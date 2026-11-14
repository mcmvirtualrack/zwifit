// Pushes `status` ({ treadmill, broadcast, sensors, antBroadcast }) to paired clients: on connect, on change, and at 1 Hz
// while the belt moves (contracts/api.md "Server → client").
const { effectiveLimits } = require('../../core/limits');
const { createOdometer, advanceOdometer } = require('../../core/session');
const { systemClock } = require('../../platform/clock');

const MIN_EMIT_GAP_MS = 250;

const { ANT_OFF, BLE_OFF } = require('../../adapters/sensors/hub');

const ANT_BROADCAST_OFF = { state: 'off', sensors: [] };

function createStatusHub({ server, treadmill, broadcast, sensors = null, antBroadcast = null, freeRun = null, settingsRepo, clock = systemClock }) {
	let treadmillStatus = { connected: false, reason: 'Starting…', kph: 0, incline: 0, hr: null, estimatedSpeed: false };
	let broadcastStatus = { available: false, reason: 'Starting…', poweredOn: false, advertising: false, clients: 0 };
	let odometer = createOdometer();
	let lastEmitAt = 0;
	let pending = null;
	let ticker = null;

	function snapshot() {
		return {
			treadmill: {
				transport: treadmill.transport,
				...treadmillStatus,
				metres: Math.round(odometer.metres),
				seconds: Math.round(odometer.seconds),
				limits: effectiveLimits(settingsRepo.get().limits, treadmill.limits()),
				capabilities: { ...treadmill.capabilities }
			},
			broadcast: { ...broadcastStatus },
			sensors: sensors ? sensors.status() : { ant: ANT_OFF, bluetooth: BLE_OFF },
			antBroadcast: antBroadcast ? antBroadcast.status() : { ...ANT_BROADCAST_OFF },
			// A run without a plan, recorded for the history (dashboard Pause / Resume / Finish).
			freeRun: freeRun ? freeRun.status() : { state: 'idle' }
		};
	}

	function emitNow() {
		pending = null;
		lastEmitAt = clock.now();
		server.io.emit('status', snapshot());
	}

	// Coalesce bursts (consoles report at 5 Hz) to at most 4 updates a second.
	function emitSoon() {
		if (pending) {
			return;
		}
		const wait = Math.max(0, MIN_EMIT_GAP_MS - (clock.now() - lastEmitAt));
		pending = clock.setTimeout(emitNow, wait);
	}

	function onTreadmillStatus(status) {
		odometer = advanceOdometer(odometer, status.connected ? status.kph : 0, clock.now());
		treadmillStatus = status;
		emitSoon();
	}

	function onBroadcastStatus(status) {
		broadcastStatus = status;
		emitSoon();
	}

	function start() {
		treadmill.on('status', onTreadmillStatus);
		broadcast.on('status', onBroadcastStatus);
		if (sensors) {
			sensors.on('status', emitSoon);
		}
		if (antBroadcast) {
			antBroadcast.on('status', emitSoon);
		}
		if (freeRun) {
			freeRun.on('status', emitSoon);
		}
		server.onConnection(socket => socket.emit('status', snapshot()));
		ticker = clock.setInterval(() => {
			if (treadmillStatus.kph > 0) {
				odometer = advanceOdometer(odometer, treadmillStatus.connected ? treadmillStatus.kph : 0, clock.now());
				emitSoon();
			}
		}, 1000);
	}

	function stop() {
		treadmill.off('status', onTreadmillStatus);
		broadcast.off('status', onBroadcastStatus);
		if (sensors) {
			sensors.off('status', emitSoon);
		}
		if (antBroadcast) {
			antBroadcast.off('status', emitSoon);
		}
		if (freeRun) {
			freeRun.off('status', emitSoon);
		}
		clock.clearInterval(ticker);
		clock.clearTimeout(pending);
		pending = null;
	}

	return { start, stop, snapshot };
}

module.exports = { createStatusHub };
