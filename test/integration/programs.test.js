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

describe('target finish time', () => {
	const byTime = (over = {}) => {
		const { easyKph, ...rest } = input(over);
		return { ...rest, targetSeconds: 3000, ...over };
	};

	test('a program from a target time keeps it, and lists it', async () => {
		const created = (await ctx.emit(client.socket, 'programs:create', byTime())).data;
		expect(created).toMatchObject({ targetSeconds: 3000, targetFrom: 'time' });
		expect((await ctx.emit(client.socket, 'programs:list')).data[0]).toMatchObject({ targetSeconds: 3000, targetFrom: 'time' });
		expect((await ctx.emit(client.socket, 'programs:get', { id: created.id })).data).toMatchObject({ targetSeconds: 3000 });
	});

	test('from an easy speed, the predicted finish time is reported', async () => {
		const preview = (await ctx.emit(client.socket, 'programs:preview', input())).data;
		expect(preview).toMatchObject({ targetFrom: 'easy', targetSeconds: expect.any(Number) });
	});

	test('both an easy speed and a target time, or neither, is refused', async () => {
		expect(await ctx.emit(client.socket, 'programs:preview', { ...input(), targetSeconds: 3000 })).toMatchObject({ ok: false, error: 'INVALID' });
		const { easyKph, ...neither } = input();
		expect(await ctx.emit(client.socket, 'programs:preview', neither)).toMatchObject({ ok: false, error: 'INVALID' });
	});

	test('malformed or impossible targets are refused', async () => {
		for (const targetSeconds of [0, -60, 599, 36001, 3000.5, '3000']) {
			expect(await ctx.emit(client.socket, 'programs:preview', byTime({ targetSeconds }))).toMatchObject({ ok: false, error: 'INVALID' });
		}
		// A 10K in 10 minutes needs 60 km/h.
		const tooFast = await ctx.emit(client.socket, 'programs:preview', byTime({ targetSeconds: 600 }));
		expect(tooFast).toMatchObject({ ok: false, error: 'INVALID' });
		expect(JSON.stringify(tooFast)).toContain('TOO_FAST');
	});
});

test('a custom program from your own plans: create, start a day, edit keeping its progress', async () => {
	const step = (id, kph, seconds) => ({ kind: 'step', id, targetKph: kph, entered: { form: 'speed', unit: 'kph', value: kph }, targetIncline: 1, end: { type: 'time', seconds } });
	const easy = await ctx.app.plansRepo.importPlan({ schemaVersion: 1, name: 'Easy 30', authoredUnits: 'metric', items: [step('a', 9, 1800)] });
	const fast = await ctx.app.plansRepo.importPlan({ schemaVersion: 1, name: 'Fast 20', authoredUnits: 'metric', items: [step('b', 12, 1200)] });
	const monday = isoIn(0);
	const mine = { name: 'My 16 weeks', startDate: monday, weeks: 16, days: [{ week: 1, weekday: 0, planId: easy.id }, { week: 1, weekday: 3, planId: fast.id }, { week: 16, weekday: 6, planId: easy.id }] };
	const created = await ctx.emit(client.socket, 'programs:createCustom', mine);
	expect(created).toMatchObject({ ok: true, data: { goal: 'custom', weeks: 16, raceDate: null } });
	const { id, days } = created.data;
	expect(days.map(d => d.title)).toEqual(['Easy 30', 'Fast 20', 'Easy 30']);
	expect((await ctx.emit(client.socket, 'programs:list')).data).toEqual([expect.objectContaining({ id, goal: 'custom', runs: 3, done: 0 })]);

	// Starting the first day saves it as that day's own plan.
	expect(await ctx.emit(client.socket, 'programs:start', { id, date: days[0].date })).toMatchObject({ ok: true });
	await ctx.app.engine.stop();
	const started = (await ctx.emit(client.socket, 'programs:get', { id })).data.days[0].planId;
	expect(started).toEqual(expect.any(String));

	// Edit: drop week 16, change week 1 Thursday; the started Monday keeps its saved plan.
	const edited = await ctx.emit(client.socket, 'programs:updateCustom', { ...mine, id, days: [mine.days[0], { week: 1, weekday: 3, planId: easy.id }] });
	expect(edited).toMatchObject({ ok: true, data: { id, days: [expect.objectContaining({ planId: started }), expect.objectContaining({ title: 'Easy 30' })] } });
	expect(edited.data.days[1].planId).toBeUndefined();

	// Refused: a plan that doesn't exist, editing a generated program, a day after the last week.
	expect(await ctx.emit(client.socket, 'programs:createCustom', { ...mine, days: [{ week: 1, weekday: 0, planId: '01HZX3K9V7Q8R2M4N6P0S1T3WC' }] })).toMatchObject({ ok: false, error: 'NOT_FOUND' });
	const generated = (await ctx.emit(client.socket, 'programs:create', input())).data;
	expect(await ctx.emit(client.socket, 'programs:updateCustom', { ...mine, id: generated.id })).toMatchObject({ ok: false, error: 'INVALID' });
	expect(await ctx.emit(client.socket, 'programs:createCustom', { ...mine, weeks: 2 })).toMatchObject({ ok: false, error: 'INVALID' });
});
