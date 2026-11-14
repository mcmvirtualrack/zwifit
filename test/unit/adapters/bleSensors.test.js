const EventEmitter = require('events');
const { BleSensors, parse, shortUuid } = require('../../../src/adapters/sensors/ble');
const { SensorHub } = require('../../../src/adapters/sensors/hub');
const { scanLease } = require('../../../src/adapters/bleScanLease');

// A fake noble with one peripheral per advertised sensor.
function fakeNoble() {
	const noble = new EventEmitter();
	noble.state = 'poweredOn';
	noble.startScanning = jest.fn();
	noble.stopScanning = jest.fn();
	return noble;
}

function fakePeripheral(id, { name, services, measurements = [] }) {
	const p = new EventEmitter();
	p.id = id;
	p.rssi = -58;
	p.advertisement = { localName: name, serviceUuids: services };
	p.characteristics = measurements.map(uuid => Object.assign(new EventEmitter(), { uuid, subscribeAsync: jest.fn(async () => {}) }));
	p.connectAsync = jest.fn(async () => {});
	p.discoverSomeServicesAndCharacteristicsAsync = jest.fn(async () => ({ characteristics: p.characteristics }));
	p.disconnect = jest.fn(() => p.emit('disconnect'));
	return p;
}

const tick = () => new Promise(resolve => setImmediate(resolve));

let ble;
afterEach(async () => {
	if (ble) {
		await ble.stop();
		ble = null;
	}
});

test('measurements decode to bpm, watts and steps per minute', () => {
	expect(parse('hr', Buffer.from([0x00, 142]))).toBe(142);
	expect(parse('hr', Buffer.from([0x01, 0x2c, 0x01]))).toBe(300);
	expect(parse('power', Buffer.from([0x00, 0x00, 0xf8, 0x00]))).toBe(248);
	expect(parse('cadence', Buffer.from([0x00, 0x00, 0x03, 172]))).toBe(172);
	expect(parse('power', Buffer.from([0x00]))).toBeNull();
	expect(shortUuid('0000180D-0000-1000-8000-00805F9B34FB')).toBe('180d');
	expect(shortUuid('2A37')).toBe('2a37');
});

test('nothing loads Bluetooth until there is a sensor to look for', async () => {
	const loadNoble = jest.fn(fakeNoble);
	ble = new BleSensors({ loadNoble });
	await ble.start();
	expect(loadNoble).not.toHaveBeenCalled();
	expect(ble.status()).toMatchObject({ available: true, scan: { active: false }, found: [], connections: [] });
});

test('a scan lists heart rate, power and cadence sensors with what they measure', async () => {
	const noble = fakeNoble();
	ble = new BleSensors({ loadNoble: () => noble, scanMs: 20 });
	await ble.start();
	ble.startScan();
	expect(noble.startScanning).toHaveBeenCalledWith([], true);
	noble.emit('discover', fakePeripheral('aa01', { name: 'Polar H10', services: ['180d'] }));
	noble.emit('discover', fakePeripheral('aa02', { name: 'Stryd', services: ['1818', '1814'] }));
	noble.emit('discover', fakePeripheral('aa03', { name: 'Headphones', services: ['110b'] }));
	const { found } = ble.status();
	expect(found.map(f => [f.id, f.name, f.kinds])).toEqual([['aa01', 'Polar H10', ['hr']], ['aa02', 'Stryd', ['power', 'cadence']]]);
	await new Promise(resolve => setTimeout(resolve, 40));
	expect(ble.status().scan.active).toBe(false);
	expect(noble.stopScanning).toHaveBeenCalled();
	expect(ble.describe('aa02')).toEqual({ id: 'aa02', name: 'Stryd', kinds: ['power', 'cadence'] });
	expect(() => ble.describe('zz')).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
});

test('a saved sensor connects, reports readings and is dropped when forgotten', async () => {
	const noble = fakeNoble();
	const settings = { sensors: { bluetooth: [] } };
	ble = new BleSensors({ loadNoble: () => noble, getSettings: () => settings, now: () => 1000 });
	const readings = [];
	ble.on('reading', r => readings.push(r));
	await ble.start();
	ble.startScan();
	const stryd = fakePeripheral('aa02', { name: 'Stryd', services: ['1818', '1814'], measurements: ['2a63', '2a53'] });
	noble.emit('discover', stryd);
	settings.sensors.bluetooth = [{ id: 'aa02', name: 'Stryd', kinds: ['power', 'cadence'] }];
	ble.refresh();
	await tick();
	await tick();
	expect(ble.status().connections).toEqual([{ id: 'aa02', name: 'Stryd', kinds: ['power', 'cadence'], state: 'connected' }]);
	stryd.characteristics[0].emit('data', Buffer.from([0, 0, 0xf8, 0]));
	stryd.characteristics[1].emit('data', Buffer.from([0, 0, 3, 170]));
	expect(readings).toEqual([{ kind: 'power', value: 248, deviceId: 'aa02' }, { kind: 'cadence', value: 170, deviceId: 'aa02' }]);
	const hub = new SensorHub({ bluetooth: ble });
	expect(hub.latest('power')).toEqual({ value: 248, deviceId: 'aa02', at: 1000, source: 'ble' });

	settings.sensors.bluetooth = [];
	ble.refresh();
	expect(stryd.disconnect).toHaveBeenCalled();
	expect(ble.latest('power')).toBeNull();
	expect(ble.status().connections).toEqual([]);
});

