const { validInput, createCounters, advance, powerEvent } = require('../../../../src/core/antBroadcast/counters');

describe('validInput', () => {
	test('keeps values in range and the sources', () => {
		expect(validInput({ kph: 10, incline: -2, hr: 140, hrSource: 'ble', cadence: 170, power: 0, powerSource: 'ant' }, { maxKph: 20 }))
			.toEqual({ kph: 10, incline: -2, hr: 140, hrSource: 'ble', cadence: 170, power: 0, powerSource: 'ant' });
	});

	test.each([
		['kph', NaN], ['kph', -1], ['kph', 30.1], ['kph', '10'],
		['incline', -10.5], ['incline', 40.5], ['incline', Infinity],
		['hr', 29], ['hr', 251], ['hr', null],
		['cadence', 0], ['cadence', 301],
		['power', -1], ['power', 2501]
	])('%s = %p becomes missing', (field, value) => {
		const input = validInput({ kph: 5, incline: 1, hr: 100, cadence: 160, power: 200, [field]: value });
		expect(input[field]).toBeNull();
	});

	test('speed above the treadmill maximum is missing', () => {
		expect(validInput({ kph: 18 }, { maxKph: 16 }).kph).toBeNull();
		expect(validInput({ kph: 16 }, { maxKph: 16 }).kph).toBe(16);
	});

	test('edges of each range are kept', () => {
		expect(validInput({ kph: 0, incline: -10, hr: 30, cadence: 1, power: 2500 })).toMatchObject({ kph: 0, incline: -10, hr: 30, cadence: 1, power: 2500 });
		expect(validInput({ kph: 30, incline: 40, hr: 250, cadence: 300 })).toMatchObject({ kph: 30, incline: 40, hr: 250, cadence: 300 });
	});

	test('anything that is not an object gives all missing; odd sources are dropped', () => {
		expect(validInput(null)).toEqual({ kph: null, incline: null, hr: null, hrSource: null, cadence: null, power: null, powerSource: null });
		expect(validInput({ hr: 100, hrSource: { evil: true } }).hrSource).toBeNull();
	});
});

describe('advance', () => {
	test('distance, time and strides advance only while the belt moves', () => {
		let c = createCounters();
		c = advance(c, { kph: 10.8, cadence: 180 }, 1000);
		expect(c).toMatchObject({ seconds: 1, metres: 3, strides: 1.5 });
		const still = advance(c, { kph: 0, cadence: 180 }, 5000);
		expect(still).toMatchObject({ seconds: 1, metres: 3, strides: 1.5 });
		const missing = advance(c, { kph: null, cadence: null }, 5000);
		expect(missing).toMatchObject({ seconds: 1, metres: 3, strides: 1.5 });
	});

	test('counters keep their values across a disconnect and continue', () => {
		let c = createCounters();
		c = advance(c, { kph: 10.8 }, 1000);
		c = advance(c, { kph: 0 }, 30000);
		c = advance(c, { kph: 10.8 }, 1000);
		expect(c).toMatchObject({ seconds: 2, metres: 6 });
	});

	test('climb grows with speed × positive incline only', () => {
		let c = advance(createCounters(), { kph: 10.8, incline: 10 }, 1000);
		expect(c.climb).toBeCloseTo(0.3);
		c = advance(c, { kph: 10.8, incline: -5 }, 1000);
		expect(c.climb).toBeCloseTo(0.3);
	});

	test('a heart beat every 60/HR seconds, in 1/1024 s', () => {
		let c = advance(createCounters(), { hr: 120 }, 1000);
		expect(c).toMatchObject({ beats: 2, beatTime: 1024, prevBeatTime: 512 });
		c = advance(c, { hr: 120 }, 250);
		expect(c.beats).toBe(2);
		c = advance(c, { hr: 120 }, 250);
		expect(c).toMatchObject({ beats: 3, beatTime: 1536, prevBeatTime: 1024 });
		// No heart rate: no beats.
		expect(advance(c, { hr: null }, 5000).beats).toBe(3);
	});

	test('beat time and count roll over', () => {
		let c = createCounters();
		for (let i = 0; i < 70; i++) {
			c = advance(c, { hr: 240 }, 60000);
		}
		expect(c.beats).toBeLessThan(256);
		expect(c.beatTime).toBeLessThan(65536);
		expect(c.beats).toBe((70 * 240) % 256);
	});

	test('negative, missing or huge time steps are safe', () => {
		const c = advance(createCounters(), { kph: 10.8 }, 1000);
		expect(advance(c, { kph: 10.8 }, -500)).toEqual(c);
		expect(advance(c, { kph: 10.8 }, NaN)).toEqual(c);
		// More than a minute between messages counts as a minute.
		expect(advance(c, { kph: 10.8 }, 3600 * 1000).seconds).toBe(61);
	});

	test('does not change the counters it is given', () => {
		const c = createCounters();
		advance(c, { kph: 10, hr: 100 }, 1000);
		expect(c).toEqual(createCounters());
	});
});

describe('powerEvent', () => {
	test('one event per message, accumulated power, both rolling over', () => {
		let c = powerEvent(createCounters(), 250);
		c = powerEvent(c, 250);
		expect(c).toMatchObject({ events: 2, accumulatedPower: 500 });
		c = { ...c, events: 255, accumulatedPower: 65500 };
		c = powerEvent(c, 100);
		expect(c).toMatchObject({ events: 0, accumulatedPower: 64 });
	});
});
