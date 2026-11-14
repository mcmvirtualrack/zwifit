// Builds the whole app from its parts: settings, pairing, treadmill and broadcast adapters, and the
// control server. app.js (the entry point) only parses options and calls createApp().start().
const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');
const paths = require('./platform/paths');
const log = require('./lib/log');
const { AppError } = require('./lib/errors');
const { createSettingsRepo } = require('./storage/settingsRepo');
const { createDevicesRepo } = require('./storage/devicesRepo');
const { createRateLimit } = require('./security/rateLimit');
const { createPairing } = require('./security/pairing');
const treadmillFactory = require('./adapters/treadmill');
const broadcastFactory = require('./adapters/broadcast');
const { NullBroadcast } = require('./adapters/broadcast/null');
const { createServer } = require('./api/server');
const { createStatusHub } = require('./api/socket/status');
const { registerControl } = require('./api/socket/control');
const { registerSettings } = require('./api/socket/settings');
const { registerPlans } = require('./api/socket/plans');
const { registerPrograms } = require('./api/socket/programs');
const { mountPlans } = require('./api/http/plans');
const { createPlansRepo } = require('./storage/plansRepo');
const { createProgramsRepo } = require('./storage/programsRepo');
const { migrateRoutes } = require('./core/plans/migrateRoutes');
const { demoPlan } = require('./core/plans/demo');
const { effectiveLimits } = require('./core/limits');
const { PlaybackEngine } = require('./core/playback/engine');
const { createRecorder } = require('./core/history/recorder');
const { FreeRunTracker } = require('./core/history/freeRun');
const { createWorkoutsRepo } = require('./storage/workoutsRepo');
const { registerPlayback } = require('./api/socket/playback');
const { registerWorkouts } = require('./api/socket/workouts');
const { mountWorkouts } = require('./api/http/workouts');
const { createZwiftDevicesRepo } = require('./storage/zwiftDevicesRepo');
const { AntSensors } = require('./adapters/sensors/ant');
const { AntBroadcast } = require('./adapters/antBroadcast');
const { registerAntBroadcast } = require('./api/socket/antBroadcast');
const { BleSensors } = require('./adapters/sensors/ble');
const { SensorHub } = require('./adapters/sensors/hub');
const { registerSensors } = require('./api/socket/sensors');
const { MergedTreadmill } = require('./core/sensorMerge');
const { registerZwiftDevices } = require('./api/socket/zwiftDevices');
const { systemClock } = require('./platform/clock');
const ids = require('./lib/ids');

// Imports the old routes.conf as plans, once. The legacy file is left as it is.
async function migrateLegacyRoutes({ legacyDir, settingsRepo, plansRepo }) {
	const settings = settingsRepo.get();
	if (settings.migrations && settings.migrations.routesV1) {
		return;
	}
	const file = path.join(legacyDir, 'routes.conf');
	if (fs.existsSync(file)) {
		try {
			const { plans, problems } = migrateRoutes(yaml.load(fs.readFileSync(file, 'utf8')));
			for (const plan of plans) {
				await plansRepo.importPlan(plan);
			}
			log.info(`Imported ${plans.length} route(s) from the old routes.conf as plans`);
			for (const problem of problems) {
				log.warn('Could not import part of a route', problem);
			}
		}
		catch (err) {
			log.warn('Could not import the old routes.conf', { message: err.message });
		}
	}
	await settingsRepo.replace({ ...settingsRepo.get(), migrations: { ...settings.migrations, routesV1: true } });
}

// Adds the "Demo" plan once (also to existing installs). Deleting it is fine: it is not re-added.
async function addDemoPlan({ settingsRepo, plansRepo }) {
	const settings = settingsRepo.get();
	if (settings.migrations && settings.migrations.demoPlanV1) {
		return;
	}
	try {
		await plansRepo.importPlan(demoPlan({ metric: settings.metric }));
	}
	catch (err) {
		log.warn('Could not add the demo plan', { message: err.message });
	}
	const current = settingsRepo.get();
	await settingsRepo.replace({ ...current, migrations: { ...current.migrations, demoPlanV1: true } });
}

// Addresses to print for the control page: the LAN IPv4 addresses when listening on all
// interfaces (phones need those, and "localhost" can resolve to IPv6 first on Windows).
function reachableHosts(bound) {
	if (bound !== '0.0.0.0' && bound !== '::') {
		return [bound.includes(':') ? `[${bound}]` : bound];
	}
	const lan = Object.values(os.networkInterfaces()).flat()
		.filter(a => a && a.family === 'IPv4' && !a.internal)
		.map(a => a.address);
	return [...new Set(lan), '127.0.0.1'];
}

