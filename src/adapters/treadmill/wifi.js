// iFit Wi-Fi treadmill (ported from src/ifit.js): JSON over ws://<ip>/control. Speeds are km/h
// at this boundary; the adapter sends whichever unit the console itself reports.
const EventEmitter = require('events');
const { assertTarget, effectiveLimits, DEFAULT_LIMITS } = require('../../core/limits');
const { mphToKph, kphToMph } = require('../../core/units');
const { AppError } = require('../../lib/errors');
const log = require('../../lib/log');
const { scan } = require('./scan');

const RECONNECT_MS = 10 * 1000;
// At most this many console fields are kept for the readout.
const MAX_CONSOLE_FIELDS = 80;
// Raw messages kept for Settings → Console output (newest last), each cut to MAX_LOG_TEXT.
const MAX_LOG = 300;
const MAX_LOG_TEXT = 2000;

const toNumber = value => {
	const n = parseFloat(value);
	return Number.isFinite(n) ? n : null;
};

class WifiTreadmill extends EventEmitter {
	constructor({ settings, limits = DEFAULT_LIMITS, fallbackKph = null, canResume = true, WebSocketImpl = globalThis.WebSocket, scanner = scan, reconnectMs = RECONNECT_MS } = {}) {
		super();
		this.transport = 'wifi';
		this.capabilities = { canControl: true, canPause: true, canResume };
		const treadmill = (settings && settings.treadmill) || {};
		this._ip = treadmill.ip || null;
		this._lastIP = treadmill.lastIP || null;
		this._speedOffset = (settings && settings.speedOffset) || 0;
		this._speedMultiplier = (settings && settings.speedMultiplier) || 1;
		this._limits = { ...limits };
		this._fallbackKph = fallbackKph;
		this._WebSocket = WebSocketImpl;
		this._scanner = scanner;
		this._reconnectMs = reconnectMs;
		this._socket = null;
		this._timer = null;
		this._scanning = false;
		this._stopped = true;
		this._connected = false;
		this._reason = 'Connecting to the treadmill…';
		this._speedUnit = null;
		this._lastTargetKph = null;
		this._reportedLimits = null;
		this._state = { kph: 0, incline: 0, hr: null, cadence: null };
		this._pulse = { 'Chest Pulse': null, 'Hand Pulse': null };
		this._reportsCurrent = false;
		this._setKph = null;
		// The console's latest value of every field it sent, for Settings → Console readout.
		this._console = new Map();
		this._log = [];
		this._logSeq = 0;
		this._startKph = null;
		this._resumeKph = null;
		this._workoutType = null;
	}

	async start() {
		if (!this._stopped) {
			return;
		}
		this._stopped = false;
		this._timer = setInterval(() => this._ensureConnected(), this._reconnectMs);
		this._ensureConnected();
	}

	async stop() {
		this._stopped = true;
		clearInterval(this._timer);
		this._timer = null;
		const socket = this._socket;
		this._socket = null;
		if (socket) {
			socket.onclose = null;
			try {
				socket.close();
			}
			catch {
				// already closed
			}
		}
		this._connected = false;
	}

	// What the console says it supports (its first message has "Minimum KPH" etc.), or null.
	limits() {
		return this._reportedLimits ? { ...this._reportedLimits } : null;
	}

	_readLimits(values) {
		const kph = (metric, imperial) => {
			const k = toNumber(values[metric]);
			if (k !== null) {
				return k;
			}
			const m = toNumber(values[imperial]);
			return m === null ? null : mphToKph(m);
		};
		const found = {
			minKph: kph('Minimum KPH', 'Minimum MPH'),
			maxKph: kph('Maximum KPH', 'Maximum MPH'),
			minIncline: toNumber(values['Minimum Incline']),
			maxIncline: toNumber(values['Maximum Incline'])
		};
		if (Object.values(found).every(v => v !== null)) {
			this._reportedLimits = found;
		}
	}

	async _ensureConnected() {
		if (this._stopped || this._socket || this._scanning) {
			return;
		}
		let host = this._ip;
		if (!host) {
			this._scanning = true;
			this._reason = 'Searching your network for the treadmill…';
			this._emitStatus();
			try {
				host = await this._scanner({ preferred: [this._lastIP, '127.0.0.1', '127.0.0.1:8080'] });
			}
			catch (err) {
				log.warn('Treadmill scan failed', { message: err.message });
			}
			this._scanning = false;
			if (this._stopped) {
				return;
			}
			if (!host) {
				this._reason = 'No treadmill found on the network. Check it is on and on the same Wi-Fi, or set its IP in Settings.';
				this._emitStatus();
				return;
			}
			this._lastIP = host;
			this.emit('discovered', { ip: host });
		}
		this._open(host);
	}

