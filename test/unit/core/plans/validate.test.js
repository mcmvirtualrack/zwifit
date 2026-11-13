const fs = require('fs');
const path = require('path');
const { validatePlan, MAX_EXPANDED_STEPS } = require('../../../../src/core/plans/validate');

const LIMITS = { minKph: 0, maxKph: 20, minIncline: 0, maxIncline: 15 };
const fixture = name => JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'fixtures', 'plans', name), 'utf8'));
const plan = () => fixture('valid-intervals.json');
const codesAt = (p, limits = LIMITS) => validatePlan(p, { limits }).map(e => `${e.path}:${e.code}`);

test('the fixtures are valid', () => {
	expect(validatePlan(plan(), { limits: LIMITS })).toEqual([]);
	expect(validatePlan(fixture('intervals-6x.json'), { limits: LIMITS })).toEqual([]);
});

describe('name: "1–80 chars, trimmed, no control chars"', () => {
	test.each([
		['', 'name:TOO_SHORT'],
		['x'.repeat(81), 'name:TOO_LONG'],
		['Bad\u0007', 'name:BAD_FORMAT'],
		['  padded ', 'name:BAD_FORMAT']
	])('%p → %s', (name, expected) => {
		const p = plan();
		p.name = name;
		expect(codesAt(p)).toContain(expected);
	});
	test('80 chars is fine', () => {
		const p = plan();
		p.name = 'n'.repeat(80);
		expect(codesAt(p)).toEqual([]);
	});
});

test('description is 0–500 chars', () => {
	const p = plan();
	p.description = '';
	expect(codesAt(p)).toEqual([]);
	p.description = 'd'.repeat(501);
	expect(codesAt(p)).toContain('description:TOO_LONG');
});

test('items: 1–200, and repeats expand to at most 2000 steps', () => {
	const p = plan();
	p.items = [];
	expect(codesAt(p)).toContain('items:TOO_FEW');
	const q = plan();
	q.items = Array.from({ length: 21 }, (_, i) => ({ ...q.items[1], id: `b${i}`, repeat: 99, steps: q.items[1].steps.map((s, j) => ({ ...s, id: `b${i}s${j}` })) }));
	expect(codesAt(q)).toContain('items:TOO_MANY_STEPS');
	expect(MAX_EXPANDED_STEPS).toBe(2000);
});

test('step label is 0–40 chars', () => {
	const p = plan();
	p.items[0].label = 'l'.repeat(41);
	expect(codesAt(p)).toContain('items[0].label:TOO_LONG');
});

describe('targetKph: "within effective limits; > 0"', () => {
	test('above the limit is ABOVE_MAX_SPEED at the step path', () => {
		const p = plan();
		p.items[1].steps[0].targetKph = 25;
		p.items[1].steps[0].entered = { form: 'speed', unit: 'kph', value: 25 };
		expect(codesAt(p)).toContain('items[1].steps[0].targetKph:ABOVE_MAX_SPEED');
	});
	test('limits from the treadmill apply', () => {
		expect(codesAt(plan(), { ...LIMITS, maxKph: 10 })).toContain('items[1].steps[0].targetKph:ABOVE_MAX_SPEED');
	});
	test('0 is refused (use stop instead)', () => {
		const p = plan();
		p.items[0].targetKph = 0;
		expect(codesAt(p)).toContain('items[0].targetKph:TOO_SMALL');
	});
});

test('entered must round-trip to targetKph within 0.05 km/h', () => {
	const p = plan();
	p.items[0].targetKph = 6.48;
	expect(codesAt(p)).toEqual([]);
	p.items[0].targetKph = 6.6;
	expect(codesAt(p)).toContain('items[0].entered:ENTERED_MISMATCH');
});

describe('incline: "within effective limits, 0.5 % resolution"', () => {
	test.each([
		[16, 'items[0].targetIncline:ABOVE_MAX_INCLINE'],
		[-1, 'items[0].targetIncline:BELOW_MIN_INCLINE'],
		[2.3, 'items[0].targetIncline:BAD_STEP']
	])('%p → %s', (incline, expected) => {
		const p = plan();
		p.items[0].targetIncline = incline;
		expect(codesAt(p)).toContain(expected);
	});
	test('controlIncline false skips the incline limit check', () => {
		const p = plan();
		p.controlIncline = false;
		p.items[0].targetIncline = 16;
		expect(codesAt(p)).toEqual([]);
	});
});

test.each([
	[{ type: 'time', seconds: 0 }, 'items[0].end.seconds:TOO_SMALL'],
	[{ type: 'time', seconds: 21601 }, 'items[0].end.seconds:TOO_LARGE'],
	[{ type: 'distance', metres: 9 }, 'items[0].end.metres:TOO_SMALL'],
	[{ type: 'distance', metres: 100001 }, 'items[0].end.metres:TOO_LARGE']
])('end %j → %s', (end, expected) => {
	const p = plan();
	p.items[0].end = end;
	expect(codesAt(p)).toContain(expected);
});

test('block repeat is 1–99 and has 1–20 steps that do not nest', () => {
	const p = plan();
	p.items[1].repeat = 0;
	expect(codesAt(p)).toContain('items[1].repeat:TOO_SMALL');
	const q = plan();
	q.items[1].steps = Array.from({ length: 21 }, (_, i) => ({ ...q.items[1].steps[0], id: `x${i}` }));
	expect(codesAt(q)).toContain('items[1].steps:TOO_MANY');
	const r = plan();
	r.items[1].steps[0] = { kind: 'block', id: 'inner', repeat: 2, steps: [r.items[0]] };
	expect(codesAt(r)).toContain('items[1].steps[0].kind:NOT_ALLOWED');
});

test('step and block ids must be unique within the plan', () => {
	const p = plan();
	p.items[1].steps[1].id = 'warmup';
	expect(codesAt(p)).toContain('items[1].steps[1].id:DUPLICATE_ID');
});

test('errors are { path, code, message }', () => {
	const p = plan();
	p.items[0].targetIncline = 99;
	for (const err of validatePlan(p, { limits: LIMITS })) {
		expect(Object.keys(err).sort()).toEqual(['code', 'message', 'path']);
	}
});
