const { generateProgram, GOALS, targetOf } = require('../../../src/core/programs/generate');
const { validatePlan } = require('../../../src/core/plans/validate');
const { totals } = require('../../../src/core/plans/totals');

const LIMITS = { minKph: 0.8, maxKph: 20, minIncline: 0, maxIncline: 15 };
const half = { goal: 'half', weeks: 16, raceDate: '2027-03-07', runDays: [1, 3, 5, 6], easyKph: 10 };

const asPlan = day => ({ schemaVersion: 1, name: 'x', description: '', authoredUnits: 'metric', controlIncline: true, items: day.items });

test('16 weeks to a Sunday race: starts on a Monday 15 weeks before race week, race on race day', () => {
	const program = generateProgram(half, LIMITS);
	expect(program.startDate).toBe('2026-11-16');
	expect(new Date(`${program.startDate}T00:00:00Z`).getUTCDay()).toBe(1);
	expect(program.days.at(-1)).toMatchObject({ date: '2027-03-07', week: 16, type: 'race', weekday: 'Sun' });
	expect(new Set(program.days.map(d => d.week)).size).toBe(16);
	// 4 runs a week (the race week may differ).
	expect(program.days.filter(d => d.week === 5)).toHaveLength(4);
});

test('every workout is a valid plan within the treadmill limits', () => {
	for (const goal of Object.keys(GOALS)) {
		for (const runDays of [[1, 3, 6], [0, 1, 3, 5, 6], [0, 1, 2, 3, 5, 6]]) {
			const program = generateProgram({ ...half, goal, runDays, easyKph: 11 }, LIMITS);
			for (const day of program.days) {
				expect({ date: day.date, errors: validatePlan(asPlan(day), { limits: LIMITS }) }).toEqual({ date: day.date, errors: [] });
			}
		}
	}
});

test('phases: hills early, intervals and tempo in the build, race pace at the peak, shorter in the taper', () => {
	const program = generateProgram(half, LIMITS);
	const types = week => program.days.filter(d => d.week === week).map(d => d.type);
	expect(types(1)).toEqual(['hills', 'easy', 'strides', 'long']);
	expect(types(8)).toEqual(['intervals', 'easy', 'easy', 'long']);   // recovery week: no tempo
	expect(types(9)).toEqual(['intervals', 'easy', 'tempo', 'long']);
	expect(types(13)).toEqual(['intervals', 'easy', 'racePace', 'long']);
	const longSeconds = week => totals(asPlan(program.days.find(d => d.week === week && d.type === 'long'))).seconds;
	expect(longSeconds(13)).toBeGreaterThan(longSeconds(1));
	expect(longSeconds(15)).toBeLessThan(longSeconds(13));
});

test('speeds are multiples of the easy speed, clamped to the treadmill', () => {
	const program = generateProgram({ ...half, easyKph: 15 }, { ...LIMITS, maxKph: 16 });
	const speeds = program.days.flatMap(d => d.items.flatMap(i => (i.kind === 'block' ? i.steps : [i]).map(s => s.targetKph)));
	expect(Math.max(...speeds)).toBe(16);
	expect(speeds).toContain(15);
});

test('a race day that is not a run day is still added', () => {
	const program = generateProgram({ ...half, raceDate: '2027-03-06', runDays: [1, 3, 6] }, LIMITS);
	expect(program.days.at(-1)).toMatchObject({ date: '2027-03-06', type: 'race', weekday: 'Sat' });
	expect(program.days.filter(d => d.date > '2027-03-06')).toEqual([]);
});

describe('target finish time', () => {
	const raceStep = program => program.days.at(-1).items.find(i => i.end && i.end.type === 'distance');
	const fromTime = { goal: 'half', weeks: 16, raceDate: '2027-03-07', runDays: [1, 3, 5, 6], targetSeconds: 6300 };

	test('a target time sets race pace to distance ÷ time and derives the easy speed from it', () => {
		const program = generateProgram(fromTime, LIMITS);
		// 21.097 km in 1:45:00 = 12.06 km/h.
		expect(raceStep(program).targetKph).toBe(12.1);
		expect(program.easyKph).toBe(10.2);
		expect(program).toMatchObject({ targetSeconds: 6300, targetFrom: 'time' });
		const racePace = program.days.find(d => d.type === 'racePace');
		expect(racePace.items.find(i => i.label === 'Race pace').targetKph).toBe(12.1);
	});

	test('from an easy speed, the program reports the finish time it trains for', () => {
		const program = generateProgram(half, LIMITS);
		// Easy 10 km/h → race pace 11.8 km/h → 21.097 km in 6436 s.
		expect(raceStep(program).targetKph).toBe(11.8);
		expect(program).toMatchObject({ targetSeconds: 6436, targetFrom: 'easy' });
	});

	test('a target faster than the treadmill can run is refused, not capped', () => {
		expect(() => generateProgram({ ...fromTime, targetSeconds: 4000 }, { ...LIMITS, maxKph: 16 }))
			.toThrow(expect.objectContaining({ code: 'INVALID', details: [expect.objectContaining({ path: 'targetSeconds', code: 'TOO_FAST' })] }));
	});

	test('a target so slow the easy runs would be under 3 km/h is refused', () => {
		expect(() => generateProgram({ ...fromTime, goal: '5k', targetSeconds: 9000 }, LIMITS))
			.toThrow(expect.objectContaining({ code: 'INVALID', details: [expect.objectContaining({ path: 'targetSeconds', code: 'TOO_SLOW' })] }));
	});

	test('every workout from a target time is a valid plan within the treadmill limits', () => {
		for (const [goal, targetSeconds] of [['5k', 1500], ['10k', 3300], ['half', 7200], ['marathon', 14400]]) {
			const program = generateProgram({ ...fromTime, goal, targetSeconds }, LIMITS);
			for (const day of program.days) {
				expect(validatePlan(asPlan(day), { limits: LIMITS })).toEqual([]);
			}
		}
	});

	test('targetOf: programs saved before targets existed get one from their race-day speed', () => {
		const { targetSeconds, targetFrom, ...older } = generateProgram(half, LIMITS);
		expect(targetOf(older)).toEqual({ targetSeconds: 6436, targetFrom: 'easy' });
		expect(targetOf(generateProgram(fromTime, LIMITS))).toEqual({ targetSeconds: 6300, targetFrom: 'time' });
	});
});
