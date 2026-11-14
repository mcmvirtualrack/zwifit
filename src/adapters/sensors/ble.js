// Bluetooth LE sensors: heart rate (Heart Rate 0x180D: straps, watches, arm bands), running power
// (Cycling Power 0x1818, which is how a Stryd sends it) and cadence (Running Speed and Cadence
// 0x1814: Stryd, footpods). Nothing connects on its own: the user scans, picks a sensor, and it is
// remembered (settings.sensors.bluetooth) and reconnected whenever it is in range. The Bluetooth
// library is only loaded once there is a sensor to look for, so a setup without Bluetooth
// sensors never touches the adapter.
const EventEmitter = require('events');
const { AppError } = require('../../lib/errors');
const log = require('../../lib/log');
const { scanLease } = require('../bleScanLease');
const { validReading } = require('./reading');

const SCAN_MS = 15 * 1000;
const RECONNECT_EVERY_MS = 30 * 1000;
const RECONNECT_SCAN_MS = 8 * 1000;
const CONNECT_TIMEOUT_MS = 15 * 1000;
// Sensors seen this recently are listed when a scan starts (the shared scan may not report them again).
const RECENT_MS = 60 * 1000;
const SERVICES = { '180d': 'hr', 1818: 'power', 1814: 'cadence' };
const MEASUREMENTS = { '2a37': 'hr', '2a63': 'power', '2a53': 'cadence' };
// Battery Service (0x180F) / Battery Level (0x2A19), read once after connecting.
const BATTERY_SERVICE = '180f';
const BATTERY_LEVEL = '2a19';
const SCAN_OWNER = 'sensors-scan';
const RECONNECT_OWNER = 'sensors-reconnect';

// '0000180d-0000-1000-8000-00805f9b34fb' or '180D' → '180d'
function shortUuid(uuid) {
	const u = String(uuid).toLowerCase().replace(/-/g, '');
	return u.length === 32 && u.startsWith('0000') && u.endsWith('00001000800000805f9b34fb') ? u.slice(4, 8) : u;
}

// Decodes a measurement notification: heart rate in bpm, power in watts, cadence in steps per
// minute (the RSC cadence field, which Zwifit's own RSC broadcast also fills with steps per minute).
function parse(kind, data) {
	if (!Buffer.isBuffer(data) || data.length < 2) {
		return null;
	}
	if (kind === 'hr') {
		return data[0] & 1 ? (data.length >= 3 ? data.readUInt16LE(1) : null) : data.readUInt8(1);
	}
	if (kind === 'power') {
		return data.length >= 4 ? data.readInt16LE(2) : null;
	}
	return data.length >= 4 ? data.readUInt8(3) : null;
}

const withTimeout = (promise, ms, message) => {
	let timer;
	return Promise.race([promise, new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })])
		.finally(() => clearTimeout(timer));
};

class BleSensors extends EventEmitter {
	// blockedReason(): why Bluetooth sensors must stay off right now (e.g. they would share the
	// adapter with the Zwift broadcast), or null. While blocked, noble is not used at all.
	// 'adapter-reset' is emitted after noble resets the adapter (it does on start and before each
	// connection), which drops every connection on it and ends any advertising.
	constructor({ getSettings = () => ({}), loadNoble = () => require('@stoprocent/noble'), blockedReason = () => null, now = Date.now, scanMs = SCAN_MS, reconnectMs = RECONNECT_EVERY_MS, reconnectScanMs = RECONNECT_SCAN_MS, connectTimeoutMs = CONNECT_TIMEOUT_MS } = {}) {
		super();
		this._getSettings = getSettings;
		this._blockedReason = blockedReason;
		this._hookedHci = null;
		this._loadNoble = loadNoble;
		this._now = now;
		this._scanMs = scanMs;
		this._reconnectMs = reconnectMs;
		this._reconnectScanMs = reconnectScanMs;
		this._connectTimeoutMs = connectTimeoutMs;
		this._noble = null;
		this._loadError = false;
		this._stopped = true;
		this._timer = null;
		this._scanTimer = null;
		this._reconnectTimer = null;
		this._scanEndsAt = null;
		// Every sensor peripheral heard: id → { peripheral, name, kinds: Set, rssi, at }
		this._seen = new Map();
		// Ids heard in the last scan.
		this._found = new Set();
		// id → { state: 'connecting' | 'connected', peripheral }
		this._links = new Map();
		this._latest = { hr: null, cadence: null, power: null };
		this._onDiscover = this._onDiscover.bind(this);
		this._onState = state => {
			this._hookReset();
			if (state === 'poweredOn') {
				// noble reset the adapter on its way to poweredOn.
				this.emit('adapter-reset');
			}
			this._changed();
		};
		this._onHciReset = () => this.emit('adapter-reset');
	}

