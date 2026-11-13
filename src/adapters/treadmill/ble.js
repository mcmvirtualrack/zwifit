// iFit Bluetooth treadmill (ported from src/ble/ifit/index.js). Uses the existing iFit protocol
// helpers in src/ble/ifit/_request.js and _constants.js. Speeds are km/h at this boundary; the
// machine's own units (Metric flag) are handled inside. Out-of-range targets are rejected, not
// clamped (the old code clamped to MaxKph).
const EventEmitter = require('events');
const Constants = require('../../ble/ifit/_constants');
const { assertTarget, effectiveLimits, DEFAULT_LIMITS } = require('../../core/limits');
const { mphToKph, kphToMph } = require('../../core/units');
const { AppError } = require('../../lib/errors');
const log = require('../../lib/log');
const { scanLease } = require('../bleScanLease');

const POLL_MS = 500;
// The scan is shared with Bluetooth sensors (see bleScanLease).
const SCAN_OWNER = 'treadmill';
const C = Constants.Characteristic;

const toNumber = value => {
	const n = parseFloat(value);
	return Number.isFinite(n) ? n : null;
};

// Wraps the helper's (data, error) callbacks.
const call = (fn, ...args) => new Promise((resolve, reject) => {
	fn(...args, (data, error) => (error ? reject(new Error(String(error))) : resolve(data)));
});

class BleTreadmill extends EventEmitter {
	constructor({ settings, limits = DEFAULT_LIMITS, fallbackKph = null, noble, request, pollMs = POLL_MS } = {}) {
		super();
		this.transport = 'ble';
		this.capabilities = { canControl: true, canPause: true, canResume: true };
		const treadmill = (settings && settings.treadmill) || {};
		this._bleCode = (treadmill.bleCode || '').toLowerCase();
		this._activation = treadmill.bleActivation || null;
		this._speedOffset = (settings && settings.speedOffset) || 0;
		this._speedMultiplier = (settings && settings.speedMultiplier) || 1;
		this._limits = { ...limits };
		this._fallbackKph = fallbackKph;
		this._noble = noble;
		this._request = request;
		this._pollMs = pollMs;
		this._stopped = true;
		this._connected = false;
		this._reason = 'Looking for the treadmill over Bluetooth…';
		this._peripheral = null;
		this._equipment = null;
		this._tx = null;
		this._rx = null;
		this._poll = null;
		this._polling = false;
		this._writes = [];
		this._reported = null;
		this._lastTarget = {};
		this._state = { kph: 0, incline: 0, hr: null, estimatedSpeed: false, mode: 'Idle' };
		this._onStateChange = this._onStateChange.bind(this);
		this._onDiscover = this._onDiscover.bind(this);
	}

	async start() {
		if (!this._stopped) {
			return;
		}
		this._stopped = false;
		if (!this._bleCode) {
			this._reason = 'No Bluetooth treadmill code is set. Run setup and enter the code shown on the treadmill.';
			this._emitStatus();
			return;
		}
		try {
			this._noble = this._noble || require('@stoprocent/noble');
			this._request = this._request || require('../../ble/ifit/_request');
		}
		catch {
			this._reason = 'Bluetooth is not available on this computer (the noble library could not load).';
			this._emitStatus();
			return;
		}
		this._noble.on('stateChange', this._onStateChange);
		this._noble.on('discover', this._onDiscover);
		// noble may report its first state before our listener was attached.
		if (this._noble.state && this._noble.state !== 'unknown') {
			this._onStateChange(this._noble.state);
		}
		this._emitStatus();
	}

	async stop() {
		this._stopped = true;
		this._stopPolling();
		if (this._noble) {
			this._noble.removeListener('stateChange', this._onStateChange);
			this._noble.removeListener('discover', this._onDiscover);
			try {
				scanLease(this._noble).release(SCAN_OWNER);
			}
			catch {
				// not scanning
			}
		}
		const peripheral = this._peripheral;
		this._peripheral = null;
		if (peripheral) {
			peripheral.removeAllListeners('disconnect');
			try {
				peripheral.disconnect();
			}
			catch {
				// already gone
			}
		}
		this._connected = false;
	}

	limits() {
		return this._reported ? { ...this._reported } : null;
	}

	_onStateChange(state) {
		if (this._stopped) {
			return;
		}
		if (state === 'poweredOn') {
			this._reason = this._connected ? undefined : 'Looking for the treadmill over Bluetooth…';
			scanLease(this._noble).acquire(SCAN_OWNER);
		}
		else {
			this._reason = state === 'unauthorized'
				? 'Not allowed to use Bluetooth. See the README section on setcap.'
				: 'The Bluetooth adapter is off or missing.';
			scanLease(this._noble).release(SCAN_OWNER);
		}
		this._emitStatus();
	}

	_onDiscover(peripheral) {
		const data = peripheral.advertisement && peripheral.advertisement.manufacturerData;
		if (this._stopped || this._peripheral || !data || !data.toString('hex').toLowerCase().endsWith(`dd${this._bleCode}`)) {
			return;
		}
		scanLease(this._noble).release(SCAN_OWNER);
		this._peripheral = peripheral;
		peripheral.once('disconnect', () => this._onPeripheralDisconnect());
		this._connect(peripheral).catch(err => {
			log.warn('Could not connect to the Bluetooth treadmill', { message: err.message });
			this._reason = 'Found the treadmill but could not connect. Retrying…';
			this._emitStatus();
			try {
				peripheral.disconnect();
			}
			catch {
				this._onPeripheralDisconnect();
			}
		});
	}

