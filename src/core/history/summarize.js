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
	return { steps, totals };
}

const positive = values => values.filter(v => typeof v === 'number' && v > 0);

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