	saved() {
		const sensors = (this._getSettings() || {}).sensors || {};
		return Array.isArray(sensors.bluetooth) ? sensors.bluetooth : [];
	}

	latest(kind) {
		return this._latest[kind];
	}

	_blocked() {
		return this._blockedReason() || null;
	}

	_reason() {
		const blocked = this._blocked();
		if (blocked) {
			return blocked;
		}
		if (this._loadError) {
			return 'Bluetooth is not available on this computer (the noble library could not load).';
		}
		if (!this._noble) {
			return null;
		}
		const state = this._noble.state;
		if (state === 'poweredOn') {
			return null;
		}
		if (state === 'unauthorized') {
			return 'Not allowed to use Bluetooth. See the README section on setcap.';
		}
		return !state || state === 'unknown' ? 'Starting Bluetooth…' : 'The Bluetooth adapter is off or missing.';
	}

	status() {
		const reason = this._reason();
		const describe = id => {
			const s = this._seen.get(id);
			return { id, name: s.name, kinds: [...s.kinds], rssi: s.rssi, values: this._values(id), ...(s.battery ? { battery: s.battery } : {}) };
		};
		const devices = Object.entries(this._latest)
			.filter(([, r]) => r)
			.map(([kind, r]) => ({ kind, deviceId: r.deviceId, value: r.value, lastSeenAt: new Date(r.at).toISOString() }));
		return {
			available: !reason || reason === 'Starting Bluetooth…',
			...(reason ? { reason } : {}),
			scan: this._scanEndsAt ? { active: true, endsAt: new Date(this._scanEndsAt).toISOString() } : { active: false },
			found: [...this._found].filter(id => this._seen.has(id)).map(describe).sort((a, b) => (b.rssi ?? -999) - (a.rssi ?? -999)),
			connections: this.saved().map(s => ({
				id: s.id, name: s.name, kinds: s.kinds,
				state: this._links.has(s.id) ? this._links.get(s.id).state : 'searching',
				...(this._seen.get(s.id)?.battery ? { battery: this._seen.get(s.id).battery } : {})
			})),
			devices
		};
	}

	_values(id) {
		const values = {};
		for (const [kind, r] of Object.entries(this._latest)) {
			if (r && r.deviceId === id) {
				values[kind] = r.value;
			}
		}
		return values;
	}

	// A sensor heard nearby, for sensors:connect.
	describe(id) {
		const s = this._seen.get(id);
		if (!s) {
			throw new AppError('NOT_FOUND', 'That Bluetooth sensor is not in range. Scan again with it awake.');
		}
		return { id, name: s.name, kinds: [...s.kinds] };
	}

	async start() {
		if (!this._stopped) {
			return;
		}
		this._stopped = false;
		if (this.saved().length && !this._blocked()) {
			this._load();
		}
		this._timer = setInterval(() => this._sweep(), this._reconnectMs);
		this._sweep();
	}

