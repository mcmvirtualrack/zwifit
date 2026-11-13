const http = require('http');
const express = require('express');
const guards = require('../../../src/security/httpGuards');
const { AppError } = require('../../../src/lib/errors');

let server;
let base;

beforeAll(async () => {
	const app = express();
	app.use(guards.securityHeaders);
	app.use(guards.hostCheck);
	app.use(guards.originCheck);
	app.use(guards.jsonBody());
	app.get('/api/thing', (req, res) => res.json({ ok: true }));
	app.post('/api/thing', (req, res) => res.json({ got: req.body }));
	app.get('/api/things/:id', guards.validateId, (req, res) => res.json({ id: req.params.id }));
	app.get('/api/fail', () => {
		throw new Error('ENOENT /home/u/secret/path');
	});
	app.get('/api/app-error', () => {
		throw new AppError('OUT_OF_RANGE', 'Too fast', [{ path: 'kph', code: 'ABOVE_MAX_SPEED', message: 'x' }]);
	});
	app.get('/', (req, res) => res.send('<html></html>'));
	app.use(guards.errorHandler);
	server = http.createServer(app);
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => new Promise(resolve => server.close(resolve)));

function request(method, path, { headers = {}, body } = {}) {
	return new Promise((resolve, reject) => {
		const req = http.request(`${base}${path}`, { method, headers }, res => {
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
		if (body !== undefined) {
			req.write(body);
		}
		req.end();
	});
}

const post = (path, body, headers = {}) => request('POST', path, {
	headers: { 'content-type': 'application/json', ...headers },
	body: typeof body === 'string' ? body : JSON.stringify(body)
});

describe('origin check', () => {
	test('same origin POST passes', async () => {
		const res = await post('/api/thing', { a: 1 }, { origin: base });
		expect(res.status).toBe(200);
		expect(res.json).toEqual({ got: { a: 1 } });
	});

	test('falls back to Referer when Origin is absent', async () => {
		expect((await post('/api/thing', {}, { referer: `${base}/plans` })).status).toBe(200);
		expect((await post('/api/thing', {}, { referer: 'http://evil.example/x' })).status).toBe(403);
	});

	test.each([
		['other host', 'http://evil.example'],
		['other port', 'http://127.0.0.1:1'],
		['other scheme', 'SAME_HOST_HTTPS'],
		['null origin', 'null']
	])('%s is rejected with BAD_ORIGIN', async (_, origin) => {
		const sent = origin === 'SAME_HOST_HTTPS' ? base.replace('http:', 'https:') : origin;
		const res = await post('/api/thing', {}, { origin: sent });
		expect(res.status).toBe(403);
		expect(res.json).toMatchObject({ error: 'BAD_ORIGIN' });
	});

	test('non-GET without Origin or Referer is rejected', async () => {
		expect((await post('/api/thing', {})).status).toBe(403);
	});

	test('GET without Origin is fine', async () => {
		expect((await request('GET', '/api/thing')).status).toBe(200);
	});

	test('isSameOrigin works on raw handshake headers', () => {
		expect(guards.isSameOrigin({ origin: 'http://pc:1337', host: 'pc:1337' }, false)).toBe(true);
		expect(guards.isSameOrigin({ origin: 'https://pc:1337', host: 'pc:1337' }, true)).toBe(true);
		expect(guards.isSameOrigin({ origin: 'http://pc:1337', host: 'pc:1337' }, true)).toBe(false);
		expect(guards.isSameOrigin({ host: 'pc:1337' }, false)).toBe(false);
		expect(guards.isSameOrigin({ referer: 'not a url', host: 'pc:1337' }, false)).toBe(false);
	});
});

describe('host check (DNS rebinding)', () => {
	const check = guards.createHostCheck({ hostname: 'LAPTOP-ZW', extra: 'zwifit.home.arpa, Treadmill' });

	test.each([
		'127.0.0.1:1337', '192.168.1.20', '[::1]:1337', '[fe80::1]', 'localhost:1337',
		'laptop-zw:1337', 'LAPTOP-ZW.local', 'laptop-zw.lan', 'zwifit.home.arpa:1337', 'treadmill'
	])('%s is allowed', host => {
		expect(check(host)).toBe(true);
	});

	test.each(['evil.example', 'evil.example:1337', 'laptop-zw.evil.example', '', undefined, '127.0.0.1.evil.example'])('%p is refused', host => {
		expect(check(host)).toBe(false);
	});

	test('a request with a foreign Host is 403 BAD_HOST', async () => {
		const res = await request('GET', '/api/thing', { headers: { host: 'evil.example:1337' } });
		expect(res.status).toBe(403);
		expect(res.json).toMatchObject({ error: 'BAD_HOST' });
	});
});

describe('security headers', () => {
	test.each(['/', '/api/thing'])('%s has the contract headers', async path => {
		const res = await request('GET', path);
		expect(res.headers['content-security-policy']).toBe(
			"default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; frame-ancestors 'none'"
		);
		expect(res.headers['x-content-type-options']).toBe('nosniff');
		expect(res.headers['referrer-policy']).toBe('no-referrer');
		expect(res.headers['x-powered-by']).toBeUndefined();
	});

	test('/api responses are not cached, pages may be', async () => {
		expect((await request('GET', '/api/thing')).headers['cache-control']).toBe('no-store');
		expect((await request('GET', '/')).headers['cache-control']).toBeUndefined();
	});
});

describe('bodies', () => {
	test('over 256 KB is 413', async () => {
		const res = await post('/api/thing', { big: 'x'.repeat(257 * 1024) }, { origin: base });
		expect(res.status).toBe(413);
		expect(res.json).toMatchObject({ error: 'TOO_LARGE' });
	});

	test('malformed JSON is 400 without parser details', async () => {
		const res = await post('/api/thing', '{"a":', { origin: base });
		expect(res.status).toBe(400);
		expect(res.json).toEqual({ error: 'BAD_JSON', message: 'The request body is not valid JSON.' });
	});
});

describe('ids and errors', () => {
	test('a valid id passes', async () => {
		const res = await request('GET', '/api/things/01HZX3K9V7Q8R2M4N6P0S1T3W5');
		expect(res.json).toEqual({ id: '01HZX3K9V7Q8R2M4N6P0S1T3W5' });
	});

	test.each(['abc', '01hzx3k9v7q8r2m4n6p0s1t3w5', '..%2F..%2Fetc', '01HZX3K9V7Q8R2M4N6P0S1T3WU'])('id %s is 400', async id => {
		const res = await request('GET', `/api/things/${id}`);
		expect(res.status).toBe(400);
		expect(res.json).toMatchObject({ error: 'BAD_ID' });
	});

	test('unexpected errors become INTERNAL with no stack or path', async () => {
		const res = await request('GET', '/api/fail');
		expect(res.status).toBe(500);
		expect(res.json).toEqual({ error: 'INTERNAL', message: 'Something went wrong.' });
		expect(res.text).not.toContain('/home');
	});

	test('AppErrors keep code, message and details', async () => {
		const res = await request('GET', '/api/app-error');
		expect(res.status).toBe(422);
		expect(res.json).toEqual({ error: 'OUT_OF_RANGE', message: 'Too fast', details: [{ path: 'kph', code: 'ABOVE_MAX_SPEED', message: 'x' }] });
	});
});
