// Deterministic treadmill for tests and `npm run start:sim`. Follows targets with a fixed ramp,
// reports heart rate from speed, and exposes hooks to simulate faults.
const EventEmitter = require('events');
const { assertTarget, DEFAULT_LIMITS } = require('../../core/limits');
const { AppError } = require('../../lib/errors');

const TICK_MS = 200;
const RAMP_KPH_PER_S = 2;
const RAMP_INCLINE_PER_S = 1;

function approach(current, target, maxStep) {
	if (Math.abs(target - current) <= maxStep) {
		return target;
	}
	return current + Math.sign(target - current) * maxStep;
}

const round = (value, places) => Math.round(value * 10 ** places) / 10 ** places;

class SimulatedTreadmill extends EventEmitter {
	constructor({ limits = DEFAULT_LIMITS, fallbackKph = null, canResume = true, heartRate = true } = {}) {
		super();
		this.transport = 'simulated';
		this.capabilities = { canControl: true, canPause: true, canResume };
		this._limits = { ...limits };
		this._fallbackKph = fallbackKph;
		this._heartRate = heartRate;
		this._reportsCurrentSpeed = true;
		this._connected = false;
		this._reason = undefined;
		this._kph = 0;
		this._incline = 0;
		this._targetKph = 0;
		this._targetIncline = 0;
		this._pausedKph = 0;
		this._timer = null;
		// What an iFit console would send, for Settings → Console output.
		this._log = [];
		this._logSeq = 0;
	}

	async start() {
		if (this._timer) {
			return;
		}
		this._connected = true;
		this._reason = undefined;
		this._timer = setInterval(() => this._tick(), TICK_MS);
		this.emit('connected');
		this._emitStatus();
	}

	async stop() {
		if (this._timer) {
			clearInterval(this._timer);
			this._timer = null;
		}
		this._connected = false;
	}

	limits() {
		return { ...this._limits };
	}

	// The same shape as the Wi-Fi console readout, from the simulated values.
	consoleReadout({ after = 0 } = {}) {
		const at = new Date().toISOString();
		const field = (key, value) => ({ key, value: String(round(value, 1)), at });
		return {
			transport: 'simulated',
			connected: this._connected,
			speedKey: 'Current KPH',
			calibrated: false,
			fields: [
				field('Actual Incline', this._incline), field('Current KPH', this._kph), field('Current MPH', this._kph / 1.609344),
				field('Incline', this._targetIncline), field('KPH', this._targetKph), field('MPH', this._targetKph / 1.609344)
			],
			log: this._log.filter(line => line.seq > after),
			logSeq: this._logSeq
		};
	}

	_requireConnected() {
		if (!this._connected) {
			throw new AppError('NOT_CONNECTED', 'The treadmill is not connected.');
		}
	}

	async setTarget(target) {
		this._requireConnected();
		assertTarget(target, this._limits);
		if (target.kph !== undefined) {
			this._targetKph = target.kph;
		}
		if (target.incline !== undefined) {
			this._targetIncline = target.incline;
		}
	}

	async pauseBelt() {
		this._requireConnected();
		this._pausedKph = this._targetKph;
		this._targetKph = 0;
	}

	async resumeBelt() {
		if (!this.capabilities.canResume) {
			throw new AppError('RESUME_UNSUPPORTED', 'This treadmill must be restarted from its console.');
		}
		this._requireConnected();
		this._targetKph = this._pausedKph;
	}

	// --- Test hooks -------------------------------------------------------------------------

	// The user presses start on the console: belt jumps to kph.
	startBelt(kph) {
		this._kph = kph;
		this._targetKph = kph;
		this._emitStatus();
	}

	simulateDisconnect(reason = 'Simulated disconnect') {
		this._connected = false;
		this._reason = reason;
		this.emit('disconnected', { reason });
		this._emitStatus();
	}

	simulateReconnect() {
		this._connected = true;
		this._reason = undefined;
		this.emit('connected');
		this._emitStatus();
	}

	// The user presses stop (or the safety key) on the console.
	simulateConsoleStop() {
		this._kph = 0;
		this._targetKph = 0;
		this._pausedKph = 0;
		this._emitStatus();
	}

	setReportsCurrentSpeed(reports) {
		this._reportsCurrentSpeed = reports;
	}

	// --- Internals --------------------------------------------------------------------------

	_tick() {
		if (this._connected) {
			const seconds = TICK_MS / 1000;
			this._kph = approach(this._kph, this._targetKph, RAMP_KPH_PER_S * seconds);
			this._incline = approach(this._incline, this._targetIncline, RAMP_INCLINE_PER_S * seconds);
		}
		this._emitStatus();
	}

	_emitStatus() {
		// Like a WebSocket 2.1 iFit console (C 990): every speed in both units, whatever it displays.
		const values = {
			KPH: this._targetKph.toFixed(1), MPH: (this._targetKph / 1.609344).toFixed(1),
			'Current KPH': this._kph.toFixed(1), 'Current MPH': (this._kph / 1.609344).toFixed(1),
			Incline: this._targetIncline.toFixed(1), 'Actual Incline': this._incline.toFixed(1)
		};
		this._log.push({ seq: ++this._logSeq, at: new Date().toISOString(), dir: 'in', text: JSON.stringify({ values }) });
		if (this._log.length > 300) {
			this._log.shift();
		}
		const estimated = !this._reportsCurrentSpeed;
		const kph = estimated ? (this._fallbackKph ?? this._targetKph) : this._kph;
		const status = {
			connected: this._connected,
			kph: round(kph, 2),
			incline: round(this._incline, 1),
			hr: this._heartRate && this._kph > 0 ? Math.round(70 + this._kph * 7) : null,
			estimatedSpeed: estimated
		};
		if (this._reason) {
			status.reason = this._reason;
		}
		this.emit('status', status);
	}
}

module.exports = { SimulatedTreadmill };
