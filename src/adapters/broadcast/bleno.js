// Broadcasts the treadmill to Zwift over Bluetooth LE (ported from src/bluetooth/index.js).
// The native library is loaded inside start(); without an adapter the status says why.
const EventEmitter = require('events');
const fs = require('fs');
const os = require('os');
const { ramp } = require('../../core/session');
const ftmsCalculator = require('../../bluetooth/treadmill/calculator');
const rscCalculator = require('../../bluetooth/rsc/calculator');
const { createServices, heartRateBuffer, powerBuffer } = require('./services');

const NAME = 'Zwifit';
const UPDATE_HZ = 5;
// Heart rate sensors notify once a second.
const HR_EVERY_TICKS = UPDATE_HZ;
const SERVICE_LABELS = { ftms: 'Fitness Machine', rsc: 'Footpod', hr: 'Heart Rate', power: 'Power' };

function isWsl() {
	try {
		return /microsoft/i.test(fs.readFileSync('/proc/version', 'utf8'));
	}
	catch {
		return false;
	}
}

function noAdapterReason(wsl = isWsl()) {
	return wsl
		? 'No Bluetooth adapter found. Under WSL, run scripts/wsl/attach-bluetooth.ps1 in Windows PowerShell, then restart Zwifit.'
		: 'No Bluetooth LE adapter found. Plug one in (or switch Bluetooth on) and restart Zwifit.';
}

class BlenoBroadcast extends EventEmitter {
	constructor({ settings, bleno, loadBleno, wsl, platform = os.platform() } = {}) {
		super();
		this._settings = settings;
		this._bleno = bleno || null;
		this._loadBleno = loadBleno || (() => {
			process.env.BLENO_DEVICE_NAME = NAME;
			return require('@stoprocent/bleno');
		});
		this._wsl = wsl;
		this._platform = platform;
		this._status = { available: false, reason: 'Starting Bluetooth…', poweredOn: false, advertising: false, clients: 0, devices: [] };
		// Connected clients by HCI handle: { address, services: Set of SERVICE_LABELS values }.
		this._clients = new Map();
		this._target = { kph: 0, incline: 0, hr: 0, cadence: 0, power: 0 };
		this._ramped = { kph: 0, incline: 0, cadence: 0 };
		this._ticks = 0;
		this._timer = null;
		this._gatt = null;
		this._handlers = null;
	}

	status() {
		return { ...this._status };
	}

	_set(changes) {
		this._status = { ...this._status, ...changes };
		if (this._status.available) {
			delete this._status.reason;
		}
		this.emit('status', this.status());
	}

	async start() {
		if (this._timer) {
			return;
		}
		try {
			this._bleno = this._bleno || this._loadBleno();
		}
		catch {
			this._set({ available: false, reason: noAdapterReason(this._wsl), poweredOn: false });
			return;
		}
		const bleno = this._bleno;
		const { ftms, rsc, hr = true, power = false, ftmsPower = false } = this._settings.broadcast;
		this._ftmsPower = !!ftmsPower;
		this._gatt = createServices(bleno, { ftms, rsc, hr, power, ftmsPower, name: NAME });
		this._handlers = {
			stateChange: state => this._onState(state),
			advertisingStart: error => {
				if (error) {
					this._set({ advertising: false, reason: 'Bluetooth advertising failed. Is another program using the adapter?' });
					return;
				}
				bleno.setServices(this._gatt.services);
				this._set({ advertising: true });
			},
			accept: (address, handle) => {
				this._clients.set(handle ?? address, { address, services: new Set() });
				this._clientsChanged(address);
			},
			disconnect: (address, handle) => {
				this._clients.delete(handle ?? address);
				this._clientsChanged(null);
			}
		};
		try {
			for (const [event, handler] of Object.entries(this._handlers)) {
				bleno.on(event, handler);
			}
		}
		catch {
			// bleno opens the adapter when the first listener is added and throws "No such device"
			// when there is none (e.g. the dongle is not attached to WSL).
			for (const [event, handler] of Object.entries(this._handlers)) {
				bleno.removeListener(event, handler);
			}
			this._handlers = null;
			this._set({ available: false, reason: noAdapterReason(this._wsl), poweredOn: false });
			return;
		}
		// Which service each client reads, e.g. Zwift pairing "Run Speed" and "Heart Rate".
		for (const [kind, characteristic] of Object.entries(this._gatt.measurements)) {
			characteristic.on('subscribe', handle => this._subscription(handle, kind, true));
			characteristic.on('unsubscribe', handle => this._subscription(handle, kind, false));
		}
		// bleno reports its first state while the first listener is being added (research R2).
		if (bleno.state && bleno.state !== 'unknown') {
			this._onState(bleno.state);
		}
		this._timer = setInterval(() => this._tick(), 1000 / UPDATE_HZ);
	}

