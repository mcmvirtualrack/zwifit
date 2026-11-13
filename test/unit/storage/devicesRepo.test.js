const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createDevicesRepo, EXPIRY_MS } = require('../../../src/storage/devicesRepo');

const DAY = 24 * 60 * 60 * 1000;
const hash = text => crypto.createHash('sha256').update(text).digest('hex');

let dir;
let now;
const clock = { now: () => now };
const file = () => path.join(dir, 'devices.json');
const onDisk = () => JSON.parse(fs.readFileSync(file(), 'utf8'));

beforeEach(() => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zwifit-devices-'));
	now = Date.parse('2026-11-01T10:00:00Z');
});

async function newRepo() {
	const repo = createDevicesRepo({ dir, clock });
	await repo.load();
	return repo;
}

test('stores only the SHA-256 token hash', async () => {
	const repo = await newRepo();
	const device = await repo.add({ name: 'Phone', tokenHash: hash('secret-token') });
	expect(device).toMatchObject({
		name: 'Phone',
		tokenHash: hash('secret-token'),
		pairedAt: '2026-11-01T10:00:00.000Z',
		lastSeenAt: '2026-11-01T10:00:00.000Z',
		expiresAt: new Date(now + 90 * DAY).toISOString()
	});
	expect(device.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
	expect(JSON.stringify(onDisk())).not.toContain('secret-token');
	expect(onDisk().devices[0].tokenHash).toBe(hash('secret-token'));
});

test('rejects anything that is not a SHA-256 hex hash', async () => {
	const repo = await newRepo();
	await expect(repo.add({ name: 'Phone', tokenHash: 'plain-token' })).rejects.toThrow();
});

test.each(['', '   ', 'x'.repeat(41), 'bad\u0000name'])('rejects device name %p', async name => {
	const repo = await newRepo();
	await expect(repo.add({ name, tokenHash: hash('t') })).rejects.toMatchObject({ code: 'BAD_NAME' });
});

test('names are trimmed and 40 characters is allowed', async () => {
	const repo = await newRepo();
	expect((await repo.add({ name: '  Tablet  ', tokenHash: hash('a') })).name).toBe('Tablet');
	expect((await repo.add({ name: 'y'.repeat(40), tokenHash: hash('b') })).name).toHaveLength(40);
});

test('expiry is 90 days after lastSeenAt', () => {
	expect(EXPIRY_MS).toBe(90 * DAY);
});

test('findByTokenHash finds live devices and treats expired ones as unknown', async () => {
	const repo = await newRepo();
	await repo.add({ name: 'Phone', tokenHash: hash('t1') });
	expect(repo.findByTokenHash(hash('t1'))).toMatchObject({ name: 'Phone' });
	expect(repo.findByTokenHash(hash('other'))).toBeNull();
	now += 90 * DAY + 1;
	expect(repo.findByTokenHash(hash('t1'))).toBeNull();
});

test('expired entries are pruned on load', async () => {
	let repo = await newRepo();
	await repo.add({ name: 'Old', tokenHash: hash('old') });
	now += 60 * DAY;
	await repo.add({ name: 'New', tokenHash: hash('new') });
	now += 31 * DAY;
	repo = await newRepo();
	expect(repo.list().map(d => d.name)).toEqual(['New']);
	expect(onDisk().devices.map(d => d.name)).toEqual(['New']);
});

test('touch renews expiry, writing lastSeenAt at most once per minute', async () => {
	const repo = await newRepo();
	const device = await repo.add({ name: 'Phone', tokenHash: hash('t') });
	const write = jest.spyOn(require('../../../src/storage/atomicFile'), 'writeJson');

	now += 30 * 1000;
	await repo.touch(device.id);
	expect(write).not.toHaveBeenCalled();
	expect(repo.list()[0].lastSeenAt).toBe(device.lastSeenAt);

	now += 31 * 1000;
	await repo.touch(device.id);
	expect(write).toHaveBeenCalledTimes(1);
	expect(repo.list()[0].lastSeenAt).toBe(new Date(now).toISOString());
	expect(repo.list()[0].expiresAt).toBe(new Date(now + 90 * DAY).toISOString());
	write.mockRestore();
});

test('remove deletes one device', async () => {
	const repo = await newRepo();
	const a = await repo.add({ name: 'A', tokenHash: hash('a') });
	await repo.add({ name: 'B', tokenHash: hash('b') });
	expect(await repo.remove(a.id)).toBe(true);
	expect(await repo.remove(a.id)).toBe(false);
	expect(onDisk().devices.map(d => d.name)).toEqual(['B']);
});

test('list returns copies', async () => {
	const repo = await newRepo();
	await repo.add({ name: 'A', tokenHash: hash('a') });
	repo.list()[0].name = 'tampered';
	expect(repo.list()[0].name).toBe('A');
});

test('a corrupt devices.json fails loudly instead of dropping all pairings', async () => {
	fs.writeFileSync(file(), '{oops');
	await expect(createDevicesRepo({ dir, clock }).load()).rejects.toMatchObject({ code: 'CORRUPT_FILE' });
});
