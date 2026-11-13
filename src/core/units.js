// Unit conversions. Internally speed is km/h, distance metres, time seconds (data-model.md).
const { AppError } = require('../lib/errors');

const KM_PER_MILE = 1.609344;
const MATCH_TOLERANCE_KPH = 0.05;
const PACE_UNITS = { 'min/mi': KM_PER_MILE, 'min/km': 1 };
const SPEED_UNITS = { kph: 1, mph: KM_PER_MILE };

class UnitError extends AppError {
	constructor(message) {
		super('BAD_UNIT', message);
		this.name = 'UnitError';
	}
}

const mphToKph = mph => mph * KM_PER_MILE;
const kphToMph = kph => kph / KM_PER_MILE;
const milesToMetres = miles => miles * KM_PER_MILE * 1000;
const metresToMiles = metres => metres / (KM_PER_MILE * 1000);
const kmToMetres = km => km * 1000;
const metresToKm = metres => metres / 1000;

// "m:ss" → seconds, or null if not a valid, non-zero pace under 100 minutes.
function parsePace(value) {
	if (typeof value !== 'string') {
		return null;
	}
	const match = /^(\d{1,2}):([0-5]\d)$/.exec(value);
	if (!match) {
		return null;
	}
	const seconds = Number(match[1]) * 60 + Number(match[2]);
	return seconds > 0 ? seconds : null;
}

function paceToKph(value, unit) {
	const km = PACE_UNITS[unit];
	if (!km) {
		throw new UnitError(`Unknown pace unit "${unit}".`);
	}
	const seconds = parsePace(value);
	if (seconds === null) {
		throw new UnitError('Pace must look like m:ss, for example 9:30.');
	}
	return km * 3600 / seconds;
}

// km/h → "m:ss" per unit, or null when there is no pace (stopped).
function kphToPace(kph, unit) {
	const km = PACE_UNITS[unit];
	if (!km) {
		throw new UnitError(`Unknown pace unit "${unit}".`);
	}
	if (!Number.isFinite(kph) || kph <= 0) {
		return null;
	}
	// Round away floating-point noise first so e.g. 119.4999999 s becomes 120 s.
	const total = Math.round(Math.round(km * 3600 / kph * 1e6) / 1e6);
	const minutes = Math.floor(total / 60);
	const seconds = total % 60;
	return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

// How the user typed a speed ({ form, unit, value }) → km/h.
function enteredToKph(entered) {
	if (!entered || typeof entered !== 'object') {
		throw new UnitError('Missing speed.');
	}
	const { form, unit, value } = entered;
	if (form === 'speed') {
		if (!SPEED_UNITS[unit]) {
			throw new UnitError(`"${unit}" is not a speed unit.`);
		}
		if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
			throw new UnitError('Speed must be a number above 0.');
		}
		return value * SPEED_UNITS[unit];
	}
	if (form === 'pace') {
		if (!PACE_UNITS[unit]) {
			throw new UnitError(`"${unit}" is not a pace unit.`);
		}
		return paceToKph(value, unit);
	}
	throw new UnitError('Speed must be entered as a speed or a pace.');
}

function enteredMatches(entered, targetKph) {
	try {
		return Math.abs(enteredToKph(entered) - targetKph) <= MATCH_TOLERANCE_KPH + 1e-9;
	}
	catch {
		return false;
	}
}

module.exports = {
	KM_PER_MILE,
	UnitError,
	mphToKph,
	kphToMph,
	milesToMetres,
	metresToMiles,
	kmToMetres,
	metresToKm,
	parsePace,
	paceToKph,
	kphToPace,
	enteredToKph,
	enteredMatches
};
