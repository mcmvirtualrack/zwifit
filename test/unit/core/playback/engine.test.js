const fs = require('fs');
const path = require('path');
const { PlaybackEngine, WAITING_MESSAGE, RESUME_MESSAGE } = require('../../../../src/core/playback/engine');

const LIMITS = { minKph: 0, maxKph: 20, minIncline: 0, maxIncline: 15 };
const fixture = name => JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'fixtures', 'plans', name), 'utf8'));

// Clock whose time only moves when the test says so.
function fakeClock() {
	let now = 0;
	let nextId = 1;
	const timers = new Map();
	return {
		now: () => now,
		setInterval: (fn, ms) => {
			const id = nextId++;
			timers.set(id, { fn, ms, due: now + ms });
			return id;
		},
		clearInterval: id => timers.delete(id),
		setTimeout: () => 0,
		clearTimeout: () => {},
		timerCount: () => timers.size,
		async advance(ms) {
			const end = now + ms;
			for (;;) {
				const due = [...timers.entries()].filter(([, t]) => t.due <= end).sort((a, b) => a[1].due - b[1].due)[0];
				if (!due) {
					break;
				}
				const [id, timer] = due;
				now = timer.due;
				timer.due += timer.ms;
				timer.fn();
				await Promise.resolve();
				await Promise.resolve();
				if (!timers.has(id)) {
					continue;
				}
			}
			now = end;
		}
	};
}

function recordingAdapter({ canResume = true } = {}) {
	const calls = [];
	return {
		calls,
		capabilities: { canControl: true, canPause: true, canResume },
		setTarget: jest.fn(async target => { calls.push(['setTarget', target]); }),
		pauseBelt: jest.fn(async () => { calls.push(['pauseBelt']); }),
		resumeBelt: jest.fn(async () => {
			if (!canResume) {
				throw Object.assign(new Error('no'), { code: 'RESUME_UNSUPPORTED' });
			}
			calls.push(['resumeBelt']);
		})
	};
}

let clock;
let adapter;
let engine;
let events;
let states;

function build({ canResume = true, cooldownKph = 3.2 } = {}) {
	clock = fakeClock();
	adapter = recordingAdapter({ canResume });
	engine = new PlaybackEngine({ adapter, clock, getLimits: () => LIMITS, getSettings: () => ({ cooldownKph }) });
	events = [];
	states = [];
	engine.on('event', e => events.push(e));
	engine.on('state', s => states.push(s));
}

const moving = (kph = 8, extra = {}) => engine.onStatus({ connected: true, kph, incline: 1, hr: 120, estimatedSpeed: false, ...extra });
const simplePlan = (items, extra = {}) => ({ id: '01HZX3K9V7Q8R2M4N6P0S1T3W5', schemaVersion: 1, name: 'Test', items, ...extra });
const step = (id, kph, incline, end) => ({ kind: 'step', id, targetKph: kph, entered: { form: 'speed', unit: 'kph', value: kph }, targetIncline: incline, end });
const twoSteps = () => simplePlan([step('a', 8, 1, { type: 'time', seconds: 10 }), step('b', 10, 2, { type: 'time', seconds: 10 })]);

beforeEach(() => build());

describe('start', () => {
	test('is refused unless idle', async () => {
		moving();
		await engine.start(twoSteps());
		await expect(engine.start(twoSteps())).rejects.toMatchObject({ code: 'ALREADY_RUNNING' });
	});

	test('is refused when the treadmill is not connected', async () => {
		await expect(engine.start(twoSteps())).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
	});

	test('is refused when the plan no longer fits the current limits', async () => {
		const plan = simplePlan([step('a', 18, 1, { type: 'time', seconds: 10 })]);
		engine = new PlaybackEngine({ adapter, clock, getLimits: () => ({ ...LIMITS, maxKph: 16 }), getSettings: () => ({ cooldownKph: 3.2 }) });
		moving();
		await expect(engine.start(plan)).rejects.toMatchObject({ code: 'INVALID_PLAN', details: [expect.objectContaining({ code: 'ABOVE_MAX_SPEED' })] });
		expect(adapter.calls).toEqual([]);
	});

	test('with the belt stopped it waits with "Start the belt on your treadmill"', async () => {
		moving(0);
		await engine.start(twoSteps());
		expect(engine.state).toBe('waiting');
		expect(states[states.length - 1].message).toBe(WAITING_MESSAGE);
		expect(adapter.calls).toEqual([]);
		moving(3);
		await Promise.resolve();
		expect(engine.state).toBe('running');
		expect(adapter.calls).toEqual([['setTarget', { kph: 8, incline: 1 }]]);
	});

	test('step 1 targets are sent on start', async () => {
		moving();
		await engine.start(twoSteps());
		expect(adapter.calls).toEqual([['setTarget', { kph: 8, incline: 1 }]]);
		expect(states[states.length - 1]).toMatchObject({ state: 'running', current: { id: 'a' }, next: { id: 'b' } });
	});
});