	async _connect(peripheral) {
		await new Promise((resolve, reject) => peripheral.connect(error => (error ? reject(new Error(String(error))) : resolve())));
		const { tx, rx } = await new Promise((resolve, reject) => this._request.initTxAndRx(peripheral, (error, newTx, newRx) => (
			error ? reject(new Error(String(error))) : resolve({ tx: newTx, rx: newRx })
		)));
		this._tx = tx;
		this._rx = rx;
		let equipment = await call(this._request.getEquipmentInformation, tx, rx);
		equipment = { ...equipment, ...await call(this._request.getSupportedCapabilities, equipment, tx, rx) };
		equipment = { ...equipment, ...await new Promise((resolve, reject) => this._request.enable(equipment, tx, rx, (data, error) => (
			error ? reject(new Error(String(error))) : resolve(data)
		), this._activation)) };
		const reads = [C.MaxIncline, C.MinIncline, C.MaxKph, C.MinKph, C.MaxPulse, C.Metric];
		equipment = { ...equipment, ...await call(this._request.writeAndRead, equipment, undefined, reads, tx, rx) };
		this._equipment = equipment;
		this._reported = this._readLimits(equipment);
		if (this._stopped) {
			return;
		}
		this._connected = true;
		this._reason = undefined;
		log.info('Treadmill connected over Bluetooth');
		this.emit('connected');
		this._emitStatus();
		this._poll = setInterval(() => this._readCurrent(), this._pollMs);
	}

	// Machine units → km/h.
	_toKph(value) {
		const n = toNumber(value);
		if (n === null) {
			return null;
		}
		return this._equipment && this._equipment.Metric === false ? mphToKph(n) : n;
	}

	_fromKph(kph) {
		return this._equipment && this._equipment.Metric === false ? kphToMph(kph) : kph;
	}

	_readLimits(equipment) {
		const found = {
			minKph: this._toKph(equipment.MinKph),
			maxKph: this._toKph(equipment.MaxKph),
			minIncline: toNumber(equipment.MinIncline),
			maxIncline: toNumber(equipment.MaxIncline)
		};
		return Object.values(found).every(v => v !== null) ? found : null;
	}

	async _readCurrent() {
		if (this._polling || !this._connected) {
			return;
		}
		this._polling = true;
		const writes = this._writes;
		this._writes = [];
		try {
			const reads = [C.Kph, C.CurrentKph, C.CurrentIncline, C.Pulse, C.Mode];
			const data = await call(this._request.writeAndRead, this._equipment, writes.length ? writes : undefined, reads, this._tx, this._rx);
			this._applyReading(data);
		}
		catch (err) {
			if (err.message !== 'disconnected') {
				log.warn('Bluetooth treadmill read failed', { message: err.message });
			}
		}
		finally {
			this._polling = false;
		}
	}

	_applyReading(data) {
		const current = this._toKph(data.CurrentKph);
		const configured = this._toKph(data.Kph);
		// Pro-Form consoles don't report current speed: fall back to the configured speed.
		const estimated = !current && !!configured;
		let kph = estimated ? configured : (current || 0);
		kph = kph < 0.1 ? 0 : (kph + this._speedOffset) * this._speedMultiplier;
		const pulse = data.Pulse;
		this._state = {
			kph,
			incline: toNumber(data.CurrentIncline) ?? this._state.incline,
			hr: pulse && pulse.source !== Constants.PulseSource.No && pulse.pulse > 0 ? pulse.pulse : null,
			estimatedSpeed: estimated,
			mode: typeof data.Mode === 'number' ? Constants.Mode.fromId(data.Mode) : data.Mode
		};
		this._emitStatus();
	}

	_queue(characteristic, value) {
		this._writes = this._writes.filter(w => w.characteristic !== characteristic);
		this._writes.push({ characteristic, value });
	}

	_requireConnected() {
		if (!this._connected) {
			throw new AppError('NOT_CONNECTED', 'The treadmill is not connected.');
		}
	}

	async setTarget(target) {
		assertTarget(target, effectiveLimits(this._limits, this._reported));
		this._requireConnected();
		if (target.kph !== undefined) {
			this._queue(C.Kph, this._fromKph(target.kph));
			this._lastTarget.kph = target.kph;
		}
		if (target.incline !== undefined) {
			this._queue(C.Incline, target.incline);
			this._lastTarget.incline = target.incline;
		}
	}

	async pauseBelt() {
		this._requireConnected();
		this._queue(C.Mode, Constants.Mode.Pause);
	}

	async resumeBelt() {
		this._requireConnected();
		this._queue(C.Mode, Constants.Mode.Active);
		if (this._lastTarget.kph !== undefined) {
			this._queue(C.Kph, this._fromKph(this._lastTarget.kph));
		}
		if (this._lastTarget.incline !== undefined) {
			this._queue(C.Incline, this._lastTarget.incline);
		}
	}

	_stopPolling() {
		clearInterval(this._poll);
		this._poll = null;
	}

	_onPeripheralDisconnect() {
		const wasConnected = this._connected;
		this._stopPolling();
		this._connected = false;
		this._peripheral = null;
		this._equipment = null;
		this._writes = [];
		this._reason = 'Lost the Bluetooth connection to the treadmill. Looking for it again…';
		if (wasConnected) {
			this.emit('disconnected', { reason: this._reason });
		}
		this._emitStatus();
		if (!this._stopped && this._noble && this._noble.state === 'poweredOn') {
			scanLease(this._noble).acquire(SCAN_OWNER);
		}
	}

	_emitStatus() {
		const status = {
			connected: this._connected,
			kph: Math.round(this._state.kph * 100) / 100,
			incline: this._state.incline,
			hr: this._state.hr,
			estimatedSpeed: this._state.estimatedSpeed,
			mode: this._state.mode
		};
		if (this._reason) {
			status.reason = this._reason;
		}
		this.emit('status', status);
	}
}

module.exports = { BleTreadmill };
