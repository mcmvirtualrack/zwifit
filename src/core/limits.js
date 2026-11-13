// Speed and incline limits. Out-of-range targets are rejected, never clamped (spec FR-011).
const { AppError } = require('../lib/errors');

const DEFAULT_LIMITS = Object.freeze({ minKph: 0, maxKph: 20, minIncline: 0, maxIncline: 15 });

const isNumber = value => typeof value === 'number' && Number.isFinite(value);

// Intersection of configured limits and limits the treadmill reports.
function effectiveLimits(settings, reported) {
	const out = { ...DEFAULT_LIMITS };
	for (const key of Object.keys(out)) {
		if (settings && isNumber(settings[key])) {
			out[key] = settings[key];
		}
	}
	if (reported) {
		for (const key of ['minKph', 'minIncline']) {
			if (isNumber(reported[key])) {
				out[key] = Math.max(out[key], reported[key]);
			}
		}
		for (const key of ['maxKph', 'maxIncline']) {
			if (isNumber(reported[key])) {
				out[key] = Math.min(out[key], reported[key]);
			}
		}
	}
	return out;
}

const CHECKS = [
	{ path: 'kph', min: 'minKph', max: 'maxKph', what: 'Speed', unit: ' km/h', above: 'ABOVE_MAX_SPEED', below: 'BELOW_MIN_SPEED' },
	{ path: 'incline', min: 'minIncline', max: 'maxIncline', what: 'Incline', unit: '%', above: 'ABOVE_MAX_INCLINE', below: 'BELOW_MIN_INCLINE' }
];

// Returns [{ path, code, message }]; empty when target ({ kph?, incline? }) is within limits.
function checkTarget(target, limits) {
	const errors = [];
	for (const check of CHECKS) {
		if (!(check.path in target) || target[check.path] === undefined) {
			continue;
		}
		const value = target[check.path];
		if (!isNumber(value)) {
			errors.push({ path: check.path, code: 'NOT_A_NUMBER', message: `${check.what} must be a number.` });
		}
		else if (value > limits[check.max]) {
			errors.push({ path: check.path, code: check.above, message: `${check.what} ${value}${check.unit} is above the maximum of ${limits[check.max]}${check.unit}.` });
		}
		else if (value < limits[check.min]) {
			errors.push({ path: check.path, code: check.below, message: `${check.what} ${value}${check.unit} is below the minimum of ${limits[check.min]}${check.unit}.` });
		}
	}
	return errors;
}

function assertTarget(target, limits) {
	const errors = checkTarget(target, limits);
	if (errors.length) {
		throw new AppError('OUT_OF_RANGE', 'That is outside the treadmill limits.', errors);
	}
}

module.exports = { DEFAULT_LIMITS, effectiveLimits, checkTarget, assertTarget };
