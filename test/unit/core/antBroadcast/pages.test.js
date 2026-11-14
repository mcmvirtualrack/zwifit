// Byte-exact vectors for every page in specs/003-ant-plus-broadcast/contracts/ant-pages.md,
// worked out by hand from the ANT+ profiles.
const pages = require('../../../../src/core/antBroadcast/pages');

const isPage = bytes => Array.isArray(bytes) && bytes.length === 8 && bytes.every(b => Number.isInteger(b) && b >= 0 && b <= 255);

describe('footpod (SDM)', () => {
	test('page 1: time, distance with rollover, speed, strides', () => {
		// 12.345 s → 2469/200 s; 300.5 m → 44 + 8/16 (mod 256); 10.8 km/h = 3 m/s; 300 strides → 44.
		expect(pages.sdmPage1({ seconds: 12.345, metres: 300.5, kph: 10.8, strides: 300 }))
			.toEqual([0x01, 69, 12, 44, 0x83, 0x00, 44, 0x00]);
		// 12 km/h = 3.333 m/s → 853/256 = 3 + 85/256.
		expect(pages.sdmPage1({ seconds: 0, metres: 0, kph: 12, strides: 0 }))
			.toEqual([0x01, 0, 0, 0, 0x03, 85, 0, 0]);
		// Time rolls over at 256 s.
		expect(pages.sdmPage1({ seconds: 256.5, metres: 0, kph: 0, strides: 255.9 })).toEqual([0x01, 100, 0, 0, 0, 0, 255, 0]);
	});

	test('page 2: cadence in strides with a 1/16 fraction, speed and use state', () => {
		expect(pages.sdmPage2({ cadence: 85.5, kph: 12, moving: true })).toEqual([0x02, 0xFF, 0xFF, 85, 0x83, 85, 0xFF, 0x01]);
		expect(pages.sdmPage2({ cadence: 0, kph: 0, moving: false })).toEqual([0x02, 0xFF, 0xFF, 0, 0x00, 0, 0xFF, 0x00]);
	});
});

describe('heart rate monitor', () => {
	test('page 4: toggle bit, previous and current beat time (mod 65 536), beat count (mod 256), rate', () => {
		expect(pages.hrmPage({ page: 4, toggle: true, prevBeatTime: 1000, beatTime: 65536 + 500, beats: 300, hr: 140 }))
			.toEqual([0x84, 0xFF, 0xE8, 0x03, 0xF4, 0x01, 44, 140]);
	});

	test('background pages 2 (manufacturer) and 3 (product) keep bytes 4–7', () => {
		const common = { prevBeatTime: 0, beatTime: 0x1234, beats: 7, hr: 60 };
		expect(pages.hrmPage({ ...common, page: 2, toggle: false })).toEqual([0x02, 0xFF, 0xFF, 0xFF, 0x34, 0x12, 7, 60]);
		expect(pages.hrmPage({ ...common, page: 3, toggle: true })).toEqual([0x83, 1, 1, 1, 0x34, 0x12, 7, 60]);
	});
});

describe('power meter', () => {
	test('page 16: event count and accumulated power roll over', () => {
		expect(pages.powerPage16({ events: 257, accumulated: 70000, power: 250 })).toEqual([0x10, 1, 0xFF, 0xFF, 0x70, 0x11, 0xFA, 0x00]);
		expect(pages.powerPage16({ events: 0, accumulated: 0, power: 2500 })).toEqual([0x10, 0, 0xFF, 0xFF, 0, 0, 0xC4, 0x09]);
	});
});

describe('fitness equipment (treadmill)', () => {
	test('page 16: type 19, elapsed 1/4 s, distance, speed mm/s, HR and flags', () => {
		// 70.3 s → 281 quarter seconds → 25; 10 km/h → 2778 mm/s; HR source 01, distance on, state 3 (in use).
		expect(pages.fePage16({ elapsed: 70.3, metres: 300.5, kph: 10, hr: 140, moving: true }))
			.toEqual([0x10, 19, 25, 44, 0xDA, 0x0A, 140, 0x35]);
	});

	test('page 16 without heart rate and with the belt stopped', () => {
		expect(pages.fePage16({ elapsed: 0, metres: 0, kph: 0, hr: null, moving: false }))
			.toEqual([0x10, 19, 0, 0, 0, 0, 0xFF, 0x24]);
	});

	test('page 16 lap toggle sets bit 7 of byte 7', () => {
		expect(pages.fePage16({ elapsed: 0, metres: 0, kph: 0, hr: null, moving: false, lap: true })[7]).toBe(0xA4);
	});

	test('page 17: incline in 0.01 % as signed int16', () => {
		expect(pages.fePage17({ incline: 3, moving: true })).toEqual([0x11, 0xFF, 0xFF, 0xFF, 0x2C, 0x01, 0xFF, 0x30]);
		expect(pages.fePage17({ incline: -2.5, moving: false })).toEqual([0x11, 0xFF, 0xFF, 0xFF, 0x06, 0xFF, 0xFF, 0x20]);
	});

	test('page 19: cadence (0xFF when missing) and climb in 0.1 m (mod 256)', () => {
		expect(pages.fePage19({ cadence: 85, climb: 12.34, moving: true })).toEqual([0x13, 0xFF, 0xFF, 0xFF, 85, 0, 123, 0x32]);
		expect(pages.fePage19({ cadence: null, climb: 30, moving: false })).toEqual([0x13, 0xFF, 0xFF, 0xFF, 0xFF, 0, 44, 0x22]);
	});
});

describe('common pages', () => {
	test('80 manufacturer and 81 product', () => {
		expect(pages.commonPage80()).toEqual([0x50, 0xFF, 0xFF, 1, 255, 0, 1, 0]);
		expect(pages.commonPage81()).toEqual([0x51, 0xFF, 0xFF, 1, 0xFF, 0xFF, 0xFF, 0xFF]);
	});
});

describe('field widths', () => {
	test('nonsense values never produce a byte outside 0–255', () => {
		const wild = [NaN, -1, 1e9, Infinity, -Infinity, undefined, null];
		for (const v of wild) {
			expect(isPage(pages.sdmPage1({ seconds: v, metres: v, kph: v, strides: v }))).toBe(true);
			expect(isPage(pages.sdmPage2({ cadence: v, kph: v, moving: true }))).toBe(true);
			expect(isPage(pages.hrmPage({ page: 4, toggle: false, prevBeatTime: v, beatTime: v, beats: v, hr: v }))).toBe(true);
			expect(isPage(pages.powerPage16({ events: v, accumulated: v, power: v }))).toBe(true);
			expect(isPage(pages.fePage16({ elapsed: v, metres: v, kph: v, hr: v, moving: true }))).toBe(true);
			expect(isPage(pages.fePage17({ incline: v, moving: true }))).toBe(true);
			expect(isPage(pages.fePage19({ cadence: v, climb: v, moving: true }))).toBe(true);
		}
	});

	test('values beyond a field are clamped to its maximum, not wrapped', () => {
		expect(pages.sdmPage1({ seconds: 0, metres: 0, kph: 100, strides: 0 }).slice(4, 6)).toEqual([0x0F, 0xFF]);
		expect(pages.powerPage16({ events: 0, accumulated: 0, power: 70000 }).slice(6)).toEqual([0xFF, 0xFF]);
		expect(pages.fePage17({ incline: 400, moving: false }).slice(4, 6)).toEqual([0xFF, 0x7F]);
		expect(pages.fePage17({ incline: -400, moving: false }).slice(4, 6)).toEqual([0x00, 0x80]);
	});
});
