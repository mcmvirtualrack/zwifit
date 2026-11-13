// ANT+ sensors through a USB stick (Garmin USB2/USB-m or USB3): heart rate from any ANT+ heart
// rate broadcaster (a chest strap, or a Garmin watch with "Broadcast Heart Rate" on), running
// cadence from a footpod (SDM; also HRM-Pro Plus) and running power from a Stryd (which sends it
// as an ANT+ power meter). Each channel takes the first sensor it finds (wildcard pairing)
// unless one was picked in Settings (settings.sensors.antDevices), so nothing needs setting up.
// startScan() lists every sensor in range so one can be picked. The native USB library is loaded
// in start(); without a stick the status says why and the stick is looked for again every 10 s.
const EventEmitter = require('events');
const fs = require('fs');
const { AppError } = require('../../lib/errors');
const { validReading } = require('./reading');

const RETRY_MS = 10 * 1000;
// Wait before reopening a channel the stick closed because its sensor went quiet.
const REATTACH_MS = 1000;
const OPEN_TIMEOUT_MS = 10 * 1000;
const SCAN_MS = 15 * 1000;

// SDM cadence is in strides per minute (one stride = two steps).
function stepsPerMinute(data) {
	if (typeof data.CadenceInteger !== 'number') {
		return null;
	}
	const strides = data.CadenceInteger + (data.CadenceFractional || 0) / 16;
	return strides > 0 ? Math.round(strides * 2) : 0;
}

// One channel per kind of sensor, with the library's sensor (one device) and scanner (all in range).
const CHANNELS = [
	{ kind: 'hr', channel: 0, sensor: 'HeartRateSensor', scanner: 'HeartRateScanner', event: 'heartRateData', value: d => d.ComputedHeartRate },
	{ kind: 'cadence', channel: 1, sensor: 'StrideSpeedDistanceSensor', scanner: 'StrideSpeedDistanceScanner', event: 'ssdData', value: stepsPerMinute },
	{ kind: 'power', channel: 2, sensor: 'BicyclePowerSensor', scanner: 'BicyclePowerScanner', event: 'powerData', value: d => d.Power }
];

// ANT+ manufacturer IDs (FIT profile) of brands that make running sensors, for friendlier names.
const MANUFACTURERS = { 1: 'Garmin', 15: 'Garmin', 23: 'Suunto', 32: 'Wahoo', 51: '4iiii', 83: 'Scosche', 95: 'Stryd', 123: 'Polar', 260: 'Zwift', 294: 'COROS', 305: 'WHOOP' };

function isWsl() {
	try {
		return /microsoft/i.test(fs.readFileSync('/proc/version', 'utf8'));
	}
	catch {
		return false;
	}
}

function noStickReason(wsl = isWsl()) {
	return wsl
		? 'No ANT+ USB stick found. Under WSL, run scripts/wsl/attach-bluetooth.ps1 -BusId <the stick\'s BUSID> in Windows PowerShell.'
		: 'No ANT+ USB stick found. Plug one in (Garmin USB-m or USB3).';
}

const withTimeout = (promise, ms, fallback) => {
	let timer;
	return Promise.race([promise, new Promise(resolve => { timer = setTimeout(() => resolve(fallback), ms); })])
		.finally(() => clearTimeout(timer));
};

// Lets go of the stick without the library's close(), which also resets the USB device: through
// usbip (WSL) that reset can leave the stick claimed by nobody, so every later open fails with
// "busy" until it is re-attached. Releasing the interface and closing the handle is enough; the
// kernel frees the rest when the process exits.
function release(stick) {
	// Lets _watch() drop its USB hotplug listener (which would otherwise keep Node running).
	if (typeof stick.emit === 'function') {
		stick.emit('released');
	}
	try {
		if (stick.inEndpoint) {
			stick.inEndpoint.removeAllListeners('data');
			stick.inEndpoint.stopPoll();
		}
	}
	catch {
		// not polling
	}
	const closeDevice = () => {
		// The library skips devices on its static "in use" list; close() would have removed it.
		const inUse = stick.constructor && stick.constructor.deviceInUse;
		const index = Array.isArray(inUse) && stick.device ? inUse.indexOf(stick.device) : -1;
		if (index >= 0) {
			inUse.splice(index, 1);
		}
		try {
			if (stick.device) {
				stick.device.close();
			}
		}
		catch {
			// already closed
		}
	};
	try {
		if (stick.iface) {
			stick.iface.release(true, closeDevice);
			return;
		}
	}
	catch {
		// not claimed
	}
	closeDevice();
}

