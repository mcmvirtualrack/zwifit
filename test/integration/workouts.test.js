const { startApp } = require('./helpers/app');

// These run real (short) plans in real time.
jest.setTimeout(20000);

const step = (id, kph, seconds) => ({ kind: 'step', id, label: id, targetKph: kph, entered: { form: 'speed', unit: 'kph', value: kph }, targetIncline: 1, end: { type: 'time', seconds } });

let ctx;
let client;
beforeEach(async () => {
	ctx = await startApp();
	client = await ctx.pairedClient();
	ctx.app.treadmill.startBelt(5);
});
afterEach(async () => {
	await ctx.stop();
});

async function runPlan() {
	const planId = (await ctx.emit(client.socket, 'plans:save', { schemaVersion: 1, name: 'Mini', items: [step('a', 6, 2), step('b', 7, 2)] })).data.id;
	const changed = ctx.next(client.socket, 'workouts:changed', () => true, 10000);
	await ctx.emit(client.socket, 'playback:start', { planId });
	return (await changed).id;
}

test('a playback becomes a workout visible through list, get and samples', async () => {
	const id = await runPlan();
	const list = await ctx.emit(client.socket, 'workouts:list', {});
	expect(list.data).toEqual([expect.objectContaining({ id, planName: 'Mini', endReason: 'completed' })]);
	const workout = (await ctx.emit(client.socket, 'workouts:get', { id })).data;
	expect(workout.steps.map(s => s.flatIndex)).toEqual([0, 1]);
	expect(workout.planSnapshot).toBeUndefined();
	expect(workout.totals.avgHr).toBeGreaterThan(0);
	const samples = (await ctx.emit(client.socket, 'workouts:samples', { id, limit: 100 })).data;
	expect(samples.total).toBeGreaterThanOrEqual(4);
	expect(samples.samples[samples.samples.length - 1].event).toBe('end');
});

test('the CSV export totals match workouts:get; deleting makes the export 404', async () => {
	const id = await runPlan();
	const workout = (await ctx.emit(client.socket, 'workouts:get', { id })).data;
	const res = await ctx.request('GET', `/api/workouts/${id}/export.csv`, { headers: { cookie: client.cookie } });
	expect(res.status).toBe(200);
	expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
	expect(res.headers['content-disposition']).toMatch(/^attachment; filename="zwifit-\d{4}-\d{2}-\d{2}-Mini\.csv"$/);
	const [header, summary] = res.text.replace(/^﻿/, '').split('\r\n');
	const columns = header.split(',');
	expect(summary.split(',')[columns.indexOf('elapsed_s')]).toBe(String(workout.totals.seconds));

	expect(await ctx.emit(client.socket, 'workouts:delete', { id })).toEqual({ ok: true });
	expect((await ctx.request('GET', `/api/workouts/${id}/export.csv`, { headers: { cookie: client.cookie } })).status).toBe(404);
});

test('unpaired export is 401', async () => {
	const id = await runPlan();
	expect((await ctx.request('GET', `/api/workouts/${id}/export.csv`)).status).toBe(401);
});

test('logs written during a workout contain no heart rate or samples (FR-019f)', async () => {
	await runPlan();
	const all = ctx.logLines.map(l => l.text).join('\n');
	expect(all).not.toMatch(/"hr":\s*\d/);
	expect(all).not.toMatch(/"samples":\s*\[/);
	for (const hr of [105, 112, 119, 126]) {
		expect(all).not.toContain(`"hr":${hr}`);
	}
});
