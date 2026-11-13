let utils = require('../../lib/utils');

exports.calculateBuffer = calculateBuffer;

// console.log((calculateBuffer({
//  kph: 9.65,
//  hr: 180,
//  incline: 3
// }).toString('hex')));

function calculateBuffer(args) {
	let kph = args.kph,
		hr = args.hr,
		incline = args.incline,
		// Running power in watts (from a Stryd), sent with a zero force on belt; left out when unknown.
		power = args.power;

	let kilometersPerHour = kph,
		kilometersPerHourRounded = Math.round(kilometersPerHour * 100),
		inclineRounded = Math.round(incline * 10),
		degrees = incline ? (Math.atan(incline / 100) * 180 / Math.PI) : 0,
		degreesRounded = Math.round(degrees * 10),
		flags = {
			InstantaneousSpeed: false,
			AverageSpeedPresent: false,
			TotalDistancePresent: false,
			InclinationAndRampAngleSettingPresent: true,
			ElevationGainPresent: false,
			InstantaneousPacePresent: false,
			AveragePacePresent: false,
			ExpendedEnergyPresent: false,
			HeartRatePresent: !!hr,
			MetabolicEquivalentPresent: false,
			ElapsedTimePresent: false,
			RemainingTimePresent: false,
			ForceOnBeltAndPowerOutputPresent: !!power,
			ReservedForFutureUse1: false,
			ReservedForFutureUse2: false,
			ReservedForFutureUse3: false
		};

	let buffer = utils
		.bufferHelper()
		.write(16, utils.convertFlags(flags))
		.write(16, kilometersPerHourRounded)
		.write(16, inclineRounded, true)
		.write(16, degreesRounded, true);

	if (hr) {
		buffer.write(8, hr);
	}

	if (power) {
		buffer.write(16, 0, true);
		buffer.write(16, Math.round(power), true);
	}

	return buffer.finish();
}
