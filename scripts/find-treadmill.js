// Looks for an iFit treadmill (NordicTrack, ProForm, ...) and prints how Zwifit can reach it.
//   node scripts/find-treadmill.js wifi   probes ws://<ip>/control on each local /24
//   node scripts/find-treadmill.js ble    scans Bluetooth LE for 20 s (Linux/macOS; needs @stoprocent/noble)
'use strict';

const mode = process.argv[2] || 'wifi';

async function findWifi() {
	const { scan, candidateHosts } = require('../src/adapters/treadmill/scan');
	const hosts = candidateHosts();
	console.log(`Probing ${hosts.length} addresses for an iFit Wi-Fi console (up to ~30 s)...`);
	const found = await scan({ hosts });
	console.log(found
		? `Found an iFit Wi-Fi console at ${found}. Use transport "wifi" with ip ${found}.`
		: 'No iFit Wi-Fi console answered. Newer consoles only offer Bluetooth: try "ble".');
}

function findBle() {
	const noble = require('@stoprocent/noble');
	const seen = new Map();
	const seconds = Number(process.argv[3]) || 20;

	function onState(state) {
		console.log(`Adapter state: ${state}`);
		if (state === 'poweredOn') {
			console.log(`Scanning for ${seconds} s. Keep the treadmill console awake...`);
			noble.startScanning([], true);
			setTimeout(() => {
				noble.stopScanning();
				report();
				process.exit(0);
			}, seconds * 1000);
		}
	}

	noble.on('discover', peripheral => {
		const ad = peripheral.advertisement || {};
		const data = ad.manufacturerData ? ad.manufacturerData.toString('hex') : '';
		const name = ad.localName || '';
		const entry = seen.get(peripheral.address) || { name, data, rssi: peripheral.rssi };
		entry.name = entry.name || name;
		entry.data = entry.data || data;
		entry.rssi = peripheral.rssi;
		seen.set(peripheral.address, entry);
	});

	function report() {
		// iFit consoles advertise manufacturer data ending in "dd" + the 4-hex code on their screen.
		const ifit = [...seen].filter(([, e]) => /^I_/.test(e.name) || /dd[0-9a-f]{4}$/.test(e.data));
		console.log(`\n${seen.size} Bluetooth devices seen.`);
		if (!ifit.length) {
			console.log('No iFit treadmill found. Wake the console (or press its Bluetooth/connect button) and retry.');
			return;
		}
		for (const [address, e] of ifit) {
			const code = (/dd([0-9a-f]{4})$/.exec(e.data) || [])[1];
			console.log(`iFit device: name "${e.name}", address ${address}, signal ${e.rssi} dBm${code ? `, code ${code.toUpperCase()}` : ''}`);
		}
		console.log('Use transport "ble". Setup asks for the code shown on the treadmill display.');
	}

	noble.on('stateChange', onState);
	if (noble.state && noble.state !== 'unknown') {
		onState(noble.state);
	}
}

if (mode === 'ble') {
	findBle();
}
else {
	findWifi().catch(err => {
		console.error(err.message);
		process.exitCode = 1;
	});
}
