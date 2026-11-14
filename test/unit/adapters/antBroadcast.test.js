// AntBroadcast against a fake stick (research.md R8): the configuration sequence, page rotation,
// open/close on value presence, stick loss, scans, device numbers, status, and inbound messages
// being ignored.
const EventEmitter = require('events');
const { AntBroadcast } = require('../../../src/adapters/antBroadcast');
const m = require('../../../src/core/antBroadcast/messages');

// A stick that answers every command with RESPONSE_NO_ERROR (and EVENT_CHANNEL_CLOSED after a
// close), and records what was written.
class FakeStick extends EventEmitter {
	constructor() {
		super();
		this.written = [];
		this.fail = null;
	}

	async write(bytes) {
		const frame = Array.from(bytes);
		this.written.push(frame);
		const [, , id, ch] = frame;
		if (id === m.ID.BROADCAST_DATA) {
			return;
		}
		setImmediate(() => {
			const code = this.fail && this.fail(frame) ? 0x15 : 0;
			this.emit('read', Uint8Array.from([0xA4, 3, 0x40, ch, id, code, 0]));
			if (id === m.ID.CLOSE && !code) {
				this.emit('read', Uint8Array.from([0xA4, 3, 0x40, ch, 0x01, m.EVENT_CHANNEL_CLOSED, 0]));
			}
		});
	}

	tx(ch) {
		this.emit('read', Uint8Array.from([0xA4, 3, 0x40, ch, 0x01, m.EVENT_TX, 0]));
	}

	// Frames written since `from`, as [id, channel, ...rest].
	frames(from = 0) {
		return this.written.slice(from).map(f => [f[2], f[3], ...f.slice(4, -1)]);
	}

	pages(ch, from = 0) {
		return this.frames(from).filter(f => f[0] === m.ID.BROADCAST_DATA && f[1] === ch).map(f => f.slice(2));
	}
}

class FakeHost extends EventEmitter {
	constructor() {
		super();
		this.stick = null;
		this.hostStatus = { available: false, reason: 'Starting ANT+…', scan: { active: false } };
	}

	stickReady() {
		return !!this.stick;
	}

	currentStick() {
		return this.stick;
	}

	status() {
		return this.hostStatus;
	}

	give(stick) {
		this.stick = stick;
		this.hostStatus = { available: true, scan: { active: false } };
		this.emit('stick', stick);
		this.emit('status', this.hostStatus);
	}

	take(reason = 'The ANT+ stick disconnected. Reconnecting…', scan = false) {
		const stick = this.stick;
		this.stick = null;
		this.emit('stick-lost', stick);
		this.hostStatus = { available: false, reason, scan: { active: scan } };
		this.emit('status', this.hostStatus);
	}
}

const flush = async () => {
	for (let i = 0; i < 30; i++) {
		await new Promise(resolve => setImmediate(resolve));
	}
};

let broadcast;
afterEach(async () => {
	if (broadcast) {
		await broadcast.stop();
		broadcast = null;
	}
});

function setup({ antBroadcast = {}, numbers = { footpod: 1111, hr: 2222, power: 3333, treadmill: 4444 }, host = new FakeHost(), randomInt } = {}) {
	const settings = {
		limits: { maxKph: 20 },
		antBroadcast: { enabled: true, footpod: true, hr: false, power: false, treadmill: false, rebroadcastAnt: { hr: false, power: false }, ...antBroadcast, ...(numbers ? { deviceNumbers: numbers } : {}) }
	};
	let now = 1000;
	const saved = [];
	const statuses = [];
	broadcast = new AntBroadcast({
		host,
		getSettings: () => settings,
		saveDeviceNumbers: async deviceNumbers => {
			saved.push(deviceNumbers);
			settings.antBroadcast.deviceNumbers = deviceNumbers;
		},
		now: () => now,
		...(randomInt ? { randomInt } : {}),
		responseTimeoutMs: 50
	});
	broadcast.on('status', s => statuses.push(s));
	const stick = new FakeStick();
	return { settings, host, stick, saved, statuses, advance: ms => { now += ms; }, start: async () => { await broadcast.start(); await flush(); } };
}

