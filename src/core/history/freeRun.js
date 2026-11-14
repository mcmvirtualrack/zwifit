// Records runs started without a plan ("free runs": the belt started from the console or the
// dashboard's Start) for the history, through the same recorder as plan playback: it emits the
// engine's `event` (start / pause / resume / end) and `sample` (once a second) shapes.
//
// - A run is saved once the belt has moved for MIN_MOVING_MS in all (the samples from the start are
//   kept), or when Finish is pressed; trying the belt for a few seconds and walking away leaves
//   nothing behind.
// - The belt stopping (dashboard Pause, or the console) is a pause; it resumes when the belt moves
//   again (dashboard Resume, or the console).
// - finish() (dashboard Finish) ends and saves it as completed. As a safety net, a run left stopped
//   for IDLE_END_MS ends by itself at the moment it stopped (the idle time is dropped).
// - A plan starting, the treadmill disconnecting and stop() (Zwifit shutting down) end it too.
// - status() / 'status': { state, startedAt, seconds (moving), metres } for the dashboard.
const EventEmitter = require('events');
const { systemClock } = require('../../platform/clock');

const SAMPLE_MS = 1000;
const MIN_MOVING_MS = 60 * 1000;
const IDLE_END_MS = 30 * 60 * 1000;
const NAME = 'Free run';

class FreeRunTracker extends EventEmitter {
	constructor({ engine = null, clock = systemClock, minMovingMs = MIN_MOVING_MS, idleEndMs = IDLE_END_MS } = {}) {
		super();
		this._engine = engine;
		this._clock = clock;
		this._minMovingMs = minMovingMs;
		this._idleEndMs = idleEndMs;
		this._status = { connected: false, kph: 0, incline: 0 };
		this._timer = null;
		this._state = 'idle';
		this._reset();
		// A plan starting ends the free run first. Registered before the recorder attaches to the
		// engine, so the recorder sees this run end before the plan's start.
		this._onEngineEvent = event => {
			if (event.type === 'start') {
				this.end('userStopped');
			}
		};
		if (engine) {
			engine.on('event', this._onEngineEvent);
		}
	}

	// 'idle' | 'running' | 'paused' (saved to the history once it has moved MIN_MOVING_MS)
	get state() {
		return this._state;
	}

	onStatus(status) {
		this._status = status || this._status;
	}

	start() {
		if (!this._timer) {
			this._timer = this._clock.setInterval(() => this._tick(), SAMPLE_MS);
		}
	}

	stop() {
		this._clock.clearInterval(this._timer);
		this._timer = null;
		this.end('appRestart');
		if (this._engine) {
			this._engine.off('event', this._onEngineEvent);
		}
	}

	// Dashboard Finish: saves the run as completed, even one shorter than MIN_MOVING_MS.
	finish() {
		if (this._state !== 'idle' && !this._saved) {
			this._save();
		}
		this.end('completed');
	}

	// Ends the run now, at the last moment the belt moved. A run not saved yet (under
	// MIN_MOVING_MS of moving) is dropped.
	end(reason = 'userStopped') {
		if (this._state !== 'idle' && this._saved) {
			this.emit('event', { type: 'end', reason, flatIndex: 0, at: new Date(this._lastMovingAt).toISOString() });
		}
		this._reset();
	}

	status() {
		if (this._state === 'idle') {
			return { state: 'idle' };
		}
		return {
			state: this._state,
			startedAt: new Date(this._startedAt).toISOString(),
			seconds: Math.round(this._seconds),
			metres: Math.round(this._metres)
		};
	}

	// Hands the run so far to the recorder; from now on everything goes straight through.
	_save() {
		this.emit('event', { type: 'start', plan: null, name: NAME, startedAt: new Date(this._startedAt).toISOString() });
		this._saved = true;
		for (const [type, payload] of this._unsaved) {
			this.emit(type, payload);
		}
		this._unsaved = [];
	}

	// A sample or event for the recorder, kept back until the run is saved.
	_out(type, payload) {
		if (this._saved) {
			this.emit(type, payload);
		}
		else {
			this._unsaved.push([type, payload]);
		}
	}

	_setState(state) {
		const changed = state !== this._state;
		this._state = state;
		if (changed) {
			this.emit('status', this.status());
		}
	}

	_reset() {
		const wasIdle = this._state === 'idle';
		this._state = 'idle';
		this._saved = false;
		this._unsaved = [];
		// The stopped seconds of the current pause, sent only if the belt moves again.
		this._held = [];
		this._seconds = 0;
		this._metres = 0;
		this._startedAt = null;
		this._lastMovingAt = null;
		this._lastTickAt = null;
		this._pausedAt = null;
		if (!wasIdle) {
			this.emit('status', this.status());
		}
	}

	_tick() {
		const now = this._clock.now();
		if (this._engine && this._engine.isActive()) {
			// Plan playback records itself.
			this.end('userStopped');
			return;
		}
		const s = this._status;
		if (!s.connected) {
			this.end('connectionLost');
			return;
		}
		const moving = s.kph > 0;
		if (this._state === 'idle') {
			if (!moving) {
				return;
			}
			this._startedAt = now;
			this._lastTickAt = now;
			this._setState('running');
		}
		if (moving && this._lastTickAt !== null) {
			const elapsed = Math.max(0, (now - this._lastTickAt) / 1000);
			this._metres += s.kph * 1000 / 3600 * elapsed;
			this._seconds += elapsed;
		}
		this._lastTickAt = now;
		if (moving) {
			this._lastMovingAt = now;
		}
		const sample = this._sample(now, moving);

		if (this._state === 'running') {
			if (!moving) {
				this._pausedAt = now;
				this._held = [sample];
				this._setState('paused');
				return;
			}
			this._out('sample', sample);
		}
		else if (moving) {
			// Paused, and the belt moves again: the pause's stopped seconds go in after all.
			this._out('event', { type: 'pause' });
			for (const h of this._held) {
				this._out('sample', h);
			}
			this._held = [];
			this._out('event', { type: 'resume' });
			this._out('sample', sample);
			this._setState('running');
		}
		else {
			this._held.push(sample);
			if (now - this._pausedAt >= this._idleEndMs) {
				this.end('treadmillStopped');
			}
			return;
		}
		if (!this._saved && this._seconds * 1000 >= this._minMovingMs) {
			this._save();
		}
	}

	_sample(now, moving) {
		const s = this._status;
		return {
			t: new Date(now).toISOString(),
			kph: moving ? s.kph : 0,
			incline: s.incline || 0,
			metres: Math.round(this._metres * 10) / 10,
			hr: s.hr || null,
			cadence: s.cadence || null,
			power: s.power || null,
			flatIndex: 0,
			estimated: !!s.estimatedSpeed
		};
	}
}

module.exports = { FreeRunTracker, MIN_MOVING_MS, IDLE_END_MS, NAME };
