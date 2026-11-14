// ANT+ broadcast end to end: createApp with the simulated treadmill and a fake ANT+ stick.
const EventEmitter = require('events');
const { startApp } = require('./helpers/app');
const { fakeAntLib } = require('./helpers/fakeAnt');

jest.setTimeout(30000);

let ctx;
let ant;
let client;

async function start(settings) {
	ant = fakeAntLib();
	ctx = await startApp({ settings, ant: { loadAnt: () => ant.lib, loadUsb: () => new EventEmitter(), wsl: false } });
	client = await ctx.pairedClient();
}

afterEach(async () => {
	if (ctx) {
		await ctx.stop();
		ctx = null;
	}
});

const until = async (check, timeoutMs = 3000) => {
	const end = Date.now() + timeoutMs;
	while (Date.now() < end) {
		const value = check();
		if (value) {
			return value;
		}
		await new Promise(resolve => setTimeout(resolve, 10));
	}
	throw new Error('timed out');
};

test('a paired device switches the broadcast on and the footpod channel opens; unpaired sockets are refused', async () => {
	await start();
	// Unpaired sockets are refused at connect, so they can never send settings:write.
	await expect(ctx.openSocket()).rejects.toThrow('NOT_PAIRED');
	expect(ant.stick().openChannels()).toEqual([]);

	const broadcasting = ctx.next(client.socket, 'status', s => s.antBroadcast && s.antBroadcast.state === 'broadcasting');
	expect(await ctx.emit(client.socket, 'settings:write', { antBroadcast: { enabled: true } })).toMatchObject({ ok: true });
	const status = await broadcasting;
	expect(status.antBroadcast.sensors).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'footpod', sending: true, deviceNumber: expect.any(Number) })]));
	expect(ant.stick().openChannels()).toEqual(expect.arrayContaining([3]));
	// The new device numbers were saved and pushed to clients.
	expect(ctx.app.settingsRepo.get().antBroadcast.deviceNumbers.footpod).toBe(status.antBroadcast.sensors.find(s => s.kind === 'footpod').deviceNumber);
});

test('the speed set with control:set shows up in the next footpod page', async () => {
	await start({ ...require('../../src/storage/settingsRepo').DEFAULT_SETTINGS, antBroadcast: { enabled: true, footpod: true, hr: false, power: false, treadmill: false, rebroadcastAnt: { hr: false, power: false } } });
	await until(() => ant.stick().openChannels().includes(3));
	ctx.app.treadmill.startBelt(10.4);
	expect(await ctx.emit(client.socket, 'control:set', { kph: 10.8 })).toEqual({ ok: true });
	await until(() => {
		ant.stick().tx(3);
		const pages = ant.stick().pages(3).filter(p => p[0] === 1);
		const last = pages[pages.length - 1];
		// 10.8 km/h = 3 m/s: integer 3, fraction 0.
		return last && (last[4] & 0x0F) === 3 && last[5] === 0;
	});
});

test('status carries antBroadcast; it is off by default and ANT+ reception still uses channels 0–2', async () => {
	await start();
	const status = await ctx.next(client.socket, 'status');
	expect(status.antBroadcast).toEqual({ state: 'off', sensors: [] });
	await until(() => ant.made.sensors.length === 3);
	expect(ant.made.sensors.map(s => s.attached[0][0]).sort()).toEqual([0, 1, 2]);
});

test('ant-broadcast:renumber returns four new numbers, saves them and pushes settings; any payload is refused', async () => {
	await start();
	await ctx.emit(client.socket, 'settings:write', { antBroadcast: { enabled: true } });
	await until(() => ant.stick().openChannels().includes(3));
	const before = ctx.app.settingsRepo.get().antBroadcast.deviceNumbers;
	const pushed = ctx.next(client.socket, 'settings', s => s.antBroadcast.deviceNumbers && s.antBroadcast.deviceNumbers.footpod !== before.footpod);
	const reply = await ctx.emit(client.socket, 'ant-broadcast:renumber', {});
	expect(reply).toMatchObject({ ok: true, data: { deviceNumbers: expect.any(Object) } });
	const numbers = reply.data.deviceNumbers;
	expect(Object.keys(numbers).sort()).toEqual(['footpod', 'hr', 'power', 'treadmill']);
	for (const n of Object.values(numbers)) {
		expect(n).toBeGreaterThanOrEqual(1);
		expect(n).toBeLessThanOrEqual(65535);
		expect(Object.values(before)).not.toContain(n);
	}
	expect((await pushed).antBroadcast.deviceNumbers).toEqual(numbers);
	expect(ctx.app.settingsRepo.get().antBroadcast.deviceNumbers).toEqual(numbers);

	expect(await ctx.emit(client.socket, 'ant-broadcast:renumber', { footpod: 5 })).toMatchObject({ ok: false, error: 'INVALID' });
	expect(await ctx.emit(client.socket, 'settings:write', { antBroadcast: { deviceNumbers: { footpod: 5 } } })).toMatchObject({ ok: false });
	expect(ctx.app.settingsRepo.get().antBroadcast.deviceNumbers).toEqual(numbers);
});

test('turning the broadcast off closes every transmit channel; reception channels stay attached', async () => {
	await start();
	await ctx.emit(client.socket, 'settings:write', { antBroadcast: { enabled: true, treadmill: true } });
	await until(() => ant.stick().openChannels().length === 2);
	await ctx.emit(client.socket, 'settings:write', { antBroadcast: { enabled: false } });
	await until(() => ant.stick().openChannels().length === 0);
	expect(ant.made.sensors).toHaveLength(3);
	expect(ant.made.sensors.every(s => s.attached.length === 1)).toBe(true);
});

test('all four sensors on one stick beside reception; inbound control pages do not move the treadmill', async () => {
	await start();
	const setTarget = jest.spyOn(ctx.app.treadmill, 'setTarget');
	await ctx.emit(client.socket, 'settings:write', { antBroadcast: { enabled: true, hr: true, power: true, treadmill: true } });
	await until(() => ant.stick().openChannels().length >= 2);
	expect(ant.stick().openChannels()).toEqual(expect.arrayContaining([3, 6]));
	let last = null;
	ctx.app.treadmill.on('status', status => { last = status; });
	ctx.app.treadmill.startBelt(6);
	await until(() => last);
	const before = { ...last };
	for (let i = 0; i < 50; i++) {
		for (const page of [48, 49, 50, 51, 70]) {
			ant.stick().emit('read', Uint8Array.from([0xA4, 9, 0x4F, 6, page, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x10, 0x27, 0]));
		}
	}
	await new Promise(resolve => setTimeout(resolve, 50));
	expect(setTarget).not.toHaveBeenCalled();
	expect(last).toMatchObject({ kph: before.kph, incline: before.incline });
	expect(ant.made.sensors.map(s => s.attached[0][0]).sort()).toEqual([0, 1, 2]);
});

test('the log says when the broadcast is ready, with the device numbers', async () => {
	await start();
	await ctx.emit(client.socket, 'settings:write', { antBroadcast: { enabled: true } });
	await until(() => ctx.logLines.some(l => /ANT\+ broadcast ready: footpod #\d+/.test(l.text)));
});
