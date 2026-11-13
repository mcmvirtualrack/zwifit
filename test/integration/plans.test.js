const fs = require('fs');
const path = require('path');
const { startApp } = require('./helpers/app');

const fixture = name => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'plans', name), 'utf8'));

let ctx;
let client;
beforeEach(async () => {
	ctx = await startApp();
	client = await ctx.pairedClient();
});
afterEach(async () => {
	await ctx.stop();
});

test('save, list, get, duplicate and delete over the socket, with plans:changed', async () => {
	const other = await ctx.pairedClient('Tablet');
	const changed = ctx.next(other.socket, 'plans:changed');
	const saved = await ctx.emit(client.socket, 'plans:save', fixture('intervals-6x.json'));
	expect(saved).toMatchObject({ ok: true, data: { id: expect.any(String), name: 'Intervals 6×' } });
	expect(await changed).toEqual({ id: saved.data.id });

	const list = await ctx.emit(client.socket, 'plans:list');
	expect(list.data).toEqual([expect.objectContaining({ id: saved.data.id, totals: expect.objectContaining({ seconds: 1830 }) })]);
	expect((await ctx.emit(client.socket, 'plans:get', { id: saved.data.id })).data.items).toHaveLength(3);

	const copy = await ctx.emit(client.socket, 'plans:duplicate', { id: saved.data.id });
	expect(copy.data.name).toBe('Intervals 6× (copy)');
	const deleted = ctx.next(other.socket, 'plans:changed', e => e.deleted);
	expect(await ctx.emit(client.socket, 'plans:delete', { id: copy.data.id })).toEqual({ ok: true });
	expect(await deleted).toEqual({ id: copy.data.id, deleted: true });
});

test('an invalid plan comes back with details at the field path', async () => {
	const plan = fixture('valid-intervals.json');
	plan.items[0].targetIncline = 30;
	const reply = await ctx.emit(client.socket, 'plans:save', plan);
	expect(reply).toMatchObject({ ok: false, details: expect.arrayContaining([expect.objectContaining({ path: 'items[0].targetIncline' })]) });
});

test('export sends an attachment with a safe file name and no server fields', async () => {
	const saved = await ctx.emit(client.socket, 'plans:save', { ...fixture('valid-intervals.json'), name: 'Hill/../repeats "fast"' });
	const res = await ctx.request('GET', `/api/plans/${saved.data.id}/export`, { headers: { cookie: client.cookie } });
	expect(res.status).toBe(200);
	expect(res.headers['content-type']).toMatch(/^application\/json/);
	expect(res.headers['content-disposition']).toBe('attachment; filename="Hill-repeats-fast.zwifit-plan.json"');
	expect(res.json.id).toBeUndefined();
	expect(res.json.createdAt).toBeUndefined();
	expect(res.json.name).toBe('Hill/../repeats "fast"');
});

test('import assigns a new id; re-importing an export gives a second identical plan', async () => {
	const saved = await ctx.emit(client.socket, 'plans:save', fixture('intervals-6x.json'));
	const exported = await ctx.request('GET', `/api/plans/${saved.data.id}/export`, { headers: { cookie: client.cookie } });
	const res = await ctx.request('POST', '/api/plans/import', { headers: { cookie: client.cookie }, body: exported.text });
	expect(res.status).toBe(201);
	expect(res.json.id).not.toBe(saved.data.id);
	const copy = (await ctx.emit(client.socket, 'plans:get', { id: res.json.id })).data;
	expect(copy.items).toEqual(saved.data.items);
	expect(copy.name).toBe('Intervals 6× (2)');
});

test('import rejects targetKph 99 with path items[0].targetKph', async () => {
	const plan = fixture('valid-intervals.json');
	plan.items[0].targetKph = 99;
	const res = await ctx.request('POST', '/api/plans/import', { headers: { cookie: client.cookie }, body: plan });
	expect(res.status).toBe(422);
	expect(res.json.details).toContainEqual(expect.objectContaining({ path: 'items[0].targetKph' }));
});

test('import over 1 MB is 413; between 256 KB and 1 MB reaches validation', async () => {
	const huge = { ...fixture('valid-intervals.json'), description: 'x'.repeat(1100 * 1024) };
	expect((await ctx.request('POST', '/api/plans/import', { headers: { cookie: client.cookie }, body: huge })).status).toBe(413);
	const big = { ...fixture('valid-intervals.json'), description: 'x'.repeat(400 * 1024) };
	const res = await ctx.request('POST', '/api/plans/import', { headers: { cookie: client.cookie }, body: big });
	expect(res.status).toBe(422);
	expect(res.json.details).toContainEqual(expect.objectContaining({ path: 'description', code: 'TOO_LONG' }));
});

test('unpaired requests are 401', async () => {
	const saved = await ctx.emit(client.socket, 'plans:save', fixture('valid-intervals.json'));
	expect((await ctx.request('GET', `/api/plans/${saved.data.id}/export`)).status).toBe(401);
	expect((await ctx.request('POST', '/api/plans/import', { body: fixture('valid-intervals.json') })).status).toBe(401);
});

test('the Demo plan is added once; once deleted it does not come back', async () => {
	const { createApp } = require('../../src/app');
	const os = require('os');
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zwifit-demo-'));
	const options = { dataDir: path.join(root, 'data'), legacyDir: root, simulate: true, disableBroadcast: true, disableSensors: true, printCode: () => {} };
	try {
		let app = await createApp(options);
		const demo = app.plansRepo.list().find(p => p.name === 'Demo');
		expect(demo).toBeDefined();
		expect(app.settingsRepo.get().migrations.demoPlanV1).toBe(true);
		await app.plansRepo.remove(demo.id);
		app = await createApp(options);
		expect(app.plansRepo.list()).toEqual([]);
	}
	finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test('a legacy routes.conf is imported once on first start and left untouched', async () => {
	await ctx.stop();
	const routes = path.join(__dirname, '..', 'fixtures', 'legacy', 'routes.conf');
	const before = fs.readFileSync(routes, 'utf8');
	ctx = await startApp({ legacyFiles: { 'routes.conf': routes } });
	expect(ctx.app.plansRepo.list().map(p => p.name).sort()).toEqual(['Hill mile repeats', 'Metric tempo']);
	expect(ctx.app.settingsRepo.get().migrations).toEqual({ routesV1: true });
	expect(fs.readFileSync(path.join(ctx.legacyDir, 'routes.conf'), 'utf8')).toBe(before);
	client = await ctx.pairedClient();
});