test('a saved sensor out of range is searched for and connects when it shows up', async () => {
	jest.useFakeTimers();
	try {
		const noble = fakeNoble();
		const settings = { sensors: { bluetooth: [{ id: 'aa01', name: 'Polar H10', kinds: ['hr'] }] } };
		ble = new BleSensors({ loadNoble: () => noble, getSettings: () => settings, reconnectMs: 1000, reconnectScanMs: 500 });
		await ble.start();
		expect(ble.status().connections[0].state).toBe('searching');
		expect(noble.startScanning).toHaveBeenCalledTimes(1);
		jest.advanceTimersByTime(500);
		expect(noble.stopScanning).toHaveBeenCalledTimes(1);
		jest.advanceTimersByTime(500);
		expect(noble.startScanning).toHaveBeenCalledTimes(2);
		const strap = fakePeripheral('aa01', { name: 'Polar H10', services: ['180d'], measurements: ['2a37'] });
		noble.emit('discover', strap);
		expect(strap.connectAsync).toHaveBeenCalled();
		expect(ble.status().connections[0].state).toBe('connecting');
	}
	finally {
		jest.useRealTimers();
	}
});

test('scanning with the adapter off is refused with the reason', () => {
	const noble = fakeNoble();
	noble.state = 'poweredOff';
	ble = new BleSensors({ loadNoble: () => noble });
	expect(() => ble.startScan()).toThrow(expect.objectContaining({ code: 'SENSORS_UNAVAILABLE', message: expect.stringMatching(/off or missing/) }));
});

test('the scan lease keeps scanning until its last holder lets go', () => {
	const noble = fakeNoble();
	const lease = scanLease(noble);
	lease.acquire('treadmill');
	lease.acquire('sensors-scan');
	expect(noble.startScanning).toHaveBeenCalledTimes(1);
	lease.release('treadmill');
	expect(noble.stopScanning).not.toHaveBeenCalled();
	lease.release('sensors-scan');
	expect(noble.stopScanning).toHaveBeenCalledTimes(1);
	expect(scanLease(noble)).toBe(lease);
});

test('while blocked (sharing the adapter with the Zwift broadcast) noble is never loaded and scans are refused', async () => {
	const loadNoble = jest.fn(fakeNoble);
	let blocked = 'Off while Zwifit broadcasts to Zwift';
	const settings = { sensors: { bluetooth: [{ id: 'aa01', name: 'Polar H10', kinds: ['hr'] }] } };
	ble = new BleSensors({ loadNoble, getSettings: () => settings, blockedReason: () => blocked });
	await ble.start();
	expect(loadNoble).not.toHaveBeenCalled();
	expect(ble.status()).toMatchObject({ available: false, reason: blocked });
	expect(() => ble.startScan()).toThrow(expect.objectContaining({ code: 'SENSORS_UNAVAILABLE', message: blocked }));
	ble.refresh();
	expect(loadNoble).not.toHaveBeenCalled();
	// Allowed in Settings: the saved sensor is looked for again.
	blocked = null;
	ble.refresh();
	expect(loadNoble).toHaveBeenCalledTimes(1);
	expect(ble.status()).toMatchObject({ available: true });
});

test('noble resetting the adapter is passed on as adapter-reset', async () => {
	const noble = fakeNoble();
	noble._bindings = { _hci: new EventEmitter() };
	ble = new BleSensors({ loadNoble: () => noble, scanMs: 20 });
	const resets = jest.fn();
	ble.on('adapter-reset', resets);
	await ble.start();
	ble.startScan();
	noble._bindings._hci.emit('reset');
	noble.emit('stateChange', 'poweredOn');
	expect(resets).toHaveBeenCalledTimes(2);
	await ble.stop();
	ble = null;
	noble._bindings._hci.emit('reset');
	expect(resets).toHaveBeenCalledTimes(2);
});
