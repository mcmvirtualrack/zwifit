const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { io: connect } = require('socket.io-client');
const { startApp } = require('./helpers/app');
const { createSettingsRepo } = require('../../src/storage/settingsRepo');

jest.setTimeout(60000);

describe('server:restart command', () => {
	let ctx;
	afterEach(() => ctx && ctx.stop());

	test('calls the restart hook when nothing is running', async () => {
		const restart = jest.fn();
		ctx = await startApp({ restart });
		const { socket } = await ctx.pairedClient();
		expect(await ctx.emit(socket, 'server:restart')).toMatchObject({ ok: true, data: { restarting: true } });
		expect(restart).toHaveBeenCalledTimes(1);
	});

	test('is refused without a supervisor, and while a plan runs', async () => {
		ctx = await startApp();
		const { socket } = await ctx.pairedClient();
		expect(await ctx.emit(socket, 'server:restart')).toMatchObject({ ok: false, error: 'RESTART_UNSUPPORTED' });
		await ctx.stop();

		const restart = jest.fn();
		ctx = await startApp({ restart });
		const client = await ctx.pairedClient();
		const step = { kind: 'step', id: 'a', label: 'a', targetKph: 6, entered: { form: 'speed', unit: 'kph', value: 6 }, targetIncline: 1, end: { type: 'time', seconds: 60 } };
		const planId = (await ctx.emit(client.socket, 'plans:save', { schemaVersion: 1, name: 'P', items: [step] })).data.id;
		ctx.app.treadmill.startBelt(5);
		await ctx.emit(client.socket, 'playback:start', { planId });
		expect(await ctx.emit(client.socket, 'server:restart')).toMatchObject({ ok: false, error: 'PLAN_RUNNING' });
		expect(restart).not.toHaveBeenCalled();
		await ctx.emit(client.socket, 'playback:stop');
	});
});

// The real entry point: `node app.js` supervises Zwifit and starts it again on server:restart.
test('npm start (app.js) restarts Zwifit in place when asked, and Ctrl+C-style stop ends it', async () => {
	const port = await new Promise(resolve => {
		const probe = net.createServer().listen(0, '127.0.0.1', () => {
			const p = probe.address().port;
			probe.close(() => resolve(p));
		});
	});
	const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zwifit-restart-'));
	const settings = createSettingsRepo({ dir: dataDir, legacyDir: dataDir });
	await settings.init();
	await settings.update({ server: { port, host: '127.0.0.1' } });
	const child = spawn(process.execPath, ['app.js', '--simulate'], {
		cwd: path.join(__dirname, '..', '..'),
		env: { ...process.env, ZWIFIT_DATA_DIR: dataDir, ZWIFIT_NO_HARDWARE: '1' },
		stdio: ['ignore', 'pipe', 'pipe']
	});
	let out = '';
	child.stdout.on('data', d => { out += d; });
	child.stderr.on('data', d => { out += d; });
	const waitFor = (pattern, count = 1) => new Promise((resolve, reject) => {
		const timer = setInterval(() => {
			if ((out.match(pattern) || []).length >= count) {
				clearInterval(timer);
				resolve();
			}
			else if (child.exitCode !== null) {
				clearInterval(timer);
				reject(new Error(`exited early:\n${out}`));
			}
		}, 100);
	});
	try {
		await waitFor(/Control page: /g);
		const code = out.match(/Pairing code: (\S+)/)[1];
		const base = `http://127.0.0.1:${port}`;
		const res = await fetch(`${base}/api/pair`, { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ code }) });
		const cookie = res.headers.get('set-cookie').split(';')[0];
		const socket = connect(base, { transports: ['websocket'], extraHeaders: { cookie, origin: base }, reconnection: false, forceNew: true });
		await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
		const reply = await new Promise(resolve => socket.emit('server:restart', undefined, resolve));
		expect(reply).toMatchObject({ ok: true });
		socket.disconnect();
		await waitFor(/Restarting Zwifit/g);
		// Two "Control page" lines per start (LAN + loopback, or just loopback when bound to it).
		const perStart = (out.match(/Control page: /g) || []).length;
		await waitFor(/Control page: /g, perStart * 2);
		// Still the same pairing after the restart.
		const session = await (await fetch(`${base}/api/session`, { headers: { cookie } })).json();
		expect(session.paired).toBe(true);
	}
	finally {
		if (child.exitCode === null) {
			const exited = new Promise(resolve => child.once('exit', resolve));
			child.kill('SIGTERM');
			await exited;
		}
	}
});
