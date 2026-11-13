const EventEmitter = require('events');
const { AntSensors, stepsPerMinute, noStickReason } = require('../../../src/adapters/sensors/ant');

// A fake ant-plus-next: sticks that open (or not) and sensors whose data the test emits.
function fakeAnt({ opens = { GarminStick2: true, GarminStick3: false } } = {}) {
	const made = { sticks: [], hr: [], sdm: [], power: [] };
	const stick = name => class extends EventEmitter {
		constructor() {
			super();
			this.name = name;
			made.sticks.push(this);
		}

		async open() {
			if (!opens[name]) {
				return false;
			}
			setImmediate(() => this.emit('startup'));
			return true;
		}

		async close() {
			this.closed = true;
		}

		async detach(sensor) {
			(this.detached = this.detached || []).push(sensor);
			return true;
		}
	};
	const sensor = list => class extends EventEmitter {
		constructor(s) {
			super();
			this.stick = s;
			this.attached = [];
			list.push(this);
		}

		async attach(channel, deviceId) {
			this.attached.push([channel, deviceId]);
		}

		// The low-level method takes a channel type second; calling it like attach() is the bug
		// seen on a real stick ("type not allowed").
		async attachSensor() {
			throw new Error('type not allowed');
		}
	};
	made.scanners = [];
	const scanner = kind => class extends EventEmitter {
		constructor(s) {
			super();
			this.stick = s;
			this.kind = kind;
			made.scanners.push(this);
		}

		async scan() {
			this.scanning = true;
		}
	};
	return { made, lib: { GarminStick2: stick('GarminStick2'), GarminStick3: stick('GarminStick3'), HeartRateSensor: sensor(made.hr), StrideSpeedDistanceSensor: sensor(made.sdm), BicyclePowerSensor: sensor(made.power), HeartRateScanner: scanner('hr'), StrideSpeedDistanceScanner: scanner('cadence'), BicyclePowerScanner: scanner('power') } };
}

// Never the real usb module: its hotplug listener keeps Node (and Jest) running.
const fakeUsb = () => new EventEmitter();

let sensors;
afterEach(async () => {
	if (sensors) {
		await sensors.stop();
		sensors = null;
	}
});

const tick = () => new Promise(resolve => setImmediate(resolve));

test('opens a USB2 stick and listens for any heart rate monitor, footpod and power meter', async () => {
	const { made, lib } = fakeAnt();
	sensors = new AntSensors({ loadAnt: () => lib, loadUsb: fakeUsb, wsl: false });
	await sensors.start();
	await tick();
	expect(sensors.status()).toEqual({ available: true, devices: [], scan: { active: false }, found: [] });
	const live = made.sticks.find(s => s.name === 'GarminStick2');
	expect(made.hr.find(h => h.stick === live).attached).toEqual([[0, 0]]);
	expect(made.sdm.find(h => h.stick === live).attached).toEqual([[1, 0]]);
	expect(made.power.find(h => h.stick === live).attached).toEqual([[2, 0]]);
});

test('falls back to a USB3 stick', async () => {
	const { lib } = fakeAnt({ opens: { GarminStick2: false, GarminStick3: true } });
	sensors = new AntSensors({ loadAnt: () => lib, loadUsb: fakeUsb, wsl: false });
	await sensors.start();
	expect(sensors.status().available).toBe(true);
});

test('heart rate and footpod cadence (strides → steps per minute) become readings', async () => {
	const { made, lib } = fakeAnt();
	let now = 1000;
	sensors = new AntSensors({ loadAnt: () => lib, loadUsb: fakeUsb, wsl: false, now: () => now });
	const readings = [];
	sensors.on('reading', r => readings.push(r));
	await sensors.start();
	made.hr[0].emit('heartRateData', { DeviceId: 4242, ComputedHeartRate: 138 });
	made.sdm[0].emit('ssdData', { DeviceId: 77, CadenceInteger: 85, CadenceFractional: 8 });
	expect(readings).toEqual([{ kind: 'hr', value: 138, deviceId: 4242 }, { kind: 'cadence', value: 171, deviceId: 77 }]);
	expect(sensors.latest('hr')).toEqual({ value: 138, deviceId: 4242, at: 1000 });
	expect(sensors.status().devices).toEqual([
		{ kind: 'hr', deviceId: 4242, value: 138, lastSeenAt: new Date(1000).toISOString() },
		{ kind: 'cadence', deviceId: 77, value: 171, lastSeenAt: new Date(1000).toISOString() }
	]);
	// Garbage is ignored.
	made.hr[0].emit('heartRateData', { DeviceId: 4242, ComputedHeartRate: undefined });
	made.hr[0].emit('heartRateData', { DeviceId: 4242, ComputedHeartRate: 999 });
	expect(readings).toHaveLength(2);
});

