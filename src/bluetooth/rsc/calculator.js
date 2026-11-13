let utils = require('../../lib/utils');

let secondsPerHour = 3600;

exports.calculateBuffer = calculateBuffer;

// console.log(calculateBuffer({ kph: 9.65, cadence: 172 }).toString('hex'));

function calculateBuffer(args) {
	let kph = args.kph,
		cadence = args.cadence;

	let metersPerSecond = kph ? kph * 1000 / secondsPerHour : 0,
		metersPerSecondRounded = Math.round(metersPerSecond * 256),
		stepsPerMinute = Math.round(cadence || 0),
		flags = {
			InstantaneousStrideLengthPresent: false,
			TotalDistancePresent: false,
			WalkingOrRunningStatusBits: kph >= 8,
			ReservedForFutureUse1: false,
			ReservedForFutureUse2: false,
			ReservedForFutureUse3: false,
			ReservedForFutureUse4: false,
			ReservedForFutureUse5: false
		};

	return utils
		.bufferHelper()
		.write(8, utils.convertFlags(flags))
		.write(16, metersPerSecondRounded)
		.write(8, stepsPerMinute)
		.finish();
}
