const fs = require('fs');
const path = require('path');
const contracts = require('../../../src/contracts');

const fixture = name => JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'fixtures', 'plans', name), 'utf8'));
const ID = '01HZX3K9V7Q8R2M4N6P0S1T3W5';

test('every schema in src/contracts/schemas compiles', () => {
	const names = contracts.schemaNames();
	const files = fs.readdirSync(path.join(__dirname, '..', '..', '..', 'src', 'contracts', 'schemas'));
	expect(names).toHaveLength(files.length);
	expect(names).toEqual(expect.arrayContaining([
		'plan-file', 'settings', 'settings-write', 'pair-body', 'control-set', 'plans-get', 'plans-save',
		'plans-duplicate', 'plans-delete', 'playback-start', 'workouts-list', 'workouts-get',
		'workouts-samples', 'workouts-delete'
	]));
});

test('the spec copy of the plan schema matches the shipped one', () => {
	const shipped = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'contracts', 'schemas', 'plan-file.schema.json'), 'utf8');
	const spec = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'specs', '001-cross-platform-training-plans', 'contracts', 'plan-file.schema.json'), 'utf8');
	expect(JSON.parse(spec)).toEqual(JSON.parse(shipped));
});

test('a valid interval plan passes', () => {
	expect(contracts.validate('plan-file', fixture('valid-intervals.json'))).toEqual([]);
	expect(contracts.validate('plans-save', fixture('valid-intervals.json'))).toEqual([]);
});

test.each([
	['invalid-unknown-property.json', 'colour', 'UNKNOWN_PROPERTY'],
	['invalid-repeat-100.json', 'items[1].repeat', 'TOO_LARGE'],
	['invalid-nested-block.json', 'items[1].steps[0].kind', 'NOT_ALLOWED'],
	['invalid-seconds-zero.json', 'items[0].end.seconds', 'TOO_SMALL'],
	['invalid-incline-step.json', 'items[0].targetIncline', 'BAD_STEP'],
	['invalid-control-char-name.json', 'name', 'BAD_FORMAT'],
	['invalid-201-items.json', 'items', 'TOO_MANY']
])('%s fails at %s with %s', (file, expectedPath, code) => {
	const errors = contracts.validate('plan-file', fixture(file));
	expect(errors).toContainEqual(expect.objectContaining({ path: expectedPath, code }));
	for (const err of errors) {
		expect(typeof err.message).toBe('string');
	}
});

test('a step with a missing field reports one error at the exact path', () => {
	const plan = fixture('valid-intervals.json');
	delete plan.items[1].steps[1].targetIncline;
	expect(contracts.validate('plan-file', plan)).toEqual([
		{ path: 'items[1].steps[1].targetIncline', code: 'REQUIRED', message: '"targetIncline" is required.' }
	]);
});

test('end must match its type', () => {
	const plan = fixture('valid-intervals.json');
	plan.items[0].end = { type: 'time', metres: 400 };
	const errors = contracts.validate('plan-file', plan);
	expect(errors).toContainEqual(expect.objectContaining({ path: 'items[0].end.seconds', code: 'REQUIRED' }));
	expect(errors).toContainEqual(expect.objectContaining({ path: 'items[0].end.metres', code: 'UNKNOWN_PROPERTY' }));
});

test('entered value must match its form', () => {
	const plan = fixture('valid-intervals.json');
	plan.items[0].entered = { form: 'pace', unit: 'mph', value: 4 };
	const paths = contracts.validate('plan-file', plan).map(e => e.path);
	expect(paths).toEqual(expect.arrayContaining(['items[0].entered.unit', 'items[0].entered.value']));
});

describe('socket event payloads', () => {
	test.each([
		['plans-get', { id: ID }],
		['plans-delete', { id: ID }],
		['plans-duplicate', { id: ID, name: 'Copy' }],
		['playback-start', { planId: ID }],
		['workouts-list', {}],
		['workouts-list', { before: '2026-11-01T00:00:00Z', limit: 100 }],
		['workouts-get', { id: ID }],
		['workouts-samples', { id: ID, fromIndex: 0, limit: 3600 }],
		['workouts-delete', { id: ID }],
		['control-set', { kph: 10 }],
		['control-set', { incline: 2.5 }],
		['pair-body', { code: 'ABCD-1234', deviceName: 'Phone' }],
		['pair-body', { code: 'abcd1234' }],
		['settings-write', { metric: true, limits: { maxKph: 16 } }]
	])('%s accepts %j', (name, payload) => {
		expect(contracts.validate(name, payload)).toEqual([]);
	});

	test.each([
		['plans-get', { id: '../etc/passwd' }, 'id'],
		['plans-get', { id: ID, extra: 1 }, 'extra'],
		['workouts-samples', { id: ID, limit: 3601 }, 'limit'],
		['workouts-list', { limit: 0 }, 'limit'],
		['control-set', {}, ''],
		['control-set', { kph: 'fast' }, 'kph'],
		['pair-body', { code: 'ABC' }, 'code'],
		['pair-body', { code: 'ABCD1234', deviceName: 'x'.repeat(41) }, 'deviceName'],
		['settings-write', { treadmill: { bleActivation: 'x' } }, 'treadmill.bleActivation'],
		['settings-write', { server: { port: 80 } }, 'server.port'],
		['settings-write', { server: { tls: { certPath: '/x' } } }, 'server.tls'],
		['settings-write', { treadmill: { ip: 'http://evil/x' } }, 'treadmill.ip'],
		['settings-write', {}, '']
	])('%s rejects %j at "%s"', (name, payload, expectedPath) => {
		const errors = contracts.validate(name, payload);
		expect(errors.map(e => e.path)).toContain(expectedPath);
	});
});

test('unknown schema names throw', () => {
	expect(() => contracts.validate('nope', {})).toThrow('Unknown schema');
});
