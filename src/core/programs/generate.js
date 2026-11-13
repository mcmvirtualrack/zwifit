// Multi-week training programs (e.g. 16 weeks to a half marathon) generated from a goal, a race
// date, the days to run and an easy-run speed. Each run day carries a full treadmill workout in
// the plan "items" shape (steps with speed, incline and time), so it plays like any plan.
//
// Shape: base (aerobic, hills) → build (intervals, tempo) → peak (race-specific) → taper; every
// 4th week before the taper is an easier recovery week. Speeds are multiples of the easy speed
// and are clamped to the treadmill's limits.
//
// Paces come from either an easy speed or a target finish time. A target time sets race pace to
// distance ÷ time exactly and the easy speed is derived from it; a target the treadmill cannot
// run is refused (never capped). From an easy speed, the program reports the time it trains for.
const { AppError } = require('../../lib/errors');

const GOALS = {
	'5k': { label: '5K', metres: 5000, race: 1.33, easy: [30, 40], long: [40, 60], tempo: [15, 25], interval: { work: 180, rest: 120, reps: [5, 8] }, taperWeeks: 1 },
	'10k': { label: '10K', metres: 10000, race: 1.27, easy: [35, 45], long: [50, 75], tempo: [18, 30], interval: { work: 240, rest: 120, reps: [4, 7] }, taperWeeks: 1 },
	half: { label: 'Half marathon', metres: 21097, race: 1.18, easy: [40, 50], long: [60, 105], tempo: [20, 35], interval: { work: 360, rest: 120, reps: [4, 6] }, taperWeeks: 2 },
	marathon: { label: 'Marathon', metres: 42195, race: 1.12, easy: [45, 55], long: [75, 150], tempo: [25, 45], interval: { work: 480, rest: 150, reps: [3, 5] }, taperWeeks: 3 }
};

// Multiples of the easy speed.
const PACE = { recovery: 0.85, warm: 0.9, easy: 1, long: 0.97, tempo: 1.2, interval: 1.33, hill: 0.95, stride: 1.3 };
const HILL_EXTRA_INCLINE = 4;
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_EASY_KPH = 3;
const MAX_EASY_KPH = 20;

const lerp = ([from, to], p) => from + (to - from) * p;
const roundTo = (value, step) => Math.round(value / step) * step;
const toDate = iso => new Date(`${iso}T00:00:00Z`);
const isoDay = date => date.toISOString().slice(0, 10);

// Monday = 0 … Sunday = 6.
const weekdayOf = date => (date.getUTCDay() + 6) % 7;

function phaseOf(week, weeks, taperWeeks) {
	const training = weeks - taperWeeks;
	if (week > training) {
		return 'taper';
	}
	const share = week / training;
	return share <= 0.35 ? 'base' : share <= 0.8 ? 'build' : 'peak';
}

// Which session each run day gets, quality days spread out and the long run last.
function sessionsFor(count) {
	return {
		3: ['quality1', 'easy', 'long'],
		4: ['quality1', 'easy', 'quality2', 'long'],
		5: ['easy', 'quality1', 'easy', 'quality2', 'long'],
		6: ['easy', 'quality1', 'easy', 'quality2', 'easy', 'long']
	}[count];
}

function createBuilder({ easyKph, incline, limits }) {
	let n = 0;
	const minKph = Math.max(limits.minKph || 0, 0.5);
	const speed = factor => Math.min(Math.max(roundTo(easyKph * factor, 0.1), minKph), limits.maxKph);
	const slope = extra => Math.min(Math.max(roundTo(incline + extra, 0.5), limits.minIncline), limits.maxIncline);

	function step(label, factor, seconds, extraIncline = 0) {
		const kph = Number(speed(factor).toFixed(1));
		return {
			kind: 'step',
			id: `s${++n}`,
			label,
			targetKph: kph,
			entered: { form: 'speed', unit: 'kph', value: kph },
			targetIncline: slope(extraIncline),
			end: { type: 'time', seconds: Math.max(Math.round(seconds), 30) }
		};
	}

	function distance(label, factor, metres) {
		const s = step(label, factor, 60);
		s.end = { type: 'distance', metres };
		return s;
	}

	function block(label, repeat, steps) {
		return { kind: 'block', id: `b${++n}`, label, repeat, steps };
	}

	return { step, distance, block };
}

