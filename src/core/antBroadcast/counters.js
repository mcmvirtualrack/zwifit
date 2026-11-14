// Turns Zwifit's instantaneous values into the running totals ANT+ receivers expect (research.md
// R3, R4): distance, time and strides while the belt moves, heart beats from the heart rate, and
// power events. Pure: every function returns new objects. Counters never reset, so a treadmill
// reconnect continues where it left off; the encoders roll them over at each field's width.

const RANGES = {
	kph: [0, 30],
	incline: [-10, 40],
	hr: [30, 250],
	cadence: [1, 300],
	power: [0, 2500]
};
// More than this between two messages (a paused stick, a stalled clock) counts as this much.
const MAX_STEP_S = 60;

const isNumber = v => typeof v === 'number' && Number.isFinite(v);
const inRange = (v, [lo, hi]) => (isNumber(v) && v >= lo && v <= hi ? v : null);
const source = v => (typeof v === 'string' && v.length <= 32 ? v : null);

// The values worth broadcasting from a merged treadmill status; anything invalid is missing (null).
function validInput(status, limits = {}) {
	const s = status && typeof status === 'object' ? status : {};
	let kph = inRange(s.kph, RANGES.kph);
	if (kph !== null && isNumber(limits.maxKph) && kph > limits.maxKph) {
		kph = null;
	}
	return {
		kph,
		incline: inRange(s.incline, RANGES.incline),
		hr: inRange(s.hr, RANGES.hr),
		hrSource: source(s.hrSource),
		cadence: inRange(s.cadence, RANGES.cadence),
		power: inRange(s.power, RANGES.power),
		powerSource: source(s.powerSource)
	};
}

function createCounters() {
	return {
		seconds: 0,
		metres: 0,
		strides: 0,
		climb: 0,
		beatTime: 0,
		prevBeatTime: 0,
		beats: 0,
		sinceBeat: 0,
		events: 0,
		accumulatedPower: 0
	};
}

// Advances the time-based counters by dtMs with the given input (kph, incline, cadence in steps
// per minute, hr).
function advance(counters, input, dtMs) {
	const next = { ...counters };
	if (!isNumber(dtMs) || dtMs <= 0) {
		return next;
	}
	const dt = Math.min(dtMs / 1000, MAX_STEP_S);
	const kph = isNumber(input.kph) ? input.kph : 0;
	if (kph > 0) {
		const metres = kph / 3.6 * dt;
		next.seconds += dt;
		next.metres += metres;
		if (isNumber(input.incline) && input.incline > 0) {
			next.climb += metres * input.incline / 100;
		}
		if (isNumber(input.cadence) && input.cadence > 0) {
			// One stride = two steps.
			next.strides += input.cadence / 2 / 60 * dt;
		}
	}
	if (isNumber(input.hr) && input.hr > 0) {
		const interval = 60 / input.hr;
		next.sinceBeat += dt;
		while (next.sinceBeat >= interval) {
			next.sinceBeat -= interval;
			next.prevBeatTime = next.beatTime;
			next.beatTime = (next.beatTime + interval * 1024) % 65536;
			next.beats = (next.beats + 1) % 256;
		}
	}
	else {
		next.sinceBeat = 0;
	}
	return next;
}

// One power-meter message: event count and accumulated power.
function powerEvent(counters, power) {
	return {
		...counters,
		events: (counters.events + 1) % 256,
		accumulatedPower: (counters.accumulatedPower + Math.round(isNumber(power) ? power : 0)) % 65536
	};
}

module.exports = { validInput, createCounters, advance, powerEvent, RANGES };