test('a sensor whose channel the stick closed (strap off, out of range) is listened for again', async () => {
	const { made, lib } = fakeAnt();
	sensors = new AntSensors({ loadAnt: () => lib, loadUsb: fakeUsb, wsl: false, reattachMs: 5, getSettings: () => ({ sensors: { antDevices: { hr: 4242 } } }) });
	await sensors.start();
	await tick();
	const hr = made.hr[0];
	hr.emit('detached');
	await new Promise(resolve => setTimeout(resolve, 20));
	expect(hr.stick.detached).toEqual([hr]);
	expect(hr.attached).toEqual([[0, 4242], [0, 4242]]);
	expect(sensors.status().available).toBe(true);
	// Data after reconnecting still becomes readings.
	const readings = [];
	sensors.on('reading', r => readings.push(r));
	hr.emit('heartRateData', { DeviceId: 4242, ComputedHeartRate: 120 });
	expect(readings).toEqual([{ kind: 'hr', value: 120, deviceId: 4242 }]);
});

test('if reopening the closed channel fails, the stick is reopened', async () => {
	const { made, lib } = fakeAnt();
	sensors = new AntSensors({ loadAnt: () => lib, loadUsb: fakeUsb, wsl: false, reattachMs: 5 });
	await sensors.start();
	await tick();
	const hr = made.hr[0];
	hr.attach = async () => { throw new Error('Cannot attach'); };
	hr.emit('detached');
	await new Promise(resolve => setTimeout(resolve, 30));
	expect(made.hr).toHaveLength(2);
	expect(made.hr[1].attached).toEqual([[0, 0]]);
	expect(sensors.status().available).toBe(true);
});

test('Stryd running power (sent as an ANT+ power meter) becomes a reading; nonsense is dropped', async () => {
	const { made, lib } = fakeAnt();
	sensors = new AntSensors({ loadAnt: () => lib, loadUsb: fakeUsb, wsl: false, now: () => 5000 });
	const readings = [];
	sensors.on('reading', r => readings.push(r));
	await sensors.start();
	made.power[0].emit('powerData', { DeviceId: 31877, Power: 248 });
	made.power[0].emit('powerData', { DeviceId: 31877, Power: 65535 });
	expect(readings).toEqual([{ kind: 'power', value: 248, deviceId: 31877 }]);
	expect(sensors.latest('power')).toEqual({ value: 248, deviceId: 31877, at: 5000 });
	expect(sensors.status().devices).toEqual([{ kind: 'power', deviceId: 31877, value: 248, lastSeenAt: new Date(5000).toISOString() }]);
});

test('without a stick the status explains how to attach it under WSL, and it keeps looking', async () => {
	jest.useFakeTimers();
	try {
		const { made, lib } = fakeAnt({ opens: { GarminStick2: false, GarminStick3: false } });
		sensors = new AntSensors({ loadAnt: () => lib, loadUsb: fakeUsb, wsl: true, retryMs: 1000 });
		await sensors.start();
		expect(sensors.status()).toMatchObject({ available: false, reason: noStickReason(true) });
		expect(sensors.status().reason).toMatch(/attach-bluetooth\.ps1 -BusId/);
		const tries = made.sticks.length;
		jest.advanceTimersByTime(1000);
		await Promise.resolve();
		expect(made.sticks.length).toBeGreaterThan(tries);
	}
	finally {
		jest.useRealTimers();
	}
});

