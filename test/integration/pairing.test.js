const { startServer } = require('./helpers/server');

let ctx;
beforeEach(async () => {
	ctx = await startServer();
});
afterEach(async () => {
	await ctx.stop();
});

const noLeaks = (res, secrets = []) => {
	expect(res.text).not.toMatch(/at \S+ \(|\/home\/|[A-Z]:\\|node_modules/);
	for (const secret of secrets) {
		expect(res.text).not.toContain(secret);
	}
};

test('unpaired GET /api/session says not paired', async () => {
	const res = await ctx.request('GET', '/api/session');
	expect(res.status).toBe(200);
	expect(res.json).toEqual({ paired: false });
	expect(res.headers['cache-control']).toBe('no-store');
});

test('unpaired socket is refused with NOT_PAIRED', async () => {
	await expect(ctx.anonClient()).rejects.toMatchObject({ message: 'NOT_PAIRED' });
});

test('socket from another origin is refused with BAD_ORIGIN, even when paired', async () => {
	const { cookie } = await ctx.pairedClient();
	await expect(ctx.openSocket({ cookie, origin: 'http://evil.example' })).rejects.toMatchObject({ message: 'BAD_ORIGIN' });
	await expect(ctx.openSocket({ cookie, origin: null })).rejects.toMatchObject({ message: 'BAD_ORIGIN' });
});

test('POST /api/pair from another origin is BAD_ORIGIN', async () => {
	const res = await ctx.request('POST', '/api/pair', { body: { code: ctx.currentCode() }, origin: 'http://evil.example' });
	expect(res.status).toBe(403);
	expect(res.json).toMatchObject({ error: 'BAD_ORIGIN' });
});

test('wrong codes are 401 BAD_CODE, and the 6th try is 429 with retryAfterSeconds', async () => {
	for (let i = 0; i < 5; i++) {
		const res = await ctx.request('POST', '/api/pair', { body: { code: '0000-0000' } });
		expect(res.status).toBe(401);
		expect(res.json).toMatchObject({ error: 'BAD_CODE' });
		noLeaks(res, [ctx.currentCode()]);
	}
	const res = await ctx.request('POST', '/api/pair', { body: { code: ctx.currentCode() } });
	expect(res.status).toBe(429);
	expect(res.json).toMatchObject({ error: 'LOCKED_OUT', retryAfterSeconds: 900 });
	expect(res.headers['retry-after']).toBe('900');
});

test('a malformed body is 422 with details', async () => {
	const res = await ctx.request('POST', '/api/pair', { body: { code: 'x', extra: true } });
	expect(res.status).toBe(422);
	expect(res.json.error).toBe('INVALID');
	expect(res.json.details.map(d => d.path)).toEqual(expect.arrayContaining(['code', 'extra']));
});

test('the right code sets the device cookie with the contract attributes', async () => {
	const res = await ctx.request('POST', '/api/pair', { body: { code: ctx.currentCode(), deviceName: 'Phone' } });
	expect(res.status).toBe(204);
	const cookie = res.headers['set-cookie'][0];
	expect(cookie).toMatch(/^zwifit_device=[A-Za-z0-9_-]{43};/);
	for (const attribute of ['HttpOnly', 'SameSite=Strict', 'Path=/', 'Max-Age=7776000']) {
		expect(cookie).toContain(attribute);
	}
	expect(cookie).not.toContain('Secure');

	const session = await ctx.request('GET', '/api/session', { headers: { cookie: cookie.split(';')[0] } });
	expect(session.json).toEqual({ paired: true, deviceName: 'Phone' });
});

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

test('pairing without a name names the device after its browser', async () => {
	const res = await ctx.request('POST', '/api/pair', { body: { code: ctx.currentCode() }, headers: { 'user-agent': IPHONE } });
	const cookie = res.headers['set-cookie'][0].split(';')[0];
	expect((await ctx.request('GET', '/api/session', { headers: { cookie } })).json).toEqual({ paired: true, deviceName: 'iPhone · Safari' });
});

test('a device still called "Device" gets its browser name on its next visit', async () => {
	const res = await ctx.request('POST', '/api/pair', { body: { code: ctx.currentCode() }, headers: { 'user-agent': 'curl/8.0' } });
	const cookie = res.headers['set-cookie'][0].split(';')[0];
	expect((await ctx.request('GET', '/api/session', { headers: { cookie, 'user-agent': 'curl/8.0' } })).json.deviceName).toBe('Device');
	expect((await ctx.request('GET', '/api/session', { headers: { cookie, 'user-agent': IPHONE } })).json.deviceName).toBe('iPhone · Safari');
	// A name the user chose is never replaced.
	expect((await ctx.request('GET', '/api/session', { headers: { cookie, 'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Firefox/131.0' } })).json.deviceName).toBe('iPhone · Safari');
});

test('PATCH /api/devices/:id renames a device; bad names, other origins and unknown ids are refused', async () => {
	const phone = await ctx.pairedClient('Phone');
	const tablet = await ctx.pairedClient('Tablet');
	const rename = (id, body, opts = {}) => ctx.request('PATCH', `/api/devices/${id}`, { body, headers: { cookie: phone.cookie }, ...opts });

	const ok = await rename(tablet.device.id, { name: 'Kitchen iPad' });
	expect(ok.status).toBe(200);
	expect(ok.json).toMatchObject({ id: tablet.device.id, name: 'Kitchen iPad', current: false });
	expect(ok.json.tokenHash).toBeUndefined();

	expect((await rename(tablet.device.id, { name: '' })).status).toBe(422);
	expect((await rename(tablet.device.id, { name: 'x'.repeat(41) })).status).toBe(422);
	expect((await rename(tablet.device.id, { name: 'TV', extra: 1 })).status).toBe(422);
	expect((await rename('01HZX3K9V7Q8R2M4N6P0S1T3W5', { name: 'TV' })).status).toBe(404);
	expect((await rename(tablet.device.id, { name: 'Evil' }, { origin: 'http://evil.example' })).status).toBe(403);
	expect((await ctx.request('PATCH', `/api/devices/${tablet.device.id}`, { body: { name: 'Anon' } })).status).toBe(401);
	const list = await ctx.request('GET', '/api/devices', { headers: { cookie: phone.cookie } });
	expect(list.json.find(d => d.id === tablet.device.id).name).toBe('Kitchen iPad');
});

test('GET /api/devices lists devices without token hashes and marks the current one', async () => {
	const phone = await ctx.pairedClient('Phone');
	await ctx.pairedClient('Tablet');
	const res = await ctx.request('GET', '/api/devices', { headers: { cookie: phone.cookie } });
	expect(res.status).toBe(200);
	expect(res.json.map(d => [d.name, d.current])).toEqual([['Phone', true], ['Tablet', false]]);
	expect(res.text).not.toContain('tokenHash');
	for (const device of ctx.devices.list()) {
		expect(res.text).not.toContain(device.tokenHash);
	}
});

test('paired-only endpoints refuse unpaired requests', async () => {
	for (const [method, path] of [['GET', '/api/devices'], ['POST', '/api/unpair'], ['POST', '/api/pairing-code'], ['DELETE', '/api/devices/01HZX3K9V7Q8R2M4N6P0S1T3W5']]) {
		const res = await ctx.request(method, path);
		expect(res.status).toBe(401);
		expect(res.json).toMatchObject({ error: 'NOT_PAIRED' });
	}
});

test('DELETE /api/devices/:id disconnects that device immediately', async () => {
	const phone = await ctx.pairedClient('Phone');
	const tablet = await ctx.pairedClient('Tablet');
	const disconnected = new Promise(resolve => tablet.socket.once('disconnect', resolve));

	const res = await ctx.request('DELETE', `/api/devices/${tablet.device.id}`, { headers: { cookie: phone.cookie } });
	expect(res.status).toBe(204);
	await disconnected;
	expect(phone.socket.connected).toBe(true);

	const again = await ctx.request('GET', '/api/session', { headers: { cookie: tablet.cookie } });
	expect(again.json).toEqual({ paired: false });
	await expect(ctx.openSocket({ cookie: tablet.cookie })).rejects.toMatchObject({ message: 'NOT_PAIRED' });
});

test('DELETE with a malformed id is 400 and an unknown id is 404', async () => {
	const { cookie } = await ctx.pairedClient();
	expect((await ctx.request('DELETE', '/api/devices/not-an-id', { headers: { cookie } })).status).toBe(400);
	expect((await ctx.request('DELETE', '/api/devices/..%2F..%2Fdevices', { headers: { cookie } })).status).toBe(400);
	const unknown = await ctx.request('DELETE', '/api/devices/01HZX3K9V7Q8R2M4N6P0S1T3W5', { headers: { cookie } });
	expect(unknown.status).toBe(404);
	expect(unknown.json).toMatchObject({ error: 'NOT_FOUND' });
});

test('POST /api/unpair removes this device and clears the cookie', async () => {
	const { cookie, socket } = await ctx.pairedClient();
	const disconnected = new Promise(resolve => socket.once('disconnect', resolve));
	const res = await ctx.request('POST', '/api/unpair', { headers: { cookie } });
	expect(res.status).toBe(204);
	expect(res.headers['set-cookie'][0]).toMatch(/^zwifit_device=;.*Max-Age=0/);
	await disconnected;
	expect(ctx.devices.list()).toEqual([]);
});

test('POST /api/pairing-code shows a paired device a new code that pairs one device only', async () => {
	const { cookie, socket } = await ctx.pairedClient();
	const before = ctx.currentCode();
	const res = await ctx.request('POST', '/api/pairing-code', { headers: { cookie } });
	expect(res.status).toBe(200);
	expect(res.headers['cache-control']).toBe('no-store');
	expect(res.json).toEqual({ code: ctx.currentCode(), expiresAt: expect.any(String) });
	expect(res.json.code).not.toBe(before);
	// Existing pairings survive a new code.
	expect(socket.connected).toBe(true);
	expect((await ctx.request('GET', '/api/session', { headers: { cookie } })).json.paired).toBe(true);

	expect((await ctx.request('POST', '/api/pair', { body: { code: res.json.code, deviceName: 'Surface Hub' } })).status).toBe(204);
	const again = await ctx.request('POST', '/api/pair', { body: { code: res.json.code, deviceName: 'Someone else' } });
	expect(again.status).toBe(401);
	expect(again.json).toMatchObject({ error: 'BAD_CODE' });
});

test('POST /api/pairing-code needs a paired device', async () => {
	const res = await ctx.request('POST', '/api/pairing-code');
	expect(res.status).toBe(401);
	expect(res.json).toMatchObject({ error: 'NOT_PAIRED' });
});

test('unknown /api routes are JSON 404s', async () => {
	const res = await ctx.request('GET', '/api/nope');
	expect(res.status).toBe(404);
	expect(res.json).toMatchObject({ error: 'NOT_FOUND' });
});

test('pairing codes and tokens never reach the log', async () => {
	const { cookie } = await ctx.pairedClient();
	const token = cookie.split('=')[1];
	await ctx.request('POST', '/api/pair', { body: { code: '0000-0000' } });
	const all = ctx.logLines.map(l => l.text).join('\n');
	expect(all).not.toContain(token);
	expect(all).not.toContain(ctx.currentCode());
});

describe('socket commands', () => {
	beforeEach(() => {
		ctx.server.handle('test:echo', 'plans-get', ({ payload, device }) => ({ id: payload.id, device: device.name }));
		ctx.server.handle('test:none', null, () => undefined);
		ctx.server.handle('test:boom', null, () => {
			throw new Error('EACCES /home/u/.local/share/zwifit/devices.json');
		});
	});

	const emit = (socket, ...args) => new Promise(resolve => socket.emit(...args, resolve));
	const ID = '01HZX3K9V7Q8R2M4N6P0S1T3W5';

	test('valid payload gets { ok: true, data }', async () => {
		const { socket } = await ctx.pairedClient('Phone');
		expect(await emit(socket, 'test:echo', { id: ID })).toEqual({ ok: true, data: { id: ID, device: 'Phone' } });
		expect(await emit(socket, 'test:none')).toEqual({ ok: true });
	});

	test('invalid payload gets INVALID with details', async () => {
		const { socket } = await ctx.pairedClient();
		const reply = await emit(socket, 'test:echo', { id: 'nope' });
		expect(reply).toMatchObject({ ok: false, error: 'INVALID', details: [expect.objectContaining({ path: 'id' })] });
		expect(await emit(socket, 'test:none', { unexpected: 1 })).toMatchObject({ ok: false, error: 'INVALID' });
	});

	test('handler crashes become INTERNAL without paths', async () => {
		const { socket } = await ctx.pairedClient();
		const reply = await emit(socket, 'test:boom');
		expect(reply).toEqual({ ok: false, error: 'INTERNAL', message: 'Something went wrong.' });
	});

	test('unknown events are dropped and logged by name only', async () => {
		const { socket } = await ctx.pairedClient();
		socket.emit('message', { event: 'writeSettings', data: { secret: 'payload-secret' } });
		expect(await emit(socket, 'test:none')).toEqual({ ok: true });
		const warning = ctx.logLines.find(l => l.text.includes('Dropped unknown socket event'));
		expect(warning.text).toContain('"event":"message"');
		expect(warning.text).not.toContain('payload-secret');
	});

	test('more than 20 commands a second are refused', async () => {
		const { socket } = await ctx.pairedClient();
		const replies = await Promise.all(Array.from({ length: 25 }, () => emit(socket, 'test:none')));
		expect(replies.filter(r => r.ok)).toHaveLength(20);
		expect(replies.filter(r => r.error === 'RATE_LIMITED')).toHaveLength(5);
	});
});

test('a socket or request from a rebinding host name is refused', async () => {
	const { cookie } = await ctx.pairedClient();
	const res = await ctx.request('GET', '/api/session', { headers: { host: 'evil.example' } });
	expect(res.status).toBe(403);
	expect(res.json).toMatchObject({ error: 'BAD_HOST' });
	const http = require('http');
	const handshake = await new Promise(resolve => {
		const req = http.request(`${ctx.base}/socket.io/?EIO=4&transport=polling`, { headers: { host: 'evil.example', origin: 'http://evil.example', cookie } }, r => {
			let text = '';
			r.on('data', c => { text += c; });
			r.on('end', () => resolve({ status: r.statusCode, text }));
		});
		req.end();
	});
	expect(handshake.status).not.toBe(200);
});

describe('trusting a device\'s address (no code or cookie from it)', () => {
	test('a trusted device is recognised by its address alone, until trust is turned off', async () => {
		const hub = await ctx.pairedClient('Surface Hub');
		expect(hub.device.ip).toBe('127.0.0.1');
		expect((await ctx.request('GET', '/api/session')).json).toEqual({ paired: false });

		const on = await ctx.request('PATCH', `/api/devices/${hub.device.id}`, { headers: { cookie: hub.cookie }, body: { trusted: true } });
		expect(on.status).toBe(200);
		expect(on.json).toMatchObject({ name: 'Surface Hub', ip: '127.0.0.1', trusted: true });

		// No cookie: the request counts as the trusted device, HTTP and live socket alike.
		expect((await ctx.request('GET', '/api/session')).json).toEqual({ paired: true, deviceName: 'Surface Hub' });
		const socket = await ctx.openSocket();
		expect(socket.connected).toBe(true);
		expect((await ctx.request('GET', '/api/devices')).json.find(d => d.current)).toMatchObject({ name: 'Surface Hub' });

		await ctx.request('PATCH', `/api/devices/${hub.device.id}`, { headers: { cookie: hub.cookie }, body: { trusted: false } });
		expect((await ctx.request('GET', '/api/session')).json).toEqual({ paired: false });
		await expect(ctx.openSocket()).rejects.toThrow('NOT_PAIRED');
	});

	test('a cookie still wins: another paired device at the same address stays itself', async () => {
		const hub = await ctx.pairedClient('Surface Hub');
		const phone = await ctx.pairedClient('Phone');
		await ctx.request('PATCH', `/api/devices/${hub.device.id}`, { headers: { cookie: hub.cookie }, body: { trusted: true } });
		expect((await ctx.request('GET', '/api/session', { headers: { cookie: phone.cookie } })).json.deviceName).toBe('Phone');
	});

	test('removing a trusted device ends its access', async () => {
		const hub = await ctx.pairedClient('Surface Hub');
		const pc = await ctx.pairedClient('PC');
		await ctx.request('PATCH', `/api/devices/${hub.device.id}`, { headers: { cookie: hub.cookie }, body: { trusted: true } });
		expect((await ctx.request('DELETE', `/api/devices/${hub.device.id}`, { headers: { cookie: pc.cookie } })).status).toBe(204);
		expect((await ctx.request('GET', '/api/session')).json).toEqual({ paired: false });
	});

	test('the body must change something; unknown fields are refused', async () => {
		const hub = await ctx.pairedClient('Surface Hub');
		expect((await ctx.request('PATCH', `/api/devices/${hub.device.id}`, { headers: { cookie: hub.cookie }, body: {} })).status).toBe(422);
		expect((await ctx.request('PATCH', `/api/devices/${hub.device.id}`, { headers: { cookie: hub.cookie }, body: { trusted: 'yes' } })).status).toBe(422);
		expect((await ctx.request('PATCH', `/api/devices/${hub.device.id}`, { headers: { cookie: hub.cookie }, body: { tokenHash: 'x' } })).status).toBe(422);
	});
});

describe('adding a client by its IP address', () => {
	test('a client added by address gets in with no code; its address can be changed', async () => {
		const pc = await ctx.pairedClient('PC');
		const added = await ctx.request('POST', '/api/devices', { headers: { cookie: pc.cookie }, body: { name: 'Surface Hub', ip: '::ffff:127.0.0.1' } });
		expect(added.status).toBe(201);
		expect(added.json).toMatchObject({ name: 'Surface Hub', ip: '127.0.0.1', trusted: true, current: false });
		// The tests connect from 127.0.0.1: no cookie, and it counts as the Hub.
		expect((await ctx.request('GET', '/api/session')).json).toEqual({ paired: true, deviceName: 'Surface Hub' });

		const moved = await ctx.request('PATCH', `/api/devices/${added.json.id}`, { headers: { cookie: pc.cookie }, body: { ip: '10.0.0.77' } });
		expect(moved.json).toMatchObject({ ip: '10.0.0.77', trusted: true });
		expect((await ctx.request('GET', '/api/session')).json).toEqual({ paired: false });
	});

	test('bad addresses, a taken address and unpaired callers are refused', async () => {
		const pc = await ctx.pairedClient('PC');
		const add = body => ctx.request('POST', '/api/devices', { headers: { cookie: pc.cookie }, body });
		for (const ip of ['example.com', '10.0.0', '10.0.0.1:80', '10.0.0.0/24']) {
			expect((await add({ name: 'X', ip })).json).toMatchObject({ error: 'INVALID' });
		}
		expect((await add({ name: '', ip: '10.0.0.5' })).status).toBe(422);
		expect((await add({ name: 'Hub', ip: '10.0.0.5' })).status).toBe(201);
		expect((await add({ name: 'Hub 2', ip: '10.0.0.5' })).json).toMatchObject({ error: 'ADDRESS_TAKEN' });
		expect((await ctx.request('POST', '/api/devices', { body: { name: 'Me', ip: '10.0.0.9' } })).status).toBe(401);
	});
});