const CONFIG = (ch, number, type, trans, period) => [
	[m.ID.ASSIGN, ch, 0x10, 0],
	[m.ID.CHANNEL_ID, ch, number & 0xFF, number >> 8, type, trans],
	[m.ID.FREQUENCY, ch, 57],
	[m.ID.PERIOD, ch, period & 0xFF, period >> 8],
	[m.ID.OPEN, ch]
];

describe('US1: footpod', () => {
	test('nothing is written before the host has a stick', async () => {
		const t = setup();
		await t.start();
		broadcast.update({ connected: true, kph: 10 });
		await flush();
		expect(t.stick.written).toEqual([]);
	});

	test('channel 3 is set up in order, then every EVENT_TX sends the next SDM page with the current speed', async () => {
		const t = setup();
		await t.start();
		broadcast.update({ kph: 10.8, cadence: 170 });
		t.host.give(t.stick);
		await flush();
		const frames = t.stick.frames();
		expect(frames.slice(0, 5)).toEqual(CONFIG(3, 1111, 124, 5, 8134));
		// The first page is loaded right after opening.
		expect(frames[5][0]).toBe(m.ID.BROADCAST_DATA);
		const from = t.stick.written.length;
		t.advance(1000);
		t.stick.tx(3);
		t.advance(1000);
		t.stick.tx(3);
		await flush();
		const [p2, p1] = t.stick.pages(3, from);
		// Page 2: 170 steps/min = 85 strides/min, speed 3 m/s, in use.
		expect(p2).toEqual([0x02, 0xFF, 0xFF, 85, 0x03, 0, 0xFF, 0x01]);
		// Page 1 after 2 s at 3 m/s: 2 s, 6 m, speed 3 + 0/256, 2.83 strides → 2.
		expect(p1).toEqual([0x01, 0, 2, 6, 0x03, 0, 2, 0]);
	});

	test('a stopped belt sends speed 0 and freezes distance', async () => {
		const t = setup();
		await t.start();
		t.host.give(t.stick);
		broadcast.update({ kph: 10.8 });
		await flush();
		t.advance(1000);
		t.stick.tx(3);
		broadcast.update({ kph: 0 });
		await flush();
		const from = t.stick.written.length;
		t.advance(5000);
		t.stick.tx(3);
		t.stick.tx(3);
		t.stick.tx(3);
		await flush();
		const page1 = t.stick.pages(3, from).find(p => p[0] === 1);
		expect(page1.slice(2, 6)).toEqual([1, 3, 0, 0]);
	});

	test("on 'stick-lost' it writes nothing more; the next 'stick' sets the channel up again with the same number", async () => {
		const t = setup();
		await t.start();
		t.host.give(t.stick);
		await flush();
		t.host.take();
		const before = t.stick.written.length;
		t.stick.tx(3);
		await flush();
		expect(t.stick.written.length).toBe(before);
		const second = new FakeStick();
		t.host.give(second);
		await flush();
		expect(second.frames().slice(0, 5)).toEqual(CONFIG(3, 1111, 124, 5, 8134));
	});

	test('a stick the host already has when the broadcast starts is used at once', async () => {
		const t = setup();
		t.host.give(t.stick);
		await t.start();
		expect(t.stick.frames()[0]).toEqual([m.ID.ASSIGN, 3, 0x10, 0]);
	});

	test('stop() closes and unassigns channel 3 and leaves the stick alone', async () => {
		const t = setup();
		await t.start();
		t.host.give(t.stick);
		await flush();
		const from = t.stick.written.length;
		await broadcast.stop();
		broadcast = null;
		expect(t.stick.frames(from).map(f => f.slice(0, 2))).toEqual([[m.ID.CLOSE, 3], [m.ID.UNASSIGN, 3]]);
		expect(t.host.listenerCount('stick')).toBe(0);
		expect(t.stick.listenerCount('read')).toBe(0);
	});

	test.each([
		['the broadcast is off', { enabled: false }],
		['the footpod is unticked', { footpod: false }]
	])('no channel when %s', async (_, antBroadcast) => {
		const t = setup({ antBroadcast });
		await t.start();
		t.host.give(t.stick);
		await flush();
		expect(t.stick.written).toEqual([]);
	});

	test('switching off while broadcasting closes the channel on the next update (settings apply live)', async () => {
		const t = setup();
		await t.start();
		t.host.give(t.stick);
		await flush();
		t.settings.antBroadcast.enabled = false;
		const from = t.stick.written.length;
		broadcast.update({ kph: 5 });
		await flush();
		expect(t.stick.frames(from).map(f => f.slice(0, 2))).toEqual([[m.ID.CLOSE, 3], [m.ID.UNASSIGN, 3]]);
		expect(broadcast.status()).toEqual({ state: 'off', sensors: [] });
	});

	test('a command the stick refuses leaves the sensor off, says so, and is retried later', async () => {
		const t = setup();
		t.stick.fail = frame => frame[2] === m.ID.ASSIGN;
		await t.start();
		t.host.give(t.stick);
		await flush();
		expect(t.stick.frames().filter(f => f[0] === m.ID.OPEN)).toEqual([]);
		expect(broadcast.status().sensors[0]).toMatchObject({ kind: 'footpod', sending: false, note: expect.stringMatching(/Trying again/) });
		t.stick.fail = null;
		broadcast.update({ kph: 1 });
		await flush();
		expect(t.stick.frames().filter(f => f[0] === m.ID.OPEN)).toEqual([]);
		t.advance(6000);
		broadcast.update({ kph: 1 });
		await flush();
		expect(t.stick.frames().filter(f => f[0] === m.ID.OPEN)).toEqual([[m.ID.OPEN, 3]]);
	});

	test('a stick that never answers times out instead of hanging', async () => {
		const t = setup();
		t.stick.write = async bytes => { t.stick.written.push(Array.from(bytes)); };
		await t.start();
		t.host.give(t.stick);
		await new Promise(resolve => setTimeout(resolve, 80));
		expect(broadcast.status().sensors[0].sending).toBe(false);
		expect(t.stick.frames()).toEqual([[m.ID.ASSIGN, 3, 0x10, 0]]);
	});

	test('a write that throws (stick yanked mid-page) is swallowed', async () => {
		const t = setup();
		await t.start();
		t.host.give(t.stick);
		await flush();
		t.stick.write = async () => { throw new Error('LIBUSB_ERROR_NO_DEVICE'); };
		expect(() => t.stick.tx(3)).not.toThrow();
		await flush();
	});
});