	_open(host) {
		let socket;
		try {
			socket = new this._WebSocket(`ws://${host}/control`);
		}
		catch (err) {
			this._reason = `Could not connect to the treadmill at ${host}.`;
			this._emitStatus();
			return;
		}
		this._socket = socket;
		socket.onopen = () => {
			if (this._socket !== socket) {
				return;
			}
			this._connected = true;
			this._reason = undefined;
			log.info('Treadmill connected over Wi-Fi', { host });
			this.emit('connected');
			this._emitStatus();
		};
		socket.onmessage = event => this._onMessage(event.data);
		socket.onerror = () => {};
		socket.onclose = () => {
			if (this._socket !== socket) {
				return;
			}
			const wasConnected = this._connected;
			this._socket = null;
			this._connected = false;
			this._reason = `Lost connection to the treadmill at ${host}. Retrying…`;
			if (wasConnected) {
				this.emit('disconnected', { reason: this._reason });
			}
			this._emitStatus();
		};
	}

	_onMessage(data) {
		this._logLine('in', String(data));
		let parsed;
		try {
			parsed = JSON.parse(String(data));
		}
		catch {
			return;
		}
		const values = parsed && typeof parsed === 'object' && parsed.values ? parsed.values : parsed;
		if (!values || typeof values !== 'object') {
			return;
		}
		this._remember(values);
		if (values['Maximum KPH'] !== undefined || values['Maximum MPH'] !== undefined) {
			this._readLimits(values);
		}
		let changed = false;
		// "KPH"/"MPH" also tell us which unit the console takes commands in. Newer consoles
		// (WebSocket 2.1, e.g. NordicTrack C 990) use them for the set speed and report the belt's
		// real speed as "Current KPH"/"Current MPH"; once seen, those win.
		if (values.KPH !== undefined) {
			this._speedUnit = 'KPH';
			this._setKph = toNumber(values.KPH);
		}
		else if (values.MPH !== undefined) {
			this._speedUnit = this._speedUnit || 'MPH';
			const mph = toNumber(values.MPH);
			this._setKph = mph === null ? null : mphToKph(mph);
		}
		// For resumeBelt(): the console's own start speed, and whether it still has a workout open
		// ("NONE" once it has ended; the belt must then be started from the console).
		if (values['Start KPH'] !== undefined || values['Start MPH'] !== undefined) {
			const kph = toNumber(values['Start KPH']);
			const mph = toNumber(values['Start MPH']);
			this._startKph = kph !== null ? kph : (mph === null ? null : mphToKph(mph));
		}
		if (values['Workout Type'] !== undefined) {
			this._workoutType = String(values['Workout Type']);
		}
		if (values['Current KPH'] !== undefined || values['Current MPH'] !== undefined) {
			this._reportsCurrent = true;
		}
		const [kphKey, mphKey] = this._reportsCurrent ? ['Current KPH', 'Current MPH'] : ['KPH', 'MPH'];
		let reported = null;
		if (values[kphKey] !== undefined) {
			reported = toNumber(values[kphKey]);
		}
		else if (values[mphKey] !== undefined) {
			const mph = toNumber(values[mphKey]);
			reported = mph === null ? null : mphToKph(mph);
		}
		if (reported !== null) {
			this._state.kph = this._calibrate(reported);
			changed = true;
		}
		// "Incline" is the set point; "Actual Incline" (newer consoles) is where the deck is now.
		const incline = toNumber(values['Actual Incline'] !== undefined ? values['Actual Incline'] : values.Incline);
		if (incline !== null) {
			this._state.incline = incline;
			changed = true;
		}
		// Chest strap first, then the hand grips; 0 means no reading from that sensor.
		for (const key of ['Chest Pulse', 'Hand Pulse']) {
			if (values[key] !== undefined) {
				const bpm = toNumber(values[key]);
				this._pulse[key] = bpm && bpm > 0 ? bpm : null;
				changed = true;
			}
		}
		if (changed) {
			this._state.hr = this._pulse['Chest Pulse'] || this._pulse['Hand Pulse'] || null;
		}
		if (values.Cadence !== undefined) {
			this._state.cadence = toNumber(values.Cadence);
			changed = true;
		}
		if (changed) {
			this._emitStatus();
		}
	}

