const { createOdometer, advanceOdometer, ramp, IDLE_RESET_MS } = require('../../../src/core/session');

test('distance and time accumulate only while moving', () => {
	let s = createOdometer();
	s = advanceOdometer(s, 0, 0);
	s = advanceOdometer(s, 12, 1000);
	expect(s).toMatchObject({ metres: 0, seconds: 0 });
	s = advanceOdometer(s, 12, 31000);
	expect(s.seconds).toBe(30);
	expect(s.metres).toBeCloseTo(100, 6);
	s = advanceOdometer(s, 0, 32000);
	s = advanceOdometer(s, 0, 600000);
	expect(s.seconds).toBe(30);
});

test('a stop shorter than an hour keeps the totals; a longer one resets them', () => {
	let s = createOdometer();
	s = advanceOdometer(s, 10, 0);
	s = advanceOdometer(s, 10, 36000);
	s = advanceOdometer(s, 0, 36000);
	s = advanceOdometer(s, 10, 36000 + IDLE_RESET_MS - 1);
	expect(s.metres).toBeCloseTo(100, 6);
	s = advanceOdometer(s, 0, 100000000);
	s = advanceOdometer(s, 10, 100000000 + IDLE_RESET_MS);
	expect(s).toMatchObject({ metres: 0, seconds: 0 });
});

test('advanceOdometer does not mutate its input', () => {
	const s = createOdometer();
	advanceOdometer(s, 10, 5);
	expect(s).toEqual(createOdometer());
});

test('ramp moves 20 % of the way and snaps when close', () => {
	expect(ramp(0, 10)).toBe(2);
	expect(ramp(9.99, 10)).toBe(10);
	expect(ramp(10, 0)).toBe(8);
});