	_subscription(handle, kind, on) {
		const client = this._clients.get(handle);
		if (!client) {
			return;
		}
		client.services[on ? 'add' : 'delete'](SERVICE_LABELS[kind]);
		this._clientsChanged(client.address);
	}

	// Updates the status list and tells the app which client to remember (address, services).
	_clientsChanged(address) {
		const devices = [...this._clients.values()].map(c => ({ address: c.address, services: [...c.services] }));
		this._set({ clients: devices.length, devices });
		const client = address && devices.find(d => d.address === address);
		if (client) {
			this.emit('client', client);
		}
	}

	_onState(state) {
		if (state === 'poweredOn') {
			this._set({ available: true, poweredOn: true });
			this._bleno.startAdvertising(NAME, this._gatt.uuids);
			return;
		}
		const reason = state === 'unauthorized'
			? 'Not allowed to use Bluetooth. Run: sudo setcap cap_net_raw,cap_net_admin+eip "$(readlink -f "$(which node)")"'
			: state === 'poweredOff'
				? 'The Bluetooth adapter is switched off. Run: sudo hciconfig hci0 up'
				: noAdapterReason(this._wsl);
		this._set({ available: false, poweredOn: false, advertising: false, reason });
		try {
			this._bleno.stopAdvertising();
		}
		catch {
			// not advertising
		}
	}

	// Latest treadmill values (km/h). Sent to Zwift at 5 Hz with gentle ramping; heart rate and
	// power are passed through as reported.
	update({ kph, incline, hr, cadence, power }) {
		this._target = { kph: kph || 0, incline: incline || 0, hr: hr || 0, cadence: cadence || 0, power: power || 0 };
	}

	_tick() {
		for (const key of Object.keys(this._ramped)) {
			this._ramped[key] = ramp(this._ramped[key], this._target[key]);
		}
		// notify() sends to every subscribed client and does nothing when none is subscribed.
		// Heart rate is passed through as reported (ramping it would invent values).
		const { ftms, rsc, hr, power } = this._gatt.measurements;
		const bpm = Math.round(this._target.hr);
		const watts = Math.round(this._target.power);
		if (ftms) {
			ftms.notify(ftmsCalculator.calculateBuffer({
				kph: this._ramped.kph,
				incline: this._ramped.incline,
				hr: bpm,
				power: this._ftmsPower ? watts : 0
			}));
		}
		if (rsc) {
			rsc.notify(rscCalculator.calculateBuffer({ kph: this._ramped.kph, cadence: this._ramped.cadence }));
		}
		// Like a power meter: nothing while no sensor reports power.
		if (power && watts > 0) {
			power.notify(powerBuffer(watts));
		}
		// No pulse from the treadmill: send nothing, so Zwift shows no heart rate rather than 0.
		if (hr && bpm > 0 && this._ticks % HR_EVERY_TICKS === 0) {
			hr.notify(heartRateBuffer(bpm));
		}
		this._ticks++;
	}

	async stop() {
		clearInterval(this._timer);
		this._timer = null;
		const bleno = this._bleno;
		if (!bleno || !this._handlers) {
			return;
		}
		for (const [event, handler] of Object.entries(this._handlers)) {
			bleno.removeListener(event, handler);
		}
		this._handlers = null;
		try {
			bleno.stopAdvertising();
			// bleno can't disconnect clients on macOS.
			if (this._platform !== 'darwin' && bleno.disconnect) {
				bleno.disconnect();
			}
		}
		catch {
			// adapter already gone
		}
	}
}

module.exports = { BlenoBroadcast, noAdapterReason, NAME };
