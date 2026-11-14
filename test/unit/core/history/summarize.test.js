// Incline totals in a workout summary (average, highest, height climbed).
const { summarize } = require('../../../../src/core/history/summarize');

const t0 = Date.parse('2026-11-01T10:00:00Z');
const header = { planSnapshot: null, startedAt: new Date(t0).toISOString() };
// One sample a second at 10.8 km/h (3 m/s), with the given incline per second.
const run = inclines => inclines.map((incline, i) => ({ t: new Date(t0 + i * 1000).toISOString(), kph: 10.8, incline, metres: i * 3, hr: null, flatIndex: 0 }));

test('average and highest incline while moving, and the height climbed', () => {
	// 100 s at 2 %, then 100 s at 6 %: 300 m × 2 % + 300 m × 6 % = 24 m climbed.
	const samples = run([...Array(101).fill(2), ...Array(100).fill(6)]);
	const { totals } = summarize(header, samples);
	expect(totals).toMatchObject({ avgIncline: 4, maxIncline: 6 });
	expect(totals.climbMetres).toBeCloseTo(24, 0);
});

test('downhill stretches do not take height away; a flat run has no incline totals', () => {
	const { totals } = summarize(header, run([...Array(101).fill(3), ...Array(100).fill(-2)]));
	expect(totals.climbMetres).toBeCloseTo(9, 0);
	expect(totals.maxIncline).toBe(3);
	expect(summarize(header, run(Array(50).fill(0))).totals).not.toHaveProperty('avgIncline');
});

test('stopped seconds do not count toward the average', () => {
	const samples = run(Array(61).fill(5));
	samples.push({ ...samples.at(-1), t: new Date(t0 + 61000).toISOString(), kph: 0, incline: 0 });
	expect(summarize(header, samples).totals.avgIncline).toBe(5);
});
