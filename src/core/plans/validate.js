// Full plan validation (data-model.md "Training Plan"): the plan-file schema plus the rules a
// schema can't express. Runs on save, import, load and right before playback.
const contracts = require('../../contracts');
const { checkTarget } = require('../limits');
const { enteredMatches } = require('../units');
const { expandedCount } = require('./expand');

const MAX_EXPANDED_STEPS = 2000;

const CODE_PATHS = { kph: 'targetKph', incline: 'targetIncline' };

function eachStep(plan, visit) {
	plan.items.forEach((item, i) => {
		if (item.kind === 'block') {
			item.steps.forEach((step, j) => visit(step, `items[${i}].steps[${j}]`));
		}
		else {
			visit(item, `items[${i}]`);
		}
	});
}

// → [{ path, code, message }]. `limits` are the effective treadmill limits.
function validatePlan(plan, { limits } = {}) {
	const errors = contracts.validate('plan-file', plan);
	if (errors.length) {
		return errors;
	}
	if (plan.name.trim() !== plan.name || !plan.name.trim()) {
		errors.push({ path: 'name', code: 'BAD_FORMAT', message: 'Name must not start or end with spaces.' });
	}
	if (expandedCount(plan) > MAX_EXPANDED_STEPS) {
		errors.push({ path: 'items', code: 'TOO_MANY_STEPS', message: `Repeats expand to more than ${MAX_EXPANDED_STEPS} steps.` });
	}

	const ids = new Map();
	const noteId = (id, itemPath) => {
		if (ids.has(id)) {
			errors.push({ path: `${itemPath}.id`, code: 'DUPLICATE_ID', message: `Id "${id}" is used more than once.` });
		}
		else {
			ids.set(id, itemPath);
		}
	};
	plan.items.forEach((item, i) => {
		noteId(item.id, `items[${i}]`);
		if (item.kind === 'block') {
			item.steps.forEach((step, j) => noteId(step.id, `items[${i}].steps[${j}]`));
		}
	});

	eachStep(plan, (step, stepPath) => {
		if (!enteredMatches(step.entered, step.targetKph)) {
			errors.push({ path: `${stepPath}.entered`, code: 'ENTERED_MISMATCH', message: 'The entered speed or pace does not match the target speed.' });
		}
		if (limits) {
			const target = plan.controlIncline === false ? { kph: step.targetKph } : { kph: step.targetKph, incline: step.targetIncline };
			for (const err of checkTarget(target, limits)) {
				errors.push({ ...err, path: `${stepPath}.${CODE_PATHS[err.path]}` });
			}
		}
	});
	return errors;
}

module.exports = { validatePlan, MAX_EXPANDED_STEPS };