	_remember(values) {
		const at = new Date().toISOString();
		for (const [key, value] of Object.entries(values)) {
			if (this._console.size >= MAX_CONSOLE_FIELDS && !this._console.has(key)) {
				break;
			}
			if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
				this._console.set(String(key).slice(0, 40), { value: value === null ? null : String(value).slice(0, 40), at });
			}
		}
	}

	// Every field the console sent (latest value and when), and which one Zwifit reads speed from.
	consoleReadout({ after = 0 } = {}) {
		const speedKey = this._reportsCurrent ? (this._console.has('Current KPH') ? 'Current KPH' : 'Current MPH') : (this._speedUnit || 'KPH');
		return {
			transport: 'wifi',
			connected: this._connected,
			speedKey,
			calibrated: this._speedOffset !== 0 || this._speedMultiplier !== 1,
			fields: [...this._console].map(([key, v]) => ({ key, value: v.value, at: v.at })).sort((a, b) => a.key.localeCompare(b.key)),
			// Raw messages after sequence number `after` ("in" from the console, "out" = commands sent).
			log: this._log.filter(line => line.seq > after),
			logSeq: this._logSeq
		};
	}

	_calibrate(kph) {
		if (kph < 0.1) {
			return 0;
		}
		return (kph + this._speedOffset) * this._speedMultiplier;
	}

	_send(values) {
		if (!this._connected || !this._socket) {
			throw new AppError('NOT_CONNECTED', 'The treadmill is not connected.');
		}
		const text = JSON.stringify({ type: 'set', values });
		this._socket.send(text);
		this._logLine('out', text);
	}

	_logLine(dir, text) {
		this._log.push({ seq: ++this._logSeq, at: new Date().toISOString(), dir, text: text.slice(0, MAX_LOG_TEXT) });
		if (this._log.length > MAX_LOG) {
			this._log.shift();
		}
	}

	_speedValues(kph) {
		return this._speedUnit === 'MPH'
			? { MPH: kphToMph(kph).toFixed(1) }
			: { KPH: kph.toFixed(1) };
	}

	async setTarget(target) {
		assertTarget(target, effectiveLimits(this._limits, this._reportedLimits));
		const values = {};
		if (target.kph !== undefined) {
			Object.assign(values, this._speedValues(target.kph));
		}
		if (target.incline !== undefined) {
			values.Incline = String(target.incline);
		}
		this._send(values);
		if (target.kph !== undefined) {
			this._lastTargetKph = target.kph;
		}
	}

	// Speed 0 stops the belt but leaves the console's workout open, so resumeBelt() can restart it
	// at the speed it was set to (checked on a NordicTrack C 990).
	async pauseBelt() {
		const was = this._setKph > 0 ? this._setKph : this._lastTargetKph;
		this._send(this._speedValues(0));
		if (was > 0) {
			this._resumeKph = was;
		}
		this._lastTargetKph = 0;
	}

	async resumeBelt() {
		if (!this.capabilities.canResume) {
			throw new AppError('RESUME_UNSUPPORTED', 'Restart the belt from the treadmill console.');
		}
		if (this._workoutType === 'NONE') {
			throw new AppError('RESUME_UNSUPPORTED', 'The treadmill has ended its workout. Start the belt from the treadmill console.');
		}
		const limits = effectiveLimits(this._limits, this._reportedLimits);
		const kph = this._resumeKph || this._startKph || limits.minKph;
		assertTarget({ kph }, limits);
		this._send(this._speedValues(kph));
		this._lastTargetKph = kph;
	}

	_emitStatus() {
		// Some consoles (e.g. Pro-Form) never report speed: once we have sent a target and still
		// heard no speed, show that target as an estimate.
		const estimated = this._connected && this._speedUnit === null && this._lastTargetKph !== null;
		const kph = estimated ? this._lastTargetKph : this._state.kph;
		const status = {
			connected: this._connected,
			kph: Math.round(kph * 100) / 100,
			incline: this._state.incline,
			hr: this._state.hr,
			estimatedSpeed: estimated
		};
		if (this._state.cadence !== null) {
			status.cadence = this._state.cadence;
		}
		if (this._reason) {
			status.reason = this._reason;
		}
		this.emit('status', status);
	}
}

module.exports = { WifiTreadmill };
