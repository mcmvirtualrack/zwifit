const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createDevicesRepo } = require('../../../src/storage/devicesRepo');
const { createRateLimit } = require('../../../src/security/rateLimit');
const pairingModule = require('../../../src/security/pairing');

const { createPairing, generateCode, normalizeCode, hashToken, CODE_ALPHABET } = pairingModule;
const DAY = 24 * 60 * 60 * 1000;

let dir;
let now;
let printed;
let devices;
let rateLimit;
let pairing;
const clock = { now: () => now };

beforeEach(async () => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zwifit-pairing-'));
	now = Date.parse('2026-11-01T10:00:00Z');
	printed = [];
	devices = createDevicesRepo({ dir, clock });
	await devices.load();
	rateLimit = createRateLimit({ clock });
	pairing = createPairing({ dir, devices, rateLimit, clock, printCode: code => printed.push(code) });
});

const lastCode = () => printed[printed.length - 1].replace('-', '');

describe('code generation', () => {
	test('8 characters of Crockford base32 from crypto.randomInt', () => {
		const spy = jest.spyOn(crypto, 'randomInt');
		const code = generateCode();
		expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
		expect(spy).toHaveBeenCalledTimes(8);
		expect(spy).toHaveBeenCalledWith(32);
		spy.mockRestore();
		expect(CODE_ALPHABET).toBe('0123456789ABCDEFGHJKMNPQRSTVWXYZ');
	});

	test('normalizeCode accepts dashes, lower case and look-alike letters', () => {
		expect(normalizeCode('abcd-efgh')).toBe('ABCDEFGH');
		expect(normalizeCode('o1il-0000')).toBe('0111' + '0000');
		expect(normalizeCode('ABC')).toBeNull();
		expect(normalizeCode('ABCDEFGU')).toBeNull();
		expect(normalizeCode(12345678)).toBeNull();
	});

	test('regenerateCode prints XXXX-XXXX, returns it (for a paired screen) and stores only a hash', async () => {
		const result = await pairing.regenerateCode();
		expect(result).toEqual({ code: printed[0] });
		expect(printed).toHaveLength(1);
		expect(printed[0]).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
		const stored = fs.readFileSync(path.join(dir, 'pairing.json'), 'utf8');
		expect(stored).not.toContain(lastCode());
		expect(JSON.parse(stored).codeHash).toMatch(/^[0-9a-f]{64}$/);
	});

	test('ensureCode creates a code only when none exists', async () => {
		expect(await pairing.ensureCode()).toBe(true);
		expect(await pairing.ensureCode()).toBe(false);
		expect(printed).toHaveLength(1);
	});
});

describe('pair', () => {
	beforeEach(() => pairing.regenerateCode());

	test('the right code returns a 32-byte token whose hash is stored', async () => {
		const result = await pairing.pair({ code: printed[0], deviceName: 'Phone', ip: '10.0.0.2' });
		expect(Object.keys(result).sort()).toEqual(['device', 'token']);
		expect(Buffer.from(result.token, 'base64url')).toHaveLength(32);
		expect(result.device.tokenHash).toBe(hashToken(result.token));
		expect(JSON.stringify(result)).not.toContain(lastCode());
		const disk = fs.readFileSync(path.join(dir, 'devices.json'), 'utf8');
		expect(disk).toContain(hashToken(result.token));
		expect(disk).not.toContain(result.token);
	});

	test('the code can pair several devices until regenerated', async () => {
		await pairing.pair({ code: lastCode(), deviceName: 'Phone', ip: '10.0.0.2' });
		await pairing.pair({ code: lastCode(), deviceName: 'Tablet', ip: '10.0.0.3' });
		expect(devices.list()).toHaveLength(2);
	});

	test('a wrong code is BAD_CODE and counts as a failure', async () => {
		await expect(pairing.pair({ code: '00000000', ip: '10.0.0.2' })).rejects.toMatchObject({ code: 'BAD_CODE' });
		await expect(pairing.pair({ code: 'nonsense', ip: '10.0.0.2' })).rejects.toMatchObject({ code: 'BAD_CODE' });
		const fail = jest.spyOn(rateLimit, 'fail');
		await expect(pairing.pair({ code: '00000000', ip: '10.0.0.2' })).rejects.toMatchObject({ code: 'BAD_CODE' });
		expect(fail).toHaveBeenCalledWith('10.0.0.2');
	});

	test('the 6th try from a locked IP is LOCKED_OUT even with the right code', async () => {
		for (let i = 0; i < 5; i++) {
			await expect(pairing.pair({ code: '00000000', ip: '10.0.0.2' })).rejects.toMatchObject({ code: 'BAD_CODE' });
		}
		await expect(pairing.pair({ code: lastCode(), ip: '10.0.0.2' }))
			.rejects.toMatchObject({ code: 'LOCKED_OUT', details: { retryAfterSeconds: 900 } });
	});

	test('global suspension persists in pairing.json and is cleared by regenerateCode', async () => {
		for (let i = 0; i < 30; i++) {
			await expect(pairing.pair({ code: '00000000', ip: `10.0.1.${i}` })).rejects.toMatchObject({ code: 'BAD_CODE' });
		}
		await expect(pairing.pair({ code: lastCode(), ip: '10.0.2.1' })).rejects.toMatchObject({ code: 'PAIRING_SUSPENDED' });

		// A restarted app (fresh rate limiter) stays suspended.
		const restarted = createPairing({ dir, devices, rateLimit: createRateLimit({ clock }), clock, printCode: () => {} });
		await restarted.load();
		await expect(restarted.pair({ code: lastCode(), ip: '10.0.2.1' })).rejects.toMatchObject({ code: 'PAIRING_SUSPENDED' });

		await pairing.regenerateCode();
		await expect(pairing.pair({ code: lastCode(), ip: '10.0.2.1' })).resolves.toHaveProperty('token');
	});

	test('a code regenerated elsewhere (npm run pair) is picked up without restart', async () => {
		const other = createPairing({ dir, devices, rateLimit: createRateLimit({ clock }), clock, printCode: code => printed.push(code) });
		const oldCode = lastCode();
		await other.regenerateCode();
		await expect(pairing.pair({ code: oldCode, ip: '10.0.0.2' })).rejects.toMatchObject({ code: 'BAD_CODE' });
		await expect(pairing.pair({ code: lastCode(), ip: '10.0.0.2' })).resolves.toHaveProperty('token');
	});

	test('no code yet means BAD_CODE', async () => {
		fs.rmSync(path.join(dir, 'pairing.json'));
		await expect(pairing.pair({ code: lastCode(), ip: '10.0.0.2' })).rejects.toMatchObject({ code: 'BAD_CODE' });
	});

	test('verification is constant-time', async () => {
		const spy = jest.spyOn(crypto, 'timingSafeEqual');
		await pairing.pair({ code: lastCode(), ip: '10.0.0.2' });
		expect(spy).toHaveBeenCalled();
		spy.mockRestore();
	});

	test('device name defaults when not given', async () => {
		const { device } = await pairing.pair({ code: lastCode(), ip: '10.0.0.2' });
		expect(device.name).toBe('Device');
	});
});

