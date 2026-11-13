const { createRecorder, rebuildFromSamples } = require('../../../../src/core/history/recorder');

const step = (id, label, kph, incline, end) => ({ kind: 'step', id, label, targetKph: kph, entered: { form: 'speed', unit: 'kph', value: kph }, targetIncline: incline, end });
const plan = {
	id: '01HZX3K9V7Q8R2M4N6P0S1T3W5', schemaVersion: 1, name: 'Two steps', items: [
		step('a', 'Easy', 8, 1, { type: 'time', seconds: 5 }),
		step('b', 'Fast', 12, 2, { type: 'time', seconds: 5 }),
		step('c', 'Walk', 5, 0, { type: 'time', seconds: 60 })
	]
};

function memoryRepo() {
	const files = { headers: {}, samples: {}, finished: {} };
	return {
		files,
		create: async h => { files.headers[h.id] = h; files.samples[h.id] = []; },
		appendSample: async (id, s) => { files.samples[id].push(s); },
		finish: async w => { files.finished[w.id] = w; }
	};
}

let now;
let repo;
let recorder;
let changed;
beforeEach(() => {
	now = Date.parse('2026-11-01T10:00:00Z');
	repo = memoryRepo();
	changed = [];
	recorder = createRecorder({ repo, newId: () => '01HZX3K9V7Q8R2M4N6P0S1T3WA', now: () => now, onChanged: id => changed.push(id) });
});

const tick = (fields, seconds = 1) => {
	now += seconds * 1000;
	recorder.onSample({ t: new Date(now).toISOString(), kph: 8, incline: 1, metres: 0, hr: 120, flatIndex: 0, estimated: false, ...fields });
};

async function runTypicalWorkout() {
	recorder.onEvent({ type: 'start', plan });
	recorder.onEvent({ type: 'step', flatIndex: 0 });
	for (let i = 1; i <= 5; i++) {
		tick({ metres: i * 2.2, hr: 120 + i });
	}
	recorder.onEvent({ type: 'stepEnd', flatIndex: 0 });
	recorder.onEvent({ type: 'step', flatIndex: 1 });
	tick({ flatIndex: 1, kph: 12, incline: 2, metres: 14, hr: 0 });
	recorder.onEvent({ type: 'override', target: { kph: 11 } });
	tick({ flatIndex: 1, kph: 11, incline: 2, metres: 17, hr: 150 });
	recorder.onEvent({ type: 'stepEnd', flatIndex: 1, skipped: true });
	recorder.onEvent({ type: 'step', flatIndex: 2 });
	tick({ flatIndex: 2, kph: 5, incline: 0, metres: 18.5, hr: 140 });
	recorder.onEvent({ type: 'pause' });
	tick({ flatIndex: 2, kph: 0, incline: 0, metres: 18.5, hr: 130 });
	recorder.onEvent({ type: 'resume' });
	tick({ flatIndex: 2, kph: 5, incline: 0, metres: 20, hr: 135, estimated: true });
	now += 1000;
	recorder.onEvent({ type: 'end', reason: 'userStopped', flatIndex: 2 });
	await recorder.flush();
	return repo.files.finished['01HZX3K9V7Q8R2M4N6P0S1T3WA'];
}

test('samples carry t, kph, incline, metres, hr|null, flatIndex and event markers', async () => {
	await runTypicalWorkout();
	const samples = repo.files.samples['01HZX3K9V7Q8R2M4N6P0S1T3WA'];
	expect(samples[0]).toEqual({ t: '2026-11-01T10:00:01.000Z', kph: 8, incline: 1, metres: 2.2, hr: 121, flatIndex: 0, event: 'step' });
	expect(samples.map(s => s.event || '')).toEqual(['step', '', '', '', '', 'step', 'override', 'step', 'pause', 'resume', 'end']);
	expect(samples[5].hr).toBeNull();
	expect(samples[9].estimated).toBe(true);
});

