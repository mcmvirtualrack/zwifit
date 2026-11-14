// Free runs (no plan) recorded into the history through the same recorder as plan playback.
const EventEmitter = require('events');
const { FreeRunTracker } = require('../../../../src/core/history/freeRun');
const { createRecorder } = require('../../../../src/core/history/recorder');

const START = Date.parse('2026-11-01T10:00:00Z');

function fakeClock() {
	let now = START;
	const timers = new Map();
	let nextId = 1;
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
		// Moves time on in 1 s steps, running interval timers as they fall due.
		advance(ms) {
			const end = now + ms;
			while (now < end) {
				now = Math.min(end, now + 1000);
				for (const t of [...timers.values()]) {
					while (t.due <= now) {
						t.due += t.ms;
						t.fn();
					}
				}
			}
		}
	};
}

function memoryRepo() {
	const files = { headers: {}, samples: {}, finished: {} };
	return {
		files,
		create: async h => { files.headers[h.id] = h; files.samples[h.id] = []; },
		appendSample: async (id, s) => { files.samples[id].push(s); },
		finish: async w => { files.finished[w.id] = w; }
	};
}

class FakeEngine extends EventEmitter {
	constructor() {
		super();
		this.active = false;
	}

	isActive() {
		return this.active;
	}
}

let clock;
let engine;
let tracker;
let repo;
let recorder;
let ids;
beforeEach(() => {
	clock = fakeClock();
	engine = new FakeEngine();
	tracker = new FreeRunTracker({ engine, clock, minMovingMs: 60000, idleEndMs: 300000 });
	repo = memoryRepo();
	ids = 0;
	recorder = createRecorder({ repo, newId: () => `run${++ids}`, now: clock.now });
	recorder.attach(engine);
	recorder.attach(tracker);
	tracker.start();
});

const belt = (kph, extra = {}) => tracker.onStatus({ connected: true, kph, incline: 1, hr: 140, ...extra });
const finished = () => Object.values(repo.files.finished);

test('a belt run under a minute is paused, not saved; left alone past the safety limit it is dropped', async () => {
	belt(8);
	clock.advance(30000);
	belt(0);
	clock.advance(10000);
	await recorder.flush();
	expect(tracker.state).toBe('paused');
	expect(repo.files.headers).toEqual({});
	clock.advance(300000);
	await recorder.flush();
	expect(tracker.state).toBe('idle');
	expect(repo.files.headers).toEqual({});
});

test('short pieces add up: paused before a minute, saved once a minute of moving is reached', async () => {
	belt(8);
	clock.advance(40000);
	belt(0);
	clock.advance(5000);
	belt(8);
	clock.advance(40000);
	await recorder.flush();
	const [header] = Object.values(repo.files.headers);
	expect(header).toMatchObject({ planName: 'Free run', startedAt: new Date(START + 1000).toISOString() });
	const samples = repo.files.samples[header.id];
	expect(samples[0].t).toBe(new Date(START + 1000).toISOString());
	expect(samples.filter(x => x.event === 'pause')).toHaveLength(1);
	expect(samples.filter(x => x.event === 'resume')).toHaveLength(1);
});

test('a run is saved from its first second once it lasts a minute, named "Free run"', async () => {
	belt(10.8);
	clock.advance(90000);
	await recorder.flush();
	const [header] = Object.values(repo.files.headers);
	expect(header).toMatchObject({ planId: null, planName: 'Free run', planSnapshot: null, startedAt: new Date(START + 1000).toISOString() });
	const samples = repo.files.samples[header.id];
	expect(samples).toHaveLength(90);
	expect(samples[0]).toMatchObject({ kph: 10.8, incline: 1, hr: 140, flatIndex: 0 });
	// 10.8 km/h = 3 m/s.
	expect(samples.at(-1).metres).toBeCloseTo(267, 0);
});

test('a stop is a pause; left stopped past the safety limit the run ends when the belt stopped', async () => {
	belt(9);
	clock.advance(120000);
	belt(0);
	clock.advance(20000);
	belt(9);
	clock.advance(60000);
	belt(0);
	const lastMoving = clock.now();
	// The first stopped second is seen on the next tick; 5 minutes from there.
	clock.advance(300000);
	expect(finished()).toEqual([]);
	clock.advance(1000);
	await recorder.flush();
	const [w] = finished();
	expect(w.endReason).toBe('treadmillStopped');
	expect(w.endedAt).toBe(new Date(lastMoving).toISOString());
	const samples = repo.files.samples[w.id];
	expect(samples.filter(s => s.event === 'pause')).toHaveLength(1);
	expect(samples.filter(s => s.event === 'resume')).toHaveLength(1);
	// The pause's stopped seconds are kept; the final 5 minutes stopped are not.
	expect(samples.filter(s => s.kph === 0 && !s.event)).toHaveLength(19);
	expect(Date.parse(samples.at(-1).t)).toBe(lastMoving);
	expect(w.totals.seconds).toBe(199);
	expect(tracker.state).toBe('idle');
});

test('Pause (belt stopped) keeps the run open; Finish saves it as completed', async () => {
	const statuses = [];
	tracker.on('status', s => statuses.push(s.state));
	belt(8);
	clock.advance(70000);
	belt(0);
	clock.advance(60000);
	expect(tracker.status()).toMatchObject({ state: 'paused', seconds: 69, metres: 153 });
	belt(8);
	clock.advance(10000);
	expect(tracker.status()).toMatchObject({ state: 'running', seconds: 79 });
	tracker.finish();
	await recorder.flush();
	expect(finished()).toEqual([expect.objectContaining({ endReason: 'completed', planName: 'Free run' })]);
	expect(tracker.status()).toEqual({ state: 'idle' });
	expect(statuses).toEqual(['running', 'paused', 'running', 'idle']);
});

test('Finish saves even a run shorter than a minute', async () => {
	belt(8);
	clock.advance(20000);
	expect(tracker.status().state).toBe('running');
	tracker.finish();
	await recorder.flush();
	const [w] = finished();
	expect(w).toMatchObject({ endReason: 'completed', totals: expect.objectContaining({ seconds: 19 }) });
	expect(repo.files.samples[w.id]).toHaveLength(21);
});

test('starting a plan ends the free run before the plan is recorded', async () => {
	belt(8);
	clock.advance(70000);
	engine.active = true;
	engine.emit('event', { type: 'start', plan: { id: 'p1', name: 'Plan', items: [] } });
	clock.advance(5000);
	await recorder.flush();
	expect(finished()).toEqual([expect.objectContaining({ id: 'run1', endReason: 'userStopped' })]);
	expect(repo.files.headers.run2).toMatchObject({ planName: 'Plan' });
	expect(tracker.state).toBe('idle');
});

test('the treadmill disconnecting ends the run; Zwifit stopping ends it as a restart', async () => {
	belt(8);
	clock.advance(70000);
	tracker.onStatus({ connected: false, kph: 0, incline: 0 });
	clock.advance(1000);
	belt(8);
	clock.advance(70000);
	tracker.stop();
	await recorder.flush();
	expect(finished().map(w => w.endReason)).toEqual(['connectionLost', 'appRestart']);
});
