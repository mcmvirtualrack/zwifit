import { describe, expect, it } from 'vitest';
import { ChartSample, nearestIndex, series, valueOf, xPositions } from './workout-charts';

const start = Date.parse('2026-11-01T06:00:00Z');
const sample = (s: number, kph: number, metres: number, hr: number | null, cadence?: number): ChartSample =>
	({ t: new Date(start + s * 1000).toISOString(), kph, metres, hr, ...(cadence ? { cadence } : {}) });

describe('workout charts', () => {
	const samples = [sample(0, 6, 0, 100), sample(60, 6, 100, 110), sample(90, 0, 100, 112), sample(120, 12, 200, 150, 170)];

	it('places samples by time or by distance on the shared axis', () => {
		expect(xPositions(samples, 'time')).toEqual([0, 500, 750, 1000]);
		expect(xPositions(samples, 'distance')).toEqual([0, 500, 500, 1000]);
	});

	it('pace is minutes per km or mile and missing while stopped; hr and cadence only when reported', () => {
		expect(valueOf(samples[0], 'pace', 1000)).toBe(600);
		expect(valueOf(samples[0], 'pace', 1609.344)).toBeCloseTo(965.6, 1);
		expect(valueOf(samples[2], 'pace', 1000)).toBeNull();
		expect(valueOf(samples[0], 'cadence', 1000)).toBeNull();
		expect(valueOf(samples[3], 'cadence', 1000)).toBe(170);
		expect(valueOf(samples[3], 'power', 1000)).toBeNull();
		expect(valueOf({ ...samples[3], power: 245 }, 'power', 1000)).toBe(245);
	});

	it('pace is drawn faster-is-higher and breaks where the belt stopped', () => {
		const pace = series(samples, xPositions(samples, 'time'), 'pace', 1000)!;
		expect(pace.top).toBeLessThan(pace.bottom);
		expect(pace.line.match(/M/g)).toHaveLength(2);
		const ys = [...pace.line.matchAll(/[ML][\d.]+ ([\d.]+)/g)].map(m => Number(m[1]));
		expect(ys[ys.length - 1]).toBeLessThan(ys[0]);
	});

	it('a metric with fewer than two values has no chart', () => {
		expect(series(samples, xPositions(samples, 'time'), 'cadence', 1000)).toBeNull();
	});

	it('finds the nearest sample to a pointer position', () => {
		expect(nearestIndex([0, 500, 750, 1000], 700)).toBe(2);
		expect(nearestIndex([0, 500, 750, 1000], 0)).toBe(0);
	});
});
