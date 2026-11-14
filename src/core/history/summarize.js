// Builds a workout's step results and totals from its samples alone (data-model.md "Workout"),
// so a crash-interrupted workout can be rebuilt exactly as a finished one is.
const { expand } = require('../plans/expand');

const round = (n, places = 2) => Math.round(n * 10 ** places) / 10 ** places;

function average(values) {
	return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function summarize({ planSnapshot, startedAt }, samples) {
	const flat = planSnapshot ? expand(planSnapshot) : [];
	const start = Date.parse(startedAt);
	const steps = [];
	const groups = [];
	for (const sample of samples) {
		const last = groups[groups.length - 1];
		if (!last || last.flatIndex !== sample.flatIndex) {
			groups.push({ flatIndex: sample.flatIndex, samples: [sample] });
		}
		else {
			last.samples.push(sample);
		}
	}
	groups.forEach((group, g) => {
		const entry = flat[group.flatIndex];
		const nextGroup = groups[g + 1];
		const firstT = Date.parse(group.samples[0].t);
		const endT = nextGroup ? Date.parse(nextGroup.samples[0].t) : Date.parse(group.samples[group.samples.length - 1].t);
		const previousMetres = g > 0 ? groups[g - 1].samples[groups[g - 1].samples.length - 1].metres : 0;
		const endMetres = nextGroup ? nextGroup.samples[0].metres : group.samples[group.samples.length - 1].metres;
		const moving = group.samples.filter(s => s.kph > 0);
		const hrs = group.samples.map(s => s.hr).filter(hr => typeof hr === 'number' && hr > 0);
		const seconds = Math.max(0, Math.round((endT - firstT) / 1000));
		const metres = round(Math.max(0, endMetres - previousMetres), 1);
		const result = {
			flatIndex: group.flatIndex,
			label: entry ? entry.step.label || '' : '',
			repetition: entry ? entry.repetition : 1,
			target: entry ? { kph: entry.step.targetKph, incline: entry.step.targetIncline } : { kph: null, incline: null },
			actual: {
				avgKph: round(average(moving.map(s => s.kph)) ?? 0),
				avgIncline: round(average(group.samples.map(s => s.incline)) ?? 0, 1)
			},
			seconds,
			metres,
			overridden: group.samples.some(s => s.event === 'override'),
			skipped: false
		};
		if (hrs.length) {
			result.avgHr = Math.round(average(hrs));
			result.maxHr = Math.max(...hrs);
		}
		const cadences = positive(group.samples.map(s => s.cadence));
		if (cadences.length) {
			result.avgCadence = Math.round(average(cadences));
		}
		const powers = positive(group.samples.map(s => s.power));
		if (powers.length) {
			result.avgPower = Math.round(average(powers));
		}
		// A step left before its end condition, when a later step was reached, was skipped.
		if (entry && nextGroup) {
			const end = entry.step.end;
			result.skipped = end.type === 'time' ? seconds < end.seconds - 1 : metres < end.metres - 5;
		}
		steps.push(result);
	});

	const lastSample = samples[samples.length - 1];
	const hrs = samples.map(s => s.hr).filter(hr => typeof hr === 'number' && hr > 0);
	const totals = {
		seconds: lastSample ? Math.max(0, Math.round((Date.parse(lastSample.t) - start) / 1000)) : 0,
		metres: lastSample ? round(lastSample.metres, 1) : 0
	};
	if (hrs.length) {
		totals.avgHr = Math.round(average(hrs));
		totals.maxHr = Math.max(...hrs);
	}
	const cadences = positive(samples.map(s => s.cadence));
	if (cadences.length) {
		totals.avgCadence = Math.round(average(cadences));
	}
	const powers = positive(samples.map(s => s.power));
	if (powers.length) {
		totals.avgPower = Math.round(average(powers));
		totals.maxPower = Math.max(...powers);
	}
	Object.assign(totals, paceTotals(samples, totals.metres));
	Object.assign(totals, inclineTotals(samples));
	return { steps, totals };
}

const positive = values => values.filter(v => typeof v === 'number' && v > 0);

// Moving time (s) — the seconds in which the distance grew, a gap over 5 s counting 5 —
// and the average speed over it (km/h), from which the page shows the average pace. Pauses and
// stops do not slow the average.
const MAX_GAP_S = 5;
function paceTotals(samples, metres) {
	let moving = 0;
	for (let i = 1; i < samples.length; i++) {
		if (samples[i].metres > samples[i - 1].metres) {
			moving += Math.min(MAX_GAP_S, Math.max(0, (Date.parse(samples[i].t) - Date.parse(samples[i - 1].t)) / 1000));
		}
	}
	if (!moving || !metres) {
		return {};
	}
	return { movingSeconds: Math.round(moving), avgKph: round((metres / moving) * 3.6) };
}

// Incline over the run, only when the belt was ever tilted: average and highest while moving (%),
// and the height climbed (m): each stretch of distance times the incline it was run at, uphill only.
function inclineTotals(samples) {
	if (!samples.some(s => typeof s.incline === 'number' && s.incline !== 0)) {
		return {};
	}
	const moving = samples.filter(s => s.kph > 0 && typeof s.incline === 'number');
	let climb = 0;
	for (let i = 1; i < samples.length; i++) {
		const prev = samples[i - 1];
		const run = samples[i].metres - prev.metres;
		if (run > 0 && prev.incline > 0) {
			climb += run * prev.incline / 100;
		}
	}
	return {
		avgIncline: round(average(moving.map(s => s.incline)) ?? 0, 1),
		maxIncline: round(Math.max(...(moving.length ? moving : samples).map(s => s.incline || 0)), 1),
		climbMetres: round(climb, 1)
	};
}

// NDJSON text → samples, ignoring a truncated last line (crash mid-write).
function parseSamples(text) {
	const samples = [];
	for (const line of text.split('\n')) {
		if (!line.trim()) {
			continue;
		}
		try {
			samples.push(JSON.parse(line));
		}
		catch {
			// partial line from a crash
		}
	}
	return samples;
}

module.exports = { summarize, parseSamples };
