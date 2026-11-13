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
const { createWorkoutsRepo } = require('./storage/workoutsRepo');
const { registerPlayback } = require('./api/socket/playback');
const { registerWorkouts } = require('./api/socket/workouts');
const { mountWorkouts } = require('./api/http/workouts');
const { createZwiftDevicesRepo } = require('./storage/zwiftDevicesRepo');
const { AntSensors } = require('./adapters/sensors/ant');
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
	restart = null
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
	const antSensors = !disableSensors && (!settings.sensors || settings.sensors.ant !== false) ? new AntSensors({ getSettings }) : null;
	const bleSensors = disableSensors ? null : new BleSensors({ getSettings });
	const sensors = antSensors || bleSensors ? new SensorHub({ ant: antSensors, bluetooth: bleSensors }) : null;
	const treadmill = new MergedTreadmill({ treadmill: adapter, sensors, getSettings });
	if (antSensors) {
		let lastAnt = '';
		antSensors.on('status', s => {
			const line = s.available ? 'ANT+ stick ready, listening for heart rate and footpod' : `ANT+ unavailable: ${s.reason}`;
			if (line !== lastAnt) {
				lastAnt = line;
				(s.available ? log.info : log.warn)(line);
			}
		});
	}
	const broadcast = createBroadcast(settings, { disableBroadcast });
	const limits = () => effectiveLimits(settingsRepo.get().limits, treadmill.limits());

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
	let server;
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
	recorder.attach(engine);

	const hub = createStatusHub({ server, treadmill, broadcast, sensors, settingsRepo });
	registerControl({ server, treadmill, settingsRepo, engine });
	registerSettings({ server, settingsRepo });
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

	treadmill.on('status', status => broadcast.update({
		kph: status.connected ? status.kph : 0,
		incline: status.connected ? status.incline : 0,
		hr: status.hr,
		cadence: status.cadence,
		power: status.power
	}));

	treadmill.on('discovered', async ({ ip }) => {
		const current = settingsRepo.get();
		current.treadmill.lastIP = ip;
		await settingsRepo.replace(current).catch(err => log.warn('Could not save the treadmill address', log.safeError(err)));
	});

	let address = null;

	async function start() {
		hub.start();
		await treadmill.start();
		await broadcast.start();
		if (sensors) {
			await sensors.start();
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
		await recorder.flush();
		hub.stop();
		await Promise.allSettled([treadmill.stop(), broadcast.stop(), sensors ? sensors.stop() : null]);
		await server.close();
	}

	// `treadmill` is the adapter itself (tests drive the simulator through it); the app uses the merged view.
	return { start, stop, server, settingsRepo, devices, pairing, plansRepo, programsRepo, workoutsRepo, zwiftDevicesRepo, engine, recorder, treadmill: adapter, sensors, broadcast, limits, address: () => address };
}

module.exports = { createApp };
