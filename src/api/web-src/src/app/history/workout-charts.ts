// Geometry for the workout charts (pace, heart rate, cadence, power, incline over time or distance): stacked
// small multiples that share one x axis, each with its own y scale (never two scales on one chart).

export interface ChartSample {
	t: string;
	kph: number;
	metres: number;
	hr: number | null;
	cadence?: number;
	power?: number;
	incline?: number;
}

export type XAxis = 'time' | 'distance';
export type Metric = 'pace' | 'hr' | 'cadence' | 'power' | 'incline';

export interface Series {
	metric: Metric;
	line: string;
	// y-axis bounds in the metric's own units (pace in seconds per km or mile).
	top: number;
	bottom: number;
}

export const CHART_W = 1000;
export const CHART_H = 100;

const SPAN_MIN: Record<Metric, number> = { pace: 60, hr: 20, cadence: 20, power: 40, incline: 2 };

// x for each sample on 0..CHART_W, by elapsed seconds or by metres.
export function xPositions(samples: ChartSample[], axis: XAxis): number[] {
	if (!samples.length) {
		return [];
	}
	const start = Date.parse(samples[0].t);
	const raw = samples.map(s => (axis === 'time' ? (Date.parse(s.t) - start) / 1000 : s.metres));
	const max = Math.max(...raw) || 1;
	return raw.map(v => round((v / max) * CHART_W));
}

// The value plotted for a metric, or null where there is none (a gap). Pace only while moving;
// metresPerUnit is 1000 (min/km) or 1609.344 (min/mi).
export function valueOf(s: ChartSample, metric: Metric, metresPerUnit: number): number | null {
	if (metric === 'pace') {
		return s.kph > 0.5 ? (metresPerUnit / 1000) * (3600 / s.kph) : null;
	}
	if (metric === 'hr') {
		return s.hr && s.hr > 0 ? s.hr : null;
	}
	if (metric === 'power') {
		return s.power && s.power > 0 ? s.power : null;
	}
	if (metric === 'incline') {
		return typeof s.incline === 'number' ? s.incline : null;
	}
	return s.cadence && s.cadence > 0 ? s.cadence : null;
}

// One line per run of values; pace is drawn faster-is-higher (top = fastest), like running apps.
export function series(samples: ChartSample[], xs: number[], metric: Metric, metresPerUnit: number): Series | null {
	const values = samples.map(s => valueOf(s, metric, metresPerUnit));
	const present = values.filter((v): v is number => v !== null);
	if (present.length < 2) {
		return null;
	}
	let low = Math.min(...present);
	let high = Math.max(...present);
	const pad = Math.max(SPAN_MIN[metric] - (high - low), 0) / 2 + (high - low) * 0.08;
	low -= pad;
	high += pad;
	const invert = metric === 'pace';
	const y = (v: number) => round(invert ? ((v - low) / (high - low)) * CHART_H : CHART_H - ((v - low) / (high - low)) * CHART_H);
	let line = '';
	let drawing = false;
	values.forEach((v, i) => {
		if (v === null) {
			drawing = false;
			return;
		}
		line += `${drawing ? 'L' : 'M'}${xs[i]} ${y(v)}`;
		drawing = true;
	});
	return { metric, line, top: invert ? low : high, bottom: invert ? high : low };
}

// Index of the sample nearest to an x position (0..CHART_W).
export function nearestIndex(xs: number[], x: number): number {
	let best = 0;
	for (let i = 1; i < xs.length; i++) {
		if (Math.abs(xs[i] - x) < Math.abs(xs[best] - x)) {
			best = i;
		}
	}
	return best;
}

const round = (n: number) => Math.round(n * 10) / 10;
