const fs = require('fs');
const os = require('os');
const path = require('path');
const { createPlansRepo } = require('../../../src/storage/plansRepo');

const LIMITS = { minKph: 0, maxKph: 20, minIncline: 0, maxIncline: 15 };
const fixture = name => JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'fixtures', 'plans', name), 'utf8'));

let dir;
let now;
let limits;
const clock = { now: () => now };
beforeEach(() => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zwifit-plans-'));
	now = Date.parse('2026-11-01T10:00:00Z');
	limits = LIMITS;
});

async function newRepo() {
	const repo = createPlansRepo({ dir, clock, getLimits: () => limits });
	await repo.load();
	return repo;
}

test('create assigns a 26-char Crockford id and server-set timestamps', async () => {
	const repo = await newRepo();
	const plan = await repo.save({ ...fixture('valid-intervals.json'), createdAt: '1999-01-01T00:00:00Z' });
	expect(plan.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
	expect(plan.createdAt).toBe('2026-11-01T10:00:00.000Z');
	expect(plan.updatedAt).toBe('2026-11-01T10:00:00.000Z');
	expect(JSON.parse(fs.readFileSync(path.join(dir, 'plans', `${plan.id}.json`), 'utf8'))).toEqual(plan);
});

test('update keeps createdAt and moves updatedAt', async () => {
	const repo = await newRepo();
	const plan = await repo.save(fixture('valid-intervals.json'));
	now += 60000;
	const updated = await repo.save({ ...plan, description: 'changed' });
	expect(updated.createdAt).toBe(plan.createdAt);
	expect(updated.updatedAt).toBe('2026-11-01T10:01:00.000Z');
	expect(repo.get(plan.id).description).toBe('changed');
});

test('saving an unknown id is NOT_FOUND', async () => {
	const repo = await newRepo();
	await expect(repo.save({ ...fixture('valid-intervals.json'), id: '01HZX3K9V7Q8R2M4N6P0S1T3W5' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
});

test('names are trimmed and unique ignoring case', async () => {
	const repo = await newRepo();
	await repo.save({ ...fixture('valid-intervals.json'), name: 'Hills' });
	await expect(repo.save({ ...fixture('valid-intervals.json'), name: 'hills' })).rejects.toMatchObject({ code: 'NAME_TAKEN' });
	const other = await repo.save({ ...fixture('valid-intervals.json'), name: ' Tempo ' });
	expect(other.name).toBe('Tempo');
});

test('invalid plans are refused with details', async () => {
	const repo = await newRepo();
	const bad = fixture('valid-intervals.json');
	bad.items[0].targetKph = 25;
	bad.items[0].entered = { form: 'speed', unit: 'kph', value: 25 };
	await expect(repo.save(bad)).rejects.toMatchObject({
		code: 'INVALID_PLAN',
		details: [expect.objectContaining({ path: 'items[0].targetKph', code: 'ABOVE_MAX_SPEED' })]
	});
});

test('list, duplicate and delete', async () => {
	const repo = await newRepo();
	const plan = await repo.save(fixture('valid-intervals.json'));
	const copy = await repo.duplicate(plan.id);
	expect(copy.name).toBe(`${plan.name} (copy)`);
	expect(copy.id).not.toBe(plan.id);
	const named = await repo.duplicate(plan.id, 'Named copy');
	expect(named.name).toBe('Named copy');
	expect(repo.list().map(p => p.name)).toEqual([plan.name, `${plan.name} (copy)`, 'Named copy'].sort());
	expect(repo.list()[0].totals).toMatchObject({ seconds: expect.any(Number), metres: expect.any(Number) });
	await repo.remove(copy.id);
	expect(fs.existsSync(path.join(dir, 'plans', `${copy.id}.json`))).toBe(false);
	await expect(repo.remove(copy.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
	expect(() => repo.get(copy.id)).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
});

test('import gives a new id and renames on a name clash', async () => {
	const repo = await newRepo();
	const plan = await repo.save(fixture('valid-intervals.json'));
	const imported = await repo.importPlan({ ...plan });
	expect(imported.id).not.toBe(plan.id);
	expect(imported.name).toBe(`${plan.name} (2)`);
	expect(imported.items).toEqual(plan.items);
});

test('a corrupt or invalid plan file is skipped and reported while others load', async () => {
	let repo = await newRepo();
	const good = await repo.save(fixture('valid-intervals.json'));
	fs.writeFileSync(path.join(dir, 'plans', '01HZX3K9V7Q8R2M4N6P0S1T3W5.json'), '{broken');
	fs.writeFileSync(path.join(dir, 'plans', '01HZX3K9V7Q8R2M4N6P0S1T3W6.json'), JSON.stringify({ id: '01HZX3K9V7Q8R2M4N6P0S1T3W6', schemaVersion: 1, name: 'x', items: [] }));
	repo = await newRepo();
	expect(repo.list().map(p => p.id)).toEqual([good.id]);
	expect(repo.problems()).toEqual(expect.arrayContaining([
		expect.objectContaining({ file: '01HZX3K9V7Q8R2M4N6P0S1T3W5.json', code: 'CORRUPT_FILE' }),
		expect.objectContaining({ file: '01HZX3K9V7Q8R2M4N6P0S1T3W6.json', code: 'INVALID_PLAN' })
	]));
});

test('a plan outside today\'s limits is flagged on load, not deleted', async () => {
	let repo = await newRepo();
	const plan = await repo.save(fixture('valid-intervals.json'));
	limits = { ...LIMITS, maxKph: 10 };
	repo = await newRepo();
	const [summary] = repo.list();
	expect(summary.id).toBe(plan.id);
	expect(summary.problems).toEqual([expect.objectContaining({ code: 'ABOVE_MAX_SPEED' })]);
	expect(fs.existsSync(path.join(dir, 'plans', `${plan.id}.json`))).toBe(true);
});
