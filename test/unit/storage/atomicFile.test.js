const fs = require('fs');
const os = require('os');
const path = require('path');
const atomicFile = require('../../../src/storage/atomicFile');

let dir;
beforeEach(() => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zwifit-atomic-'));
});
afterEach(() => {
	jest.restoreAllMocks();
});

const leftovers = () => fs.readdirSync(dir).filter(name => name.endsWith('.tmp'));

test('writeJson then readJson round-trips and leaves no temp file', async () => {
	const file = path.join(dir, 'a.json');
	await atomicFile.writeJson(file, { hello: 'world', n: 1 });
	expect(await atomicFile.readJson(file)).toEqual({ hello: 'world', n: 1 });
	expect(atomicFile.readJsonSync(file)).toEqual({ hello: 'world', n: 1 });
	expect(leftovers()).toEqual([]);
});

test('writeJson creates missing parent directories', async () => {
	const file = path.join(dir, 'plans', 'x.json');
	await atomicFile.writeJson(file, { ok: true });
	expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ ok: true });
});

test('a failure before rename keeps the previous file and removes the temp file', async () => {
	const file = path.join(dir, 'b.json');
	await atomicFile.writeJson(file, { version: 1 });
	jest.spyOn(fs.promises, 'rename').mockRejectedValueOnce(new Error('disk gone'));
	await expect(atomicFile.writeJson(file, { version: 2 })).rejects.toThrow('disk gone');
	expect(await atomicFile.readJson(file)).toEqual({ version: 1 });
	expect(leftovers()).toEqual([]);
});

test('concurrent writes to one path are serialized; last write wins', async () => {
	const file = path.join(dir, 'c.json');
	await Promise.all(Array.from({ length: 20 }, (_, i) => atomicFile.writeJson(file, { i })));
	expect(await atomicFile.readJson(file)).toEqual({ i: 19 });
	expect(leftovers()).toEqual([]);
});

test('a write after a failed write still runs', async () => {
	const file = path.join(dir, 'd.json');
	jest.spyOn(fs.promises, 'rename').mockRejectedValueOnce(new Error('boom'));
	await expect(atomicFile.writeJson(file, { a: 1 })).rejects.toThrow('boom');
	await atomicFile.writeJson(file, { a: 2 });
	expect(await atomicFile.readJson(file)).toEqual({ a: 2 });
});

test('readJson of a corrupt file throws CorruptFileError without the absolute path', async () => {
	const file = path.join(dir, 'bad.json');
	fs.writeFileSync(file, '{ not json');
	await expect(atomicFile.readJson(file)).rejects.toBeInstanceOf(atomicFile.CorruptFileError);
	try {
		atomicFile.readJsonSync(file);
		throw new Error('expected throw');
	}
	catch (err) {
		expect(err).toBeInstanceOf(atomicFile.CorruptFileError);
		expect(err.message).toContain('bad.json');
		expect(err.message).not.toContain(dir);
		expect(err.fileName).toBe('bad.json');
	}
});

test('readJson of a missing file returns undefined', async () => {
	expect(await atomicFile.readJson(path.join(dir, 'missing.json'))).toBeUndefined();
	expect(atomicFile.readJsonSync(path.join(dir, 'missing.json'))).toBeUndefined();
});

test('appendLine appends one JSON object per line', async () => {
	const file = path.join(dir, 'w', 's.ndjson');
	await atomicFile.appendLine(file, { t: 1 });
	await atomicFile.appendLine(file, { t: 2 });
	expect(fs.readFileSync(file, 'utf8')).toBe('{"t":1}\n{"t":2}\n');
});

test('remove deletes a file and ignores a missing one', async () => {
	const file = path.join(dir, 'gone.json');
	await atomicFile.writeJson(file, {});
	await atomicFile.remove(file);
	await atomicFile.remove(file);
	expect(fs.existsSync(file)).toBe(false);
});