class AntSensors extends EventEmitter {
	constructor({ loadAnt = () => require('ant-plus-next'), loadUsb = () => require('usb').usb, getSettings = () => ({}), wsl, now = Date.now, retryMs = RETRY_MS, openTimeoutMs = OPEN_TIMEOUT_MS, scanMs = SCAN_MS, reattachMs = REATTACH_MS } = {}) {
		super();
		this._reattachMs = reattachMs;
		this._reattachTimers = new Set();
		this._loadAnt = loadAnt;
		this._loadUsb = loadUsb;
		this._getSettings = getSettings;
		this._openTimeoutMs = openTimeoutMs;
		this._scanMs = scanMs;
		this._wsl = wsl;
		this._now = now;
		this._retryMs = retryMs;
		this._stick = null;
		this._timer = null;
		this._stopped = true;
		this._opening = false;
		this._scan = null;
		this._scanReason = null;
		// Sensors heard in the last scan, by device number: { id, kinds, values, rssi, manufacturer }
		this._found = new Map();
		// Latest reading per kind: { value, deviceId, at }
		this._latest = { hr: null, cadence: null, power: null };
		this._status = { available: false, reason: 'Starting ANT+…' };
		// What each device has said about itself: { manufacturer, battery }, by device number.
		this._about = new Map();
	}

	status() {
		const devices = Object.entries(this._latest)
			.filter(([, r]) => r)
			.map(([kind, r]) => ({ kind, deviceId: r.deviceId, value: r.value, lastSeenAt: new Date(r.at).toISOString(), ...this._about.get(r.deviceId) }));
		const found = [...this._found.values()]
			.map(f => ({ id: String(f.id), kinds: [...f.kinds], values: { ...f.values }, rssi: f.rssi, manufacturer: f.manufacturer, ...(this._about.get(f.id)?.battery ? { battery: this._about.get(f.id).battery } : {}) }))
			.sort((a, b) => (b.rssi ?? -999) - (a.rssi ?? -999));
		const scan = this._scan
			? { active: true, endsAt: new Date(this._scan.endsAt).toISOString() }
			: { active: false, ...(this._scanReason ? { reason: this._scanReason } : {}) };
		return { ...this._status, devices, scan, found };
	}

	latest(kind) {
		return this._latest[kind];
	}

	// The device numbers picked in Settings, by kind (missing: the first one in range).
	chosen() {
		const sensors = (this._getSettings() || {}).sensors || {};
		return { ...sensors.antDevices };
	}

	// A sensor heard in the last scan or in use now, for sensors:connect.
	describe(id) {
		const number = Number(id);
		const found = this._found.get(number);
		if (found) {
			return { id: String(number), kinds: [...found.kinds], name: found.manufacturer };
		}
		const kinds = Object.entries(this._latest).filter(([, r]) => r && r.deviceId === number).map(([kind]) => kind);
		if (!kinds.length) {
			throw new AppError('NOT_FOUND', 'That ANT+ sensor was not heard. Scan again with it awake.');
		}
		return { id: String(number), kinds, name: null };
	}

	async start() {
		if (!this._stopped) {
			return;
		}
		this._stopped = false;
		await this._open();
		this._timer = setInterval(() => {
			if (!this._stick && !this._scan) {
				this._open();
			}
		}, this._retryMs);
	}

	async stop() {
		this._stopped = true;
		clearInterval(this._timer);
		this._timer = null;
		if (this._scan) {
			this._scan.finish();
			await this._scan.done;
		}
		await this._close();
	}

	// Lists every sensor in range for scanMs. The stick cannot scan with channels open, so the
	// sensors in use pause meanwhile (the one already in use keeps reporting through the scan) and
	// are reopened afterwards. Returns at once; `done` settles when the sensors are back.
	startScan() {
		if (this._scan) {
			return { endsAt: this._scan.endsAt, done: this._scan.done };
		}
		if (!this._stick || this._stopped) {
			throw new AppError('SENSORS_UNAVAILABLE', this._status.reason || 'No ANT+ stick is ready.');
		}
		let finish;
		const ended = new Promise(resolve => { finish = resolve; });
		const timer = setTimeout(() => finish(), this._scanMs);
		this._scan = { endsAt: this._now() + this._scanMs, finish: () => { clearTimeout(timer); finish(); } };
		this._scanReason = null;
		this._found = new Map();
		this._scan.done = this._runScan(ended);
		this.emit('status', this.status());
		return { endsAt: this._scan.endsAt, done: this._scan.done };
	}

