// Flattens a plan's items (steps and repeat blocks) into the sequence playback runs.

// → [{ flatIndex, itemIndex, stepIndex, repetition, repeatOf, step }]
// repetition is 1-based within a block (1 of 1 for a plain step).
function expand(plan) {
	const flat = [];
	(plan.items || []).forEach((item, itemIndex) => {
		if (item.kind === 'block') {
			for (let repetition = 1; repetition <= item.repeat; repetition++) {
				item.steps.forEach((step, stepIndex) => {
					flat.push({ flatIndex: flat.length, itemIndex, stepIndex, repetition, repeatOf: item.repeat, blockLabel: item.label || '', step });
				});
			}
		}
		else {
			flat.push({ flatIndex: flat.length, itemIndex, stepIndex: null, repetition: 1, repeatOf: 1, blockLabel: '', step: item });
		}
	});
	return flat;
}

// Number of steps expand() would produce, without building them.
function expandedCount(plan) {
	return (plan.items || []).reduce((sum, item) => sum + (item.kind === 'block' ? item.repeat * item.steps.length : 1), 0);
}

module.exports = { expand, expandedCount };
