const { demoPlan } = require('../../../../src/core/plans/demo');
const { validatePlan } = require('../../../../src/core/plans/validate');
const { totals } = require('../../../../src/core/plans/totals');
const { expand } = require('../../../../src/core/plans/expand');
const contracts = require('../../../../src/contracts');
const { DEFAULT_LIMITS } = require('../../../../src/core/limits');

test.each([true, false])('the demo plan (metric=%s) is a valid plan file within the default limits', metric => {
	const plan = demoPlan({ metric });
	expect(contracts.validate('plan-file', plan)).toEqual([]);
	expect(validatePlan(plan, { limits: DEFAULT_LIMITS })).toEqual([]);
	expect(plan.authoredUnits).toBe(metric ? 'metric' : 'imperial');
});

test('it uses speed and pace, time and distance, and a repeat block, and lasts about 12 minutes', () => {
	const plan = demoPlan({ metric: true });
	const steps = expand(plan);
	expect(steps).toHaveLength(9);
	expect(new Set(steps.map(s => s.step.entered.form))).toEqual(new Set(['speed', 'pace']));
	expect(new Set(steps.map(s => s.step.end.type))).toEqual(new Set(['time', 'distance']));
	const { seconds } = totals(plan);
	expect(seconds).toBeGreaterThan(10 * 60);
	expect(seconds).toBeLessThan(14 * 60);
	// Gentle: nothing faster than a brisk walk.
	expect(Math.max(...steps.map(s => s.step.targetKph))).toBeLessThanOrEqual(6.5);
});
