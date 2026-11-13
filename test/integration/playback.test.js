const { startApp } = require('./helpers/app');

// These run real (short) plans in real time.
jest.setTimeout(20000);

const step = (id, kph, incline, seconds) => ({ kind: 'step', id, label: id, targetKph: kph, entered: { form: 'speed', unit: 'kph', value: kph }, targetIncline: incline, end: { type: 'time', seconds } });
const shortPlan = (name = 'Short', seconds = 2) => ({ schemaVersion: 1, name, items: [step('a', 6, 1, seconds), step('b', 7, 2, seconds)] });

let ctx;
let phone;
let tablet;
let planId;
beforeEach(async () => {
	ctx = await startApp();
	phone = await ctx.pairedClient('Phone');
	tablet = await ctx.pairedClient('Tablet');
	planId = (await ctx.emit(phone.socket, 'plans:save', shortPlan())).data.id;
	ctx.app.treadmill.startBelt(5);
});
afterEach(async () => {
	await ctx.stop();
});

test('both devices receive the same playback state, at 1 Hz while running', async () => {
	const seenPhone = [];
	const seenTablet = [];
	phone.socket.on('playback', p => seenPhone.push(p));
	tablet.socket.on('playback', p => seenTablet.push(p));
	expect(await ctx.emit(phone.socket, 'playback:start', { planId })).toMatchObject({ ok: true, data: { state: 'running', planName: 'Short' } });
	await new Promise(resolve => setTimeout(resolve, 2500));
	expect(seenPhone.length).toBeGreaterThanOrEqual(3);
	expect(seenTablet.map(p => [p.state, p.cursor && p.cursor.flatIndex])).toEqual(seenPhone.map(p => [p.state, p.cursor && p.cursor.flatIndex]));
});

test('a second start is ALREADY_RUNNING; deleting the running plan is PLAN_RUNNING', async () => {
	await ctx.emit(phone.socket, 'playback:start', { planId });
	expect(await ctx.emit(tablet.socket, 'playback:start', { planId })).toMatchObject({ ok: false, error: 'ALREADY_RUNNING' });
	expect(await ctx.emit(tablet.socket, 'plans:delete', { id: planId })).toMatchObject({ ok: false, error: 'PLAN_RUNNING' });
});

test('editing the running plan does not change the session', async () => {
	await ctx.emit(phone.socket, 'playback:start', { planId });
	const plan = (await ctx.emit(phone.socket, 'plans:get', { id: planId })).data;
	plan.items[1].targetKph = 9;
	plan.items[1].entered.value = 9;
	expect(await ctx.emit(phone.socket, 'plans:save', plan)).toMatchObject({ ok: true });
	const setTarget = jest.spyOn(ctx.app.treadmill, 'setTarget');
	await ctx.emit(phone.socket, 'playback:skip');
	expect(setTarget).toHaveBeenCalledWith({ kph: 7, incline: 2 });
});

test('pause, resume and stop from either device; control:set during playback is an override', async () => {
	await ctx.emit(phone.socket, 'playback:start', { planId });
	expect(await ctx.emit(tablet.socket, 'control:set', { kph: 6.5 })).toEqual({ ok: true });
	expect(ctx.app.engine.snapshot().override).toEqual({ kph: 6.5 });
	expect(await ctx.emit(tablet.socket, 'playback:pause')).toEqual({ ok: true });
	expect(ctx.app.engine.state).toBe('paused');
	expect(await ctx.emit(phone.socket, 'playback:resume')).toEqual({ ok: true });
	expect(ctx.app.engine.state).toBe('running');
	expect(await ctx.emit(tablet.socket, 'playback:stop')).toEqual({ ok: true });
	expect(ctx.app.engine.snapshot()).toMatchObject({ state: 'ended', endReason: 'userStopped' });
});

test('revoking the controlling device disconnects it; the plan continues and another device can stop it', async () => {
	await ctx.emit(phone.socket, 'playback:start', { planId: (await ctx.emit(phone.socket, 'plans:save', shortPlan('Long', 60))).data.id });
	const gone = new Promise(resolve => phone.socket.once('disconnect', resolve));
	const res = await ctx.request('DELETE', `/api/devices/${phone.device.id}`, { headers: { cookie: tablet.cookie } });
	expect(res.status).toBe(204);
	await gone;
	expect(ctx.app.engine.state).toBe('running');
	await expect(ctx.openSocket({ cookie: phone.cookie })).rejects.toMatchObject({ message: 'NOT_PAIRED' });
	expect(await ctx.emit(tablet.socket, 'playback:stop')).toEqual({ ok: true });
});

test('a plan runs to completion and then sends only the cool-down', async () => {
	const setTarget = jest.spyOn(ctx.app.treadmill, 'setTarget');
	const done = ctx.next(tablet.socket, 'playback', p => p.state === 'completed', 10000);
	await ctx.emit(phone.socket, 'playback:start', { planId });
	await done;
	const calls = setTarget.mock.calls.map(c => c[0]);
	expect(calls[0]).toEqual({ kph: 6, incline: 1 });
	expect(calls).toContainEqual({ kph: 7, incline: 2 });
	expect(calls[calls.length - 1]).toEqual({ kph: 3.2, incline: 0 });
	const count = calls.length;
	await new Promise(resolve => setTimeout(resolve, 1500));
	expect(setTarget).toHaveBeenCalledTimes(count);
});

test('after an app restart the state is idle and nothing is sent', async () => {
	await ctx.emit(phone.socket, 'playback:start', { planId });
	await ctx.stop();
	ctx = await startApp();
	await ctx.pairedClient();
	const setTarget = jest.spyOn(ctx.app.treadmill, 'setTarget');
	expect(ctx.app.engine.snapshot().state).toBe('idle');
	await new Promise(resolve => setTimeout(resolve, 1000));
	expect(setTarget).not.toHaveBeenCalled();
});
