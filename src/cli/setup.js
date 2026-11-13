// First-run setup (ported from src/oneTimeSetup.js): asks units and how the treadmill connects,
// saves settings.json and shows the pairing code and control-page address.
// Run again any time with `npm run setup`.
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const paths = require('../platform/paths');
const contracts = require('../contracts');
const { createSettingsRepo } = require('../storage/settingsRepo');
const { createDevicesRepo } = require('../storage/devicesRepo');
const { createRateLimit } = require('../security/rateLimit');
const { createPairing } = require('../security/pairing');

const REQUIRED_MODULES = ['express', 'socket.io', 'ajv', 'js-yaml'];
const MAX_TRIES = 3;
const YES = new Set(['y', 'yes', '1', 'ja', 'si', 'oui', 'true']);

function missingModules(resolve = require.resolve) {
	return REQUIRED_MODULES.filter(name => {
		try {
			resolve(name);
			return false;
		}
		catch {
			return true;
		}
	});
}

function needsSetup({ dataDir = paths.dataDir(), legacyDir = paths.legacyDir() } = {}) {
	return !fs.existsSync(path.join(dataDir, 'settings.json')) && !fs.existsSync(path.join(legacyDir, 'settings.conf'));
}

const isValidHost = value => contracts.validate('settings-write', { treadmill: { ip: value } }).length === 0;

// The console shows the code as "AB CD"; it advertises the bytes the other way round.
const swapBleCode = code => code.slice(2, 4) + code.slice(0, 2);

async function runSetup({
	ask,
	out = text => process.stdout.write(`${text}\n`),
	dataDir = paths.dataDir(),
	legacyDir = paths.legacyDir(),
	resolve = require.resolve,
	hostname = os.hostname()
}) {
	out('Welcome to Zwifit!');
	const missing = missingModules(resolve);
	if (missing.length) {
		out(`Some parts are missing (${missing.join(', ')}). Run "npm install" in the Zwifit folder first.`);
		return null;
	}

	paths.ensureDataDir(dataDir);
	const repo = createSettingsRepo({ dir: dataDir, legacyDir });
	await repo.init();
	const settings = repo.get();

	async function askUntil(question, accept, problem) {
		for (let i = 0; i < MAX_TRIES; i++) {
			const answer = String(await ask(question) ?? '').trim();
			const value = accept(answer);
			if (value !== undefined) {
				return value;
			}
			out(problem);
		}
		throw Object.assign(new Error('Setup cancelled after too many invalid answers.'), { code: 'SETUP_ABORTED' });
	}

	settings.metric = YES.has(String(await ask('Use metric units (km/h)? [y/N]') ?? '').trim().toLowerCase());

	const transport = await askUntil(
		'How does your treadmill connect? 1) Wi-Fi  2) Bluetooth  3) Simulated (no treadmill) [1]',
		answer => ({ '': 'wifi', 1: 'wifi', wifi: 'wifi', 2: 'ble', ble: 'ble', bluetooth: 'ble', 3: 'simulated', simulated: 'simulated' })[answer.toLowerCase()],
		'Please answer 1, 2 or 3.'
	);
	settings.treadmill.transport = transport;

	if (transport === 'wifi') {
		settings.treadmill.ip = await askUntil(
			'Treadmill IP address (leave blank to search the network):',
			answer => (answer === '' ? null : isValidHost(answer) ? answer : undefined),
			'That doesn\'t look like an IP address or host name (for example 192.168.1.50).'
		);
	}
	else if (transport === 'ble') {
		const code = await askUntil(
			'Switch the treadmill on, press its connect button and type the 4-character code it shows:',
			answer => (/^[0-9A-Fa-f]{4}$/.test(answer) ? answer.toUpperCase() : undefined),
			'The code is exactly 4 characters, 0-9 and A-F.'
		);
		settings.treadmill.bleCode = swapBleCode(code);
	}

	await repo.replace(settings);
	out(`Settings saved to ${repo.file}`);
	if (transport === 'ble' && !settings.treadmill.bleActivation) {
		out('Next, run "npm run enable-ble" once to activate Bluetooth control with the treadmill maker\'s app.');
	}

	const devices = createDevicesRepo({ dir: dataDir });
	await devices.load();
	const pairing = createPairing({ dir: dataDir, devices, rateLimit: createRateLimit(), printCode: code => out(`Pairing code: ${code}`) });
	await pairing.regenerateCode();
	out(`Open http://${hostname}:${settings.server.port}/ on your phone or tablet and enter the pairing code.`);
	return repo.get();
}

function terminalAsk() {
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
	const ask = question => new Promise(resolve => rl.question(`${question} `, resolve));
	return { ask, close: () => rl.close() };
}

if (require.main === module) {
	const terminal = terminalAsk();
	runSetup({ ask: terminal.ask })
		.then(result => { process.exitCode = result ? 0 : 1; })
		.catch(err => {
			process.stderr.write(`${err.message}\n`);
			process.exitCode = 1;
		})
		.finally(() => terminal.close());
}

module.exports = { runSetup, needsSetup, missingModules, swapBleCode, terminalAsk };