test('a missing library is reported, not thrown', async () => {
	sensors = new AntSensors({ loadAnt: () => { throw new Error('Cannot find module'); }, loadUsb: fakeUsb, wsl: false });
	await sensors.start();
	expect(sensors.status()).toMatchObject({ available: false, reason: expect.stringMatching(/not installed/) });
});

test('removing the stick is reported and stop() closes it', async () => {
	const { made, lib } = fakeAnt();
	sensors = new AntSensors({ loadAnt: () => lib, loadUsb: fakeUsb, wsl: false });
	await sensors.start();
	const live = made.sticks.find(s => s.name === 'GarminStick2');
	live.emit('shutdown');
	expect(sensors.status()).toMatchObject({ available: false, reason: expect.stringMatching(/removed/) });
	await sensors.start();
	await sensors.stop();
	sensors = null;
});

test('an open() that hangs (stick left half-claimed) gives up and later retries succeed', async () => {
	const { made, lib } = fakeAnt();
	let hang = true;
	const realOpen = lib.GarminStick2.prototype.open;
	lib.GarminStick2.prototype.open = function () {
		return hang ? new Promise(() => {}) : realOpen.call(this);
	};
	sensors = new AntSensors({ loadAnt: () => lib, loadUsb: fakeUsb, wsl: false, retryMs: 30, openTimeoutMs: 20 });
	await sensors.start();
	expect(sensors.status().available).toBe(false);
	hang = false;
	await new Promise(resolve => setTimeout(resolve, 150));
	expect(sensors.status().available).toBe(true);
	expect(made.hr.at(-1).attached).toEqual([[0, 0]]);
});

test('a stick that opens but never starts up is released and reported', async () => {
	const { lib } = fakeAnt();
	lib.GarminStick2.prototype.open = async function () {
		this.device = { close: jest.fn() };
		return true;
	};
	sensors = new AntSensors({ loadAnt: () => lib, loadUsb: fakeUsb, wsl: false, openTimeoutMs: 20 });
	await sensors.start();
	expect(sensors.status()).toMatchObject({ available: false, reason: expect.stringMatching(/did not respond/) });
});

test('stop() releases the stick without the library close() (which resets the USB device)', async () => {
	const { made, lib } = fakeAnt();
	sensors = new AntSensors({ loadAnt: () => lib, loadUsb: fakeUsb, wsl: false });
	await sensors.start();
	const live = made.sticks.find(s => s.name === 'GarminStick2');
	const released = jest.fn((closeAll, done) => done());
	live.iface = { release: released };
	live.device = { close: jest.fn() };
	// The library's static list of devices it treats as taken.
	live.constructor.deviceInUse = [live.device];
	live.inEndpoint = Object.assign(new EventEmitter(), { stopPoll: jest.fn() });
	await sensors.stop();
	sensors = null;
	expect(live.inEndpoint.stopPoll).toHaveBeenCalled();
	expect(released).toHaveBeenCalled();
	expect(live.device.close).toHaveBeenCalled();
	expect(live.closed).toBeUndefined();
	expect(live.constructor.deviceInUse).toEqual([]);
});

test('a stick that disconnects while in use is noticed and reopened (endpoint error or USB detach)', async () => {
	const usb = new EventEmitter();
	for (const trigger of ['endpoint', 'detach']) {
		const { made, lib } = fakeAnt();
		lib.GarminStick2.prototype.open = async function () {
			this.device = { close: jest.fn() };
			this.inEndpoint = Object.assign(new EventEmitter(), { stopPoll: jest.fn() });
			setImmediate(() => this.emit('startup'));
			return true;
		};
		sensors = new AntSensors({ loadAnt: () => lib, loadUsb: () => usb, wsl: false, retryMs: 20 });
		await sensors.start();
		expect(sensors.status().available).toBe(true);
		const first = made.sticks.find(s => s.inEndpoint);
		if (trigger === 'endpoint') {
			first.inEndpoint.emit('error', new Error('LIBUSB_TRANSFER_NO_DEVICE'));
		}
		else {
			usb.emit('detach', first.device);
		}
		expect(sensors.status()).toMatchObject({ available: false, reason: expect.stringMatching(/disconnected/) });
		expect(first.device.close).toHaveBeenCalled();
		await new Promise(resolve => setTimeout(resolve, 80));
		expect(sensors.status().available).toBe(true);
		expect(made.sticks.filter(s => s.inEndpoint).length).toBeGreaterThan(1);
		await sensors.stop();
		sensors = null;
	}
	// Every stick that was watched has been released again, so no hotplug listener is left behind.
	expect(usb.listenerCount('detach')).toBe(0);
});

