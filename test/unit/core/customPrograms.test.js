// Custom training programs built week by week from the user's own plans.
const { buildCustomProgram, keepProgress, mondayOf } = require('../../../src/core/programs/custom');

const PLAN_A = '01HZX3K9V7Q8R2M4N6P0S1T3WA';
const PLAN_B = '01HZX3K9V7Q8R2M4N6P0S1T3WB';
const step = (kph, seconds) => ({ kind: 'step', id: `s${kph}`, targetKph: kph, entered: { form: 'speed', unit: 'kph', value: kph }, targetIncline: 1, end: { type: 'time', seconds } });
const plans = {
	[PLAN_A]: { id: PLAN_A, name: 'Easy 30', description: 'Relaxed', items: [step(9, 1800)] },
	[PLAN_B]: { id: PLAN_B, name: '6 × 400 m', items: [step(14, 90)] }
};
const getPlan = id => {
	if (!plans[id]) {
		throw Object.assign(new Error('No such plan.'), { code: 'NOT_FOUND' });
	}
	return plans[id];
};

test('days land on the right dates from the Monday of the start week, sorted, with the plan copied in', () => {
	// Wednesday 19 Nov 2026 → week 1 starts Monday 16 Nov.
	const program = buildCustomProgram({
		name: '  My 16 weeks ', startDate: '2026-11-19', weeks: 16,
		days: [{ week: 2, weekday: 5, planId: PLAN_B }, { week: 1, weekday: 0, planId: PLAN_A }, { week: 16, weekday: 6, planId: PLAN_A }]
	}, getPlan);
	expect(program).toMatchObject({ name: 'My 16 weeks', goal: 'custom', weeks: 16, startDate: '2026-11-16', raceDate: null, runDays: [0, 5, 6] });
	expect(program.days.map(d => [d.date, d.week, d.weekday, d.title])).toEqual([
		['2026-11-16', 1, 'Mon', 'Easy 30'],
		['2026-11-28', 2, 'Sat', '6 × 400 m'],
		['2027-03-07', 16, 'Sun', 'Easy 30']
	]);
	expect(program.days[0]).toMatchObject({ type: 'custom', description: 'Relaxed', sourcePlanId: PLAN_A, items: plans[PLAN_A].items });
	expect(program.days[1].description).toBe('');
});

test('mistakes are refused: a day after the last week, two workouts on one day, a missing plan, a bad date', () => {
	const base = { name: 'P', startDate: '2026-11-16', weeks: 4 };
	expect(() => buildCustomProgram({ ...base, days: [{ week: 5, weekday: 0, planId: PLAN_A }] }, getPlan)).toThrow(/after the program's last week/);
	expect(() => buildCustomProgram({ ...base, days: [{ week: 1, weekday: 2, planId: PLAN_A }, { week: 1, weekday: 2, planId: PLAN_B }] }, getPlan)).toThrow(/two workouts/);
	expect(() => buildCustomProgram({ ...base, days: [{ week: 1, weekday: 2, planId: '01HZX3K9V7Q8R2M4N6P0S1T3WC' }] }, getPlan)).toThrow(/No such plan/);
	expect(() => buildCustomProgram({ ...base, startDate: '2026-02-30', days: [] }, getPlan)).toThrow(/valid start date/);
	expect(() => buildCustomProgram({ ...base, weeks: 53, days: [] }, getPlan)).toThrow(/1 to 52 weeks/);
	expect(() => buildCustomProgram({ ...base, name: '   ', days: [] }, getPlan)).toThrow(/name/);
});

test('an empty program (all rest) is allowed, and the start snaps to Monday', () => {
	expect(mondayOf('2026-11-22').toISOString().slice(0, 10)).toBe('2026-11-16');
	expect(buildCustomProgram({ name: 'Later', startDate: '2026-11-22', weeks: 1, days: [] }, getPlan)).toMatchObject({ days: [], runDays: [], startDate: '2026-11-16' });
});

test('after an edit, days with the same plan on the same date keep their saved workout', () => {
	const input = { name: 'P', startDate: '2026-11-16', weeks: 2, days: [{ week: 1, weekday: 0, planId: PLAN_A }, { week: 1, weekday: 2, planId: PLAN_B }] };
	const before = buildCustomProgram(input, getPlan);
	before.days[0].planId = '01HZX3K9V7Q8R2M4N6P0S1T3W1';
	before.days[1].planId = '01HZX3K9V7Q8R2M4N6P0S1T3W2';
	// Monday unchanged; Wednesday swapped to plan A; a new Friday.
	const next = buildCustomProgram({ ...input, days: [{ week: 1, weekday: 0, planId: PLAN_A }, { week: 1, weekday: 2, planId: PLAN_A }, { week: 1, weekday: 4, planId: PLAN_B }] }, getPlan);
	const kept = keepProgress(before, next);
	expect(kept.days.map(d => d.planId)).toEqual(['01HZX3K9V7Q8R2M4N6P0S1T3W1', undefined, undefined]);
});
