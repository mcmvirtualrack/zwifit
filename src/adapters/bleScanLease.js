// One Bluetooth scan shared by everyone who needs it (the treadmill looking for itself, sensors
// being searched for): noble has a single scan, so one user's stopScanning() would otherwise end
// another's search. The scan runs while anyone holds it and the adapter is on.
const leases = new WeakMap();

function scanLease(noble) {
	let lease = leases.get(noble);
	if (lease) {
		return lease;
	}
	const holders = new Set();
	let scanning = false;
	const sync = () => {
		const want = holders.size > 0 && noble.state === 'poweredOn';
		if (want && !scanning) {
			scanning = true;
			// Duplicates on: a sensor that drops out and comes back must be seen again while the scan
			// runs, and its signal strength stays current.
			noble.startScanning([], true);
		}
		else if (!want && scanning) {
			scanning = false;
			try {
				noble.stopScanning();
			}
			catch {
				// adapter already gone
			}
		}
	};
	if (typeof noble.on === 'function') {
		noble.on('stateChange', state => {
			if (state !== 'poweredOn') {
				// The adapter stopped the scan itself.
				scanning = false;
			}
			sync();
		});
	}
	lease = {
		acquire(owner) {
			holders.add(owner);
			sync();
		},
		release(owner) {
			holders.delete(owner);
			sync();
		},
		holds: owner => holders.has(owner)
	};
	leases.set(noble, lease);
	return lease;
}

module.exports = { scanLease };