test('the next targets are sent within 2 s of a time boundary (SC-004)', async () => {
	moving();
	await engine.start(twoSteps());
	await clock.advance(9750);
	expect(adapter.calls).toHaveLength(1);
	await clock.advance(1000);
	expect(adapter.calls[1]).toEqual(['setTarget', { kph: 10, incline: 2 }]);
});

test('distance steps advance on distance travelled, flagging estimated speed', async () => {
	const plan = simplePlan([step('a', 7.2, 0, { type: 'distance', metres: 20 }), step('b', 9, 0, { type: 'time', seconds: 60 })]);
	moving(7.2, { estimatedSpeed: true });
	await engine.start(plan);
	await clock.advance(9000);
	expect(adapter.calls).toHaveLength(1);
	await clock.advance(1500);
	expect(adapter.calls[1]).toEqual(['setTarget', { kph: 9, incline: 0 }]);
	expect(states[states.length - 1].estimated).toBe(true);
});

describe('pause and resume', () => {
	test('pause stops the belt once, freezes progress, and sends nothing for 10 minutes', async () => {
		moving();
		await engine.start(twoSteps());
		await clock.advance(4000);
		await engine.pause();
		expect(adapter.calls.slice(1)).toEqual([['pauseBelt']]);
		moving(0);
		const frozen = engine.snapshot().stepElapsed.seconds;
		await clock.advance(10 * 60 * 1000);
		expect(adapter.calls.slice(1)).toEqual([['pauseBelt']]);
		expect(engine.snapshot().stepElapsed.seconds).toBe(frozen);
		expect(engine.state).toBe('paused');
	});

	test('pause with the belt already stopped sends no stop', async () => {
		moving();
		await engine.start(twoSteps());
		moving(0);
		await engine.pause();
		expect(adapter.pauseBelt).not.toHaveBeenCalled();
	});

	test('the belt moving again by itself does not resume the plan', async () => {
		moving();
		await engine.start(twoSteps());
		await engine.pause();
		moving(5);
		await clock.advance(5000);
		expect(engine.state).toBe('paused');
		expect(adapter.calls.slice(1)).toEqual([['pauseBelt']]);
	});

	test('resume calls resumeBelt then sends the step targets', async () => {
		moving();
		await engine.start(twoSteps());
		await engine.pause();
		await engine.resume();
		expect(adapter.calls.slice(1)).toEqual([['pauseBelt'], ['resumeBelt'], ['setTarget', { kph: 8, incline: 1 }]]);
		expect(engine.state).toBe('running');
	});

	test('canResume=false waits for the belt, then continues', async () => {
		build({ canResume: false });
		moving();
		await engine.start(twoSteps());
		await engine.pause();
		moving(0);
		await engine.resume();
		expect(engine.state).toBe('resuming');
		expect(states[states.length - 1].message).toBe(RESUME_MESSAGE);
		expect(adapter.resumeBelt).not.toHaveBeenCalled();
		moving(2);
		await Promise.resolve();
		expect(engine.state).toBe('running');
		expect(adapter.calls[adapter.calls.length - 1]).toEqual(['setTarget', { kph: 8, incline: 1 }]);
	});

	test('a treadmill that refuses to resume is RESUME_REFUSED and stays paused', async () => {
		moving();
		await engine.start(twoSteps());
		await engine.pause();
		adapter.resumeBelt.mockRejectedValueOnce(Object.assign(new Error('safety key'), { code: 'NOT_CONNECTED' }));
		await expect(engine.resume()).rejects.toMatchObject({ code: 'RESUME_REFUSED' });
		expect(engine.state).toBe('paused');
	});

	test('connection loss while paused ends the plan', async () => {
		moving();
		await engine.start(twoSteps());
		await engine.pause();
		engine.onStatus({ connected: false });
		expect(engine.snapshot()).toMatchObject({ state: 'ended', endReason: 'connectionLost' });
	});
});

test('override applies now and clears at the next step', async () => {
	moving();
	await engine.start(twoSteps());
	await engine.override({ kph: 9 });
	expect(adapter.calls[1]).toEqual(['setTarget', { kph: 9 }]);
	expect(engine.snapshot().override).toEqual({ kph: 9 });
	moving(9);
	await clock.advance(10250);
	expect(engine.snapshot().override).toBeNull();
	expect(adapter.calls[2]).toEqual(['setTarget', { kph: 10, incline: 2 }]);
	expect(events.find(e => e.type === 'override')).toEqual({ type: 'override', target: { kph: 9 } });
});

test('skip sends the next step now; skipping while paused sends nothing', async () => {
	moving();
	await engine.start(twoSteps());
	await engine.skip();
	expect(adapter.calls[1]).toEqual(['setTarget', { kph: 10, incline: 2 }]);
	expect(events.find(e => e.type === 'stepEnd')).toMatchObject({ flatIndex: 0, skipped: true });

	build();
	moving();
	await engine.start(simplePlan([...twoSteps().items, step('c', 6, 0, { type: 'time', seconds: 10 })]));
	await engine.pause();
	await engine.skip();
	expect(adapter.calls.slice(1)).toEqual([['pauseBelt']]);
	expect(engine.snapshot().current.id).toBe('b');
});