describe('US1: device numbers', () => {
	test('a missing number is drawn from randomInt(1, 65536) and saved; existing ones are kept', async () => {
		const draws = [];
		const randomInt = (lo, hi) => {
			draws.push([lo, hi]);
			return 4000 + draws.length;
		};
		const t = setup({ numbers: { hr: 2222 }, randomInt });
		await t.start();
		t.host.give(t.stick);
		await flush();
		expect(draws.every(([lo, hi]) => lo === 1 && hi === 65536)).toBe(true);
		expect(t.saved).toHaveLength(1);
		expect(t.saved[0].hr).toBe(2222);
		expect(t.saved[0].footpod).toBeGreaterThanOrEqual(4001);
		expect(t.stick.frames()[1]).toEqual([m.ID.CHANNEL_ID, 3, t.saved[0].footpod & 0xFF, t.saved[0].footpod >> 8, 124, 5]);
	});

	test('existing numbers are reused unchanged and nothing is saved', async () => {
		const t = setup({ randomInt: () => { throw new Error('should not draw'); } });
		await t.start();
		t.host.give(t.stick);
		await flush();
		expect(t.saved).toEqual([]);
		expect(t.stick.frames()[1].slice(2, 4)).toEqual([1111 & 0xFF, 1111 >> 8]);
	});

	test('the drawn numbers differ from each other', async () => {
		let i = 0;
		const sequence = [7, 7, 7, 8, 9, 9, 10];
		const t = setup({ numbers: null, randomInt: () => sequence[i++] });
		await t.start();
		const numbers = Object.values(t.saved[0]);
		expect(new Set(numbers).size).toBe(4);
	});
});

