const fs = require('fs');
const path = require('path');
const { startApp } = require('./helpers/app');

const LEGACY_SETTINGS = path.join(__dirname, '..', 'fixtures', 'legacy', 'settings.conf');

let ctx;
afterEach(async () => {
	if (ctx) {
		await ctx.stop();
		ctx = null;
	}
});

test('starts with the treadmill reporting and broadcast unavailable, without throwing', async () => {
	ctx = await startApp();
	const client = await ctx.pairedClient();
	const status = await ctx.next(client.socket, 'status');
	expect(status.treadmill).toMatchObject({ transport: 'simulated', connected: true, capabilities: { canResume: true } });
	expect(status.treadmill.limits).toEqual({ minKph: 0, maxKph: 20, minIncline: 0, maxIncline: 15 });
	expect(status.broadcast).toMatchObject({ available: false, reason: expect.any(String) });
});

test('a paired client gets status and settings within 1 s of connecting', async () => {
	ctx = await startApp();
	const res = await ctx.request('POST', '/api/pair', { body: { code: ctx.currentCode() } });
	const cookie = res.headers['set-cookie'][0].split(';')[0];
	const started = Date.now();
	const { io: connect } = require('socket.io-client');
	const socket = connect(ctx.base, { transports: ['websocket'], extraHeaders: { cookie, origin: ctx.base }, reconnection: false, forceNew: true });
	const [status, settings] = await Promise.all([ctx.next(socket, 'status'), ctx.next(socket, 'settings')]);
	expect(Date.now() - started).toBeLessThan(1000);
	expect(status.treadmill).toBeDefined();
	expect(settings.treadmill.bleActivation).toBeUndefined();
	socket.disconnect();
});

test('a treadmill disconnect is shown within 5 s with its reason', async () => {
	ctx = await startApp();
	const { socket } = await ctx.pairedClient();
	await ctx.next(socket, 'status');
	const started = Date.now();
	ctx.app.treadmill.simulateDisconnect('Treadmill switched off');
	const status = await ctx.next(socket, 'status', s => !s.treadmill.connected);
	expect(Date.now() - started).toBeLessThan(5000);
	expect(status.treadmill.reason).toBe('Treadmill switched off');
});

test('distance and time count up while the belt moves', async () => {
	ctx = await startApp();
	const { socket } = await ctx.pairedClient();
	ctx.app.treadmill.startBelt(18);
	const status = await ctx.next(socket, 'status', s => s.treadmill.metres >= 5, 4000);
	expect(status.treadmill.seconds).toBeGreaterThanOrEqual(1);
});

test('first start migrates a legacy settings.conf', async () => {
	ctx = await startApp({ legacyFiles: { 'settings.conf': LEGACY_SETTINGS } });
	const saved = JSON.parse(fs.readFileSync(path.join(ctx.dataDir, 'settings.json'), 'utf8'));
	expect(saved).toMatchObject({ version: 2, metric: true, treadmill: { transport: 'ble', bleCode: '3A4F' } });
	expect(ctx.logLines.some(l => l.text.includes('Imported settings'))).toBe(true);
});

test('the pairing code is printed once on first start, not logged', async () => {
	ctx = await startApp();
	expect(ctx.currentCode()).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
	expect(ctx.logLines.map(l => l.text).join('\n')).not.toContain(ctx.currentCode());
});
