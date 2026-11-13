// Workout CSV export (contracts/workout-export-csv.md): UTF-8 BOM, CRLF, RFC 4180 quoting, one
// header, rows summary → steps → samples. Text cells are guarded against spreadsheet formulas.
const { kphToMph, metresToMiles, metresToKm } = require('../units');

const BOM = '﻿';
const FORMULA_START = /^[=+\-@\t\r]/;

function columns(metric) {
	const speed = metric ? 'kph' : 'mph';
	const distance = metric ? 'km' : 'mi';
	return ['record_type', 'time_utc', 'elapsed_s', 'step_index', 'step_label', 'repetition', `target_${speed}`,
		'target_incline_pct', `speed_${speed}`, 'incline_pct', `distance_${distance}`, 'hr_bpm', 'hr_max_bpm', 'event', 'estimated'];
}

// Text from users (plan name, labels): neutralise formulas, then quote per RFC 4180.
function textCell(value) {
	if (value === null || value === undefined) {
		return '';
	}
	let text = String(value);
	if (FORMULA_START.test(text)) {
		text = `'${text}`;
	}
	return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const numberCell = (value, places = 2) => (typeof value === 'number' && Number.isFinite(value) ? String(Math.round(value * 10 ** places) / 10 ** places) : '');

function toCsv(workout, samples, { metric }) {
	const speed = kph => numberCell(typeof kph === 'number' ? (metric ? kph : kphToMph(kph)) : null);
	const distance = metres => numberCell(typeof metres === 'number' ? (metric ? metresToKm(metres) : metresToMiles(metres)) : null, 3);
	const start = Date.parse(workout.startedAt);
	const rows = [columns(metric)];
	const stepStarts = new Map();
	for (const sample of samples) {
		if (!stepStarts.has(sample.flatIndex)) {
			stepStarts.set(sample.flatIndex, sample.t);
		}
	}
	const movingSamples = samples.filter(s => s.kph > 0);
	const avg = values => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

	rows.push([
		'summary', textCell(workout.startedAt), numberCell(workout.totals.seconds, 0), '', textCell(workout.planName), '', '', '',
		speed(avg(movingSamples.map(s => s.kph))), numberCell(avg(samples.map(s => s.incline)), 1), distance(workout.totals.metres),
		numberCell(workout.totals.avgHr ?? null, 0), numberCell(workout.totals.maxHr ?? null, 0), textCell(workout.endReason),
		samples.some(s => s.estimated) ? 'true' : 'false'
	]);
	for (const step of workout.steps) {
		rows.push([
			'step', textCell(stepStarts.get(step.flatIndex) || ''), numberCell(step.seconds, 0), String(step.flatIndex), textCell(step.label),
			String(step.repetition), speed(step.target.kph), numberCell(step.target.incline, 1), speed(step.actual.avgKph),
			numberCell(step.actual.avgIncline, 1), distance(step.metres), numberCell(step.avgHr ?? null, 0), numberCell(step.maxHr ?? null, 0),
			step.skipped ? 'skipped' : step.overridden ? 'overridden' : '', ''
		]);
	}
	for (const sample of samples) {
		rows.push([
			'sample', textCell(sample.t), numberCell((Date.parse(sample.t) - start) / 1000, 0), String(sample.flatIndex), '', '', '', '',
			speed(sample.kph), numberCell(sample.incline, 1), distance(sample.metres), numberCell(sample.hr ?? null, 0), '',
			textCell(sample.event || ''), sample.estimated ? 'true' : ''
		]);
	}
	return BOM + rows.map(row => row.join(',')).join('\r\n') + '\r\n';
}

function csvFileName(workout) {
	const date = workout.startedAt.slice(0, 10);
	const safe = String(workout.planName || 'workout').replace(/[^A-Za-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '') || 'workout';
	return `zwifit-${date}-${safe}`.slice(0, 60) + '.csv';
}

module.exports = { toCsv, csvFileName, columns };