function workout(type, ctx) {
	const { goal, p, volume, b, race } = ctx;
	const minutes = m => Math.max(Math.round(m * volume), 10) * 60;
	const warm = () => b.step('Warm up', PACE.warm, 600);
	const cool = () => b.step('Cool down', PACE.recovery, 300);
	switch (type) {
		case 'easy':
			return { title: 'Easy run', description: 'Relaxed and conversational.', items: [b.step('Easy', PACE.easy, minutes(lerp(goal.easy, p)))] };
		case 'long':
			return { title: 'Long run', description: 'Steady and easy; builds endurance.', items: [b.step('Long run', PACE.long, minutes(lerp(goal.long, p)))] };
		case 'hills': {
			const reps = Math.round(lerp([5, 8], p));
			return {
				title: 'Hills',
				description: `${reps} × 2 min uphill, jog back easy.`,
				items: [warm(), b.block('Hills', reps, [b.step('Uphill', PACE.hill, 120, HILL_EXTRA_INCLINE), b.step('Recover', PACE.recovery, 120)]), cool()]
			};
		}
		case 'strides': {
			return {
				title: 'Easy + strides',
				description: 'Easy running, then 6 short quick strides.',
				items: [b.step('Easy', PACE.easy, minutes(lerp(goal.easy, p) * 0.8)), b.block('Strides', 6, [b.step('Stride', PACE.stride, 30), b.step('Walk / jog', PACE.recovery * 0.7, 60)]), cool()]
			};
		}
		case 'tempo': {
			const tempo = minutes(lerp(goal.tempo, p));
			return { title: 'Tempo', description: `${Math.round(tempo / 60)} min comfortably hard.`, items: [warm(), b.step('Tempo', PACE.tempo, tempo), cool()] };
		}
		case 'intervals': {
			const { work, rest, reps } = goal.interval;
			const count = Math.max(Math.round(lerp(reps, p) * Math.min(volume, 1)), 2);
			return {
				title: 'Intervals',
				description: `${count} × ${work / 60} min hard, ${rest / 60} min easy between.`,
				items: [warm(), b.block('Intervals', count, [b.step('Hard', PACE.interval, work), b.step('Recover', PACE.recovery, rest)]), cool()]
			};
		}
		case 'racePace': {
			const seconds = minutes(lerp(goal.tempo, p) * 1.2);
			return { title: 'Race pace', description: `${Math.round(seconds / 60)} min at goal race pace.`, items: [warm(), b.step('Race pace', race, seconds), cool()] };
		}
		case 'race':
			return { title: `Race: ${goal.label}`, description: 'Race day. Skip it here if you race outdoors.', items: [b.step('Warm up', PACE.warm, 600), b.distance(goal.label, race, goal.metres)] };
		case 'shakeout':
			return { title: 'Shake-out', description: 'Short and easy with a few strides.', items: [b.step('Easy', PACE.easy, 1200), b.block('Strides', 4, [b.step('Stride', PACE.stride, 20), b.step('Jog', PACE.recovery, 60)])] };
		default:
			throw new Error(`Unknown session ${type}`);
	}
}

// The workout type for each session slot, by phase (recovery weeks drop the second quality day).
function typeFor(slot, phase, recoveryWeek) {
	if (slot === 'easy' || slot === 'long') {
		return slot;
	}
	if (slot === 'quality2' && recoveryWeek) {
		return 'easy';
	}
	const table = {
		base: { quality1: 'hills', quality2: 'strides' },
		build: { quality1: 'intervals', quality2: 'tempo' },
		peak: { quality1: 'intervals', quality2: 'racePace' },
		taper: { quality1: 'intervals', quality2: 'racePace' }
	};
	return table[phase][slot];
}

// input: { goal, weeks, raceDate: "YYYY-MM-DD", runDays: [0-6, Monday = 0], easyKph | targetSeconds, incline? }
// limits: the treadmill's { minKph, maxKph, minIncline, maxIncline }.
const invalid = (code, message) => new AppError('INVALID', message, [{ path: 'targetSeconds', code, message }]);

const clock = seconds => {
	const s = Math.round(seconds);
	const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
	return `${Math.floor(s / 3600)}:${mm}:${String(s % 60).padStart(2, '0')}`;
};

