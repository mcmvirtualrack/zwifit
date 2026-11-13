const { treadmillContract, LIMITS } = require('./treadmillContract');
const { SimulatedTreadmill } = require('../../../src/adapters/treadmill/simulated');
const treadmillFactory = require('../../../src/adapters/treadmill');
const broadcastFactory = require('../../../src/adapters/broadcast');
const { NullBroadcast } = require('../../../src/adapters/broadcast/null');

treadmillContract('simulated', options => ({ adapter: new SimulatedTreadmill(options) }));

describe('simulated treadmill behaviour', () => {
	let adapter;
	let statuses;

	beforeEach(async () => {
		jest.useFakeTimers();
		adapter = new SimulatedTreadmill({ limits: LIMITS });
		statuses = [];
		adapter.on('status', s => statuses.push(s));
		await adapter.start();
	});

	afterEach(async () => {
		await adapter.stop();
		jest.useRealTimers();
	});

	const last = () => statuses[statuses.length - 1];

	test('starts connected and stopped', () => {
		expect(last()).toMatchObject({ connected: true, kph: 0, incline: 0, hr: null, estimatedSpeed: false });
	});

	test('ramps to the target speed and incline deterministically', async () => {
		adapter.startBelt(2);
		await adapter.setTarget({ kph: 10, incline: 3 });
		jest.advanceTimersByTime(2000);
		const mid = last().kph;
		expect(mid).toBeGreaterThan(2);
		expect(mid).toBeLessThan(10);
		jest.advanceTimersByTime(10000);
		expect(last()).toMatchObject({ kph: 10, incline: 3 });
		expect(last().hr).toBeGreaterThan(60);
	});

	test('pauseBelt stops the belt, resumeBelt restores the previous target', async () => {
		adapter.startBelt(8);
		jest.advanceTimersByTime(1000);
		await adapter.pauseBelt();
		jest.advanceTimersByTime(10000);
		expect(last().kph).toBe(0);
		await adapter.resumeBelt();
		jest.advanceTimersByTime(10000);
		expect(last().kph).toBe(8);
	});

	test('setTarget before start or after disconnect is NOT_CONNECTED', async () => {
		adapter.simulateDisconnect('cable pulled');
		expect(last()).toMatchObject({ connected: false, reason: 'cable pulled' });
		await expect(adapter.setTarget({ kph: 5 })).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
	});

	test('disconnect emits disconnected; reconnect emits connected', () => {
		const events = [];
		adapter.on('disconnected', e => events.push(['disconnected', e]));
		adapter.on('connected', () => events.push(['connected']));
		adapter.simulateDisconnect('gone');
		adapter.simulateReconnect();
		expect(events).toEqual([['disconnected', { reason: 'gone' }], ['connected']]);
	});

	test('simulateConsoleStop brings the belt to 0 immediately', async () => {
		adapter.startBelt(10);
		jest.advanceTimersByTime(1000);
		adapter.simulateConsoleStop();
		expect(last().kph).toBe(0);
		jest.advanceTimersByTime(5000);
		expect(last().kph).toBe(0);
	});

	test('without current speed it reports the fallback as estimated', async () => {
		const sim = new SimulatedTreadmill({ limits: LIMITS, fallbackKph: 6 });
		const seen = [];
		sim.on('status', s => seen.push(s));
		await sim.start();
		sim.startBelt(9);
		sim.setReportsCurrentSpeed(false);
		jest.advanceTimersByTime(1000);
		expect(seen[seen.length - 1]).toMatchObject({ kph: 6, estimatedSpeed: true });
		await sim.stop();
	});

	test('limits() returns a copy', () => {
		adapter.limits().maxKph = 99;
		expect(adapter.limits().maxKph).toBe(20);
	});
});

describe('factories', () => {
	test('treadmill factory builds the simulated adapter for --simulate or transport simulated', () => {
		const settings = { treadmill: { transport: 'wifi' }, limits: LIMITS, fallbackKph: null };
		expect(treadmillFactory.create(settings, { simulate: true }).transport).toBe('simulated');
		expect(treadmillFactory.create({ ...settings, treadmill: { transport: 'simulated' } }).transport).toBe('simulated');
	});

	test('treadmill factory refuses unknown transports', () => {
		expect(() => treadmillFactory.create({ treadmill: { transport: 'carrier-pigeon' }, limits: LIMITS }))
			.toThrow(expect.objectContaining({ code: 'UNSUPPORTED_TRANSPORT' }));
	});

	test('null broadcast reports unavailable and accepts updates', async () => {
		const broadcast = broadcastFactory.create({ broadcast: { ftms: true, rsc: false } }, { disabled: true });
		expect(broadcast).toBeInstanceOf(NullBroadcast);
		const status = new Promise(resolve => broadcast.once('status', resolve));
		await broadcast.start();
		expect(await status).toEqual({ available: false, reason: 'Bluetooth broadcast is turned off.', poweredOn: false, advertising: false, clients: 0, devices: [] });
		expect(() => broadcast.update({ kph: 5, incline: 0, hr: null })).not.toThrow();
		await broadcast.stop();
	});

	test('broadcast factory uses the null adapter when every service is off', () => {
		expect(broadcastFactory.create({ broadcast: { ftms: false, rsc: false, hr: false } })).toBeInstanceOf(NullBroadcast);
	});
});
