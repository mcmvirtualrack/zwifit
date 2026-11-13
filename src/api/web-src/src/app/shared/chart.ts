import { TracePoint } from './hr-trace';

export interface LanePaths {
	line: string;
	area: string;
	// The latest reading in the range and its height in the box (0 top … 100 bottom), for the value tag.
	last: number | null;
	lastY: number | null;
}

// Paths for one lane of a live chart in a 1000 × 100 box: time from `start` (left) to `end`
// (right) and values on a fixed scale from `min` (bottom) to `max` (top). Gaps (null) break the
// line; `step` draws a staircase (incline changes in steps).
export function lanePath(points: TracePoint[], start: number, end: number, min: number, max: number, { step = false } = {}): LanePaths {
	const span = Math.max(1, end - start);
	const x = (t: number) => round(((t - start) / span) * 1000);
	const y = (v: number) => round(Math.min(100, Math.max(0, ((max - v) / (max - min || 1)) * 100)));
	const runs: { x: number; y: number }[][] = [];
	let run: { x: number; y: number }[] = [];
	let last: number | null = null;
	for (const p of points) {
		if (p.t < start || p.t > end) {
			continue;
		}
		if (p.v === null) {
			if (run.length) {
				runs.push(run);
			}
			run = [];
			continue;
		}
		const point = { x: x(p.t), y: y(p.v) };
		if (step && run.length && run[run.length - 1].y !== point.y) {
			run.push({ x: point.x, y: run[run.length - 1].y });
		}
		run.push(point);
		last = p.v;
	}
	if (run.length) {
		runs.push(run);
	}
	const drawn = runs.filter(r => r.length > 1);
	const line = drawn.map(r => r.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join('')).join('');
	const area = drawn.map(r => `M${r[0].x} 100` + r.map(p => `L${p.x} ${p.y}`).join('') + `L${r[r.length - 1].x} 100Z`).join('');
	return { line, area, last, lastY: last === null ? null : y(last) };
}

// The smallest multiple of `step` at or above value.
export const ceilTo = (value: number, step: number) => Math.ceil(value / step) * step;
export const floorTo = (value: number, step: number) => Math.floor(value / step) * step;

// A scale that holds every reading, padded, at least `minSpan` tall and snapped to `step`.
export function scaleFor(values: number[], { floor, ceiling, minSpan, step }: { floor?: number; ceiling?: number; minSpan: number; step: number }): { min: number; max: number } {
	if (!values.length) {
		const min = floor ?? 0;
		return { min, max: ceiling ?? min + minSpan };
	}
	let min = floorTo(Math.min(...values) - step / 2, step);
	let max = ceilTo(Math.max(...values) + step / 2, step);
	if (floor !== undefined) {
		min = Math.min(min, floor);
	}
	if (ceiling !== undefined) {
		max = Math.max(max, ceiling);
	}
	if (max - min < minSpan) {
		const extra = (minSpan - (max - min)) / 2;
		min = floorTo(min - extra, step);
		max = ceilTo(max + extra, step);
	}
	return { min, max };
}

// m:ss or h:mm:ss
export function clock(seconds: number): string {
	const s = Math.max(0, Math.round(seconds));
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const ss = String(s % 60).padStart(2, '0');
	return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

// Six labels under a time axis: "−10:00 … now", or elapsed time "0:00 … 25:00" for a workout.
export function axisLabels(spanMs: number, elapsedFrom: number | null): string[] {
	return Array.from({ length: 6 }, (_, i) => {
		const seconds = (spanMs / 1000) * (i / 5);
		if (elapsedFrom !== null) {
			return clock(elapsedFrom + seconds);
		}
		return i === 5 ? 'now' : `−${clock(spanMs / 1000 - seconds)}`;
	});
}

const round = (n: number) => Math.round(n * 10) / 10;
