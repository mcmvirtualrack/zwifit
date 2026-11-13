const fs = require('fs');
const os = require('os');
const path = require('path');
const { createSettingsRepo, validateSettings, DEFAULT_SETTINGS } = require('../../../src/storage/settingsRepo');

const LEGACY_FIXTURE = path.join(__dirname, '..', '..', 'fixtures', 'legacy', 'settings.conf');

let dataDir;
let legacyDir;
beforeEach(() => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zwifit-settings-'));
	dataDir = path.join(root, 'data');
	legacyDir = path.join(root, 'repo');
	fs.mkdirSync(legacyDir);
});

const settingsFile = () => path.join(dataDir, 'settings.json');
const clone = value => JSON.parse(JSON.stringify(value));

describe('migration', () => {
	test('legacy settings.conf becomes settings.json v2 and the legacy file is untouched', async () => {
		fs.copyFileSync(LEGACY_FIXTURE, path.join(legacyDir, 'settings.conf'));
		const before = fs.readFileSync(path.join(legacyDir, 'settings.conf'), 'utf8');
		const repo = createSettingsRepo({ dir: dataDir, legacyDir });
		await repo.init();

		const saved = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
		expect(saved).toEqual(repo.get());
		expect(saved).toMatchObject({
			version: 2,
			metric: true,
			treadmill: {
				transport: 'ble',
				ip: '192.168.1.50',
				lastIP: '192.168.1.50',
				bleCode: '3A4F',
				bleDeviceName: 'I_TL',
				bleActivation: '01020304',
				bleDetails: { a: 1 }
			},
			speedOffset: 0.2,
			speedMultiplier: 1.05,
			broadcast: { ftms: false, rsc: true },
			limits: DEFAULT_SETTINGS.limits,
			cooldownKph: 3.2,
			server: { port: 1337, host: '0.0.0.0', tls: null }
		});
		expect(fs.readFileSync(path.join(legacyDir, 'settings.conf'), 'utf8')).toBe(before);
	});

	test('legacy wifi settings map to transport wifi', async () => {
		fs.writeFileSync(path.join(legacyDir, 'settings.conf'), 'version: 1\nble: false\nip: treadmill.local\n');
		const repo = createSettingsRepo({ dir: dataDir, legacyDir });
		await repo.init();
		expect(repo.get().treadmill).toMatchObject({ transport: 'wifi', ip: 'treadmill.local' });
	});

	test('no files at all gives defaults and writes them', async () => {
		const repo = createSettingsRepo({ dir: dataDir, legacyDir });
		await repo.init();
		expect(repo.get()).toEqual(DEFAULT_SETTINGS);
		expect(fs.existsSync(settingsFile())).toBe(true);
	});

	test('an existing settings.json wins over settings.conf', async () => {
		fs.copyFileSync(LEGACY_FIXTURE, path.join(legacyDir, 'settings.conf'));
		fs.mkdirSync(dataDir, { recursive: true });
		fs.writeFileSync(settingsFile(), JSON.stringify({ ...DEFAULT_SETTINGS, metric: false }));
		const repo = createSettingsRepo({ dir: dataDir, legacyDir });
		await repo.init();
		expect(repo.get().treadmill.transport).toBe('wifi');
	});

	test('an invalid settings.json is refused with details, not silently replaced', async () => {
		fs.mkdirSync(dataDir, { recursive: true });
		fs.writeFileSync(settingsFile(), JSON.stringify({ ...DEFAULT_SETTINGS, speedMultiplier: 9 }));
		const repo = createSettingsRepo({ dir: dataDir, legacyDir });
		await expect(repo.init()).rejects.toMatchObject({
			code: 'INVALID_SETTINGS',
			details: [expect.objectContaining({ path: 'speedMultiplier' })]
		});
		expect(JSON.parse(fs.readFileSync(settingsFile(), 'utf8')).speedMultiplier).toBe(9);
	});
});