	async stop() {
		this._stopped = true;
		clearInterval(this._timer);
		clearTimeout(this._scanTimer);
		clearTimeout(this._reconnectTimer);
		this._timer = null;
		this._scanEndsAt = null;
		if (this._noble) {
			scanLease(this._noble).release(SCAN_OWNER);
			scanLease(this._noble).release(RECONNECT_OWNER);
			this._noble.removeListener('discover', this._onDiscover);
			this._noble.removeListener('stateChange', this._onState);
		}
		if (this._hookedHci) {
			this._hookedHci.removeListener('reset', this._onHciReset);
			this._hookedHci = null;
		}
		for (const id of [...this._links.keys()]) {
			this._drop(id);
		}
	}

	// noble's HCI layer (Linux) says when it resets the adapter; created once noble starts.
	_hookReset() {
		const hci = this._noble && this._noble._bindings && this._noble._bindings._hci;
		if (hci && hci !== this._hookedHci && typeof hci.on === 'function') {
			if (this._hookedHci) {
				this._hookedHci.removeListener('reset', this._onHciReset);
			}
			hci.on('reset', this._onHciReset);
			this._hookedHci = hci;
		}
	}

	// Loads noble once; false when Bluetooth cannot be used at all.
	_load() {
		if (this._noble) {
			return true;
		}
		if (this._loadError) {
			return false;
		}
		try {
			this._noble = this._loadNoble();
		}
		catch {
			this._loadError = true;
			this._changed();
			return false;
		}
		this._noble.on('discover', this._onDiscover);
		this._noble.on('stateChange', this._onState);
		this._hookReset();
		return true;
	}

	// Lists the sensors in range for scanMs. Returns at once.
	startScan() {
		const blocked = this._blocked();
		if (blocked) {
			throw new AppError('SENSORS_UNAVAILABLE', blocked);
		}
		if (!this._load() || this._noble.state !== 'poweredOn') {
			throw new AppError('SENSORS_UNAVAILABLE', this._reason() || 'Bluetooth is not ready.');
		}
		if (!this._scanEndsAt) {
			const since = this._now() - RECENT_MS;
			this._found = new Set([...this._seen].filter(([, s]) => s.at >= since).map(([id]) => id));
			this._scanEndsAt = this._now() + this._scanMs;
			scanLease(this._noble).acquire(SCAN_OWNER);
			this._scanTimer = setTimeout(() => {
				this._scanEndsAt = null;
				scanLease(this._noble).release(SCAN_OWNER);
				this._changed();
			}, this._scanMs);
			this._changed();
		}
		return { endsAt: this._scanEndsAt };
	}

	// Applies the saved list: connects sensors that were added (when in range), drops removed ones.
	refresh() {
		const saved = new Set(this.saved().map(s => s.id));
		for (const id of [...this._links.keys()]) {
			if (!saved.has(id)) {
				this._drop(id);
			}
		}
		if (saved.size && !this._blocked() && this._load()) {
			for (const id of saved) {
				if (this._seen.has(id) && !this._links.has(id)) {
					this._connect(id);
				}
			}
			this._sweep();
		}
		this._changed();
	}

	// Saved sensors not connected: scan for them for a while (they connect when heard).
	_sweep() {
		if (this._stopped || this._blocked() || !this._noble || this._noble.state !== 'poweredOn') {
			return;
		}
		if (!this.saved().some(s => !this._links.has(s.id))) {
			return;
		}
		const lease = scanLease(this._noble);
		if (lease.holds(RECONNECT_OWNER)) {
			return;
		}
		lease.acquire(RECONNECT_OWNER);
		clearTimeout(this._reconnectTimer);
		this._reconnectTimer = setTimeout(() => lease.release(RECONNECT_OWNER), this._reconnectScanMs);
	}

