// HTTPS on an extra port (settings.server.tls.port) next to plain HTTP on the main port, for
// browsers that insist on HTTPS (e.g. a managed Edge). The certificate is a test-only fixture.
const fs = require('fs');
const https = require('https');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { io: connect } = require('socket.io-client');
const { createServer } = require('../../src/api/server');
const { createDevicesRepo } = require('../../src/storage/devicesRepo');
const { createRateLimit } = require('../../src/security/rateLimit');
const { createPairing } = require('../../src/security/pairing');
const log = require('../../src/lib/log');

const TLS_DIR = path.join(__dirname, '..', 'fixtures', 'tls');

const freePort = () => new Promise(resolve => {
	const probe = net.createServer().listen(0, '127.0.0.1', () => {
		const { port } = probe.address();
		probe.close(() => resolve(port));
	});
});

function call(base, method, urlPath, { body, origin = base } = {}) {
	const lib = base.startsWith('https') ? https : http;
	const payload = body === undefined ? undefined : JSON.stringify(body);
	const headers = { origin, ...(payload ? { 'content-type': 'application/json' } : {}) };
	return new Promise((resolve, reject) => {
		const req = lib.request(`${base}${urlPath}`, { method, headers, rejectUnauthorized: false }, res => {
			res.resume();
			res.on('end', () => resolve({ status: res.statusCode, headers: res.headers }));
		});
		req.on('error', reject);
		req.end(payload);
	});
}

let server;
let sockets = [];
let printed;
let httpBase;
let httpsBase;

beforeEach(async () => {
	log.setSink(() => {});
	const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zwifit-https-'));
	const devices = createDevicesRepo({ dir: dataDir });
	await devices.load();
	printed = [];
	const pairing = createPairing({ dir: dataDir, devices, rateLimit: createRateLimit(), printCode: code => printed.push(code) });
	await pairing.ensureCode();
	const tlsPort = await freePort();
	server = createServer({
		pairing,
		devices,
		staticDir: dataDir,
		tls: { certPath: path.join(TLS_DIR, 'test-cert.pem'), keyPath: path.join(TLS_DIR, 'test-key.pem'), port: tlsPort }
	});
	const { port } = await server.listen(0, '127.0.0.1');
	httpBase = `http://127.0.0.1:${port}`;
	httpsBase = `https://127.0.0.1:${tlsPort}`;
});

afterEach(async () => {
	sockets.forEach(s => s.disconnect());
	sockets = [];
	await server.close();
	log.setSink(null);
});

test('the main port stays plain HTTP while the extra port serves HTTPS', async () => {
	expect(server.secure).toBe(false);
	expect((await call(httpBase, 'GET', '/api/session')).status).toBe(200);
	expect((await call(httpsBase, 'GET', '/api/session')).status).toBe(200);
});

test('pairing over HTTPS sets a Secure cookie, and the live socket connects over HTTPS', async () => {
	const res = await call(httpsBase, 'POST', '/api/pair', { body: { code: printed.at(-1) } });
	expect(res.status).toBe(204);
	expect(res.headers['set-cookie'][0]).toMatch(/; Secure/);
	const cookie = res.headers['set-cookie'][0].split(';')[0];
	const socket = connect(httpsBase, { transports: ['websocket'], extraHeaders: { cookie, origin: httpsBase }, rejectUnauthorized: false, reconnection: false, forceNew: true });
	sockets.push(socket);
	await new Promise((resolve, reject) => {
		socket.once('connect', resolve);
		socket.once('connect_error', reject);
	});
});

test('an HTTP origin is refused on the HTTPS port (the scheme is part of the origin)', async () => {
	const wrongOrigin = httpsBase.replace('https', 'http');
	expect((await call(httpsBase, 'POST', '/api/pair', { body: { code: printed.at(-1) }, origin: wrongOrigin })).status).toBe(403);
	const socket = connect(httpsBase, { transports: ['websocket'], extraHeaders: { origin: wrongOrigin }, rejectUnauthorized: false, reconnection: false, forceNew: true });
	sockets.push(socket);
	const err = await new Promise(resolve => socket.once('connect_error', resolve));
	expect(err.message).toBe('BAD_ORIGIN');
});
