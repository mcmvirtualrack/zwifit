const { WebSocketServer } = require('ws');
const { treadmillContract, LIMITS } = require('./treadmillContract');
const { WifiTreadmill } = require('../../../src/adapters/treadmill/wifi');
const { scan, candidateHosts } = require('../../../src/adapters/treadmill/scan');

// In-memory stand-in for an iFit console's WebSocket, for the timer-controlled contract suite.
function fakeConsole({ heartRate = true } = {}) {
	const sent = [];
	let opened;
	const ready = new Promise(resolve => { opened = resolve; });
	class FakeSocket {
		constructor(url) {
			this.url = url;
			Promise.resolve().then(() => {
				this.onopen && this.onopen();
				const values = { KPH: '5.0', Incline: '1' };
				if (heartRate) {
					values['Chest Pulse'] = '120';
				}
				this.onmessage && this.onmessage({ data: JSON.stringify({ values }) });
				opened();
			});
		}
		send(text) {
			sent.push(JSON.parse(text));
		}
		close() {
			this.onclose && this.onclose();
		}
	}
	return { FakeSocket, sent: () => sent, ready: () => ready };
}

treadmillContract('wifi', ({ limits, canResume, heartRate }) => {
	const fake = fakeConsole({ heartRate });
	const adapter = new WifiTreadmill({ settings: { treadmill: { ip: '10.0.0.9' } }, limits, canResume, WebSocketImpl: fake.FakeSocket });
	return { adapter, ready: fake.ready, sent: fake.sent };
});

