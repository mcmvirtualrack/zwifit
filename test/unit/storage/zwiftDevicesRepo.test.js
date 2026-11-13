const fs = require('fs');
const os = require('os');
const path = require('path');
const { createZwiftDevicesRepo, defaultName } = require('../../../src/storage/zwiftDevicesRepo');

let dir;
let now;
const clock = { now: () => now };
beforeEach(() => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zwifit-zdev-'));
	now = Date.parse('2026-11-01T05:00:00Z');
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

async function repo() {
	const r = createZwiftDevicesRepo({ dir, clock });
	await r.load();
	return r;
}

test('a new device gets a default name from its address and survives a restart', async () => {
	const r = await repo();
	await r.seen('F4:26:79:30:5A:10', ['Fitness Machine']);
	expect(r.list()).toEqual([{
		address: 'f4:26:79:30:5a:10',
		name: 'Bluetooth device ··5A:10',
		named: false,
		firstSeenAt: '2026-11-01T05:00:00.000Z',
		lastSeenAt: '2026-11-01T05:00:00.000Z',
		services: ['Fitness Machine']
	}]);
	expect((await repo()).list()).toHaveLength(1);
});

test('seeing it again updates the time and adds services, and keeps the name', async () => {
	const r = await repo();
	await r.seen('f4:26:79:30:5a:10', ['Fitness Machine']);
	await r.rename('f4:26:79:30:5a:10', '  Apple TV  ');
	now += 60000;
	await r.seen('f4:26:79:30:5a:10', ['Heart Rate', 'Fitness Machine']);
	expect(r.list()[0]).toMatchObject({ name: 'Apple TV', named: true, lastSeenAt: '2026-11-01T05:01:00.000Z', services: ['Fitness Machine', 'Heart Rate'] });
});

test('the list is newest first and keeps at most 20 devices', async () => {
	const r = await repo();
	for (let i = 0; i < 22; i++) {
		now += 1000;
		await r.seen(`aa:bb:cc:dd:ee:${i.toString(16).padStart(2, '0')}`);
	}
	const list = r.list();
	expect(list).toHaveLength(20);
	expect(list[0].address).toBe('aa:bb:cc:dd:ee:15');
	expect(list.map(d => d.address)).not.toContain('aa:bb:cc:dd:ee:00');
});

test('bad names, unknown devices and malformed addresses are refused', async () => {
	const r = await repo();
	await r.seen('not-an-address');
	expect(r.list()).toEqual([]);
	await r.seen('aa:bb:cc:dd:ee:ff');
	await expect(r.rename('aa:bb:cc:dd:ee:ff', '')).rejects.toMatchObject({ code: 'BAD_NAME' });
	await expect(r.rename('aa:bb:cc:dd:ee:ff', 'x'.repeat(41))).rejects.toMatchObject({ code: 'BAD_NAME' });
	await expect(r.rename('aa:bb:cc:dd:ee:ff', 'bad\u0007name')).rejects.toMatchObject({ code: 'BAD_NAME' });
	await expect(r.rename('11:22:33:44:55:66', 'TV')).rejects.toMatchObject({ code: 'NOT_FOUND' });
	await expect(r.forget('11:22:33:44:55:66')).rejects.toMatchObject({ code: 'NOT_FOUND' });
});

test('forget removes it for good', async () => {
	const r = await repo();
	await r.seen('aa:bb:cc:dd:ee:ff');
	await r.forget('AA:BB:CC:DD:EE:FF');
	expect((await repo()).list()).toEqual([]);
});

test('defaultName uses the last two bytes', () => {
	expect(defaultName('f4:26:79:30:5a:10')).toBe('Bluetooth device ··5A:10');
});