test('the summary has step results with averages, HR, overridden and skipped', async () => {
	const workout = await runTypicalWorkout();
	expect(workout).toMatchObject({
		planName: 'Two steps',
		startedAt: '2026-11-01T10:00:00.000Z',
		endedAt: '2026-11-01T10:00:11.000Z',
		endReason: 'userStopped',
		totals: { seconds: 11, metres: 20, avgHr: expect.any(Number), maxHr: 150 }
	});
	expect(workout.steps).toHaveLength(3);
	expect(workout.steps[0]).toMatchObject({ flatIndex: 0, label: 'Easy', repetition: 1, target: { kph: 8, incline: 1 }, actual: { avgKph: 8, avgIncline: 1 }, seconds: 5, avgHr: 123, maxHr: 125, overridden: false, skipped: false });
	expect(workout.steps[1]).toMatchObject({ flatIndex: 1, overridden: true, skipped: true, avgHr: 150, maxHr: 150 });
	expect(workout.steps[2]).toMatchObject({ flatIndex: 2, label: 'Walk', skipped: false });
	expect(changed).toEqual(['01HZX3K9V7Q8R2M4N6P0S1T3WA']);
});

test('HR fields are absent when no sample had heart rate', async () => {
	recorder.onEvent({ type: 'start', plan });
	tick({ hr: null });
	tick({ hr: 0 });
	recorder.onEvent({ type: 'end', reason: 'completed', flatIndex: 0 });
	await recorder.flush();
	const workout = repo.files.finished['01HZX3K9V7Q8R2M4N6P0S1T3WA'];
	expect(workout.totals.avgHr).toBeUndefined();
	expect(workout.totals.maxHr).toBeUndefined();
	expect(workout.steps[0].avgHr).toBeUndefined();
});

test('cadence is kept when the treadmill reports it and averaged per step and overall', async () => {
	recorder.onEvent({ type: 'start', plan });
	tick({ cadence: 150 });
	tick({ cadence: 160 });
	tick({ cadence: 0 });
	tick({ flatIndex: 1, cadence: 170 });
	recorder.onEvent({ type: 'end', reason: 'completed', flatIndex: 1 });
	await recorder.flush();
	const samples = repo.files.samples['01HZX3K9V7Q8R2M4N6P0S1T3WA'];
	expect(samples.map(s => s.cadence)).toEqual([150, 160, undefined, 170, 170]);
	const workout = repo.files.finished['01HZX3K9V7Q8R2M4N6P0S1T3WA'];
	expect(workout.steps.map(s => s.avgCadence)).toEqual([155, 170]);
	expect(workout.totals.avgCadence).toBe(163);
});

test('running power (Stryd) is kept while reported and averaged per step, with the overall maximum', async () => {
	recorder.onEvent({ type: 'start', plan });
	tick({ power: 200 });
	tick({ power: 0 });
	tick({ power: 220 });
	tick({ flatIndex: 1, power: 280 });
	recorder.onEvent({ type: 'end', reason: 'completed', flatIndex: 1 });
	await recorder.flush();
	const samples = repo.files.samples['01HZX3K9V7Q8R2M4N6P0S1T3WA'];
	expect(samples.map(s => s.power)).toEqual([200, undefined, 220, 280, 280]);
	const workout = repo.files.finished['01HZX3K9V7Q8R2M4N6P0S1T3WA'];
	expect(workout.steps.map(s => s.avgPower)).toEqual([210, 280]);
	expect(workout.totals).toMatchObject({ avgPower: 245, maxPower: 280 });
});

test('rebuildFromSamples gives the same summary, survives a truncated line and ends appRestart', async () => {
	const finished = await runTypicalWorkout();
	const header = repo.files.headers['01HZX3K9V7Q8R2M4N6P0S1T3WA'];
	const text = repo.files.samples[header.id].map(s => JSON.stringify(s)).join('\n') + '\n{"t":"2026-11-01T10:00:1';
	const rebuilt = rebuildFromSamples(header, text);
	expect(rebuilt.steps).toEqual(finished.steps);
	expect(rebuilt.totals).toEqual(finished.totals);
	expect(rebuilt.endReason).toBe('appRestart');
	expect(rebuilt.endedAt).toBe('2026-11-01T10:00:11.000Z');
});

test('events and samples without a running workout are ignored', async () => {
	tick({});
	recorder.onEvent({ type: 'end', reason: 'completed', flatIndex: 0 });
	await recorder.flush();
	expect(repo.files.finished).toEqual({});
});
