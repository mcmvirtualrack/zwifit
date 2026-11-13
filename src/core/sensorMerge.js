// Wraps the treadmill adapter so its status carries the best heart rate and cadence available:
// an ANT+ or Bluetooth sensor (watch, strap, footpod) while it is reporting, otherwise the
// treadmill's own; plus running power, which only a sensor (Stryd) gives.
// Everything else (commands, limits, capabilities) is the treadmill's, so the dashboard, Zwift
// broadcast, playback and workout history all see one merged status.
const EventEmitter = require('events');

// A sensor reading older than this no longer counts (the watch stopped broadcasting).
const FRESH_MS = 5000;
// Where a reading may come from. auto: ANT+ first, then Bluetooth, then the treadmill (heart rate,
// cadence); sensor: ANT+ or Bluetooth, whichever is newer (an older setting).
const SOURCES = ['auto', 'ant', 'ble', 'treadmill', 'off', 'sensor'];
const POWER_SOURCES = ['auto', 'ant', 'ble', 'off'];
// Power is averaged over this many seconds (1 = as sent).
const SMOOTHING = [1, 3, 10];
const DEFAULT_SMOOTHING_S = 3;
const NONE = { value: null, source: null };

const fresh = (reading, now) => (reading && now - reading.at <= FRESH_MS && reading.value > 0 ? reading : null);

// The reading to use for one kind: { value, source: 'ant' | 'ble' | 'treadmill' | null }.
// from(source) gives the latest sensor reading from 'ant' or 'ble'.
function pick(mode, treadmillValue, from, now) {
	const own = treadmillValue > 0 ? { value: treadmillValue, source: 'treadmill' } : NONE;
	const sensor = source => {
		const r = fresh(from(source), now);
		return r ? { value: r.value, source } : NONE;
	};
	switch (mode) {
		case 'off': return NONE;
		case 'treadmill': return own;
		case 'ant': return sensor('ant');
		case 'ble': return sensor('ble');
		case 'sensor': {
			const [a, b] = [fresh(from('ant'), now), fresh(from('ble'), now)];
			const r = a && (!b || a.at >= b.at) ? { ...a, source: 'ant' } : b ? { ...b, source: 'ble' } : null;
			return r ? { value: r.value, source: r.source } : NONE;
		}
		default: {
			const ant = sensor('ant');
			if (ant.value !== null) {
				return ant;
			}
			const ble = sensor('ble');
			return ble.value !== null ? ble : own;
		}
	}
}

class MergedTreadmill extends EventEmitter {
	constructor({ treadmill, sensors, getSettings, now = Date.now }) {
		super();
		this._treadmill = treadmill;
		this._sensors = sensors;
		this._getSettings = getSettings;
		this._now = now;
		this._last = null;
		// Recent power readings, for smoothing: { at, value, source }
		this._powerLog = [];
		this.transport = treadmill.transport;
		this.capabilities = treadmill.capabilities;
		treadmill.on('status', status => {
			this._last = status;
			this._emit();
		});
		for (const event of ['connected', 'disconnected', 'discovered']) {
			treadmill.on(event, payload => this.emit(event, payload));
		}
		if (sensors) {
			sensors.on('reading', reading => {
				if (reading && reading.kind === 'power') {
					const at = this._now();
					this._powerLog = [...this._powerLog.filter(r => at - r.at <= 15000), { at, value: reading.value, source: reading.source || 'ant' }];
				}
				this._emit();
			});
		}
	}

	_settings() {
		return (this._getSettings() || {}).sensors || {};
	}

	_mode(kind) {
		const s = this._settings();
		if (kind === 'power') {
			return POWER_SOURCES.includes(s.powerSource) ? s.powerSource : 'auto';
		}
		const mode = kind === 'hr' ? s.hrSource : s.cadenceSource;
		return SOURCES.includes(mode) ? mode : 'auto';
	}

	// The latest reading of a kind from 'ant' or 'ble' (a single-transport sensors object counts as ANT+).
	_from(kind) {
		const sensors = this._sensors;
		return source => {
			if (!sensors) {
				return null;
			}
			if (typeof sensors.latestFrom === 'function') {
				return sensors.latestFrom(kind, source);
			}
			const reading = sensors.latest(kind);
			return reading && (reading.source || 'ant') === source ? reading : null;
		};
	}

	// Power averaged over the chosen seconds, from the same source as the latest reading.
	_smooth(power, now) {
		const seconds = SMOOTHING.includes(this._settings().powerSmoothing) ? this._settings().powerSmoothing : DEFAULT_SMOOTHING_S;
		if (seconds <= 1) {
			return power.value;
		}
		const recent = this._powerLog.filter(r => r.source === power.source && now - r.at < seconds * 1000 && r.value > 0);
		return recent.length ? Math.round(recent.reduce((sum, r) => sum + r.value, 0) / recent.length) : power.value;
	}

	merge(status) {
		const now = this._now();
		// A disconnected treadmill's last pulse and cadence are stale; sensor readings still count.
		const own = kind => (status.connected ? status[kind] : null);
		const hr = pick(this._mode('hr'), own('hr'), this._from('hr'), now);
		const cadence = pick(this._mode('cadence'), own('cadence'), this._from('cadence'), now);
		const merged = { ...status, hr: hr.value, hrSource: hr.source };
		delete merged.cadence;
		if (cadence.value !== null) {
			merged.cadence = cadence.value;
			merged.cadenceSource = cadence.source;
		}
		delete merged.power;
		const power = pick(this._mode('power'), null, this._from('power'), now);
		if (power.value !== null) {
			merged.power = this._smooth(power, now);
			merged.powerSource = power.source;
		}
		return merged;
	}

	_emit() {
		if (this._last) {
			this.emit('status', this.merge(this._last));
		}
	}

	limits() {
		return this._treadmill.limits();
	}

	start() {
		return this._treadmill.start();
	}

	stop() {
		return this._treadmill.stop();
	}

	setTarget(target) {
		return this._treadmill.setTarget(target);
	}

	pauseBelt() {
		return this._treadmill.pauseBelt();
	}

	resumeBelt() {
		return this._treadmill.resumeBelt();
	}
}

module.exports = { MergedTreadmill, FRESH_MS, SOURCES, POWER_SOURCES, SMOOTHING };
