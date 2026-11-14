const { nextPage, createSchedule } = require('../../../../src/core/antBroadcast/schedule');

// Runs `count` messages and returns the pages sent.
function run(kind, values, count = 64, state = createSchedule()) {
	const sent = [];
	for (let i = 0; i < count; i++) {
		const out = nextPage(kind, state, values);
		sent.push(out.page);
		state = out.state;
	}
	return { sent, state };
}

const counts = numbers => numbers.reduce((acc, n) => ({ ...acc, [n]: (acc[n] || 0) + 1 }), {});

const footpod = { seconds: 1, metres: 2, kph: 10, strides: 3, cadence: 85, moving: true };
const hr = { prevBeatTime: 0, beatTime: 512, beats: 1, hr: 120 };
const power = { events: 1, accumulatedPower: 200, power: 200 };
const treadmill = { elapsed: 1, metres: 2, kph: 10, hr: 120, incline: 2, cadence: 85, climb: 1, moving: true };

test('every page is 8 bytes', () => {
	for (const [kind, values] of [['footpod', footpod], ['hr', hr], ['power', power], ['treadmill', treadmill]]) {
		expect(run(kind, values, 128).sent.every(p => p.length === 8)).toBe(true);
	}
});

test('footpod alternates pages 1 and 2 with cadence; pages 80 and 81 twice each per 64', () => {
	const { sent } = run('footpod', footpod);
	const numbers = sent.map(p => p[0]);
	expect(counts(numbers)).toEqual({ 1: 30, 2: 30, 0x50: 2, 0x51: 2 });
	expect(numbers.slice(0, 4)).toEqual([1, 2, 1, 2]);
});

test('footpod without cadence never sends page 2', () => {
	const numbers = run('footpod', { ...footpod, cadence: null }).sent.map(p => p[0]);
	expect(counts(numbers)).toEqual({ 1: 60, 0x50: 2, 0x51: 2 });
});

test('heart rate: page 4 with the toggle bit flipping every 4 messages, background 2 then 3', () => {
	const { sent, state } = run('hr', hr);
	sent.forEach((p, i) => expect(p[0] >> 7).toBe(Math.floor(i / 4) % 2));
	const numbers = sent.map(p => p[0] & 0x7F);
	expect(counts(numbers)).toEqual({ 4: 60, 2: 4 });
	expect(sent[0][7]).toBe(120);
	const next = run('hr', hr, 64, state).sent.map(p => p[0] & 0x7F);
	expect(counts(next)).toEqual({ 4: 60, 3: 4 });
});

test('power: page 16 with 80 and 81 twice each per 64', () => {
	const numbers = run('power', power).sent.map(p => p[0]);
	expect(counts(numbers)).toEqual({ 0x10: 60, 0x50: 2, 0x51: 2 });
});

test('treadmill: 16, 17, 16, 19 cycle with 80 and 81 twice each per 64', () => {
	const numbers = run('treadmill', treadmill).sent.map(p => p[0]);
	expect(numbers.slice(0, 8)).toEqual([0x10, 0x11, 0x10, 0x13, 0x10, 0x11, 0x10, 0x13]);
	expect(counts(numbers)).toEqual({ 0x10: 30, 0x11: 16, 0x13: 14, 0x50: 2, 0x51: 2 });
});

test('the state is not changed in place and keeps counting past many cycles', () => {
	const state = createSchedule();
	nextPage('power', state, power);
	expect(state).toEqual(createSchedule());
	expect(() => run('power', power, 64 * 300)).not.toThrow();
});

test('an unknown kind is an error', () => {
	expect(() => nextPage('bike', createSchedule(), {})).toThrow();
});
