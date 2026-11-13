// The "Demo" plan added on first start: about 12 minutes at gentle speeds, using every kind of step
// (speed and pace targets, time and distance ends, a repeat block) so it is a starting point to
// open in the editor and adjust. In the user's units: km/h and min/km, or mph and min/mi.
const { enteredToKph, kmToMetres, milesToMetres } = require('../units');

function demoPlan({ metric = true } = {}) {
	const step = (id, label, entered, incline, end) => ({
		kind: 'step', id, label, targetKph: enteredToKph(entered), entered, targetIncline: incline, end
	});
	const speed = (kph, mph) => ({ form: 'speed', unit: metric ? 'kph' : 'mph', value: metric ? kph : mph });
	const pace = (perKm, perMile) => ({ form: 'pace', unit: metric ? 'min/km' : 'min/mi', value: metric ? perKm : perMile });
	const minutes = m => ({ type: 'time', seconds: m * 60 });
	const distance = (km, miles) => ({ type: 'distance', metres: metric ? kmToMetres(km) : milesToMetres(miles) });

	return {
		schemaVersion: 1,
		name: 'Demo',
		description: 'A short sample workout. Open it in Plans to change speeds, paces, inclines and durations.',
		authoredUnits: metric ? 'metric' : 'imperial',
		items: [
			step('warmup', 'Warm-up walk', speed(4, 2.5), 0, minutes(2)),
			{
				kind: 'block',
				id: 'intervals',
				label: 'Intervals',
				repeat: 3,
				steps: [
					step('brisk', 'Brisk', speed(6.5, 4), 1, minutes(1)),
					step('easy', 'Easy', speed(4.5, 2.8), 0, minutes(1))
				]
			},
			step('steady', 'Steady pace', pace('10:00', '16:00'), 2, distance(0.25, 0.15)),
			step('cooldown', 'Cool-down', speed(3.5, 2.2), 0, minutes(2))
		]
	};
}

module.exports = { demoPlan };
