// Custom training programs: the user picks, week by week, which of their own plans to run on which
// weekday (programs:createCustom / programs:updateCustom). The result has the same shape as a
// generated program (src/core/programs/generate.js), so starting a day, progress and history work
// the same: each day keeps a copy of its plan's steps (`items`) and the plan it came from
// (`sourcePlanId`); starting it saves that copy as the day's own plan (`planId`).
const { AppError } = require('../../lib/errors');
const { DAY_NAMES } = require('./generate');

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_WEEKS = 52;
const isoDay = date => date.toISOString().slice(0, 10);
const invalid = (path, message) => new AppError('INVALID', message, [{ path, code: 'INVALID', message }]);

// The Monday of the week `date` (YYYY-MM-DD) falls in: week 1 always starts on a Monday.
function mondayOf(date) {
	const d = new Date(`${date}T00:00:00Z`);
	if (Number.isNaN(d.getTime()) || isoDay(d) !== date) {
		throw invalid('startDate', 'Pick a valid start date.');
	}
	return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY_MS);
}

// input: { name, startDate, weeks, days: [{ week, weekday (Monday = 0), planId }] }
// getPlan(id) returns the plan or throws NOT_FOUND.
function buildCustomProgram(input, getPlan) {
	const name = String(input.name || '').trim();
	if (!name) {
		throw invalid('name', 'Give the program a name.');
	}
	const weeks = input.weeks;
	if (!Number.isInteger(weeks) || weeks < 1 || weeks > MAX_WEEKS) {
		throw invalid('weeks', `A program has 1 to ${MAX_WEEKS} weeks.`);
	}
	const monday = mondayOf(input.startDate);
	const seen = new Set();
	const plans = new Map();
	const days = [];
	for (const [i, d] of (input.days || []).entries()) {
		if (d.week > weeks) {
			throw invalid(`days[${i}].week`, `Week ${d.week} is after the program's last week (${weeks}).`);
		}
		const key = `${d.week}:${d.weekday}`;
		if (seen.has(key)) {
			throw invalid(`days[${i}]`, `Week ${d.week} ${DAY_NAMES[d.weekday]} has two workouts. Pick one.`);
		}
		seen.add(key);
		if (!plans.has(d.planId)) {
			plans.set(d.planId, getPlan(d.planId));
		}
		const plan = plans.get(d.planId);
		days.push({
			date: isoDay(new Date(monday.getTime() + ((d.week - 1) * 7 + d.weekday) * DAY_MS)),
			week: d.week,
			weekday: DAY_NAMES[d.weekday],
			type: 'custom',
			phase: 'custom',
			title: plan.name,
			description: plan.description || '',
			items: plan.items,
			sourcePlanId: plan.id
		});
	}
	days.sort((a, b) => a.date.localeCompare(b.date));
	return {
		name,
		goal: 'custom',
		weeks,
		startDate: isoDay(monday),
		raceDate: null,
		runDays: [...new Set((input.days || []).map(d => d.weekday))].sort((a, b) => a - b),
		easyKph: null,
		days
	};
}

// After an edit, a day that still runs the same plan on the same date keeps the plan its workout
// was saved as (so its progress and history stay); any other day starts fresh.
function keepProgress(previous, next) {
	const before = new Map((previous.days || []).map(d => [d.date, d]));
	for (const day of next.days) {
		const old = before.get(day.date);
		if (old && old.planId && old.sourcePlanId === day.sourcePlanId) {
			day.planId = old.planId;
		}
	}
	return next;
}

module.exports = { buildCustomProgram, keepProgress, mondayOf, MAX_WEEKS };