// { easyKph, race } where race is the multiple of easyKph that runs the goal at the target time.
function pacesFromTarget(goal, targetSeconds, limits) {
	const raceKph = goal.metres / targetSeconds * 3.6;
	if (roundTo(raceKph, 0.1) > limits.maxKph) {
		throw invalid('TOO_FAST', `A ${goal.label} in ${clock(targetSeconds)} needs ${raceKph.toFixed(1)} km/h, faster than this treadmill's top speed of ${limits.maxKph} km/h.`);
	}
	const easyKph = roundTo(raceKph / goal.race, 0.1);
	if (easyKph < Math.max(MIN_EASY_KPH, limits.minKph || 0) || easyKph > MAX_EASY_KPH) {
		throw invalid('TOO_SLOW', `A ${goal.label} in ${clock(targetSeconds)} gives easy runs too slow to plan; pick a faster target.`);
	}
	return { easyKph: Number(easyKph.toFixed(1)), race: raceKph / easyKph };
}

// The finish time a program trains for: as entered, or from its race-day speed (older programs).
function targetOf(program) {
	if (program.targetSeconds) {
		return { targetSeconds: program.targetSeconds, targetFrom: program.targetFrom || 'time' };
	}
	const goal = GOALS[program.goal];
	const raceDay = (program.days || []).find(d => d.type === 'race');
	const step = raceDay && raceDay.items.find(i => i.end && i.end.type === 'distance');
	return step && goal ? { targetSeconds: Math.round(goal.metres / (step.targetKph / 3.6)), targetFrom: 'easy' } : null;
}

function generateProgram(input, limits) {
	const goal = GOALS[input.goal];
	const weeks = input.weeks;
	const runDays = [...new Set(input.runDays)].sort((a, b) => a - b);
	const sessions = sessionsFor(runDays.length);
	const fromTime = input.targetSeconds !== undefined && input.targetSeconds !== null;
	const { easyKph, race: raceFactor } = fromTime ? pacesFromTarget(goal, input.targetSeconds, limits) : { easyKph: input.easyKph, race: goal.race };
	const b = createBuilder({ easyKph, incline: input.incline ?? 1, limits });

	const race = toDate(input.raceDate);
	// Week 1 starts on the Monday (weeks - 1) weeks before the race week's Monday.
	const raceMonday = new Date(race.getTime() - weekdayOf(race) * DAY_MS);
	const start = new Date(raceMonday.getTime() - (weeks - 1) * 7 * DAY_MS);
	const trainingWeeks = weeks - goal.taperWeeks;

	const days = [];
	for (let week = 1; week <= weeks; week++) {
		const phase = phaseOf(week, weeks, goal.taperWeeks);
		const recoveryWeek = phase !== 'taper' && week % 4 === 0 && week < trainingWeeks;
		const p = Math.min((week - 1) / Math.max(trainingWeeks - 1, 1), 1);
		const taperStep = week - trainingWeeks;
		const volume = phase === 'taper' ? Math.max(0.75 - 0.2 * (taperStep - 1), 0.4) : recoveryWeek ? 0.75 : 1;
		const raceWeek = week === weeks;
		runDays.forEach((weekday, i) => {
			const date = new Date(start.getTime() + ((week - 1) * 7 + weekday) * DAY_MS);
			if (raceWeek && date > race) {
				return;
			}
			let type = typeFor(sessions[i], phase, recoveryWeek);
			if (raceWeek) {
				const isRace = isoDay(date) === input.raceDate;
				type = isRace ? 'race' : sessions[i] === 'long' || i === runDays.length - 1 ? 'shakeout' : type === 'intervals' ? 'tempo' : 'easy';
			}
			const w = workout(type, { goal, p, volume: raceWeek ? 0.5 : volume, b, race: raceFactor });
			days.push({ date: isoDay(date), week, weekday: DAY_NAMES[weekday], type, phase, ...w });
		});
		if (raceWeek && !runDays.includes(weekdayOf(race))) {
			const w = workout('race', { goal, p: 1, volume: 1, b, race: raceFactor });
			days.push({ date: input.raceDate, week, weekday: DAY_NAMES[weekdayOf(race)], type: 'race', phase, ...w });
		}
	}
	days.sort((a, c) => a.date.localeCompare(c.date));
	const program = {
		name: `${goal.label} · ${weeks} weeks`,
		goal: input.goal,
		weeks,
		raceDate: input.raceDate,
		startDate: isoDay(start),
		runDays,
		easyKph,
		incline: input.incline ?? 1,
		days
	};
	return fromTime
		? { ...program, targetSeconds: input.targetSeconds, targetFrom: 'time' }
		: { ...program, ...targetOf(program) };
}

module.exports = { generateProgram, targetOf, GOALS, DAY_NAMES };