test('a scan lists every sensor in range by device, then reopens the channels', async () => {
	const { made, lib } = fakeAnt();
	sensors = new AntSensors({ loadAnt: () => lib, loadUsb: fakeUsb, wsl: false, scanMs: 30 });
	await sensors.start();
	const { done } = sensors.startScan();
	expect(sensors.status().scan.active).toBe(true);
	await new Promise(resolve => setTimeout(resolve, 10));
	const scanStick = made.scanners[0].stick;
	expect(made.scanners.map(s => s.kind)).toEqual(['hr', 'cadence', 'power']);
	expect(made.scanners.every(s => s.scanning && s.stick === scanStick)).toBe(true);
	const [hr, sdm, power] = made.scanners;
	// A Stryd is one device number for both its power meter and its footpod.
	power.emit('powerData', { DeviceId: 31877, Power: 250, Rssi: -60 });
	sdm.emit('ssdData', { DeviceId: 31877, CadenceInteger: 86, CadenceFractional: 0, Rssi: -60 });
	hr.emit('heartRateData', { DeviceId: 4242, ComputedHeartRate: 140, Rssi: -75, ManId: 1 });
	expect(sensors.status().found).toEqual([
		{ id: '31877', kinds: ['power', 'cadence'], values: { power: 250, cadence: 172 }, rssi: -60, manufacturer: null },
		{ id: '4242', kinds: ['hr'], values: { hr: 140 }, rssi: -75, manufacturer: 'Garmin' }
	]);
	expect(sensors.describe('31877')).toEqual({ id: '31877', kinds: ['power', 'cadence'], name: null });
	await done;
	expect(sensors.status()).toMatchObject({ available: true, scan: { active: false } });
	expect(made.hr.at(-1).stick).not.toBe(scanStick);
	expect(sensors.status().found).toHaveLength(2);
});

test('picked device numbers are used instead of the first in range', async () => {
	const { made, lib } = fakeAnt();
	const settings = { sensors: { antDevices: { power: 31877, cadence: 31877 } } };
	sensors = new AntSensors({ loadAnt: () => lib, loadUsb: fakeUsb, wsl: false, getSettings: () => settings });
	await sensors.start();
	expect(made.power.at(-1).attached).toEqual([[2, 31877]]);
	expect(made.sdm.at(-1).attached).toEqual([[1, 31877]]);
	expect(made.hr.at(-1).attached).toEqual([[0, 0]]);
	settings.sensors.antDevices.hr = 4242;
	await sensors.reconnect();
	expect(made.hr.at(-1).attached).toEqual([[0, 4242]]);
	expect(sensors.status().available).toBe(true);
});

test('scanning without a stick is refused with the reason', async () => {
	const { lib } = fakeAnt({ opens: { GarminStick2: false, GarminStick3: false } });
	sensors = new AntSensors({ loadAnt: () => lib, loadUsb: fakeUsb, wsl: false });
	await sensors.start();
	expect(() => sensors.startScan()).toThrow(expect.objectContaining({ code: 'SENSORS_UNAVAILABLE' }));
	expect(() => sensors.describe('99')).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
});

test('stepsPerMinute', () => {
	expect(stepsPerMinute({ CadenceInteger: 80, CadenceFractional: 0 })).toBe(160);
	expect(stepsPerMinute({ CadenceInteger: 0, CadenceFractional: 0 })).toBe(0);
	expect(stepsPerMinute({})).toBeNull();
});
