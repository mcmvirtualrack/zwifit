const { startApp } = require('./helpers/app');

let ctx;
let client;
beforeEach(async () => {
	ctx = await startApp();
	client = await ctx.pairedClient();
});
afterEach(async () => {
	await ctx.stop();
});

test('control:set out of range is OUT_OF_RANGE and the treadmill receives nothing', async () => {
	const setTarget = jest.spyOn(ctx.app.treadmill, 'setTarget');
	const reply = await ctx.emit(client.socket, 'control:set', { kph: 25 });
	expect(reply).toMatchObject({ ok: false, error: 'OUT_OF_RANGE', details: [expect.objectContaining({ path: 'kph', code: 'ABOVE_MAX_SPEED' })] });
	expect(setTarget).not.toHaveBeenCalled();
});

test('control:set with no fields is a schema error', async () => {
	expect(await ctx.emit(client.socket, 'control:set', {})).toMatchObject({ ok: false, error: 'INVALID' });
	expect(await ctx.emit(client.socket, 'control:set', { kph: '10' })).toMatchObject({ ok: false, error: 'INVALID' });
});

test('a valid control:set reaches the treadmill', async () => {
	const setTarget = jest.spyOn(ctx.app.treadmill, 'setTarget');
	expect(await ctx.emit(client.socket, 'control:set', { kph: 8.5, incline: 2 })).toEqual({ ok: true });
	expect(setTarget).toHaveBeenCalledWith({ kph: 8.5, incline: 2 });
});

test('limits changed in settings apply to the next command', async () => {
	expect(await ctx.emit(client.socket, 'settings:write', { limits: { maxKph: 12 } })).toMatchObject({ ok: true });
	expect(await ctx.emit(client.socket, 'control:set', { kph: 13 })).toMatchObject({ ok: false, error: 'OUT_OF_RANGE' });
});

describe('control:start and control:stop (dashboard buttons)', () => {
	const step = (id, kph) => ({ kind: 'step', id, label: id, targetKph: kph, entered: { form: 'speed', unit: 'kph', value: kph }, targetIncline: 0, end: { type: 'time', seconds: 60 } });

	test('stop stops the belt; start restarts it where the treadmill allows', async () => {
		const pauseBelt = jest.spyOn(ctx.app.treadmill, 'pauseBelt');
		const resumeBelt = jest.spyOn(ctx.app.treadmill, 'resumeBelt');
		ctx.app.treadmill.startBelt(6);
		expect(await ctx.emit(client.socket, 'control:stop')).toEqual({ ok: true });
		expect(pauseBelt).toHaveBeenCalledTimes(1);
		expect(await ctx.emit(client.socket, 'control:start')).toEqual({ ok: true });
		expect(resumeBelt).toHaveBeenCalledTimes(1);
	});

	test('start is refused, without touching the belt, on treadmills that must be started from the console', async () => {
		ctx.app.treadmill.capabilities.canResume = false;
		const resumeBelt = jest.spyOn(ctx.app.treadmill, 'resumeBelt');
		expect(await ctx.emit(client.socket, 'control:start')).toMatchObject({ ok: false, error: 'RESUME_UNSUPPORTED' });
		expect(resumeBelt).not.toHaveBeenCalled();
	});

	test('while a plan runs, start is refused and stop ends the plan and stops the belt', async () => {
		const planId = (await ctx.emit(client.socket, 'plans:save', { schemaVersion: 1, name: 'Long', items: [step('a', 6)] })).data.id;
		ctx.app.treadmill.startBelt(5);
		expect(await ctx.emit(client.socket, 'playback:start', { planId })).toMatchObject({ ok: true });
		expect(await ctx.emit(client.socket, 'control:start')).toMatchObject({ ok: false, error: 'PLAN_RUNNING' });
		const pauseBelt = jest.spyOn(ctx.app.treadmill, 'pauseBelt');
		expect(await ctx.emit(client.socket, 'control:stop')).toEqual({ ok: true });
		expect(ctx.app.engine.isActive()).toBe(false);
		expect(pauseBelt).toHaveBeenCalled();
	});
});

describe('zwift-devices (remembered Zwift connections)', () => {
	test('a connecting client is remembered, can be renamed, and every paired device hears about it', async () => {
		const other = await ctx.pairedClient('Tablet');
		let changed = ctx.next(other.socket, 'zwift-devices:changed');
		ctx.app.broadcast.emit('client', { address: 'F4:26:79:30:5A:10', services: ['Fitness Machine'] });
		await changed;
		expect((await ctx.emit(client.socket, 'zwift-devices:list')).data).toEqual([
			expect.objectContaining({ address: 'f4:26:79:30:5a:10', name: 'Bluetooth device ··5A:10', services: ['Fitness Machine'] })
		]);

		changed = ctx.next(other.socket, 'zwift-devices:changed');
		expect(await ctx.emit(client.socket, 'zwift-devices:rename', { address: 'f4:26:79:30:5a:10', name: 'Apple TV' })).toMatchObject({ ok: true, data: { name: 'Apple TV' } });
		await changed;
		expect(await ctx.emit(client.socket, 'zwift-devices:forget', { address: 'f4:26:79:30:5a:10' })).toEqual({ ok: true });
		expect((await ctx.emit(client.socket, 'zwift-devices:list')).data).toEqual([]);
	});

	test.each([
		[{ address: 'nope', name: 'TV' }],
		[{ address: 'f4:26:79:30:5a:10', name: '' }],
		[{ address: 'f4:26:79:30:5a:10', name: 'TV', extra: true }]
	])('rename %j is a schema error', async payload => {
		expect(await ctx.emit(client.socket, 'zwift-devices:rename', payload)).toMatchObject({ ok: false, error: 'INVALID' });
	});
});

describe('settings:write (regression for the legacy unauthenticated fromJSON)', () => {
	test.each([
		[{ evil: true }],
		[{ treadmill: { bleActivation: 'aa' } }],
		[{ treadmill: { bleDetails: {} } }],
		[{ server: { tls: { certPath: '/etc/passwd', keyPath: '/etc/passwd' } } }],
		[{ speedMultiplier: 5 }]
	])('%j is rejected and nothing changes', async payload => {
		const before = ctx.app.settingsRepo.get();
		expect(await ctx.emit(client.socket, 'settings:write', payload)).toMatchObject({ ok: false, error: expect.stringMatching(/INVALID/) });
		expect(ctx.app.settingsRepo.get()).toEqual(before);
	});

	test('a valid write is saved and broadcast to every paired client', async () => {
		const other = await ctx.pairedClient('Tablet');
		const seen = ctx.next(other.socket, 'settings', s => s.metric === true);
		const reply = await ctx.emit(client.socket, 'settings:write', { metric: true });
		expect(reply).toMatchObject({ ok: true, data: { metric: true } });
		expect((await seen).metric).toBe(true);
	});

	test('the legacy message event does nothing', async () => {
		client.socket.emit('message', JSON.stringify({ event: 'writeSettings', data: { metric: true, ip: 'evil' } }));
		expect(await ctx.emit(client.socket, 'control:set', { kph: 1 })).toEqual({ ok: true });
		expect(ctx.app.settingsRepo.get().metric).toBe(false);
	});
});
