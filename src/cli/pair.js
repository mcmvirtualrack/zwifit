// `npm run pair`: makes a new pairing code and prints it. Works while the app is running, because
// the app re-reads pairing.json on every attempt. Existing paired devices stay paired.
const paths = require('../platform/paths');
const { createDevicesRepo } = require('../storage/devicesRepo');
const { createRateLimit } = require('../security/rateLimit');
const { createPairing } = require('../security/pairing');

async function main({ dir = paths.ensureDataDir(), out = process.stdout } = {}) {
	const devices = createDevicesRepo({ dir });
	const pairing = createPairing({
		dir,
		devices,
		rateLimit: createRateLimit(),
		printCode: code => out.write(`Pairing code: ${code}\n`)
	});
	await pairing.regenerateCode();
	out.write('Enter it on the Zwifit page on your phone or tablet. Devices already paired stay paired.\n');
}

if (require.main === module) {
	main().catch(err => {
		process.stderr.write(`Could not create a pairing code: ${err.code || 'error'}\n`);
		process.exitCode = 1;
	});
}

module.exports = { main };