test('controlIncline:false never sends incline', async () => {
	moving();
	await engine.start({ ...twoSteps(), controlIncline: false });
	await engine.override({ incline: 4 });
	await clock.advance(10250);
	await clock.advance(10250);
	expect(adapter.calls.every(([, target]) => !target || target.incline === undefined)).toBe(true);
});

test('the last step ends with exactly one cool-down command, then completed', async () => {
	moving();
	await engine.start(twoSteps());
	await clock.advance(10250);
	moving(10);
	await clock.advance(10250);
	expect(adapter.calls).toEqual([
		['setTarget', { kph: 8, incline: 1 }],
		['setTarget', { kph: 10, incline: 2 }],
		['setTarget', { kph: 3.2, incline: 0 }]
	]);
	expect(engine.snapshot()).toMatchObject({ state: 'completed', endReason: 'completed' });
	expect(adapter.pauseBelt).not.toHaveBeenCalled();
});

test('a speed of 0 for 3 s that the engine did not ask for ends as treadmillStopped', async () => {
	moving();
	await engine.start(twoSteps());
	moving(0);
	await clock.advance(2500);
	expect(engine.state).toBe('running');
	await clock.advance(1000);
	expect(engine.snapshot()).toMatchObject({ state: 'ended', endReason: 'treadmillStopped' });
});

test('BLE console Pause/Idle mode ends as treadmillStopped', async () => {
	moving();
	await engine.start(twoSteps());
	moving(8, { mode: 'Pause' });
	expect(engine.snapshot().endReason).toBe('treadmillStopped');
});

test('a disconnect ends as connectionLost', async () => {
	moving();
	await engine.start(twoSteps());
	engine.onStatus({ connected: false });
	expect(engine.snapshot()).toMatchObject({ state: 'ended', endReason: 'connectionLost' });
});

test('a target not reached in 5 s is sent once more', async () => {
	moving(5);
	await engine.start(twoSteps());
	await clock.advance(5500);
	await clock.advance(3000);
	expect(adapter.calls).toEqual([['setTarget', { kph: 8, incline: 1 }], ['setTarget', { kph: 8, incline: 1 }]]);
});

test.each(['stop', 'completed', 'connectionLost', 'treadmillStopped'])('after the plan ends (%s) no adapter call is made for any later event (SC-005)', async how => {
	moving();
	await engine.start(twoSteps());
	if (how === 'stop') {
		await engine.stop();
	}
	else if (how === 'completed') {
		await clock.advance(20500);
	}
	else if (how === 'connectionLost') {
		engine.onStatus({ connected: false });
	}
	else {
		moving(0);
		await clock.advance(3500);
	}
	const before = adapter.calls.length;
	moving(12);
	moving(0);
	engine.onStatus({ connected: false });
	moving(5, { mode: 'Pause' });
	await clock.advance(60 * 60 * 1000);
	await expect(engine.override({ kph: 5 })).rejects.toMatchObject({ code: 'NOT_RUNNING' });
	await expect(engine.resume()).rejects.toMatchObject({ code: 'NOT_PAUSED' });
	await expect(engine.skip()).rejects.toMatchObject({ code: 'NOT_RUNNING' });
	expect(adapter.calls).toHaveLength(before);
	expect(clock.timerCount()).toBe(0);
});

test('stop ends as userStopped without stopping the belt', async () => {
	moving();
	await engine.start(twoSteps());
	await engine.stop();
	expect(engine.snapshot()).toMatchObject({ state: 'ended', endReason: 'userStopped' });
	expect(adapter.calls).toHaveLength(1);
});

test('the plan is a snapshot: editing the original does not change the session', async () => {
	moving();
	const plan = twoSteps();
	await engine.start(plan);
	plan.items[1].targetKph = 19;
	await engine.skip();
	expect(adapter.calls[1]).toEqual(['setTarget', { kph: 10, incline: 2 }]);
});

test('samples every second while running or paused carry the recorder fields', async () => {
	const samples = [];
	engine.on('sample', s => samples.push(s));
	moving(9, { hr: 0 });
	await engine.start(twoSteps());
	await clock.advance(3000);
	await engine.pause();
	await clock.advance(2000);
	expect(samples.length).toBeGreaterThanOrEqual(4);
	expect(samples[0]).toEqual({ t: expect.any(String), kph: 9, incline: 1, metres: expect.any(Number), hr: null, cadence: null, power: null, flatIndex: 0, estimated: false });
	expect(samples[samples.length - 1].kph).toBe(0);
});

test('the snapshot reports remaining time and distance for the step and plan', async () => {
	moving();
	await engine.start(fixture('intervals-6x.json'));
	const s = engine.snapshot();
	expect(s.stepRemaining).toEqual({ seconds: 300 });
	expect(s.planRemaining.seconds).toBe(1830);
	expect(s.stepCount).toBe(14);
});

test('dispose returns to idle (app restart) without sending anything', async () => {
	moving();
	await engine.start(twoSteps());
	engine.dispose();
	expect(engine.state).toBe('idle');
	await clock.advance(30000);
	expect(adapter.calls).toHaveLength(1);
});
