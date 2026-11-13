// Plan totals. A time step's distance and a distance step's time are estimated from the target
// speed, so totals say which parts are estimates.
const { expand } = require('./expand');

// Duration and distance of one step at its target speed.
function stepTotals(step) {
	const metresPerSecond = step.targetKph / 3.6;
	if (step.end.type === 'time') {
		return { seconds: step.end.seconds, metres: metresPerSecond * step.end.seconds, estimatedSeconds: false, estimatedMetres: true };
	}
	return { seconds: step.end.metres / metresPerSecond, metres: step.end.metres, estimatedSeconds: true, estimatedMetres: false };
}

function totals(plan) {
	let seconds = 0;
	let metres = 0;
	let estimatedSeconds = false;
	let estimatedMetres = false;
	for (const { step } of expand(plan)) {
		const t = stepTotals(step);
		seconds += t.seconds;
		metres += t.metres;
		estimatedSeconds = estimatedSeconds || t.estimatedSeconds;
		estimatedMetres = estimatedMetres || t.estimatedMetres;
	}
	return {
		seconds: Math.round(seconds),
		metres: Math.round(metres * 10) / 10,
		estimated: estimatedSeconds || estimatedMetres,
		estimatedSeconds,
		estimatedMetres
	};
}

module.exports = { totals, stepTotals };
