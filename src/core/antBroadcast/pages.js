// ANT+ data pages Zwifit sends (specs/003-ant-plus-broadcast/contracts/ant-pages.md). Pure: each
// encoder takes already-validated values and returns 8 bytes. Every field is clamped to its width
// (or rolled over where the profile says so), so even nonsense input cannot produce a bad byte.

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
// Unsigned integer of `max` or less, from a value already in the field's units.
const uint = (v, max) => clamp(Math.floor(num(v)), 0, max);
// A counter that rolls over at `mod` (256, 65 536 …).
const wrap = (v, mod) => ((Math.floor(Math.max(0, num(v))) % mod) + mod) % mod;
const lo = v => v & 0xFF;
const hi = v => (v >> 8) & 0xFF;

// Speed in m/s as a 4-bit integer and a 1/256 fraction (SDM pages 1 and 2).
function sdmSpeed(kph) {
	const total = clamp(Math.round(num(kph) / 3.6 * 256), 0, 15 * 256 + 255);
	return { int: total >> 8, frac: total & 0xFF };
}

function sdmPage1({ seconds, metres, kph, strides }) {
	const time = Math.round(Math.max(0, num(seconds)) * 200);
	const distance = Math.floor(Math.max(0, num(metres)) * 16);
	const speed = sdmSpeed(kph);
	return [
		0x01,
		time % 200,
		Math.floor(time / 200) % 256,
		Math.floor(distance / 16) % 256,
		((distance % 16) << 4) | speed.int,
		speed.frac,
		wrap(strides, 256),
		0x00
	];
}

// cadence in strides per minute.
function sdmPage2({ cadence, kph, moving }) {
	const total = clamp(Math.round(num(cadence) * 16), 0, 255 * 16 + 15);
	const speed = sdmSpeed(kph);
	return [0x02, 0xFF, 0xFF, total >> 4, ((total & 0x0F) << 4) | speed.int, speed.frac, 0xFF, moving ? 0x01 : 0x00];
}

// page 4 (previous beat), or background pages 2 (manufacturer) and 3 (product).
function hrmPage({ page, toggle, prevBeatTime, beatTime, beats, hr }) {
	const head = {
		2: [0x02, 0xFF, 0xFF, 0xFF],
		3: [0x03, 1, 1, 1]
	}[page] || [0x04, 0xFF, lo(wrap(prevBeatTime, 65536)), hi(wrap(prevBeatTime, 65536))];
	const time = wrap(beatTime, 65536);
	head[0] |= toggle ? 0x80 : 0;
	return [...head, lo(time), hi(time), wrap(beats, 256), uint(hr, 255)];
}

function powerPage16({ events, accumulated, power }) {
	const total = wrap(accumulated, 65536);
	const watts = uint(power, 0xFFFF);
	return [0x10, wrap(events, 256), 0xFF, 0xFF, lo(total), hi(total), lo(watts), hi(watts)];
}

// Bits 4–6: FE state (2 ready, 3 in use); bit 7: lap toggle.
const feState = (moving, lap) => ((moving ? 3 : 2) << 4) | (lap ? 0x80 : 0);

function fePage16({ elapsed, metres, kph, hr, moving, lap }) {
	const speed = clamp(Math.round(num(kph) / 3.6 * 1000), 0, 0xFFFE);
	const hasHr = typeof hr === 'number' && Number.isFinite(hr) && hr > 0;
	const capabilities = (hasHr ? 0x01 : 0x00) | 0x04;
	return [
		0x10,
		19,
		wrap(Math.round(Math.max(0, num(elapsed)) * 4), 256),
		wrap(metres, 256),
		lo(speed),
		hi(speed),
		hasHr ? uint(hr, 254) : 0xFF,
		capabilities | feState(moving, lap)
	];
}

function fePage17({ incline, moving, lap }) {
	const value = clamp(Math.round(num(incline) * 100), -32768, 32767) & 0xFFFF;
	return [0x11, 0xFF, 0xFF, 0xFF, lo(value), hi(value), 0xFF, feState(moving, lap)];
}

// cadence in strides per minute; climb in metres.
function fePage19({ cadence, climb, moving, lap }) {
	const hasCadence = typeof cadence === 'number' && Number.isFinite(cadence) && cadence > 0;
	return [0x13, 0xFF, 0xFF, 0xFF, hasCadence ? uint(cadence, 254) : 0xFF, 0x00, wrap(num(climb) * 10, 256), 0x02 | feState(moving, lap)];
}

// Manufacturer 255 = development; hardware revision 1, model 1.
const commonPage80 = () => [0x50, 0xFF, 0xFF, 1, 255, 0, 1, 0];
// Software revision 1; serial 0xFFFFFFFF = none.
const commonPage81 = () => [0x51, 0xFF, 0xFF, 1, 0xFF, 0xFF, 0xFF, 0xFF];

module.exports = { sdmPage1, sdmPage2, hrmPage, powerPage16, fePage16, fePage17, fePage19, commonPage80, commonPage81 };
