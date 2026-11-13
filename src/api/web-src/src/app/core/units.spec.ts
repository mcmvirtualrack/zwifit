import { describe, expect, it } from 'vitest';
import { enteredToKph, formatDuration, kphToPace, parseDuration, parsePace } from './units';

describe('units (browser port of src/core/units.js)', () => {
	it('converts pace and speed like the server', () => {
		expect(enteredToKph({ form: 'pace', unit: 'min/mi', value: '10:00' })!).toBeCloseTo(9.656, 3);
		expect(enteredToKph({ form: 'speed', unit: 'mph', value: 6 })!).toBeCloseTo(9.656, 3);
		expect(enteredToKph({ form: 'pace', unit: 'min/km', value: '6:00' })).toBe(10);
		expect(kphToPace(10, 'min/km')).toBe('6:00');
		expect(kphToPace(0, 'min/km')).toBeNull();
	});

	it('rejects bad paces', () => {
		for (const bad of ['0:00', '1:60', 'abc', '100:00']) {
			expect(parsePace(bad)).toBeNull();
		}
	});

	it('formats and parses durations', () => {
		expect(formatDuration(3725)).toBe('1:02:05');
		expect(formatDuration(125)).toBe('2:05');
		expect(parseDuration('1:02:05')).toBe(3725);
		expect(parseDuration('5:00')).toBe(300);
		expect(parseDuration('5:60')).toBeNull();
		expect(parseDuration('0')).toBeNull();
	});
});
