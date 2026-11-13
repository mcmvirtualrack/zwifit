// Read-only: connects Zwifit's Wi-Fi adapter to a treadmill and prints what it reports.
// It never sends speed or incline commands.
//   node scripts/watch-treadmill.js <treadmill-ip> [seconds]
'use strict';

const { WifiTreadmill } = require('../src/adapters/treadmill/wifi');
const log = require('../src/lib/log');

const ip = process.argv[2];
const seconds = Number(process.argv[3]) || 30;
if (!ip) {
	console.error('Usage: node scripts/watch-treadmill.js <treadmill-ip> [seconds]');
	process.exit(1);
}

log.setSink(() => {});
const treadmill = new WifiTreadmill({ settings: { treadmill: { ip } } });
let last = '';
let limitsShown = false;
treadmill.on('connected', () => console.log(`Connected to ${ip}.`));
treadmill.on('disconnected', ({ reason }) => console.log(`Disconnected: ${reason}`));
treadmill.on('status', status => {
	if (!limitsShown && treadmill.limits()) {
		limitsShown = true;
		console.log(`Treadmill limits: ${JSON.stringify(treadmill.limits())}`);
	}
	const line = `speed ${status.kph.toFixed(1)} km/h  incline ${status.incline}%  hr ${status.hr ?? '-'}${status.estimatedSpeed ? '  (estimated)' : ''}${status.reason ? `  [${status.reason}]` : ''}`;
	if (line !== last) {
		console.log(`${new Date().toLocaleTimeString()}  ${line}`);
		last = line;
	}
});

treadmill.start();
setTimeout(async () => {
	await treadmill.stop();
	console.log('Done.');
	process.exit(0);
}, seconds * 1000);
