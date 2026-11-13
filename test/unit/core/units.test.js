const units = require('../../../src/core/units');

test('kph and mph convert with 1.609344', () => {
	expect(units.mphToKph(1)).toBeCloseTo(1.609344, 6);
	expect(units.kphToMph(1.609344)).toBeCloseTo(1, 6);
	expect(units.kphToMph(units.mphToKph(7.3))).toBeCloseTo(7.3, 9);
});

test('pace 10:00 min/mi is 9.656 km/h', () => {
	expect(units.paceToKph('10:00', 'min/mi')).toBeCloseTo(9.656, 2);
	expect(units.kphToPace(units.mphToKph(6), 'min/mi')).toBe('10:00');
});

test('pace 6:00 min/km is 10 km/h', () => {
	expect(units.paceToKph('6:00', 'min/km')).toBeCloseTo(10, 6);
	expect(units.kphToPace(10, 'min/km')).toBe('6:00');
});

test('kphToPace rounds seconds and carries to minutes', () => {
	expect(units.kphToPace(3600 / 359.6, 'min/km')).toBe('6:00');
	expect(units.kphToPace(3600 / 119.5, 'min/km')).toBe('2:00');
});

test.each(['0:00', '1:60', 'abc', '', '10', '100:00', ':30', null, undefined, 5])('invalid pace %p is rejected', value => {
	expect(units.parsePace(value)).toBeNull();
	expect(() => units.paceToKph(value, 'min/km')).toThrow(units.UnitError);
});

test('unknown pace unit is rejected', () => {
	expect(() => units.paceToKph('6:00', 'min/yard')).toThrow(units.UnitError);
});

test('speed 0 or negative has no pace', () => {
	expect(units.kphToPace(0, 'min/km')).toBeNull();
	expect(units.kphToPace(-1, 'min/mi')).toBeNull();
	expect(units.kphToPace(NaN, 'min/mi')).toBeNull();
});

test('distance conversions', () => {
	expect(units.milesToMetres(1)).toBeCloseTo(1609.344, 6);
	expect(units.metresToMiles(1609.344)).toBeCloseTo(1, 9);
	expect(units.kmToMetres(2.5)).toBe(2500);
	expect(units.metresToKm(2500)).toBe(2.5);
});

describe('enteredToKph', () => {
	test('speed forms', () => {
		expect(units.enteredToKph({ form: 'speed', unit: 'kph', value: 12 })).toBe(12);
		expect(units.enteredToKph({ form: 'speed', unit: 'mph', value: 6 })).toBeCloseTo(9.656, 3);
	});
	test('pace forms', () => {
		expect(units.enteredToKph({ form: 'pace', unit: 'min/km', value: '5:00' })).toBeCloseTo(12, 6);
		expect(units.enteredToKph({ form: 'pace', unit: 'min/mi', value: '10:00' })).toBeCloseTo(9.656, 3);
	});
	test('rejects mismatched form/unit and bad values', () => {
		expect(() => units.enteredToKph({ form: 'speed', unit: 'min/km', value: 5 })).toThrow(units.UnitError);
		expect(() => units.enteredToKph({ form: 'pace', unit: 'kph', value: '5:00' })).toThrow(units.UnitError);
		expect(() => units.enteredToKph({ form: 'speed', unit: 'kph', value: -1 })).toThrow(units.UnitError);
		expect(() => units.enteredToKph({ form: 'speed', unit: 'kph', value: '5' })).toThrow(units.UnitError);
		expect(() => units.enteredToKph(null)).toThrow(units.UnitError);
	});
});

test('enteredMatches allows 0.05 km/h of rounding', () => {
	const entered = { form: 'pace', unit: 'min/mi', value: '10:00' };
	expect(units.enteredMatches(entered, 9.656)).toBe(true);
	expect(units.enteredMatches(entered, 9.70)).toBe(true);
	expect(units.enteredMatches(entered, 9.75)).toBe(false);
	expect(units.enteredMatches({ form: 'pace', unit: 'min/mi', value: 'x' }, 9.656)).toBe(false);
});