describe('against a fake iFit console', () => {
	let server;
	let host;
	let consoleSocket;
	let received;
	let adapter;
	let statuses;

	const connected = () => new Promise(resolve => server.once('connection', socket => {
		consoleSocket = socket;
		socket.on('message', data => received.push(JSON.parse(String(data))));
		resolve();
	}));

	beforeEach(async () => {
		server = new WebSocketServer({ port: 0, host: '127.0.0.1', path: '/control' });
		await new Promise(resolve => server.once('listening', resolve));
		host = `127.0.0.1:${server.address().port}`;
		received = [];
		statuses = [];
	});

	afterEach(async () => {
		if (adapter) {
			await adapter.stop();
			adapter = null;
		}
		await new Promise(resolve => server.close(resolve));
	});

	async function startAdapter(settings = {}) {
		adapter = new WifiTreadmill({ settings: { treadmill: { ip: host }, ...settings }, limits: LIMITS, fallbackKph: 4 });
		adapter.on('status', s => statuses.push(s));
		const opened = new Promise(resolve => adapter.once('connected', resolve));
		const accepted = connected();
		await adapter.start();
		await Promise.all([opened, accepted]);
	}

	const sendValues = values => consoleSocket.send(JSON.stringify({ values }));
	const nextStatus = () => new Promise(resolve => adapter.once('status', resolve));

	test('KPH, incline, heart rate and cadence become a km/h status', async () => {
		await startAdapter();
		const status = nextStatus();
		sendValues({ KPH: '10.5', Incline: '2.5', 'Chest Pulse': '142', Cadence: '170' });
		// Only "KPH" (the set speed) so far: Zwift gets it eased, not as a measured speed.
		expect(await status).toEqual({ connected: true, kph: 10.5, incline: 2.5, hr: 142, cadence: 170, estimatedSpeed: false, speedSource: 'set' });
	});

	test('a console that reports "Current KPH" gives the measured belt speed', async () => {
		await startAdapter();
		const status = nextStatus();
		sendValues({ KPH: '10.5', 'Current KPH': '10.2' });
		expect(await status).toMatchObject({ kph: 10.2, speedSource: 'measured', estimatedSpeed: false });
	});

	test('MPH is converted to km/h', async () => {
		await startAdapter();
		const status = nextStatus();
		sendValues({ MPH: '6' });
		expect((await status).kph).toBeCloseTo(9.66, 2);
	});

	test('Chest Pulse 0 is reported as no heart rate', async () => {
		await startAdapter();
		const status = nextStatus();
		sendValues({ KPH: '8', 'Chest Pulse': '0' });
		expect((await status).hr).toBeNull();
	});

	test('the console readout lists every field as sent, and which one speed is read from', async () => {
		await startAdapter();
		let status = nextStatus();
		sendValues({ KPH: '2.0', MPH: '1.2', Incline: '0.0', 'Workout Type': 'MANUAL', Nested: { a: 1 } });
		await status;
		let readout = adapter.consoleReadout();
		expect(readout).toMatchObject({ transport: 'wifi', connected: true, speedKey: 'KPH', calibrated: false });
		expect(readout.fields.map(f => [f.key, f.value])).toEqual([['Incline', '0.0'], ['KPH', '2.0'], ['MPH', '1.2'], ['Workout Type', 'MANUAL']]);
		status = nextStatus();
		sendValues({ 'Current KPH': '2.2' });
		await status;
		readout = adapter.consoleReadout();
		expect(readout.speedKey).toBe('Current KPH');
		expect(readout.fields.find(f => f.key === 'KPH').value).toBe('2.0');
		expect(readout.fields.find(f => f.key === 'Current KPH')).toEqual({ key: 'Current KPH', value: '2.2', at: expect.any(String) });
	});

	test('the console output keeps raw messages in order: from the console and commands sent', async () => {
		await startAdapter();
		const status = nextStatus();
		sendValues({ KPH: '2.0', Incline: '0.0' });
		await status;
		await adapter.setTarget({ kph: 3 });
		const { log, logSeq } = adapter.consoleReadout();
		const mine = log.slice(-2);
		expect(mine.map(l => l.dir)).toEqual(['in', 'out']);
		expect(JSON.parse(mine[0].text)).toEqual({ values: { KPH: '2.0', Incline: '0.0' } });
		expect(JSON.parse(mine[1].text)).toMatchObject({ type: 'set', values: { KPH: '3.0' } });
		expect(logSeq).toBe(mine[1].seq);
		// Only newer lines after a sequence number.
		expect(adapter.consoleReadout({ after: logSeq }).log).toEqual([]);
		expect(adapter.consoleReadout({ after: logSeq - 1 }).log).toEqual([mine[1]]);
	});

	test('a WebSocket 2.1 console (C 990) shows "Current KPH", not the set speed in "KPH"', async () => {
		await startAdapter();
		let status = nextStatus();
		sendValues({ 'Websocket Version': '2.1', KPH: '2.0', MPH: '1.2', 'Default Units': 'Metric' });
		expect((await status).kph).toBe(2);
		status = nextStatus();
		sendValues({ 'Current MPH': '1.0', 'Current KPH': '1.6' });
		expect((await status).kph).toBe(1.6);
		// A later set-point change no longer replaces the real belt speed.
		status = nextStatus();
		sendValues({ MPH: '1.5', KPH: '2.5', Incline: '0.0' });
		expect((await status).kph).toBe(1.6);
		status = nextStatus();
		sendValues({ 'Current KPH': '2.2' });
		expect((await status).kph).toBe(2.2);
	});

	test('the hand grips are used when the chest strap has no reading', async () => {
		await startAdapter();
		let status = nextStatus();
		sendValues({ 'Chest Pulse': '0', 'Hand Pulse': '96' });
		expect((await status).hr).toBe(96);
		status = nextStatus();
		sendValues({ 'Chest Pulse': '71' });
		expect((await status).hr).toBe(71);
		status = nextStatus();
		sendValues({ 'Chest Pulse': '0', 'Hand Pulse': '0' });
		expect((await status).hr).toBeNull();
	});

	test('speed under 0.1 is 0 and calibration applies above it', async () => {
		await startAdapter({ speedOffset: 0.5, speedMultiplier: 1.1 });
		let status = nextStatus();
		sendValues({ KPH: '0.05' });
		expect((await status).kph).toBe(0);
		status = nextStatus();
		sendValues({ KPH: '10' });
		expect((await status).kph).toBeCloseTo(11.55, 2);
	});

	test('a console that never reports speed shows the last target as estimated', async () => {
		await startAdapter();
		expect(statuses[statuses.length - 1]).toMatchObject({ kph: 0, estimatedSpeed: false });
		let status = nextStatus();
		sendValues({ Incline: '1' });
		expect(await status).toMatchObject({ kph: 0, estimatedSpeed: false });
		await adapter.setTarget({ kph: 9 });
		status = nextStatus();
		sendValues({ Incline: '1' });
		expect(await status).toMatchObject({ kph: 9, estimatedSpeed: true });
	});

	test('setTarget sends KPH to a metric console and MPH to an imperial one', async () => {
		await startAdapter();
		let status = nextStatus();
		sendValues({ KPH: '5' });
		await status;
		await adapter.setTarget({ kph: 12, incline: 3 });
		status = nextStatus();
		sendValues({ MPH: '3' });
		await status;
		await new Promise(resolve => setTimeout(resolve, 50));
		expect(received[0]).toEqual({ type: 'set', values: { KPH: '12.0', Incline: '3' } });

		const imperial = new WifiTreadmill({ settings: { treadmill: { ip: host } }, limits: LIMITS });
		const accepted = connected();
		const opened = new Promise(resolve => imperial.once('connected', resolve));
		await imperial.start();
		await Promise.all([accepted, opened]);
		const seen = new Promise(resolve => imperial.once('status', resolve));
		sendValues({ MPH: '3' });
		await seen;
		received = [];
		consoleSocket.on('message', data => received.push(JSON.parse(String(data))));
		await imperial.setTarget({ kph: 9.656 });
		await new Promise(resolve => setTimeout(resolve, 50));
		expect(received[0]).toEqual({ type: 'set', values: { MPH: '6.0' } });
		await imperial.stop();
	});

	test('limits reported by the console (C 990 style) are exposed and enforced', async () => {
		await startAdapter();
		const status = nextStatus();
		sendValues({
			'Minimum Incline': '0.0', 'Maximum Incline': '12.0', 'Minimum MPH': '0.6', 'Maximum MPH': '13.6',
			'Minimum KPH': '1.0', 'Maximum KPH': '22.0', MPH: '0.0', KPH: '0.0', Incline: '2.0', 'Actual Incline': '1.5'
		});
		expect((await status).incline).toBe(1.5);
		expect(adapter.limits()).toEqual({ minKph: 1, maxKph: 22, minIncline: 0, maxIncline: 12 });
		await expect(adapter.setTarget({ incline: 13 })).rejects.toMatchObject({
			code: 'OUT_OF_RANGE', details: [expect.objectContaining({ code: 'ABOVE_MAX_INCLINE' })]
		});
		await expect(adapter.setTarget({ kph: 0.5 })).rejects.toMatchObject({
			details: [expect.objectContaining({ code: 'BELOW_MIN_SPEED' })]
		});
	});

	test('out-of-range targets are rejected and nothing is sent', async () => {
		await startAdapter();
		await expect(adapter.setTarget({ kph: 21 })).rejects.toMatchObject({ code: 'OUT_OF_RANGE' });
		await new Promise(resolve => setTimeout(resolve, 50));
		expect(received).toEqual([]);
	});

	test('pauseBelt sends speed 0; resumeBelt goes back to the speed the belt was set to (C 990)', async () => {
		await startAdapter();
		expect(adapter.capabilities.canResume).toBe(true);
		let status = nextStatus();
		sendValues({ KPH: '6.5', 'Start KPH': '2.0', 'Workout Type': 'MANUAL', 'Current KPH': '6.4' });
		await status;
		await adapter.pauseBelt();
		await adapter.resumeBelt();
		await new Promise(resolve => setTimeout(resolve, 50));
		expect(received).toEqual([
			{ type: 'set', values: { KPH: '0.0' } },
			{ type: 'set', values: { KPH: '6.5' } }
		]);
		// Pressing Stop again while stopped keeps the speed to come back to.
		status = nextStatus();
		sendValues({ KPH: '0.0', Incline: '0.0' });
		await status;
		await adapter.pauseBelt();
		await adapter.resumeBelt();
		await new Promise(resolve => setTimeout(resolve, 50));
		expect(received.at(-1)).toEqual({ type: 'set', values: { KPH: '6.5' } });
	});

	test('resumeBelt without an earlier stop uses the console start speed', async () => {
		await startAdapter();
		const status = nextStatus();
		sendValues({ 'Start KPH': '2.0', 'Workout Type': 'MANUAL', Incline: '0.0' });
		await status;
		await adapter.resumeBelt();
		await new Promise(resolve => setTimeout(resolve, 50));
		expect(received).toEqual([{ type: 'set', values: { KPH: '2.0' } }]);
	});

	test('resumeBelt is refused, sending nothing, once the console has ended its workout', async () => {
		await startAdapter();
		const status = nextStatus();
		sendValues({ KPH: '5.0', 'Workout Type': 'NONE' });
		await status;
		await expect(adapter.resumeBelt()).rejects.toMatchObject({ code: 'RESUME_UNSUPPORTED' });
		await new Promise(resolve => setTimeout(resolve, 50));
		expect(received).toEqual([]);
	});

	test('the console closing emits disconnected with a reason', async () => {
		await startAdapter();
		const gone = new Promise(resolve => adapter.once('disconnected', resolve));
		consoleSocket.close();
		expect(await gone).toEqual({ reason: expect.stringContaining('Lost connection') });
		expect(statuses[statuses.length - 1]).toMatchObject({ connected: false });
		await expect(adapter.setTarget({ kph: 5 })).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
	});

	test('start() resolves even when nothing is listening', async () => {
		const lonely = new WifiTreadmill({ settings: { treadmill: { ip: '127.0.0.1:1' } }, limits: LIMITS });
		await expect(lonely.start()).resolves.toBeUndefined();
		await lonely.stop();
	});

	test('without an IP it scans, connects to what it finds, and reports it', async () => {
		adapter = new WifiTreadmill({ settings: { treadmill: {} }, limits: LIMITS, scanner: async ({ preferred }) => {
			expect(preferred).toContain('127.0.0.1');
			return host;
		} });
		const discovered = new Promise(resolve => adapter.once('discovered', resolve));
		const accepted = connected();
		await adapter.start();
		expect(await discovered).toEqual({ ip: host });
		await accepted;
	});

	test('the scanner finds the console among candidates', async () => {
		consoleSocket = null;
		server.on('connection', socket => socket.send(JSON.stringify({ values: { MPH: '0' } })));
		expect(await scan({ hosts: ['127.0.0.1:1', host], preferred: [] })).toBe(host);
	});
});

test('candidate hosts cover each local /24 except our own address', () => {
	const hosts = candidateHosts({
		eth0: [{ family: 'IPv4', internal: false, address: '192.168.1.20' }, { family: 'IPv6', internal: false, address: 'fe80::1' }],
		lo: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }]
	});
	expect(hosts).toHaveLength(253);
	expect(hosts).toContain('192.168.1.1');
	expect(hosts).not.toContain('192.168.1.20');
});