	async _runScan(ended) {
		let stick = null;
		try {
			await this._close();
			const ant = this._loadAnt();
			const opened = await this._openStick(ant);
			stick = opened.stick;
			if (!stick) {
				this._scanReason = opened.reason;
				return;
			}
			if (stick._canScan === false) {
				this._scanReason = 'This ANT+ stick cannot scan. It still connects to the first sensor of each kind it hears.';
				return;
			}
			const chosen = this.chosen();
			for (const c of CHANNELS) {
				const scanner = new ant[c.scanner](stick);
				scanner.on(c.event, data => this._heard(c, data, chosen));
				await scanner.scan();
			}
			await ended;
		}
		catch (err) {
			this._scanReason = `Could not scan: ${err.message}`;
		}
		finally {
			if (stick) {
				release(stick);
			}
			this._scan = null;
			this.emit('status', this.status());
			await this._open();
		}
	}

	_heard(c, data, chosen) {
		const id = data.DeviceId;
		if (typeof id !== 'number' || id <= 0) {
			return;
		}
		const entry = this._found.get(id) || { id, kinds: new Set(), values: {}, rssi: null, manufacturer: null };
		entry.kinds.add(c.kind);
		const value = c.value(data);
		if (validReading(c.kind, value)) {
			entry.values[c.kind] = Math.round(value);
		}
		if (typeof data.Rssi === 'number') {
			entry.rssi = data.Rssi;
		}
		if (MANUFACTURERS[data.ManId]) {
			entry.manufacturer = MANUFACTURERS[data.ManId];
		}
		this._learn(data);
		this._found.set(id, entry);
		const current = this._latest[c.kind];
		if (chosen[c.kind] === id || (!chosen[c.kind] && current && current.deviceId === id)) {
			this._reading(c.kind, id, value);
		}
		this.emit('status', this.status());
	}

	// Reopens the stick so a changed choice of sensors applies (a running scan reopens it anyway).
	async reconnect() {
		if (this._scan || this._stopped) {
			return;
		}
		const chosen = this.chosen();
		for (const kind of Object.keys(this._latest)) {
			if (this._latest[kind] && chosen[kind] && this._latest[kind].deviceId !== chosen[kind]) {
				this._latest[kind] = null;
			}
		}
		await this._close();
		this._set({ available: false, reason: 'Switching ANT+ sensors…' });
		await this._open();
	}

	_set(status) {
		this._status = status;
		this.emit('status', this.status());
	}

	// Opens the first stick that answers and waits for it to start up: { stick } or { reason }.
	async _openStick(ant) {
		for (const Stick of [ant.GarminStick2, ant.GarminStick3]) {
			let stick;
			try {
				stick = new Stick();
			}
			catch {
				continue;
			}
			// The stick sends "startup" once it is ready for channels.
			const started = new Promise(resolve => stick.once('startup', resolve));
			// A stick left half-claimed (e.g. after a crash) can make open() or startup hang, which
			// would block every later retry; both are bounded. open() can also throw outright
			// ("No such device") while usbipd re-attaches a stick that just reset.
			const opening = Promise.resolve().then(() => stick.open()).catch(() => false);
			const opened = await withTimeout(opening, this._openTimeoutMs, false);
			if (!opened) {
				release(stick);
				continue;
			}
			if (!await withTimeout(started.then(() => true), this._openTimeoutMs, false)) {
				release(stick);
				return { reason: 'The ANT+ stick did not respond. Unplug it and plug it back in (under WSL: re-run attach-bluetooth.ps1).' };
			}
			return { stick };
		}
		return { reason: noStickReason(this._wsl) };
	}

