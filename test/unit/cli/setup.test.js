const fs = require('fs');
const os = require('os');
const path = require('path');
const { runSetup, needsSetup, missingModules, swapBleCode } = require('../../../src/cli/setup');

let root;
let dataDir;
let legacyDir;
let lines;
beforeEach(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), 'zwifit-setup-'));
	dataDir = path.join(root, 'data');
	legacyDir = path.join(root, 'repo');
	fs.mkdirSync(legacyDir);
	lines = [];
});

const answers = list => {
	const queue = [...list];
	return jest.fn(async () => queue.shift());
};
const run = (ask, extra = {}) => runSetup({ ask, out: text => lines.push(text), dataDir, legacyDir, hostname: 'zwifit-pc', ...extra });
const saved = () => JSON.parse(fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf8'));

test('Wi-Fi with an IP: saves metric, transport and ip; prints pairing code and URL', async () => {
	const result = await run(answers(['y', '1', '172.25.253.254']));
	expect(result.treadmill).toMatchObject({ transport: 'wifi', ip: '172.25.253.254' });
	expect(saved()).toMatchObject({ metric: true, treadmill: { transport: 'wifi', ip: '172.25.253.254' } });
	expect(lines.some(l => /^Pairing code: [0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/.test(l))).toBe(true);
	expect(lines).toContain('Open http://zwifit-pc:1337/ on your phone or tablet and enter the pairing code.');
});

test('Wi-Fi with a blank IP means search the network', async () => {
	await run(answers(['n', '', '']));
	expect(saved().treadmill).toMatchObject({ transport: 'wifi', ip: null });
	expect(saved().metric).toBe(false);
});

test('an invalid IP is asked again', async () => {
	const ask = answers(['n', '1', 'http://evil/x', '192.168.1.5/admin', '192.168.1.50']);
	await run(ask);
	expect(saved().treadmill.ip).toBe('192.168.1.50');
	expect(lines.filter(l => l.startsWith('That doesn\'t look like'))).toHaveLength(2);
});

test('Bluetooth stores the 4-hex code byte-swapped and points at enable-ble', async () => {
	await run(answers(['n', '2', 'zz', '3a4f']));
	expect(saved().treadmill).toMatchObject({ transport: 'ble', bleCode: '4F3A' });
	expect(lines.some(l => l.includes('npm run enable-ble'))).toBe(true);
	expect(lines).toContain('The code is exactly 4 characters, 0-9 and A-F.');
});

test('simulated needs no further questions', async () => {
	const ask = answers(['n', '3']);
	await run(ask);
	expect(saved().treadmill.transport).toBe('simulated');
	expect(ask).toHaveBeenCalledTimes(2);
});

test('three invalid answers abort without saving a half-made setup', async () => {
	await expect(run(answers(['n', 'x', 'y', 'z']))).rejects.toMatchObject({ code: 'SETUP_ABORTED' });
	expect(saved().treadmill.transport).toBe('wifi');
});

test('missing dependencies are found with require.resolve, not by looking for ./node_modules', async () => {
	const resolve = name => {
		if (name === 'socket.io') {
			throw new Error('not found');
		}
		return name;
	};
	expect(missingModules(resolve)).toEqual(['socket.io']);
	const result = await run(answers([]), { resolve });
	expect(result).toBeNull();
	expect(lines.some(l => l.includes('npm install'))).toBe(true);
	expect(fs.existsSync(path.join(dataDir, 'settings.json'))).toBe(false);
});

test('needsSetup is true only with neither settings.json nor a legacy settings.conf', () => {
	expect(needsSetup({ dataDir, legacyDir })).toBe(true);
	fs.writeFileSync(path.join(legacyDir, 'settings.conf'), 'version: 1\n');
	expect(needsSetup({ dataDir, legacyDir })).toBe(false);
});

test('swapBleCode swaps the two bytes', () => {
	expect(swapBleCode('3A4F')).toBe('4F3A');
});
