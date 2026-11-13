const EventEmitter = require('events');
const Constants = require('../../../src/ble/ifit/_constants');
const { treadmillContract, LIMITS } = require('./treadmillContract');
const { BleTreadmill } = require('../../../src/adapters/treadmill/ble');

const C = Constants.Characteristic;

// Fake noble + fake iFit request layer (same callback API as src/ble/ifit/_request.js).
function fakeBle({ metric = true, machine = { MinKph: 1, MaxKph: 16, MinIncline: 0, MaxIncline: 12 }, reading = {} } = {}) {
	const noble = new EventEmitter();
	noble.state = 'poweredOn';
	noble.startScanning = jest.fn(() => {
		Promise.resolve().then(() => noble.emit('discover', peripheral));
	});
	noble.stopScanning = jest.fn();

	const peripheral = new EventEmitter();
	peripheral.advertisement = { manufacturerData: Buffer.from('0102dd3a4f', 'hex') };
	peripheral.connect = cb => cb(null);
	peripheral.disconnect = jest.fn(() => peripheral.emit('disconnect'));

	const writes = [];
	let current = { Kph: 0, CurrentKph: 0, CurrentIncline: 0, Pulse: { source: Constants.PulseSource.No, pulse: 0 }, Mode: Constants.Mode.Idle, ...reading };
	let connected;
	const ready = new Promise(resolve => { connected = resolve; });
	const request = {
		initTxAndRx: (p, cb) => cb(null, 'tx', 'rx'),
		getEquipmentInformation: (tx, rx, cb) => cb({ equipment: Constants.SportsEquipment.Treadmill, characteristics: {} }),
		getSupportedCapabilities: (eq, tx, rx, cb) => cb({}),
		enable: (eq, tx, rx, cb) => cb({}),
		writeAndRead: (eq, w, reads, tx, rx, cb) => {
			if (reads.includes(C.Metric)) {
				cb({ ...machine, Metric: metric });
				Promise.resolve().then(connected);
				return;
			}
			if (w) {
				writes.push(...w.map(x => ({ name: Object.keys(C).find(k => C[k] === x.characteristic), value: x.value })));
			}
			cb(current);
		}
	};
	return {
		noble, peripheral, request, ready: () => ready, writes,
		setReading: next => { current = { ...current, ...next }; }
	};
}

const settings = { treadmill: { transport: 'ble', bleCode: '3A4F' } };

treadmillContract('ble', ({ limits, canResume, heartRate }) => {
	const fake = fakeBle({ reading: heartRate === false ? {} : { Pulse: { source: Constants.PulseSource.Ble, pulse: 130 } } });
	const adapter = new BleTreadmill({ settings, limits, noble: fake.noble, request: fake.request });
	if (canResume === false) {
		// No iFit BLE console lacks resume; emulate one so the shared rule is still exercised.
		adapter.capabilities.canResume = false;
		adapter.resumeBelt = async () => { throw Object.assign(new Error('x'), { code: 'RESUME_UNSUPPORTED' }); };
	}
	return { adapter, ready: fake.ready, sent: () => fake.writes };
});