describe('US4: status and renumber', () => {
	test('off when disabled', async () => {
		const t = setup({ antBroadcast: { enabled: false } });
		await t.start();
		expect(broadcast.status()).toEqual({ state: 'off', sensors: [] });
	});

	test('starting before a stick, then broadcasting with the device numbers', async () => {
		const t = setup({ antBroadcast: { treadmill: true } });
		await t.start();
		t.host.hostStatus = { available: false, reason: 'Starting ANT+…', scan: { active: false } };
		expect(broadcast.status()).toMatchObject({ state: 'starting' });
		t.host.give(t.stick);
		await flush();
		expect(broadcast.status()).toEqual({
			state: 'broadcasting',
			sensors: [{ kind: 'footpod', deviceNumber: 1111, sending: true }, { kind: 'treadmill', deviceNumber: 4444, sending: true }]
		});
	});

	test("without a stick it shows the host's reason (e.g. the WSL hint)", async () => {
		const t = setup();
		await t.start();
		t.host.hostStatus = { available: false, reason: 'No ANT+ USB stick found. Under WSL, run scripts/wsl/attach-bluetooth.ps1 …', scan: { active: false } };
		t.host.emit('status', t.host.hostStatus);
		expect(broadcast.status()).toMatchObject({ state: 'error', reason: expect.stringMatching(/No ANT\+ USB stick found/) });
	});

	test('switched on while Zwifit runs without the stick: error with needsRestart', async () => {
		const t = setup({ host: null });
		broadcast = new AntBroadcast({ host: null, getSettings: () => t.settings, saveDeviceNumbers: async () => {} });
		await broadcast.start();
		expect(broadcast.status()).toMatchObject({ state: 'error', needsRestart: true, reason: expect.stringMatching(/Restart Zwifit/) });
		expect(broadcast.status().sensors).toEqual([{ kind: 'footpod', deviceNumber: 1111, sending: false }]);
		broadcast.update({ kph: 3 });
		await expect(broadcast.renumber()).resolves.toBeDefined();
	});

	test('paused while the host scans; resumes with the same numbers afterwards', async () => {
		const t = setup();
		await t.start();
		t.host.give(t.stick);
		await flush();
		t.host.take('Scanning', true);
		expect(broadcast.status()).toMatchObject({ state: 'paused', reason: 'Paused while scanning for sensors' });
		const after = new FakeStick();
		t.host.give(after);
		await flush();
		expect(broadcast.status()).toMatchObject({ state: 'broadcasting', sensors: [{ kind: 'footpod', deviceNumber: 1111, sending: true }] });
	});

	test("'status' is emitted only on change", async () => {
		const t = setup();
		await t.start();
		t.host.give(t.stick);
		await flush();
		const count = t.statuses.length;
		broadcast.update({ kph: 5 });
		broadcast.update({ kph: 6 });
		await flush();
		expect(t.statuses.length).toBe(count);
		expect(t.statuses[t.statuses.length - 1].state).toBe('broadcasting');
	});

	test('renumber() draws four new numbers, saves them and reopens the channels under them', async () => {
		let next = 100;
		const t = setup({ randomInt: () => next++ });
		await t.start();
		t.host.give(t.stick);
		await flush();
		const from = t.stick.written.length;
		const numbers = await broadcast.renumber();
		await flush();
		expect(numbers).toEqual({ footpod: 100, hr: 101, power: 102, treadmill: 103 });
		expect(t.saved[t.saved.length - 1]).toEqual(numbers);
		const frames = t.stick.frames(from);
		expect(frames.slice(0, 2).map(f => f.slice(0, 2))).toEqual([[m.ID.CLOSE, 3], [m.ID.UNASSIGN, 3]]);
		expect(frames.slice(2, 7)).toEqual(CONFIG(3, 100, 124, 5, 8134));
		expect(broadcast.status().sensors[0].deviceNumber).toBe(100);
	});

	test('renumber() avoids the numbers in use now', async () => {
		const sequence = [1111, 5, 2222, 6, 7, 8];
		const t = setup({ randomInt: () => sequence.shift() });
		await t.start();
		const numbers = await broadcast.renumber();
		expect(numbers).toEqual({ footpod: 5, hr: 6, power: 7, treadmill: 8 });
	});
});

