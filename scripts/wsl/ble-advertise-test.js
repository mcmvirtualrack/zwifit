// Advertises "Zwifit Test" with the Fitness Machine (0x1826) and Running Speed and Cadence
// (0x1814) service UUIDs for two minutes, so a phone BLE scanner (e.g. nRF Connect) can confirm
// the adapter broadcasts. No services are served; this only proves advertising works.
//
// Usage: node scripts/wsl/ble-advertise-test.js [seconds]
'use strict';

const bleno = require('@stoprocent/bleno');

const NAME = 'Zwifit Test';
const UUIDS = ['1826', '1814'];
const seconds = Number(process.argv[2]) || 120;

function stop(code) {
	try {
		bleno.stopAdvertising();
	}
	catch {
		// already stopped
	}
	setTimeout(() => process.exit(code), 500);
}

function onState(state) {
	console.log(`Adapter state: ${state}`);
	if (state === 'poweredOn') {
		bleno.startAdvertising(NAME, UUIDS);
	}
	else if (state === 'poweredOff') {
		console.log('The adapter is switched off. Waiting for it to come up (sudo hciconfig hci0 up)...');
	}
	else if (state === 'unauthorized') {
		console.error('Not allowed to use Bluetooth. Run: sudo setcap cap_net_raw,cap_net_admin+eip "$(readlink -f "$(which node)")"');
		stop(1);
	}
	else if (state === 'unsupported') {
		console.error('No usable Bluetooth LE adapter. Run: bash scripts/wsl/check-bluetooth.sh');
		stop(1);
	}
}

// Adding the first stateChange listener initializes bleno, which can report the initial state
// before the listener is attached, so check the current state as well.
bleno.on('stateChange', onState);
if (bleno.state !== 'unknown') {
	onState(bleno.state);
}

bleno.on('advertisingStart', error => {
	if (error) {
		console.error(`Advertising failed: ${error.message || error}`);
		stop(1);
		return;
	}
	console.log(`Advertising as "${NAME}" for ${seconds} s. Look for it in a BLE scanner app on your phone.`);
	setTimeout(() => {
		console.log('Done.');
		stop(0);
	}, seconds * 1000);
});

bleno.on('accept', address => console.log(`A device connected: ${address}`));
bleno.on('disconnect', address => console.log(`Device disconnected: ${address}`));

process.on('SIGINT', () => stop(0));