describe('iFit Bluetooth behaviour', () => {
	let fake;
	let adapter;
	let statuses;

	async function start(options = {}, adapterOptions = {}) {
		fake = fakeBle(options);
		adapter = new BleTreadmill({ settings, limits: LIMITS, noble: fake.noble, request: fake.request, pollMs: 10, ...adapterOptions });
		statuses = [];
		adapter.on('status', s => statuses.push(s));
		await adapter.start();
		await fake.ready();
	}

	afterEach(async () => {
		await adapter.stop();
	});

	const poll = () => new Promise(resolve => setTimeout(resolve, 40));
	const last = () => statuses[statuses.length - 1];

	test('connects to the peripheral whose manufacturer data ends in dd + code', async () => {
		await start();
		expect(fake.noble.stopScanning).toHaveBeenCalled();
		expect(last()).toMatchObject({ connected: true });
	});

	test('reported MinKph/MaxKph/MinIncline/MaxIncline are exposed via limits()', async () => {
		await start();
		expect(adapter.limits()).toEqual({ minKph: 1, maxKph: 16, minIncline: 0, maxIncline: 12 });
	});

	test('imperial machines report mph, converted to km/h', async () => {
		await start({ metric: false, machine: { MinKph: 0.5, MaxKph: 10, MinIncline: 0, MaxIncline: 12 } });
		expect(adapter.limits().maxKph).toBeCloseTo(16.09, 2);
		fake.setReading({ CurrentKph: 6, Kph: 6 });
		await poll();
		expect(last().kph).toBeCloseTo(9.66, 2);
		await adapter.setTarget({ kph: 9.656 });
		await poll();
		expect(fake.writes.find(w => w.name === 'Kph').value).toBeCloseTo(6, 3);
	});

	test('regression: speed above MaxKph is rejected with ABOVE_MAX_SPEED, never clamped', async () => {
		await start();
		await expect(adapter.setTarget({ kph: 17 })).rejects.toMatchObject({
			code: 'OUT_OF_RANGE', details: [expect.objectContaining({ code: 'ABOVE_MAX_SPEED' })]
		});
		await poll();
		expect(fake.writes).toEqual([]);
	});

	test('pauseBelt writes Mode=Pause; resumeBelt writes Mode=Active then the last targets', async () => {
		await start();
		await adapter.setTarget({ kph: 8, incline: 2 });
		await poll();
		fake.writes.length = 0;
		await adapter.pauseBelt();
		await poll();
		expect(fake.writes).toEqual([{ name: 'Mode', value: Constants.Mode.Pause }]);
		fake.writes.length = 0;
		await adapter.resumeBelt();
		await poll();
		expect(fake.writes).toEqual([
			{ name: 'Mode', value: Constants.Mode.Active },
			{ name: 'Kph', value: 8 },
			{ name: 'Incline', value: 2 }
		]);
	});

	test('Pro-Form: no current speed falls back to the configured speed as estimated', async () => {
		await start();
		fake.setReading({ Kph: 7, CurrentKph: 0 });
		await poll();
		expect(last()).toMatchObject({ kph: 7, estimatedSpeed: true });
		fake.setReading({ Kph: 7, CurrentKph: 6.8 });
		await poll();
		expect(last()).toMatchObject({ kph: 6.8, estimatedSpeed: false });
	});

	test('heart rate from a real source is reported; source No or 0 is null', async () => {
		await start({ reading: { Pulse: { source: Constants.PulseSource.Ble, pulse: 141 } } });
		await poll();
		expect(last().hr).toBe(141);
		fake.setReading({ Pulse: { source: Constants.PulseSource.No, pulse: 141 } });
		await poll();
		expect(last().hr).toBeNull();
	});

	test('a peripheral disconnect emits disconnected and scans again', async () => {
		await start();
		const gone = new Promise(resolve => adapter.once('disconnected', resolve));
		fake.noble.startScanning.mockImplementation(() => {});
		fake.peripheral.emit('disconnect');
		expect(await gone).toEqual({ reason: expect.stringContaining('Lost the Bluetooth connection') });
		expect(fake.noble.startScanning).toHaveBeenCalledTimes(2);
		await expect(adapter.setTarget({ kph: 5 })).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
	});

	test('without a BLE code it reports why instead of scanning', async () => {
		const noble = new EventEmitter();
		adapter = new BleTreadmill({ settings: { treadmill: { transport: 'ble' } }, noble });
		const status = new Promise(resolve => adapter.once('status', resolve));
		await adapter.start();
		expect(await status).toMatchObject({ connected: false, reason: expect.stringContaining('code') });
	});

	test('a powered-off adapter is reported', async () => {
		const noble = new EventEmitter();
		noble.state = 'poweredOff';
		noble.stopScanning = jest.fn();
		adapter = new BleTreadmill({ settings, noble, request: {} });
		const seen = [];
		adapter.on('status', s => seen.push(s));
		await adapter.start();
		expect(seen[0].reason).toMatch(/off or missing/);
	});
});
