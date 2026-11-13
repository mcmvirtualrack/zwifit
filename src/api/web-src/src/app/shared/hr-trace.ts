import { HrSample } from '../core/hr-history.service';

export interface HrTracePaths {
	line: string;
	area: string;
	min: number;
	max: number;
	// How much time the box spans (from the first reading, up to the window).
	spanMs: number;
}

export interface TracePoint {
	t: number;
	v: number | null;
}

const MIN_SPAN_BPM = 20;
export const MIN_SPAN_WATTS = 40;
const MIN_SPAN_MS = 30 * 1000;

// SVG paths for the heart-rate trace in a width × height box: time runs left (the first reading,
// or now − window once there is more) to right (now), so a fresh trace fills the card instead of
// hugging its right edge; bpm is scaled to the readings' own range (at least 20 bpm tall).
// Gaps (no pulse) break the line. Null when there are fewer than two readings.
export function hrTrace(samples: HrSample[], now: number, windowMs: number, width = 1000, height = 100): HrTracePaths | null {
	return trace(samples.map(s => ({ t: s.t, v: s.bpm })), now, windowMs, { width, height, minSpan: MIN_SPAN_BPM });
}

// The time a trace spans: from its first reading (at least 30 s), up to the window.
export function traceSpan(points: TracePoint[], now: number, windowMs: number): number | null {
	const first = points.find(p => p.v !== null && now - p.t <= windowMs);
	return first ? Math.min(windowMs, Math.max(MIN_SPAN_MS, now - first.t)) : null;
}

// The same for any metric (heart rate, power): minSpan is the smallest value range drawn, so a
// steady reading is a flat line in the middle; spanMs lines up several traces on one time axis.
export function trace(points: TracePoint[], now: number, windowMs: number,
	{ width = 1000, height = 100, minSpan, spanMs: fixedSpan }: { width?: number; height?: number; minSpan: number; spanMs?: number }): HrTracePaths | null {
	const readings = points.filter(s => s.v !== null && now - s.t <= windowMs);
	if (readings.length < 2) {
		return null;
	}
	const spanMs = fixedSpan ?? traceSpan(points, now, windowMs)!;
	const values = readings.map(s => s.v as number);
	const min = Math.min(...values);
	const max = Math.max(...values);
	const mid = (min + max) / 2;
	// Padding above and below: a fifth of the minimum range (4 bpm, 8 W).
	const span = Math.max(minSpan, max - min + (2 * minSpan) / 5);
	const low = mid - span / 2;
	const x = (t: number) => round(((t - (now - spanMs)) / spanMs) * width);
	const y = (bpm: number) => round(height - ((bpm - low) / span) * height);

	const runs: { x: number; y: number }[][] = [];
	let run: { x: number; y: number }[] = [];
	for (const s of points) {
		if (now - s.t > spanMs) {
			continue;
		}
		if (s.v === null) {
			if (run.length) {
				runs.push(run);
			}
			run = [];
			continue;
		}
		run.push({ x: x(s.t), y: y(s.v) });
	}
	if (run.length) {
		runs.push(run);
	}

	const drawn = runs.filter(r => r.length > 1);
	const line = drawn.map(r => r.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join('')).join('');
	const area = drawn.map(r => `M${r[0].x} ${height}` + r.map(p => `L${p.x} ${p.y}`).join('') + `L${r[r.length - 1].x} ${height}Z`).join('');
	return line ? { line, area, min, max, spanMs } : null;
}

const round = (n: number) => Math.round(n * 10) / 10;
