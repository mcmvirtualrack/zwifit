import { describe, expect, it } from 'vitest';
import { MIN_SPAN_WATTS, hrTrace, trace, traceSpan } from './hr-trace';

const MIN = 60 * 1000;
const now = 10 * MIN;

describe('hrTrace', () => {
	it('needs at least two readings', () => {
		expect(hrTrace([], now, 10 * MIN)).toBeNull();
		expect(hrTrace([{ t: now, bpm: 120 }, { t: now - 1000, bpm: null }], now, 10 * MIN)).toBeNull();
	});

	it('runs from the left edge (oldest) to the right edge (now), higher bpm higher up', () => {
		const p = hrTrace([{ t: 0, bpm: 100 }, { t: now, bpm: 140 }], now, 10 * MIN)!;
		expect(p.min).toBe(100);
		expect(p.max).toBe(140);
		const [start, end] = p.line.split('L');
		expect(start).toMatch(/^M0 /);
		expect(end).toMatch(/^1000 /);
		expect(Number(start.split(' ')[1])).toBeGreaterThan(Number(end.split(' ')[1]));
		expect(p.area).toMatch(/^M0 100L0 [\d.]+L1000 [\d.]+L1000 100Z$/);
	});

	it('a trace younger than the window still fills the box from the left', () => {
		const p = hrTrace([{ t: now - 2 * MIN, bpm: 100 }, { t: now - MIN, bpm: 120 }, { t: now, bpm: 110 }], now, 10 * MIN)!;
		expect(p.line).toMatch(/^M0 [\d.]+L500 [\d.]+L1000 /);
		expect(p.spanMs).toBe(2 * MIN);
	});

	it('a steady heart rate is a flat line in the middle, not stretched to the edges', () => {
		const p = hrTrace([{ t: now - 2000, bpm: 120 }, { t: now, bpm: 120 }], now, 10 * MIN)!;
		expect(p.line).toMatch(/ 50L/);
	});

	it('no pulse breaks the line, and readings older than the window are dropped', () => {
		const samples = [
			{ t: -MIN, bpm: 200 },
			{ t: 1 * MIN, bpm: 100 }, { t: 2 * MIN, bpm: 110 },
			{ t: 3 * MIN, bpm: null },
			{ t: 4 * MIN, bpm: 120 }, { t: 5 * MIN, bpm: 130 }
		];
		const p = hrTrace(samples, now, 10 * MIN)!;
		expect(p.max).toBe(130);
		expect(p.line.match(/M/g)).toHaveLength(2);
		expect(p.area.match(/Z/g)).toHaveLength(2);
	});

	it('power uses the same geometry with its own range, and a shared span lines traces up', () => {
		const power = [{ t: now - MIN, v: 200 }, { t: now, v: 260 }];
		expect(traceSpan(power, now, 10 * MIN)).toBe(MIN);
		const p = trace(power, now, 10 * MIN, { height: 46, minSpan: MIN_SPAN_WATTS, spanMs: 2 * MIN })!;
		expect(p).toMatchObject({ min: 200, max: 260, spanMs: 2 * MIN });
		// Starts halfway across: the shared axis spans 2 minutes, this trace only the last one.
		expect(p.line).toMatch(/^M500 [\d.]+L1000 /);
		expect(p.area).toMatch(/ 46Z$/);
		expect(traceSpan([{ t: now, v: null }], now, 10 * MIN)).toBeNull();
	});
});
