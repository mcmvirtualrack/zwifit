const limits = require('../../../src/core/limits');

test('defaults are 0–20 km/h and 0–15 % incline', () => {
	expect(limits.DEFAULT_LIMITS).toEqual({ minKph: 0, maxKph: 20, minIncline: 0, maxIncline: 15 });
});

test('effective limits are the intersection of settings and treadmill-reported limits', () => {
	const settings = { minKph: 0, maxKph: 20, minIncline: 0, maxIncline: 15 };
	expect(limits.effectiveLimits(settings, { minKph: 1, maxKph: 16, minIncline: -3, maxIncline: 12 }))
		.toEqual({ minKph: 1, maxKph: 16, minIncline: 0, maxIncline: 12 });
	expect(limits.effectiveLimits(settings, null)).toEqual(settings);
	expect(limits.effectiveLimits(undefined, undefined)).toEqual(limits.DEFAULT_LIMITS);
});

test('effective limits ignore non-numeric reported values', () => {
	expect(limits.effectiveLimits(limits.DEFAULT_LIMITS, { maxKph: 'fast', maxIncline: NaN }))
		.toEqual(limits.DEFAULT_LIMITS);
});

const L = { minKph: 0, maxKph: 20, minIncline: 0, maxIncline: 15 };

test('in-range targets pass', () => {
	expect(limits.checkTarget({ kph: 10, incline: 5 }, L)).toEqual([]);
	expect(limits.checkTarget({ kph: 20 }, L)).toEqual([]);
	expect(limits.checkTarget({ incline: 0 }, L)).toEqual([]);
});

test.each([
	[{ kph: 20.01 }, 'kph', 'ABOVE_MAX_SPEED'],
	[{ kph: -0.1 }, 'kph', 'BELOW_MIN_SPEED'],
	[{ incline: 15.5 }, 'incline', 'ABOVE_MAX_INCLINE'],
	[{ incline: -1 }, 'incline', 'BELOW_MIN_INCLINE'],
	[{ kph: 'ten' }, 'kph', 'NOT_A_NUMBER'],
	[{ kph: NaN }, 'kph', 'NOT_A_NUMBER'],
	[{ incline: Infinity }, 'incline', 'NOT_A_NUMBER']
])('%p is rejected with %s %s', (target, path, code) => {
	const errors = limits.checkTarget(target, L);
	expect(errors).toHaveLength(1);
	expect(errors[0]).toMatchObject({ path, code });
	expect(typeof errors[0].message).toBe('string');
});

test('checkTarget never returns a clamped value', () => {
	const target = { kph: 50, incline: 50 };
	const errors = limits.checkTarget(target, L);
	expect(errors.map(e => e.code)).toEqual(['ABOVE_MAX_SPEED', 'ABOVE_MAX_INCLINE']);
	expect(target).toEqual({ kph: 50, incline: 50 });
});

test('assertTarget throws an OUT_OF_RANGE AppError with details', () => {
	expect(() => limits.assertTarget({ kph: 30 }, L)).toThrow(expect.objectContaining({
		code: 'OUT_OF_RANGE',
		details: [expect.objectContaining({ path: 'kph', code: 'ABOVE_MAX_SPEED' })]
	}));
	expect(() => limits.assertTarget({ kph: 5 }, L)).not.toThrow();
});