describe('authenticate', () => {
	let token;
	beforeEach(async () => {
		await pairing.regenerateCode();
		({ token } = await pairing.pair({ code: lastCode(), deviceName: 'Phone', ip: '10.0.0.2' }));
	});

	test('a valid token returns the device and renews its expiry', async () => {
		now += 10 * DAY;
		const device = await pairing.authenticate(token);
		expect(device).toMatchObject({ name: 'Phone', expiresAt: new Date(now + 90 * DAY).toISOString() });
	});

	test('regenerating the code keeps existing pairings', async () => {
		await pairing.regenerateCode();
		expect(await pairing.authenticate(token)).toMatchObject({ name: 'Phone' });
	});

	test('expired and revoked tokens are rejected', async () => {
		now += 90 * DAY + 1;
		expect(await pairing.authenticate(token)).toBeNull();

		now = Date.parse('2026-11-01T10:00:00Z');
		await pairing.regenerateCode();
		const second = await pairing.pair({ code: lastCode(), ip: '10.0.0.3' });
		await devices.remove(second.device.id);
		expect(await pairing.authenticate(second.token)).toBeNull();
	});

	test.each([undefined, null, '', 'short', 'x'.repeat(500), 42])('junk token %p is rejected', async junk => {
		expect(await pairing.authenticate(junk)).toBeNull();
	});
});

test('the module exposes no way to read the current code', () => {
	const exposed = Object.keys(pairing).concat(Object.keys(pairingModule));
	expect(exposed.filter(name => /^(get|current|read)Code/i.test(name))).toEqual([]);
});

describe('a code shown on screen', () => {
	test('expires after 10 minutes', async () => {
		const { code, expiresAt } = await pairing.regenerateCode({ shown: true });
		expect(expiresAt).toBe(new Date(now + 10 * 60 * 1000).toISOString());
		now += 10 * 60 * 1000 + 1;
		await expect(pairing.pair({ code, ip: '10.0.0.5' })).rejects.toMatchObject({ code: 'BAD_CODE' });
	});

	test('pairs one device; a console code (npm run pair) stays reusable', async () => {
		const { code } = await pairing.regenerateCode({ shown: true });
		await pairing.pair({ code, ip: '10.0.0.5' });
		await expect(pairing.pair({ code, ip: '10.0.0.6' })).rejects.toMatchObject({ code: 'BAD_CODE' });

		const console = await pairing.regenerateCode();
		expect(console.expiresAt).toBeUndefined();
		await pairing.pair({ code: console.code, ip: '10.0.0.5' });
		await pairing.pair({ code: console.code, ip: '10.0.0.6' });
		expect(devices.list()).toHaveLength(3);
	});
});