	async _open() {
		if (this._opening || this._stopped || this._scan) {
			return;
		}
		this._opening = true;
		try {
			let ant;
			try {
				ant = this._loadAnt();
			}
			catch {
				this._set({ available: false, reason: 'ANT+ support is not installed in this build.' });
				return;
			}
			const { stick, reason } = await this._openStick(ant);
			if (!stick) {
				this._set({ available: false, reason });
				return;
			}
			stick.on('shutdown', () => {
				if (this._stick === stick) {
					this._stick = null;
					this._set({ available: false, reason: 'The ANT+ stick was removed. Looking for it again…' });
				}
			});
			const chosen = this.chosen();
			try {
				// deviceId 0 = the first sensor of that type in range. (The sensors' own method is
				// attach(channel, deviceId); attachSensor() is the low-level one with a channel type.)
				await Promise.all(CHANNELS.map(c => {
					const sensor = new ant[c.sensor](stick);
					sensor.on(c.event, data => {
						this._learn(data);
						this._reading(c.kind, data.DeviceId, c.value(data));
					});
					sensor.on('detached', () => this._reattach(stick, c, sensor));
					return sensor.attach(c.channel, chosen[c.kind] || 0);
				}));
			}
			catch (err) {
				release(stick);
				this._set({ available: false, reason: `ANT+ stick found but could not listen: ${err.message}` });
				return;
			}
			this._stick = stick;
			this._watch(stick);
			this._set({ available: true });
		}
		catch (err) {
			// e.g. the stick vanished mid-open while usbipd re-attaches it; the retry timer tries again.
			this._stick = null;
			this._set({ available: false, reason: `Could not open the ANT+ stick (${err.message}). Trying again…` });
		}
		finally {
			this._opening = false;
		}
	}

	// Notices the stick going away while in use (unplugged, or under WSL dropped and re-attached
	// by usbipd) so the retry timer opens it again, instead of waiting on a dead handle forever.
	_watch(stick) {
		const lost = () => this._lost(stick);
		if (stick.inEndpoint && typeof stick.inEndpoint.on === 'function') {
			stick.inEndpoint.on('error', lost);
		}
		let usb = null;
		try {
			usb = this._loadUsb();
		}
		catch {
			// no hotplug events; the endpoint error still applies
		}
		if (usb && typeof usb.on === 'function') {
			const onDetach = device => {
				if (device === stick.device) {
					lost();
				}
			};
			usb.on('detach', onDetach);
			stick.once('released', () => usb.removeListener('detach', onDetach));
		}
	}

	_lost(stick) {
		if (this._stick !== stick) {
			return;
		}
		this._stick = null;
		release(stick);
		this._set({ available: false, reason: 'The ANT+ stick disconnected. Reconnecting…' });
	}

	// A sensor that stops sending (strap taken off, out of range) makes the stick close its channel;
	// the library then unassigns it and emits "detached". Without reopening it, that sensor would
	// not be heard again until Zwifit restarts. If reopening fails, the whole stick is reopened.
	_reattach(stick, c, sensor) {
		const current = () => this._stick === stick && !this._stopped && !this._scan;
		if (!current()) {
			return;
		}
		// Frees the stick's count of channels in use, which the library leaves taken.
		Promise.resolve().then(() => stick.detach && stick.detach(sensor)).catch(() => {});
		const timer = setTimeout(async () => {
			this._reattachTimers.delete(timer);
			if (!current()) {
				return;
			}
			try {
				await sensor.attach(c.channel, this.chosen()[c.kind] || 0);
			}
			catch {
				await this._close();
				this._set({ available: false, reason: 'Reconnecting the ANT+ stick…' });
				await this._open();
			}
		}, this._reattachMs);
		this._reattachTimers.add(timer);
	}

	async _close() {
		for (const timer of this._reattachTimers) {
			clearTimeout(timer);
		}
		this._reattachTimers.clear();
		const stick = this._stick;
		this._stick = null;
		if (stick) {
			release(stick);
		}
	}

	// Maker and battery, from the common data pages a sensor sends now and then.
	_learn(data) {
		if (typeof data.DeviceId !== 'number') {
			return;
		}
		const about = { ...this._about.get(data.DeviceId) };
		if (MANUFACTURERS[data.ManId]) {
			about.manufacturer = MANUFACTURERS[data.ManId];
		}
		if (typeof data.BatteryLevel === 'number' && data.BatteryLevel > 0 && data.BatteryLevel <= 100) {
			about.battery = `${Math.round(data.BatteryLevel)}%`;
		}
		else if (typeof data.BatteryStatus === 'string' && data.BatteryStatus !== 'Invalid') {
			about.battery = data.BatteryStatus.toLowerCase();
		}
		if (about.manufacturer || about.battery) {
			this._about.set(data.DeviceId, about);
		}
	}

	_reading(kind, deviceId, value) {
		if (!validReading(kind, value)) {
			return;
		}
		this._latest[kind] = { value: Math.round(value), deviceId, at: this._now() };
		this.emit('reading', { kind, value: Math.round(value), deviceId });
	}
}

module.exports = { AntSensors, stepsPerMinute, noStickReason, MANUFACTURERS };