	_onDiscover(peripheral) {
		const ad = peripheral.advertisement || {};
		const kinds = (ad.serviceUuids || []).map(u => SERVICES[shortUuid(u)]).filter(Boolean);
		const id = peripheral.id;
		const known = this._seen.get(id);
		const saved = this.saved().find(s => s.id === id);
		if (!kinds.length && !known && !saved) {
			return;
		}
		const entry = known || { kinds: new Set(saved ? saved.kinds : []) };
		entry.peripheral = peripheral;
		entry.name = ad.localName || entry.name || (saved && saved.name) || null;
		entry.rssi = typeof peripheral.rssi === 'number' ? peripheral.rssi : entry.rssi ?? null;
		entry.at = this._now();
		kinds.forEach(k => entry.kinds.add(k));
		this._seen.set(id, entry);
		const isNew = this._scanEndsAt && !this._found.has(id);
		if (this._scanEndsAt) {
			this._found.add(id);
		}
		if (saved && !this._links.has(id) && !this._stopped && !this._blocked()) {
			this._connect(id);
		}
		else if (isNew) {
			this._changed();
		}
	}

	async _connect(id) {
		const entry = this._seen.get(id);
		const peripheral = entry.peripheral;
		const link = { state: 'connecting', peripheral };
		this._links.set(id, link);
		if (this._noble) {
			// Connecting while scanning fails on some adapters; the user's own scan is left running.
			scanLease(this._noble).release(RECONNECT_OWNER);
		}
		this._changed();
		peripheral.once('disconnect', () => {
			if (this._links.get(id) === link) {
				this._links.delete(id);
				this._changed();
			}
		});
		try {
			await withTimeout(peripheral.connectAsync(), this._connectTimeoutMs, 'timed out');
			const { characteristics } = await peripheral.discoverSomeServicesAndCharacteristicsAsync([...Object.keys(SERVICES), BATTERY_SERVICE], [...Object.keys(MEASUREMENTS), BATTERY_LEVEL]);
			let listening = 0;
			for (const characteristic of characteristics) {
				if (shortUuid(characteristic.uuid) === BATTERY_LEVEL) {
					this._readBattery(entry, characteristic);
					continue;
				}
				const kind = MEASUREMENTS[shortUuid(characteristic.uuid)];
				if (!kind) {
					continue;
				}
				characteristic.on('data', data => this._reading(kind, id, parse(kind, data)));
				await characteristic.subscribeAsync();
				entry.kinds.add(kind);
				listening++;
			}
			if (!listening) {
				throw new Error('it has no heart rate, power or cadence data');
			}
			if (this._links.get(id) !== link) {
				return;
			}
			link.state = 'connected';
			log.info(`Bluetooth sensor connected: ${entry.name || id}`);
			this._changed();
		}
		catch (err) {
			log.warn(`Could not connect to the Bluetooth sensor ${entry.name || id}`, { message: err.message });
			if (this._links.get(id) === link) {
				this._links.delete(id);
			}
			this._disconnect(peripheral);
			this._changed();
		}
	}

	async _readBattery(entry, characteristic) {
		try {
			const data = typeof characteristic.readAsync === 'function' ? await characteristic.readAsync() : null;
			if (Buffer.isBuffer(data) && data.length && data[0] <= 100) {
				entry.battery = `${data[0]}%`;
				this._changed();
			}
		}
		catch {
			// battery level is optional
		}
	}

	_drop(id) {
		const link = this._links.get(id);
		this._links.delete(id);
		for (const kind of Object.keys(this._latest)) {
			if (this._latest[kind] && this._latest[kind].deviceId === id) {
				this._latest[kind] = null;
			}
		}
		if (link) {
			this._disconnect(link.peripheral);
		}
	}

	_disconnect(peripheral) {
		try {
			if (typeof peripheral.cancelConnect === 'function' && peripheral.state === 'connecting') {
				peripheral.cancelConnect();
			}
			else {
				peripheral.disconnect();
			}
		}
		catch {
			// already gone
		}
	}

	_changed() {
		this.emit('status', this.status());
	}

	_reading(kind, id, value) {
		if (!validReading(kind, value)) {
			return;
		}
		this._latest[kind] = { value: Math.round(value), deviceId: id, at: this._now() };
		this.emit('reading', { kind, value: Math.round(value), deviceId: id });
	}
}

module.exports = { BleSensors, parse, shortUuid };
