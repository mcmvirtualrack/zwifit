const fs = require('fs');
const os = require('os');
const path = require('path');
const { createWorkoutsRepo } = require('../../../src/storage/workoutsRepo');

let dir;
beforeEach(() => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zwifit-workouts-'));
});

const id = n => `01HZX3K9V7Q8R2M4N6P0S1T3${String(n).padStart(2, '0').replace(/[ILOU]/g, 'X')}`;
const header = (n, startedAt) => ({
	id: id(n), planId: null, planName: `Run ${n}`, planSnapshot: { schemaVersion: 1, name: `Run ${n}`, items: [] },
	startedAt, endedAt: null, endReason: null, totals: { seconds: 0, metres: 0 }, steps: []
});
const sample = (t, extra = {}) => ({ t, kph: 8, incline: 1, metres: 10, hr: 120, flatIndex: 0, ...extra });

async function newRepo() {
	const repo = createWorkoutsRepo({ dir });
	await repo.load();
	return repo;
}

test('writes the summary file and appends one sample per line', async () => {
	const repo = await newRepo();
	await repo.create(header(10, '2026-11-01T10:00:00.000Z'));
	await repo.appendSample(id(10), sample('2026-11-01T10:00:01.000Z'));
	await repo.appendSample(id(10), sample('2026-11-01T10:00:02.000Z'));
	expect(JSON.parse(fs.readFileSync(path.join(dir, 'workouts', `${id(10)}.json`), 'utf8')).planName).toBe('Run 10');
	const lines = fs.readFileSync(path.join(dir, 'workouts', `${id(10)}.samples.ndjson`), 'utf8').trim().split('\n');
	expect(lines.map(l => JSON.parse(l).t)).toEqual(['2026-11-01T10:00:01.000Z', '2026-11-01T10:00:02.000Z']);
});

test('list is newest first, pages with before, limit 1–100', async () => {
	const repo = await newRepo();
	for (let n = 10; n < 15; n++) {
		const w = header(n, `2026-11-0${n - 9}T10:00:00.000Z`);
		await repo.create(w);
		await repo.finish({ ...w, endedAt: w.startedAt, endReason: 'completed' });
	}
	expect(repo.list().map(w => w.planName)).toEqual(['Run 14', 'Run 13', 'Run 12', 'Run 11', 'Run 10']);
	expect(repo.list({ limit: 2 }).map(w => w.planName)).toEqual(['Run 14', 'Run 13']);
	expect(repo.list({ before: '2026-11-03T10:00:00.000Z' }).map(w => w.planName)).toEqual(['Run 11', 'Run 10']);
	expect(repo.list({ limit: 500 })).toHaveLength(5);
	expect(repo.list()[0].planSnapshot).toBeUndefined();
});

test('samples are paged with limit ≤ 3600', async () => {
	const repo = await newRepo();
	await repo.create(header(10, '2026-11-01T10:00:00.000Z'));
	for (let i = 0; i < 10; i++) {
		await repo.appendSample(id(10), sample(new Date(Date.parse('2026-11-01T10:00:00Z') + i * 1000).toISOString(), { metres: i }));
	}
	const page = await repo.samples(id(10), { fromIndex: 3, limit: 4 });
	expect(page.total).toBe(10);
	expect(page.samples.map(s => s.metres)).toEqual([3, 4, 5, 6]);
	expect((await repo.samples(id(10), { limit: 99999 })).samples).toHaveLength(10);
});

test('delete removes both files', async () => {
	const repo = await newRepo();
	await repo.create(header(10, '2026-11-01T10:00:00.000Z'));
	await repo.appendSample(id(10), sample('2026-11-01T10:00:01.000Z'));
	await repo.remove(id(10));
	expect(fs.readdirSync(path.join(dir, 'workouts'))).toEqual([]);
	expect(() => repo.get(id(10))).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
	await expect(repo.remove(id(10))).rejects.toMatchObject({ code: 'NOT_FOUND' });
});

test('startup closes a workout left open by a crash, keeping its samples', async () => {
	let repo = await newRepo();
	await repo.create(header(10, '2026-11-01T10:00:00.000Z'));
	await repo.appendSample(id(10), sample('2026-11-01T10:00:01.000Z', { metres: 2 }));
	await repo.appendSample(id(10), sample('2026-11-01T10:00:02.000Z', { metres: 4 }));
	fs.appendFileSync(path.join(dir, 'workouts', `${id(10)}.samples.ndjson`), '{"t":"2026-11-01T10:0');
	repo = createWorkoutsRepo({ dir });
	expect((await repo.load()).recovered).toEqual([id(10)]);
	expect(repo.get(id(10))).toMatchObject({ endReason: 'appRestart', endedAt: '2026-11-01T10:00:02.000Z', totals: { seconds: 2, metres: 4 } });
	expect(JSON.parse(fs.readFileSync(path.join(dir, 'workouts', `${id(10)}.json`), 'utf8')).endReason).toBe('appRestart');
	expect((await repo.samples(id(10))).samples).toHaveLength(2);
});
