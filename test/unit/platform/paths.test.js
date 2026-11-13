const path = require('path');
const fs = require('fs');
const os = require('os');
const paths = require('../../../src/platform/paths');

describe('dataDir', () => {
	test('linux uses XDG_DATA_HOME when set', () => {
		expect(paths.dataDir({ platform: 'linux', env: { XDG_DATA_HOME: '/x/data' }, home: '/home/u' }))
			.toBe('/x/data/zwifit');
	});

	test('linux falls back to ~/.local/share', () => {
		expect(paths.dataDir({ platform: 'linux', env: {}, home: '/home/u' }))
			.toBe('/home/u/.local/share/zwifit');
	});

	test('macOS uses Application Support', () => {
		expect(paths.dataDir({ platform: 'darwin', env: {}, home: '/Users/u' }))
			.toBe('/Users/u/Library/Application Support/Zwifit');
	});

	test('windows uses APPDATA', () => {
		expect(paths.dataDir({ platform: 'win32', env: { APPDATA: 'C:\\Users\\u\\AppData\\Roaming' }, home: 'C:\\Users\\u' }))
			.toBe('C:\\Users\\u\\AppData\\Roaming\\Zwifit');
	});

	test('windows without APPDATA falls back to home', () => {
		expect(paths.dataDir({ platform: 'win32', env: {}, home: 'C:\\Users\\u' }))
			.toBe('C:\\Users\\u\\AppData\\Roaming\\Zwifit');
	});

	test('ZWIFIT_DATA_DIR overrides every platform', () => {
		for (const platform of ['linux', 'darwin', 'win32']) {
			expect(paths.dataDir({ platform, env: { ZWIFIT_DATA_DIR: '/custom', APPDATA: 'C:\\a' }, home: '/h' }))
				.toBe(path.resolve('/custom'));
		}
	});
});

describe('ensureDataDir', () => {
	test('creates the directory (0700 on POSIX)', () => {
		const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'zwifit-')), 'nested', 'data');
		expect(paths.ensureDataDir(dir)).toBe(dir);
		expect(fs.statSync(dir).isDirectory()).toBe(true);
		if (process.platform !== 'win32') {
			expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
		}
	});
});

test('legacyDir is the repository root', () => {
	expect(fs.existsSync(path.join(paths.legacyDir(), 'package.json'))).toBe(true);
	expect(fs.existsSync(path.join(paths.legacyDir(), 'app.js'))).toBe(true);
});
