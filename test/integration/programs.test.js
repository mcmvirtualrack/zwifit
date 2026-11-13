const { startApp } = require('./helpers/app');

jest.setTimeout(20000);

const isoIn = days => new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const input = (over = {}) => ({ goal: '10k', weeks: 12, raceDate: isoIn(70), runDays: [1, 3, 6], easyKph: 9, ...over });

let ctx;
let client;
beforeEach(async () => {
	ctx = await startApp();
	client = await ctx.pairedClient();
});
afterEach(async () => {
	await ctx.stop();
});

test('preview generates without saving; create saves and lists it with progress', async () => {
	const preview = await ctx.emit(client.socket, 'programs:preview', input());
	expect(preview).toMatchObject({ ok: true, data: { name: '10K · 12 weeks', weeks: 12 } });
	expect((await ctx.emit(client.socket, 'programs:list')).data).toEqual([]);

	const created = (await ctx.emit(client.socket, 'programs:create', input({ name: 'Spring 10K' }))).data;
	expect(created.name).toBe('Spring 10K');
	const list = (await ctx.emit(client.socket, 'programs:list')).data;
	expect(list).toEqual([expect.objectContaining({ id: created.id, name: 'Spring 10K', runs: created.days.length, done: 0 })]);
	const got = (await ctx.emit(client.socket, 'programs:get', { id: created.id })).data;
	expect(got.days[0]).toMatchObject({ done: false, workoutId: null });
});

test('bad input is refused: a past race date, too few run days', async () => {
	expect(await ctx.emit(client.socket, 'programs:create', input({ raceDate: isoIn(-1) }))).toMatchObject({ ok: false, error: 'INVALID' });
	expect(await ctx.emit(client.socket, 'programs:create', input({ runDays: [1, 3] }))).toMatchObject({ ok: false, error: 'INVALID' });
});

test('starting a day saves its workout as a plan once, plays it, and a completed run marks it done', async () => {
	const program = (await ctx.emit(client.socket, 'programs:create', input())).data;
	const day = program.days[0];
	ctx.app.treadmill.startBelt(5);
	const started = await ctx.emit(client.socket, 'programs:start', { id: program.id, date: day.date });
	expect(started).toMatchObject({ ok: true, data: { state: 'running' } });
	const planId = ctx.app.programsRepo.get(program.id).days[0].planId;
	expect(ctx.app.plansRepo.get(planId).name).toContain(`W${day.week}`);

	await ctx.emit(client.socket, 'playback:stop');
	// Finishing it properly: record a completed workout of that plan.
	const workoutId = '01HZX3K9V7Q8R2M4N6P0S1T3W5';
	await ctx.app.workoutsRepo.create({ id: workoutId, planId, planName: 'x', startedAt: new Date().toISOString() });
	await ctx.app.workoutsRepo.finish({ ...ctx.app.workoutsRepo.getFull(workoutId), endedAt: new Date().toISOString(), endReason: 'completed' });

	// Starting it again reuses the same plan.
	await ctx.emit(client.socket, 'programs:start', { id: program.id, date: day.date });
	await ctx.emit(client.socket, 'playback:stop');
	expect(ctx.app.programsRepo.get(program.id).days[0].planId).toBe(planId);
	const got = (await ctx.emit(client.socket, 'programs:get', { id: program.id })).data;
	expect(got.days[0]).toMatchObject({ done: true, workoutId });
});

test('delete removes the program but keeps plans already made from it', async () => {
	const program = (await ctx.emit(client.socket, 'programs:create', input())).data;
	ctx.app.treadmill.startBelt(5);
	await ctx.emit(client.socket, 'programs:start', { id: program.id, date: program.days[0].date });
	await ctx.emit(client.socket, 'playback:stop');
	const planId = ctx.app.programsRepo.get(program.id).days[0].planId;
	expect(await ctx.emit(client.socket, 'programs:delete', { id: program.id })).toMatchObject({ ok: true });
	expect((await ctx.emit(client.socket, 'programs:list')).data).toEqual([]);
	expect(ctx.app.plansRepo.has(planId)).toBe(true);
});
