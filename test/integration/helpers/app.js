// Starts the real app (createApp) on 127.0.0.1:<random port> with a temporary data directory and
// the simulated treadmill. Clients send the server's own Origin.
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { io: connect } = require('socket.io-client');
const { createApp } = require('../../../src/app');
const log = require('../../../src/lib/log');

// Test apps start without the demo plan unless asked, so plan lists start empty.
async function startApp({ legacyFiles = {}, settings, demoPlan = false, restart, ant } = {}) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zwifit-app-'));
	const dataDir = path.join(root, 'data');
	const legacyDir = path.join(root, 'repo');
	fs.mkdirSync(legacyDir, { recursive: true });
	for (const [name, source] of Object.entries(legacyFiles)) {
		fs.copyFileSync(source, path.join(legacyDir, name));
	}
	if (settings) {
		fs.mkdirSync(dataDir, { recursive: true });
		fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify(settings));
	}
	const logLines = [];
	log.setSink((level, text) => logLines.push({ level, text }));
	const printed = [];
	const app = await createApp({ dataDir, legacyDir, simulate: true, disableBroadcast: true, disableSensors: true, demoPlan, printCode: code => printed.push(code), port: 0, host: '127.0.0.1', restart, ant });
	const { port } = await app.start();
	const base = `http://127.0.0.1:${port}`;
	const sockets = [];

	function request(method, urlPath, { headers = {}, body, origin = base, raw } = {}) {
		const allHeaders = { ...headers };
		if (origin) {
			allHeaders.origin = origin;
		}
		let payload;
		if (body !== undefined) {
			payload = typeof body === 'string' ? body : JSON.stringify(body);
			allHeaders['content-type'] = allHeaders['content-type'] || 'application/json';
		}
		return new Promise((resolve, reject) => {
			const req = http.request(`${base}${urlPath}`, { method, headers: allHeaders }, res => {
				const chunks = [];
				res.on('data', chunk => chunks.push(chunk));
				res.on('end', () => {
					const buffer = Buffer.concat(chunks);
					const text = buffer.toString('utf8');
					let json;
					try {
						json = JSON.parse(text);
					}
					catch {
						json = undefined;
					}
					resolve({ status: res.statusCode, headers: res.headers, text, json, buffer: raw ? buffer : undefined });
				});
			});
			req.on('error', reject);
			if (payload !== undefined) {
				req.write(payload);
			}
			req.end();
		});
	}

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

	// Pairs a new device. The socket is created with listeners for the first status/settings.
	async function pairedClient(deviceName = 'Test device') {
		const res = await request('POST', '/api/pair', { body: { code: printed[printed.length - 1], deviceName } });
		if (res.status !== 204) {
			throw new Error(`pairing failed: ${res.status} ${res.text}`);
		}
		const cookie = res.headers['set-cookie'][0].split(';')[0];
		const socket = await openSocket({ cookie });
		const device = app.devices.list().find(d => d.name === deviceName);
		return { cookie, socket, device };
	}

	const emit = (socket, event, ...args) => new Promise(resolve => socket.emit(event, ...args, resolve));
	const next = (socket, event, predicate = () => true, timeoutMs = 5000) => new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			socket.off(event, listener);
			reject(new Error(`timed out waiting for ${event}`));
		}, timeoutMs);
		function listener(payload) {
			if (predicate(payload)) {
				clearTimeout(timer);
				socket.off(event, listener);
				resolve(payload);
			}
		}
		socket.on(event, listener);
	});

	async function stop() {
		for (const socket of sockets) {
			socket.disconnect();
		}
		await app.stop();
		log.setSink(null);
		fs.rmSync(root, { recursive: true, force: true });
	}

	return { app, base, dataDir, legacyDir, request, openSocket, pairedClient, emit, next, logLines, currentCode: () => printed[printed.length - 1], stop };
}

module.exports = { startApp };