describe('US2: heart rate and power', () => {
	const both = { footpod: false, hr: true, power: true };

	test('HRM on channel 4 and power on channel 5 open only while a value is present', async () => {
		const t = setup({ antBroadcast: both });
		await t.start();
		t.host.give(t.stick);
		await flush();
		expect(t.stick.written).toEqual([]);
		expect(broadcast.status().sensors).toEqual([
			{ kind: 'hr', deviceNumber: 2222, sending: false, note: 'No heart rate right now' },
			{ kind: 'power', deviceNumber: 3333, sending: false, note: 'No power right now' }
		]);
		broadcast.update({ kph: 10, hr: 120, hrSource: 'ble', power: 250, powerSource: 'ble' });
		await flush();
		const frames = t.stick.frames();
		expect(frames.filter(f => f[1] === 4).slice(0, 5)).toEqual(CONFIG(4, 2222, 120, 1, 8070));
		expect(frames.filter(f => f[1] === 5).slice(0, 5)).toEqual(CONFIG(5, 3333, 11, 5, 8182));
	});

	test('HRM pages carry the rate and count beats; power pages count events and accumulate', async () => {
		const t = setup({ antBroadcast: both });
		await t.start();
		t.host.give(t.stick);
		broadcast.update({ hr: 120, hrSource: 'ble', power: 250, powerSource: 'ble' });
		await flush();
		const from = t.stick.written.length;
		t.advance(1000);
		t.stick.tx(4);
		t.stick.tx(5);
		t.stick.tx(5);
		await flush();
		// 1 s at 120 bpm: 2 more beats (on top of the first page's 0), beat time 1024.
		const hr = t.stick.pages(4, from)[0];
		expect(hr[0] & 0x7F).toBe(4);
		expect(hr.slice(4)).toEqual([0x00, 0x04, 2, 120]);
		const power = t.stick.pages(5, from);
		expect(power[1]).toEqual([0x10, 3, 0xFF, 0xFF, 750 & 0xFF, 750 >> 8, 250, 0]);
	});

	test('the channel closes when the value goes and reopens under the same number when it returns', async () => {
		const t = setup({ antBroadcast: both });
		await t.start();
		t.host.give(t.stick);
		broadcast.update({ hr: 120, hrSource: 'ble' });
		await flush();
		let from = t.stick.written.length;
		broadcast.update({ hr: null });
		await flush();
		expect(t.stick.frames(from).map(f => f.slice(0, 2))).toEqual([[m.ID.CLOSE, 4], [m.ID.UNASSIGN, 4]]);
		from = t.stick.written.length;
		broadcast.update({ hr: 130, hrSource: 'ble' });
		await flush();
		expect(t.stick.frames(from).slice(0, 5)).toEqual(CONFIG(4, 2222, 120, 1, 8070));
	});

	test('values from ANT+ sensors are not rebroadcast unless asked', async () => {
		const t = setup({ antBroadcast: both });
		await t.start();
		t.host.give(t.stick);
		broadcast.update({ hr: 120, hrSource: 'ant', power: 250, powerSource: 'ant' });
		await flush();
		expect(t.stick.written).toEqual([]);
		expect(broadcast.status().sensors).toEqual([
			{ kind: 'hr', deviceNumber: 2222, sending: false, note: 'Heart rate comes from an ANT+ sensor; pair your device with it directly' },
			{ kind: 'power', deviceNumber: 3333, sending: false, note: 'Power comes from an ANT+ sensor; pair your device with it directly' }
		]);
		t.settings.antBroadcast.rebroadcastAnt = { hr: true, power: true };
		broadcast.update({ hr: 120, hrSource: 'ant', power: 250, powerSource: 'ant' });
		await flush();
		expect(t.stick.frames().filter(f => f[0] === m.ID.OPEN).map(f => f[1]).sort()).toEqual([4, 5]);
	});

	test('out-of-range values count as missing', async () => {
		const t = setup({ antBroadcast: both });
		await t.start();
		t.host.give(t.stick);
		broadcast.update({ hr: 400, hrSource: 'ble', power: 9000, powerSource: 'ble' });
		await flush();
		expect(t.stick.written).toEqual([]);
	});
});

