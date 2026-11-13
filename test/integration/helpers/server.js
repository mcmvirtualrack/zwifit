// Starts a real control server on 127.0.0.1:<random port> with a temporary data directory, the
// simulated treadmill and the null broadcast adapter. Clients send the server's own Origin.
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { io: connect } = require('socket.io-client');
const { createServer } = require('../../../src/api/server');
const { createDevicesRepo } = require('../../../src/storage/devicesRepo');
const { createSettingsRepo } = require('../../../src/storage/settingsRepo');
const { createRateLimit } = require('../../../src/security/rateLimit');
const { createPairing } = require('../../../src/security/pairing');
const { SimulatedTreadmill } = require('../../../src/adapters/treadmill/simulated');
const { NullBroadcast } = require('../../../src/adapters/broadcast/null');
const log = require('../../../src/lib/log');

async function startServer() {
	const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zwifit-it-'));
	const logLines = [];
	log.setSink((level, text) => logLines.push({ level, text }));

	const settings = createSettingsRepo({ dir: dataDir, legacyDir: dataDir });
	await settings.init();
	const devices = createDevicesRepo({ dir: dataDir });
	await devices.load();
	const printed = [];
	const pairing = createPairing({ dir: dataDir, devices, rateLimit: createRateLimit(), printCode: code => printed.push(code) });
	await pairing.ensureCode();

	const treadmill = new SimulatedTreadmill({ limits: settings.get().limits });
	const broadcast = new NullBroadcast();
	const server = createServer({ pairing, devices, staticDir: path.join(dataDir, 'www') });
	const { port } = await server.listen(0, '127.0.0.1');
	const base = `http://127.0.0.1:${port}`;
	const sockets = [];

	function request(method, urlPath, { headers = {}, body, origin = base } = {}) {
		const allHeaders = { ...headers };
		if (origin) {
			allHeaders.origin = origin;
		}
		let payload;
		if (body !== undefined) {
			payload = typeof body === 'string' ? body : JSON.stringify(body);
			allHeaders['content-type'] = 'application/json';
		}
		return new Promise((resolve, reject) => {
			const req = http.request(`${base}${urlPath}`, { method, headers: allHeaders }, res => {
				let text = '';
				res.setEncoding('utf8');
				res.on('data', chunk => { text += chunk; });
				res.on('end', () => {
					let json;
					try {
						json = JSON.parse(text);
					}
					catch {
						json = undefined;
					}
					resolve({ status: res.statusCode, headers: res.headers, text, json });
				});
			});
			req.on('error', reject);
			if (payload !== undefined) {
				req.write(payload);
			}
			req.end();
		});
	}

	const currentCode = () => printed[printed.length - 1];

	// Opens a socket. Resolves with the socket once connected, or rejects with the connect_error.
	function openSocket({ cookie, origin = base } = {}) {
		const extraHeaders = {};
		if (cookie) {
			extraHeaders.cookie = cookie;
		}
		if (origin) {
			extraHeaders.origin = origin;
		}
		const socket = connect(base, { transports: ['websocket'], extraHeaders, reconnection: false, forceNew: true });
		sockets.push(socket);
		return new Promise((resolve, reject) => {
			socket.once('connect', () => resolve(socket));
			socket.once('connect_error', reject);
		});
	}

	// Pairs a new device and returns { cookie, socket, device }.
	async function pairedClient(deviceName = 'Test device') {
		const res = await request('POST', '/api/pair', { body: { code: currentCode(), deviceName } });
		if (res.status !== 204) {
			throw new Error(`pairing failed: ${res.status} ${res.text}`);
		}
		const cookie = res.headers['set-cookie'][0].split(';')[0];
		const socket = await openSocket({ cookie });
		const device = devices.list().find(d => d.name === deviceName);
		return { cookie, socket, device };
	}

	const anonClient = () => openSocket();

	async function stop() {
		for (const socket of sockets) {
			socket.disconnect();
		}
		await treadmill.stop();
		await server.close();
		log.setSink(null);
		fs.rmSync(dataDir, { recursive: true, force: true });
	}

	return { base, dataDir, server, settings, devices, pairing, treadmill, broadcast, request, openSocket, pairedClient, anonClient, currentCode, logLines, stop };
}

module.exports = { startServer };
