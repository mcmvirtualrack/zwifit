// Test-only launcher for Playwright: the real app with the simulated treadmill in a fresh data
// directory. Writes the pairing code to <dataDir>/e2e-code.txt and listens on 127.0.0.1:<port+1>
// for POST /disconnect | /reconnect | /belt?kph=N so tests can act as the treadmill.
// Never used by the app itself.
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { createApp } = require('../../src/app');

const port = Number(process.env.E2E_PORT || 1348);
const dataDir = process.env.ZWIFIT_DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'zwifit-e2e-'));

(async () => {
	const app = await createApp({
		dataDir,
		legacyDir: dataDir,
		simulate: true,
		disableBroadcast: true, disableSensors: true,
		port,
		host: '127.0.0.1',
		printCode: code => fs.writeFileSync(path.join(dataDir, 'e2e-code.txt'), code)
	});
	await app.start();

	http.createServer((req, res) => {
		const url = new URL(req.url, 'http://localhost');
		if (req.method !== 'POST') {
			res.writeHead(405).end();
			return;
		}
		if (url.pathname === '/disconnect') {
			app.treadmill.simulateDisconnect('Treadmill switched off');
		}
		else if (url.pathname === '/reconnect') {
			app.treadmill.simulateReconnect();
		}
		else if (url.pathname === '/belt') {
			app.treadmill.startBelt(Number(url.searchParams.get('kph')) || 0);
		}
		else if (url.pathname === '/code') {
			res.writeHead(200, { 'content-type': 'text/plain' }).end(fs.readFileSync(path.join(dataDir, 'e2e-code.txt'), 'utf8'));
			return;
		}
		else {
			res.writeHead(404).end();
			return;
		}
		res.writeHead(204).end();
	}).listen(port + 1, '127.0.0.1');

	console.log(`e2e server ready on http://127.0.0.1:${port}/`);
})().catch(err => {
	console.error(err);
	process.exit(1);
});