describe('US3: treadmill (fitness equipment)', () => {
	const fe = { footpod: false, treadmill: true };

	test('channel 6 is FE type 17, trans type 5, period 8192; pages follow speed, incline, climb', async () => {
		const t = setup({ antBroadcast: fe });
		await t.start();
		t.host.give(t.stick);
		broadcast.update({ kph: 10, incline: 3, hr: 140, hrSource: 'ble', cadence: 170 });
		await flush();
		expect(t.stick.frames().slice(0, 5)).toEqual(CONFIG(6, 4444, 17, 5, 8192));
		const from = t.stick.written.length;
		t.advance(1000);
		for (let i = 0; i < 4; i++) {
			t.stick.tx(6);
		}
		await flush();
		const pages = t.stick.pages(6, from);
		expect(pages.map(p => p[0])).toEqual([0x11, 0x10, 0x13, 0x10]);
		// Page 17: incline 3 % = 300.
		expect(pages[0].slice(4, 6)).toEqual([0x2C, 0x01]);
		// Page 16: speed 2778 mm/s, HR 140, in use.
		expect(pages[1].slice(4)).toEqual([0xDA, 0x0A, 140, 0x35]);
		// Page 19: 85 strides/min; 1 s at 2.78 m/s up 3 % = 0.083 m → 0 decimetres.
		expect(pages[2].slice(4, 7)).toEqual([85, 0, 0]);
	});

	test('inbound control pages and requests on channel 6 are ignored: no write, no treadmill call', async () => {
		const t = setup({ antBroadcast: fe });
		await t.start();
		t.host.give(t.stick);
		await flush();
		const from = t.stick.written.length;
		for (const page of [48, 49, 50, 51, 70]) {
			// Acknowledged data, broadcast data and burst data with a control page.
			for (const id of [0x4F, 0x4E, 0x50]) {
				t.stick.emit('read', Uint8Array.from([0xA4, 9, id, 6, page, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x10, 0x27, 0]));
			}
		}
		// Garbage and other channels' events too.
		t.stick.emit('read', Uint8Array.from([0xA4]));
		t.stick.emit('read', Uint8Array.from([0xA4, 3, 0x40, 0, 0x01, m.EVENT_TX, 0]));
		await flush();
		expect(t.stick.written.length).toBe(from);
		// The adapter has no treadmill to call: it only ever writes to the stick.
		expect(Object.keys(broadcast).some(k => /treadmill/i.test(k))).toBe(false);
	});

	test('all four sensors use channels 3–6 on one stick', async () => {
		const t = setup({ antBroadcast: { footpod: true, hr: true, power: true, treadmill: true } });
		await t.start();
		t.host.give(t.stick);
		broadcast.update({ kph: 8, hr: 120, hrSource: 'ble', power: 200, powerSource: 'treadmill' });
		await flush();
		expect(t.stick.frames().filter(f => f[0] === m.ID.OPEN).map(f => f[1]).sort()).toEqual([3, 4, 5, 6]);
		expect(broadcast.status().sensors.every(s => s.sending)).toBe(true);
	});
});
