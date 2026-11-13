// sensors:scan { transport } — looks for sensors for 15 s; what is heard appears in
//   status.sensors.<ant|bluetooth>.found. ANT+ pauses its sensors while it scans.
// sensors:connect { transport, id } — uses that sensor from now on (remembered in settings).
// sensors:forget { transport, id } — stops using it (ANT+ goes back to the first one in range).
// Paired devices only.
const { AppError } = require('../../lib/errors');

function registerSensors({ server, ant = null, bluetooth = null, settingsRepo, log }) {
	const pick = transport => {
		const sensors = transport === 'ant' ? ant : bluetooth;
		if (!sensors) {
			throw new AppError('SENSORS_UNAVAILABLE', transport === 'ant' ? 'ANT+ is switched off in Settings.' : 'Bluetooth sensors are not available.');
		}
		return sensors;
	};

	async function saveSensors(patch) {
		const current = settingsRepo.get();
		await settingsRepo.replace({ ...current, sensors: { ...current.sensors, ...patch } });
		server.io.emit('settings', settingsRepo.publicView());
	}

	const later = promise => Promise.resolve(promise).catch(err => log.warn('Sensor change did not apply', log.safeError(err)));

	server.handle('sensors:scan', 'sensors-scan', ({ payload }) => {
		const { endsAt } = pick(payload.transport).startScan();
		return { endsAt: new Date(endsAt).toISOString() };
	});

	server.handle('sensors:connect', 'sensors-connect', async ({ payload }) => {
		const sensors = pick(payload.transport);
		const sensor = sensors.describe(payload.id);
		const current = settingsRepo.get().sensors || {};
		if (payload.transport === 'ant') {
			const antDevices = { ...current.antDevices };
			for (const kind of sensor.kinds) {
				antDevices[kind] = Number(sensor.id);
			}
			await saveSensors({ antDevices });
			later(ant.reconnect());
		}
		else {
			const list = (current.bluetooth || []).filter(s => s.id !== sensor.id);
			if (list.length >= 8) {
				throw new AppError('LIMIT', 'Up to 8 Bluetooth sensors can be remembered. Forget one first.');
			}
			await saveSensors({ bluetooth: [...list, { id: sensor.id, name: sensor.name ? sensor.name.slice(0, 64) : null, kinds: sensor.kinds }] });
			bluetooth.refresh();
		}
		return sensor;
	});

	server.handle('sensors:forget', 'sensors-forget', async ({ payload }) => {
		const current = settingsRepo.get().sensors || {};
		if (payload.transport === 'ant') {
			const antDevices = { ...current.antDevices };
			for (const kind of Object.keys(antDevices)) {
				if (String(antDevices[kind]) === payload.id) {
					delete antDevices[kind];
				}
			}
			await saveSensors({ antDevices });
			if (ant) {
				later(ant.reconnect());
			}
		}
		else {
			await saveSensors({ bluetooth: (current.bluetooth || []).filter(s => s.id !== payload.id) });
			if (bluetooth) {
				bluetooth.refresh();
			}
		}
	});
}

module.exports = { registerSensors };
