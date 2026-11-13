const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { migrateRoutes, parseLine } = require('../../../../src/core/plans/migrateRoutes');
const { validatePlan } = require('../../../../src/core/plans/validate');
const { milesToMetres, mphToKph } = require('../../../../src/core/units');

const FIXTURE = path.join(__dirname, '..', '..', '..', 'fixtures', 'legacy', 'routes.conf');

let result;
let before;
beforeAll(() => {
	before = fs.readFileSync(FIXTURE, 'utf8');
	result = migrateRoutes(yaml.load(before));
});

test('every help-text format parses', () => {
	expect(parseLine('1 Mile: 1% Incline')).toMatchObject({ point: { type: 'distance' }, changes: [{ incline: 1 }] });
	expect(parseLine('2.6 Miles: 6.2 MPH').changes[0].kph).toBeCloseTo(mphToKph(6.2), 6);
	expect(parseLine('0:30:00: 10% Incline')).toMatchObject({ point: { type: 'time', value: 1800 }, changes: [{ incline: 10 }] });
	expect(parseLine('5 Miles: 2% Incline, 4 MPH').changes).toHaveLength(2);
	expect(parseLine('2 Kilometers: 10 KPH')).toMatchObject({ point: { type: 'distance', value: 2000 }, changes: [{ kph: 10 }] });
	expect(parseLine('5 km: 1.5% Incline').point.value).toBe(5000);
	expect(parseLine('nonsense')).toBeNull();
	expect(parseLine('1 Furlong: 4 MPH')).toBeNull();
});

test('cumulative points become consecutive steps whose speed and incline carry forward', () => {
	const hill = result.plans.find(p => p.name === 'Hill mile repeats');
	const steps = hill.items;
	expect(steps).toHaveLength(4);
	expect(steps[0]).toMatchObject({ targetIncline: 1, entered: { form: 'speed', unit: 'mph', value: 6 }, end: { type: 'distance' } });
	expect(steps[0].end.metres).toBeCloseTo(milesToMetres(1), 0);
	expect(steps[1]).toMatchObject({ targetIncline: 1, entered: { value: 6.2 } });
	expect(steps[1].end.metres).toBeCloseTo(milesToMetres(1.6), 0);
	// 2.6 mi at 6 / 6.2 mph took ~25.5 min, so the 30-minute point is a ~4.5-minute time step.
	expect(steps[2]).toMatchObject({ targetIncline: 10, entered: { value: 6.2 }, end: { type: 'time' } });
	expect(steps[2].end.seconds).toBeGreaterThan(200);
	expect(steps[2].end.seconds).toBeLessThan(330);
	expect(steps[3]).toMatchObject({ targetIncline: 2, entered: { value: 4 } });
	expect(hill.authoredUnits).toBe('imperial');
});

test('unparseable lines are reported with line numbers and the rest still migrates', () => {
	const tempo = result.plans.find(p => p.name === 'Metric tempo');
	expect(tempo.items.map(s => s.entered.value)).toEqual([10, 10, 8]);
	expect(result.problems).toContainEqual(expect.objectContaining({ route: 'Metric tempo', line: 3, message: 'Could not understand this line.' }));
});

test('a route with no speed is reported, not turned into a broken plan', () => {
	expect(result.plans.find(p => p.name === 'No speed at all')).toBeUndefined();
	expect(result.problems).toContainEqual(expect.objectContaining({ route: 'No speed at all', message: 'The route never sets a speed.' }));
});

test('every migrated plan passes validation', () => {
	expect(result.plans).toHaveLength(2);
	for (const plan of result.plans) {
		expect(validatePlan(plan, { limits: { minKph: 0, maxKph: 20, minIncline: 0, maxIncline: 15 } })).toEqual([]);
	}
});

test('the legacy file is untouched', () => {
	expect(fs.readFileSync(FIXTURE, 'utf8')).toBe(before);
});

test('points that go backwards are reported', () => {
	const { plans, problems } = migrateRoutes({ list: [{ name: 'Back', steps: '2 Miles: 5 MPH\n1 Mile: 6 MPH' }] });
	expect(plans[0].items).toHaveLength(1);
	expect(problems).toContainEqual(expect.objectContaining({ line: 2, message: 'This point is not after the previous one.' }));
});
