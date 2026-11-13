// Finds an iFit Wi-Fi treadmill on the local network: probes ws://<ip>/control on every address
// of each local IPv4 /24 (from os.networkInterfaces, replacing the old local-devices package).
const os = require('os');

const PROBE_TIMEOUT_MS = 5000;
const CONCURRENCY = 64;

function candidateHosts(interfaces = os.networkInterfaces()) {
	const hosts = [];
	for (const addresses of Object.values(interfaces)) {
		for (const address of addresses || []) {
			if (address.family !== 'IPv4' || address.internal) {
				continue;
			}
			const prefix = address.address.split('.').slice(0, 3).join('.');
			for (let i = 1; i < 255; i++) {
				const host = `${prefix}.${i}`;
				if (host !== address.address && !hosts.includes(host)) {
					hosts.push(host);
				}
			}
		}
	}
	return hosts;
}

// Resolves true when the host answers like an iFit console (a message with MPH or KPH).
function probe(host, { WebSocketImpl = globalThis.WebSocket, timeoutMs = PROBE_TIMEOUT_MS } = {}) {
	return new Promise(resolve => {
		let socket;
		let done = false;
		const finish = found => {
			if (done) {
				return;
			}
			done = true;
			clearTimeout(timer);
			try {
				socket.close();
			}
			catch {
				// already closed
			}
			resolve(found);
		};
		const timer = setTimeout(() => finish(false), timeoutMs);
		try {
			socket = new WebSocketImpl(`ws://${host}/control`);
		}
		catch {
			finish(false);
			return;
		}
		socket.onerror = () => finish(false);
		socket.onclose = () => finish(false);
		socket.onmessage = event => {
			try {
				const parsed = JSON.parse(String(event.data));
				const values = parsed && parsed.values ? parsed.values : parsed;
				finish(!!values && (values.MPH !== undefined || values.KPH !== undefined));
			}
			catch {
				finish(false);
			}
		};
	});
}

// Returns the first host that answers, trying `preferred` hosts first, or null.
async function scan({ preferred = [], hosts = candidateHosts(), probeHost = probe, concurrency = CONCURRENCY } = {}) {
	const queue = [...preferred.filter(Boolean), ...hosts];
	let found = null;
	async function worker() {
		while (!found && queue.length) {
			const host = queue.shift();
			if (await probeHost(host)) {
				found = found || host;
			}
		}
	}
	await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
	return found;
}

module.exports = { scan, probe, candidateHosts };