function createBroadcast(settings, { disableBroadcast }) {
	try {
		return broadcastFactory.create(settings, { disabled: disableBroadcast });
	}
	catch (err) {
		if (err.code === 'MODULE_NOT_FOUND') {
			return new NullBroadcast({ reason: 'Zwift broadcast is not available in this build yet.' });
		}
		throw err;
	}
}

async function createApp({
	dataDir = paths.dataDir(),
	legacyDir = paths.legacyDir(),
	simulate = false,
	disableBroadcast = false,
	disableSensors = false,
	demoPlan: withDemoPlan = true,
	printCode,
	port,
	host,
	// Called by Settings → Restart Zwifit; null when nothing would start Zwifit again.
	restart = null,
	// Test doubles for the ANT+ stick ({ loadAnt, loadUsb, wsl }); also opens it with disableSensors.
	ant = null
} = {}) {
	paths.ensureDataDir(dataDir);
	const settingsRepo = createSettingsRepo({ dir: dataDir, legacyDir });
	const { source } = await settingsRepo.init();
	if (source === 'settings.conf') {
		log.info('Imported settings from the old settings.conf');
	}

	const devices = createDevicesRepo({ dir: dataDir });
	await devices.load();
	const pairing = createPairing({ dir: dataDir, devices, rateLimit: createRateLimit(), ...(printCode ? { printCode } : {}) });
	await pairing.load();
	const newCode = await pairing.ensureCode();

	const settings = settingsRepo.get();
	const adapter = treadmillFactory.create(settings, { simulate });
	// ANT+ and Bluetooth heart rate (watch, strap), cadence and power (footpod, Stryd), merged into
	// the treadmill's status.
	const getSettings = () => settingsRepo.get();
	// One ANT+ stick for both: reception of ANT+ sensors (channels 0–2, if ANT+ sensors are on) and
	// the ANT+ broadcast (channels 3–6, specs/003). It is opened when either is on at start;
	// turning the broadcast on later with neither needs a restart (the status says so).
	const antListening = !settings.sensors || settings.sensors.ant !== false;
	const antBroadcasting = !!(settings.antBroadcast && settings.antBroadcast.enabled);
	const antStick = (!disableSensors || ant) && (antListening || antBroadcasting)
		? new AntSensors({ getSettings, listen: () => (getSettings().sensors || {}).ant !== false, ...ant })
		: null;
	// ANT+ sensors (Settings → Sensors) only when switched on; otherwise the stick only broadcasts.
	const antSensors = antListening ? antStick : null;
	// Bluetooth sensors (noble) and the Zwift broadcast (bleno) on one Linux adapter: noble resets the
	// adapter when it starts and before every connection, which drops Zwift and ends advertising.
	// So Bluetooth sensors stay off while they would share it, unless allowed in Settings → Sensors.
	let zwiftBroadcast = null;
	const sharedAdapter = os.platform() === 'linux' && (process.env.NOBLE_HCI_DEVICE_ID || '0') === (process.env.BLENO_HCI_DEVICE_ID || '0');
	const bluetoothBlocked = () => {
		if (!sharedAdapter || !zwiftBroadcast || typeof zwiftBroadcast.adapterReset !== 'function') {
			return null;
		}
		if ((getSettings().sensors || {}).bluetoothWithZwift) {
			return null;
		}
		return 'Off while Zwifit broadcasts to Zwift on the same Bluetooth adapter: connecting to a Bluetooth sensor would drop Zwift. Use ANT+, or allow Bluetooth sensors below.';
	};
	const bleSensors = disableSensors ? null : new BleSensors({ getSettings, blockedReason: bluetoothBlocked });
	const sensors = antSensors || bleSensors ? new SensorHub({ ant: antSensors, bluetooth: bleSensors }) : null;
	const treadmill = new MergedTreadmill({ treadmill: adapter, sensors, getSettings });
	// One console line per change of state (statuses repeat often). describe(s) returns
	// { ok, line }, or null while still starting.
	const logStatus = (emitter, describe, { now = false } = {}) => {
		let last = '';
		const show = s => {
			const entry = describe(s);
			if (entry && entry.line !== last) {
				last = entry.line;
				(entry.ok ? log.info : log.warn)(entry.line);
			}
		};
		emitter.on('status', show);
		if (now) {
			show(emitter.status());
		}
	};
	const starting = reason => reason === 'Starting Bluetooth…' || reason === 'Starting…';
	if (antStick) {
		logStatus(antStick, s => s.available
			? { ok: true, line: antSensors ? 'ANT+ stick ready, listening for heart rate and footpod' : 'ANT+ stick ready (for the ANT+ broadcast only)' }
			: { ok: false, line: `ANT+ unavailable: ${s.reason}` });
	}
	if (bleSensors) {
		// Bluetooth sensors are only looked for once one has been chosen (Settings → Sensors).
		logStatus(bleSensors, s => {
			if (s.reason) {
				return starting(s.reason) ? null : { ok: false, line: `Bluetooth sensors unavailable: ${s.reason}` };
			}
			const names = (s.connections || []).map(c => c.name || c.id);
			return names.length
				? { ok: true, line: `Bluetooth ready, listening for sensors: ${names.join(', ')}` }
				: { ok: true, line: 'Bluetooth sensors: none chosen yet (Settings → Sensors → Scan for sensors)' };
		}, { now: true });
	}
	const broadcast = createBroadcast(settings, { disableBroadcast });
	zwiftBroadcast = broadcast;
	// When Bluetooth sensors are allowed anyway: advertise to Zwift again after each noble reset.
	if (bleSensors && typeof broadcast.adapterReset === 'function') {
		bleSensors.on('adapter-reset', () => broadcast.adapterReset());
	}
	logStatus(broadcast, s => {
		if (s.advertising) {
			const clients = s.clients ? `, ${s.clients} Zwift device(s) connected` : ', waiting for Zwift to connect';
			return { ok: true, line: `Bluetooth broadcast ready, advertising as "Zwifit"${clients}` };
		}
		return !s.reason || starting(s.reason) ? null : { ok: false, line: `Bluetooth broadcast unavailable: ${s.reason}` };
	});
	const limits = () => effectiveLimits(settingsRepo.get().limits, treadmill.limits());
	let server;
	const antBroadcast = new AntBroadcast({
		host: antStick,
		getSettings,
		getLimits: limits,
		saveDeviceNumbers: async deviceNumbers => {
			const current = settingsRepo.get();
			await settingsRepo.replace({ ...current, antBroadcast: { ...current.antBroadcast, deviceNumbers } });
			if (server) {
				server.io.emit('settings', settingsRepo.publicView());
			}
		}
	});
	logStatus(antBroadcast, s => {
		if (s.state === 'broadcasting') {
			const list = s.sensors.map(x => `${x.kind} #${x.deviceNumber}`).join(', ');
			return { ok: true, line: `ANT+ broadcast ready: ${list}` };
		}
		if (s.state === 'error') {
			return { ok: false, line: `ANT+ broadcast unavailable: ${s.reason}` };
		}
		if (s.state === 'paused') {
			return { ok: true, line: `ANT+ broadcast ${s.reason.toLowerCase()}` };
		}
		return null;
	});

	const plansRepo = createPlansRepo({ dir: dataDir, getLimits: limits });
	await plansRepo.load();
	await migrateLegacyRoutes({ legacyDir, settingsRepo, plansRepo });
	if (withDemoPlan) {
		await addDemoPlan({ settingsRepo, plansRepo });
	}

	const programsRepo = createProgramsRepo({ dir: dataDir });
	await programsRepo.load();

	const zwiftDevicesRepo = createZwiftDevicesRepo({ dir: dataDir });
	await zwiftDevicesRepo.load();

	const workoutsRepo = createWorkoutsRepo({ dir: dataDir });
	const { recovered } = await workoutsRepo.load();
	if (recovered.length) {
		log.info(`Recovered ${recovered.length} workout(s) interrupted by a restart`);
	}

	// Always idle on start: nothing a previous run was doing resumes (FR-015a).
	const engine = new PlaybackEngine({
		adapter: treadmill,
		clock: systemClock,
		getLimits: limits,
		getSettings: () => settingsRepo.get(),
		log
	});
	treadmill.on('status', status => engine.onStatus(status));

	const tls = settings.server.tls && settings.server.tls.certPath ? settings.server.tls : null;
	const plansChanged = id => server.io.emit('plans:changed', { id });
	server = createServer({
		pairing,
		devices,
		tls,
		routes: (router, guards) => {
			mountPlans(router, { ...guards, plansRepo, onChanged: plansChanged });
			mountWorkouts(router, { ...guards, workoutsRepo, settingsRepo });
		}
	});
	const recorder = createRecorder({
		repo: workoutsRepo,
		newId: ids.newId,
		onChanged: id => server.io.emit('workouts:changed', { id }),
		log
	});
	// Runs without a plan (belt started from the console or Start) go into the history as "Free run".
	// Created before the recorder attaches to the engine, so a plan starting ends the free run first.
	const freeRun = new FreeRunTracker({ engine });
	treadmill.on('status', status => freeRun.onStatus(status));
	recorder.attach(engine);
	recorder.attach(freeRun);

	const hub = createStatusHub({ server, treadmill, broadcast, sensors, antBroadcast, freeRun, settingsRepo });
	registerControl({ server, treadmill, settingsRepo, engine, freeRun });
	registerSettings({ server, settingsRepo, onChange: () => {
		antBroadcast.refresh();
		// "Allow Bluetooth sensors" may have changed.
		if (bleSensors) {
			bleSensors.refresh();
		}
	} });
	registerAntBroadcast({ server, antBroadcast, log });
	registerPlans({ server, plansRepo, isRunning: id => engine.runningPlanId() === id });
	registerPlayback({ server, engine, plansRepo });
	registerPrograms({ server, programsRepo, plansRepo, workoutsRepo, engine, getLimits: limits });
	registerWorkouts({ server, workoutsRepo });
	registerZwiftDevices({ server, repo: zwiftDevicesRepo, broadcast, log });
	registerSensors({ server, ant: antSensors, bluetooth: bleSensors, settingsRepo, log });
	// Settings → Console readout: every field the treadmill console sent, as it sent it.
	server.handle('treadmill:console', 'treadmill-console', ({ payload }) => (adapter.consoleReadout
		? adapter.consoleReadout({ after: payload.after || 0 })
		: { transport: adapter.transport, speedKey: null, calibrated: false, fields: [], log: [], logSeq: 0 }));
	server.handle('server:restart', null, ({ device }) => {
		if (!restart) {
			throw new AppError('RESTART_UNSUPPORTED', 'Zwifit was started without its restart helper. Restart it from its console (Ctrl+C, then npm start).');
		}
		if (engine.isActive()) {
			throw new AppError('PLAN_RUNNING', 'Stop the running plan before restarting Zwifit.');
		}
		log.info(`Restart requested by "${device.name}"`);
		restart();
		return { restarting: true };
	});

	// The belt's measured speed goes to Zwift as is. A treadmill adapter that doesn't say (Bluetooth
	// FTMS, simulator) reports its real speed; only a set or estimated speed is eased.
	treadmill.on('status', status => broadcast.update({
		kph: status.connected ? status.kph : 0,
		measuredSpeed: !status.estimatedSpeed && status.speedSource !== 'set' && status.speedSource !== 'estimated',
		incline: status.connected ? status.incline : 0,
		hr: status.hr,
		cadence: status.cadence,
		power: status.power
	}));
	// Same values for the ANT+ broadcast, with their sources (FR-006: ANT+ values aren't sent back).
	treadmill.on('status', status => antBroadcast.update({
		...status,
		kph: status.connected ? status.kph : 0,
		incline: status.connected ? status.incline : 0
	}));

	treadmill.on('discovered', async ({ ip }) => {
		const current = settingsRepo.get();
		current.treadmill.lastIP = ip;
		await settingsRepo.replace(current).catch(err => log.warn('Could not save the treadmill address', log.safeError(err)));
	});

	let address = null;

	async function start() {
		hub.start();
		freeRun.start();
		await treadmill.start();
		await broadcast.start();
		// Before the stick opens, so the broadcast hears its 'stick' event.
		await antBroadcast.start();
		if (sensors) {
			await sensors.start();
		}
		if (antStick && !antSensors) {
			await antStick.start();
		}
		address = await server.listen(port ?? settings.server.port, host ?? settings.server.host);
		const scheme = server.secure ? 'https' : 'http';
		for (const host of reachableHosts(address.address)) {
			log.info(`Control page: ${scheme}://${host}:${address.port}/`);
			if (server.securePort) {
				log.info(`Control page: https://${host}:${server.securePort}/`);
			}
		}
		if (!newCode) {
			log.info('Pair a new phone or tablet with the code shown when Zwifit first ran, or run "npm run pair" for a new one.');
		}
		return address;
	}

	async function stop() {
		engine.dispose();
		freeRun.stop();
		await recorder.flush();
		hub.stop();
		// The broadcast closes its channels before the stick is let go.
		await antBroadcast.stop();
		await Promise.allSettled([treadmill.stop(), broadcast.stop(), sensors ? sensors.stop() : null, antStick && !antSensors ? antStick.stop() : null]);
		await server.close();
	}

	// `treadmill` is the adapter itself (tests drive the simulator through it); the app uses the merged view.
	return { start, stop, server, settingsRepo, devices, pairing, plansRepo, programsRepo, workoutsRepo, zwiftDevicesRepo, engine, recorder, freeRun, treadmill: adapter, sensors, broadcast, antBroadcast, limits, address: () => address };
}

module.exports = { createApp };