describe('validateSettings', () => {
	const withChange = change => {
		const s = clone(DEFAULT_SETTINGS);
		change(s);
		return validateSettings(s).map(e => e.path);
	};

	test('defaults are valid', () => {
		expect(validateSettings(DEFAULT_SETTINGS)).toEqual([]);
	});

	test.each([
		['speedMultiplier 0.4', s => { s.speedMultiplier = 0.4; }, 'speedMultiplier'],
		['speedMultiplier 1.6', s => { s.speedMultiplier = 1.6; }, 'speedMultiplier'],
		['speedOffset -2.1', s => { s.speedOffset = -2.1; }, 'speedOffset'],
		['speedOffset 2.1', s => { s.speedOffset = 2.1; }, 'speedOffset'],
		['maxKph 31', s => { s.limits.maxKph = 31; }, 'limits.maxKph'],
		['minKph -1', s => { s.limits.minKph = -1; }, 'limits.minKph'],
		['minKph = maxKph', s => { s.limits.minKph = 10; s.limits.maxKph = 10; }, 'limits.minKph'],
		['minIncline -11', s => { s.limits.minIncline = -11; }, 'limits.minIncline'],
		['maxIncline 41', s => { s.limits.maxIncline = 41; }, 'limits.maxIncline'],
		['minIncline > maxIncline', s => { s.limits.minIncline = 5; s.limits.maxIncline = 2; }, 'limits.minIncline'],
		['cooldownKph 0', s => { s.cooldownKph = 0; }, 'cooldownKph'],
		['cooldownKph above maxKph', s => { s.limits.maxKph = 10; s.cooldownKph = 12; }, 'cooldownKph'],
		['cooldownKph below minKph', s => { s.limits.minKph = 4; s.cooldownKph = 3.2; }, 'cooldownKph'],
		['fallbackKph above maxKph', s => { s.fallbackKph = 25; }, 'fallbackKph'],
		['port 80', s => { s.server.port = 80; }, 'server.port'],
		['port 65536', s => { s.server.port = 65536; }, 'server.port'],
		['bleCode 3 chars', s => { s.treadmill.bleCode = 'ABC'; }, 'treadmill.bleCode'],
		['bleCode non-hex', s => { s.treadmill.bleCode = 'ZZZZ'; }, 'treadmill.bleCode'],
		['ip with scheme', s => { s.treadmill.ip = 'http://192.168.1.5'; }, 'treadmill.ip'],
		['ip with path', s => { s.treadmill.ip = '192.168.1.5/admin'; }, 'treadmill.ip'],
		['tls cert only', s => { s.server.tls = { certPath: '/c.pem', keyPath: null }; }, 'server.tls'],
		['tls key only', s => { s.server.tls = { keyPath: '/k.pem' }; }, 'server.tls'],
		['unknown key', s => { s.evil = true; }, 'evil']
	])('rejects %s', (_, change, expectedPath) => {
		expect(withChange(change)).toContain(expectedPath);
	});

	test.each([
		['ip with port', s => { s.treadmill.ip = '192.168.1.5:8080'; }],
		['hostname', s => { s.treadmill.ip = 'treadmill.local'; }],
		['tls both', s => { s.server.tls = { certPath: '/c.pem', keyPath: '/k.pem' }; }],
		['bleCode lowercase hex', s => { s.treadmill.bleCode = '3a4f'; }]
	])('accepts %s', (_, change) => {
		expect(withChange(change)).toEqual([]);
	});
});

describe('update', () => {
	let repo;
	beforeEach(async () => {
		repo = createSettingsRepo({ dir: dataDir, legacyDir });
		await repo.init();
	});

	test('merges allow-listed fields and saves', async () => {
		const next = await repo.update({ metric: true, limits: { maxKph: 16 }, treadmill: { ip: '10.0.0.2' } });
		expect(next.metric).toBe(true);
		expect(next.limits).toEqual({ ...DEFAULT_SETTINGS.limits, maxKph: 16 });
		expect(next.treadmill.ip).toBe('10.0.0.2');
		expect(JSON.parse(fs.readFileSync(settingsFile(), 'utf8'))).toEqual(next);
	});

	test.each(['bleActivation', 'bleDetails', 'bleServices', 'bleAdvertisingData', 'bleScanData'])('refuses writes to treadmill.%s', async key => {
		await expect(repo.update({ treadmill: { [key]: 'x' } })).rejects.toMatchObject({ code: 'INVALID_SETTINGS' });
		expect(repo.get().treadmill[key]).toBeUndefined();
	});

	test('server port and host may change; TLS file paths may not', async () => {
		expect((await repo.update({ server: { port: 8080, host: '127.0.0.1' } })).server)
			.toEqual({ port: 8080, host: '127.0.0.1', tls: null });
		await expect(repo.update({ server: { tls: { certPath: '/etc/shadow', keyPath: '/k' } } }))
			.rejects.toMatchObject({ code: 'INVALID_SETTINGS' });
		await expect(repo.update({ server: { host: 'evil.example' } })).rejects.toMatchObject({ code: 'INVALID_SETTINGS' });
	});

	test('a change that breaks a cross-field rule is refused and nothing is saved', async () => {
		const before = fs.readFileSync(settingsFile(), 'utf8');
		await expect(repo.update({ limits: { maxKph: 3 } })).rejects.toMatchObject({
			code: 'INVALID_SETTINGS',
			details: [expect.objectContaining({ path: 'cooldownKph' })]
		});
		expect(fs.readFileSync(settingsFile(), 'utf8')).toBe(before);
		expect(repo.get().limits.maxKph).toBe(20);
	});

	test('get() returns a copy', () => {
		repo.get().metric = 'tampered';
		expect(repo.get().metric).toBe(false);
	});

	test('publicView omits BLE internals', async () => {
		await repo.replace({ ...repo.get(), treadmill: { ...repo.get().treadmill, bleActivation: 'secret', bleDetails: { x: 1 } } });
		const view = repo.publicView();
		expect(view.treadmill.bleActivation).toBeUndefined();
		expect(view.treadmill.bleDetails).toBeUndefined();
		expect(view.treadmill.transport).toBe('wifi');
	});
});
