const fs = require('fs');
const os = require('os');
const path = require('path');
const { main } = require('../../../src/cli/pair');
const { createDevicesRepo } = require('../../../src/storage/devicesRepo');
const { createRateLimit } = require('../../../src/security/rateLimit');
const { createPairing } = require('../../../src/security/pairing');

let dir;
beforeEach(() => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zwifit-cli-'));
});

const run = async () => {
	let text = '';
	await main({ dir, out: { write: chunk => { text += chunk; } } });
	return text;
};

test('prints a new code as XXXX-XXXX and stores only its hash', async () => {
	const text = await run();
	const code = /Pairing code: ([0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4})\n/.exec(text)[1];
	expect(fs.readFileSync(path.join(dir, 'pairing.json'), 'utf8')).not.toContain(code.replace('-', ''));
});

test('a running app accepts the new code and keeps existing pairings', async () => {
	const devices = createDevicesRepo({ dir });
	await devices.load();
	const printed = [];
	const app = createPairing({ dir, devices, rateLimit: createRateLimit(), printCode: c => printed.push(c) });
	await app.ensureCode();
	const { token } = await app.pair({ code: printed[0], ip: '10.0.0.2' });

	const code = /Pairing code: (\S+)/.exec(await run())[1];
	await expect(app.pair({ code: printed[0], ip: '10.0.0.3' })).rejects.toMatchObject({ code: 'BAD_CODE' });
	await expect(app.pair({ code, ip: '10.0.0.3' })).resolves.toHaveProperty('token');
	expect(await app.authenticate(token)).not.toBeNull();
});
