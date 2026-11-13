// Training plan playback (data-model.md "Playback Session" state machine).
//
//   idle/completed/ended ──start──▶ waiting (belt stopped) ──belt moves──▶ running
//   running ──pause──▶ paused ──resume──▶ running        (canResume=false: resuming, waits for belt)
//   running ──last step done──▶ completed                (one cool-down command, belt keeps going)
//   any active ──stop / connection lost / treadmill stopped──▶ ended(reason)
//
// Safety rules: the belt only restarts on an explicit resume; nothing outside limits is sent;
// once completed or ended, no further adapter call is made for any later event (SC-005).
const EventEmitter = require('events');
const { AppError } = require('../../lib/errors');
const { checkTarget } = require('../limits');
const { expand } = require('../plans/expand');
const { stepTotals } = require('../plans/totals');
const { validatePlan } = require('../plans/validate');

const TICK_MS = 250;
const SAMPLE_MS = 1000;
const STOPPED_GRACE_MS = 3000;
const RESEND_AFTER_MS = 5000;
const SPEED_TOLERANCE_KPH = 0.3;
const ACTIVE = new Set(['waiting', 'running', 'paused', 'resuming']);
const CONSOLE_STOP_MODES = new Set(['Pause', 'Idle']);

const WAITING_MESSAGE = 'Start the belt on your treadmill';
const RESUME_MESSAGE = 'Start the belt on your treadmill to continue';

class PlaybackEngine extends EventEmitter {
	constructor({ adapter, clock, getLimits, getSettings, log = { warn() {}, info() {} } }) {
		super();
		this._adapter = adapter;
		this._clock = clock;
		this._getLimits = getLimits;
		this._getSettings = getSettings;
		this._log = log;
		this._status = { connected: false, kph: 0, incline: 0, hr: null, estimatedSpeed: false };
		this._reset();
		this._state = 'idle';
	}

	_reset() {
		this._plan = null;
		this._flat = [];
		this._index = 0;
		this._step = { seconds: 0, metres: 0 };
		this._elapsed = { seconds: 0, metres: 0 };
		this._override = null;
		this._endReason = null;
		this._message = null;
		this._estimated = false;
		this._lastTickAt = null;
		this._lastSampleAt = null;
		this._stoppedSince = null;
		this._sent = null;
		this._controllerDeviceId = null;
		if (this._timer) {
			this._clock.clearInterval(this._timer);
		}
		this._timer = null;
	}

	get state() {
		return this._state;
	}

	isActive() {
		return ACTIVE.has(this._state);
	}

	runningPlanId() {
		return this.isActive() && this._plan ? this._plan.id : null;
	}

	// --- Commands -------------------------------------------------------------------------

	async start(plan, { deviceId } = {}) {
		if (this.isActive()) {
			throw new AppError('ALREADY_RUNNING', 'A plan is already running.');
		}
		if (!this._status.connected) {
			throw new AppError('NOT_CONNECTED', 'The treadmill is not connected.');
		}
		const errors = validatePlan(plan, { limits: this._getLimits() });
		if (errors.length) {
			throw new AppError('INVALID_PLAN', 'The plan does not fit the treadmill\'s current limits.', errors);
		}
		this._reset();
		this._plan = JSON.parse(JSON.stringify(plan));
		this._flat = expand(this._plan);
		this._controllerDeviceId = deviceId || null;
		this._timer = this._clock.setInterval(() => this._tick(), TICK_MS);
		if (this._status.kph > 0) {
			await this._begin();
		}
		else {
			this._state = 'waiting';
			this._message = WAITING_MESSAGE;
			this._emitState();
		}
	}

	async _begin() {
		this._state = 'running';
		this._message = null;
		this._lastTickAt = this._clock.now();
		this._lastSampleAt = this._lastTickAt;
		this.emit('event', { type: 'start', plan: this._plan, flat: this._flat, controllerDeviceId: this._controllerDeviceId });
		this.emit('event', { type: 'step', flatIndex: 0 });
		await this._sendStepTargets();
		this._emitState();
	}

	async pause() {
		if (this._state === 'waiting') {
			throw new AppError('NOT_RUNNING', 'The plan has not started yet.');
		}
		if (this._state !== 'running') {
			throw new AppError('NOT_RUNNING', 'The plan is not running.');
		}
		this._accumulate();
		this._state = 'paused';
		this._sent = null;
		this.emit('event', { type: 'pause' });
		// Pause with the belt already stopped sends no stop command.
		if (this._status.kph > 0) {
			await this._call(() => this._adapter.pauseBelt());
		}
		this._emitState();
	}

	// Only ever called for an explicit resume from a paired device (FR-015a).
	async resume() {
		if (this._state !== 'paused') {
			throw new AppError('NOT_PAUSED', 'The plan is not paused.');
		}
		if (!this._adapter.capabilities.canResume) {
			this._state = 'resuming';
			this._message = RESUME_MESSAGE;
			this._emitState();
			return;
		}
		try {
			await this._adapter.resumeBelt();
		}
		catch (err) {
			throw new AppError('RESUME_REFUSED', 'The treadmill would not restart. Start it from the console.', err.code ? [{ path: '', code: err.code, message: err.message }] : undefined);
		}
		await this._continue();
	}

	async _continue() {
		this._state = 'running';
		this._message = null;
		this._lastTickAt = this._clock.now();
		this._stoppedSince = null;
		this.emit('event', { type: 'resume' });
		await this._sendStepTargets();
		this._emitState();
	}

	async skip() {
		if (!['running', 'paused', 'resuming'].includes(this._state)) {
			throw new AppError('NOT_RUNNING', 'The plan is not running.');
		}
		this._accumulate();
		this.emit('event', { type: 'step', flatIndex: this._index, skipped: true });
		await this._advance({ skipped: true });
	}

	async stop() {
		if (!this.isActive()) {
			throw new AppError('NOT_RUNNING', 'No plan is running.');
		}
		if (this._state === 'waiting') {
			this._reset();
			this._state = 'idle';
			this._emitState();
			return;
		}
		this._end('userStopped');
	}

	// A manual change during playback: applies now, for the rest of the current step (FR-019).
	async override(target) {
		if (this._state !== 'running') {
			throw new AppError('NOT_RUNNING', 'The plan is not running.');
		}
		const send = { ...target };
		if (this._plan.controlIncline === false) {
			delete send.incline;
		}
		this._override = { ...this._override, ...target };
		this.emit('event', { type: 'override', target });
		if (Object.keys(send).length) {
			await this._call(() => this._adapter.setTarget(send));
			this._noteSent(send);
		}
		this._emitState();
	}

	// --- Treadmill input ------------------------------------------------------------------

	onStatus(status) {
		this._status = { ...this._status, ...status };
		if (!this.isActive()) {
			return;
		}
		if (!status.connected) {
			if (this._state === 'waiting') {
				this._reset();
				this._state = 'idle';
				this._message = 'The treadmill disconnected before the plan started.';
				this._emitState();
				return;
			}
			this._end('connectionLost');
			return;
		}
		if (this._state === 'waiting' && status.kph > 0) {
			this._begin().catch(err => this._log.warn('Could not start the plan', { message: err.message }));
			return;
		}
		if (this._state === 'resuming' && status.kph > 0) {
			this._continue().catch(err => this._log.warn('Could not continue the plan', { message: err.message }));
			return;
		}
		if (this._state === 'running') {
			if (status.mode && CONSOLE_STOP_MODES.has(status.mode)) {
				this._end('treadmillStopped');
				return;
			}
			if (status.kph <= 0) {
				this._stoppedSince = this._stoppedSince ?? this._clock.now();
			}
			else {
				this._stoppedSince = null;
			}
		}
	}

	// --- Internals ------------------------------------------------------------------------

	_tick() {
		if (!this.isActive()) {
			return;
		}
		const now = this._clock.now();
		if (this._state === 'running') {
			if (this._stoppedSince !== null && now - this._stoppedSince >= STOPPED_GRACE_MS) {
				this._end('treadmillStopped');
				return;
			}
			this._accumulate();
			this._checkTargetReached(now);
			const current = this._flat[this._index].step;
			const done = current.end.type === 'time' ? this._step.seconds >= current.end.seconds : this._step.metres >= current.end.metres;
			if (done) {
				this._advance({ skipped: false }).catch(err => this._log.warn('Could not move to the next step', { message: err.message }));
				return;
			}
		}
		if (this._state === 'running' || this._state === 'paused' || this._state === 'resuming') {
			if (now - this._lastSampleAt >= SAMPLE_MS) {
				this._lastSampleAt = now;
				this.emit('sample', this._sample());
				this._emitState();
			}
		}
	}

	_accumulate() {
		const now = this._clock.now();
		if (this._state === 'running' && this._lastTickAt !== null) {
			const seconds = Math.max(0, (now - this._lastTickAt) / 1000);
			const metres = Math.max(0, this._status.kph) / 3.6 * seconds;
			this._step.seconds += seconds;
			this._step.metres += metres;
			this._elapsed.seconds += seconds;
			this._elapsed.metres += metres;
			this._estimated = this._estimated || !!this._status.estimatedSpeed;
		}
		this._lastTickAt = now;
	}

	async _advance({ skipped }) {
		const from = this._index;
		this.emit('event', { type: 'stepEnd', flatIndex: from, skipped, seconds: this._step.seconds, metres: this._step.metres });
		this._index++;
		this._step = { seconds: 0, metres: 0 };
		this._override = null;
		if (this._index >= this._flat.length) {
			await this._complete();
			return;
		}
		this.emit('event', { type: 'step', flatIndex: this._index });
		if (this._state === 'running') {
			await this._sendStepTargets();
		}
		this._emitState();
	}

	async _complete() {
		const { cooldownKph } = this._getSettings();
		const target = this._plan.controlIncline === false ? { kph: cooldownKph } : { kph: cooldownKph, incline: 0 };
		const errors = checkTarget(target, this._getLimits());
		if (this._state === 'running') {
			if (errors.length) {
				this._log.warn('Cool-down speed is outside the treadmill limits; not sent', { codes: errors.map(e => e.code) });
			}
			else {
				await this._call(() => this._adapter.setTarget(target));
			}
		}
		this._index = this._flat.length - 1;
		this._end('completed');
	}

	_end(reason) {
		this._accumulate();
		this._state = reason === 'completed' ? 'completed' : 'ended';
		this._endReason = reason;
		this._message = null;
		this._clock.clearInterval(this._timer);
		this._timer = null;
		this.emit('event', { type: 'end', reason, flatIndex: this._index });
		this._emitState();
	}

	_targetsFor(step) {
		const target = { kph: step.targetKph };
		if (this._plan.controlIncline !== false) {
			target.incline = step.targetIncline;
		}
		return target;
	}

	async _sendStepTargets() {
		const target = this._targetsFor(this._flat[this._index].step);
		await this._call(() => this._adapter.setTarget(target));
		this._noteSent(target);
	}

	_noteSent(target) {
		if (target.kph !== undefined) {
			this._sent = { kph: target.kph, at: this._clock.now(), resent: false, target };
		}
	}

	// A target the belt hasn't reached after 5 s is sent once more (and logged).
	_checkTargetReached(now) {
		const sent = this._sent;
		if (!sent || sent.resent || now - sent.at < RESEND_AFTER_MS) {
			return;
		}
		if (Math.abs(this._status.kph - sent.kph) <= SPEED_TOLERANCE_KPH || this._status.estimatedSpeed) {
			this._sent = null;
			return;
		}
		sent.resent = true;
		this._log.warn('Treadmill did not reach the target speed; sending it again', { target: sent.kph, actual: this._status.kph });
		this._call(() => this._adapter.setTarget(sent.target)).catch(() => {});
	}

	// Every adapter call goes through here: nothing is sent once the session is over.
	async _call(fn) {
		if (!this.isActive()) {
			return;
		}
		try {
			await fn();
		}
		catch (err) {
			this._log.warn('Treadmill command failed', { code: err.code, message: err.message });
			if (err.code === 'NOT_CONNECTED') {
				this._end('connectionLost');
			}
		}
	}

	_sample() {
		return {
			t: new Date(this._clock.now()).toISOString(),
			kph: this._state === 'running' ? this._status.kph : 0,
			incline: this._status.incline,
			metres: Math.round(this._elapsed.metres * 10) / 10,
			hr: this._status.hr || null,
			cadence: this._status.cadence || null,
			power: this._status.power || null,
			flatIndex: this._index,
			estimated: !!this._status.estimatedSpeed
		};
	}

	_remaining() {
		if (!this._flat.length) {
			return { step: null, plan: null };
		}
		const current = this._flat[this._index].step;
		const step = current.end.type === 'time'
			? { seconds: Math.max(0, current.end.seconds - this._step.seconds) }
			: { metres: Math.max(0, current.end.metres - this._step.metres) };
		const metresPerSecond = current.targetKph / 3.6;
		let seconds = step.seconds ?? step.metres / metresPerSecond;
		let metres = step.metres ?? step.seconds * metresPerSecond;
		for (const entry of this._flat.slice(this._index + 1)) {
			const t = stepTotals(entry.step);
			seconds += t.seconds;
			metres += t.metres;
		}
		return { step, plan: { seconds: Math.round(seconds), metres: Math.round(metres) } };
	}

	snapshot() {
		const entry = this._flat[this._index];
		const next = this._flat[this._index + 1];
		const remaining = this.isActive() ? this._remaining() : { step: null, plan: null };
		const describe = e => e && {
			...e.step,
			flatIndex: e.flatIndex,
			repetition: e.repetition,
			repeatOf: e.repeatOf,
			blockLabel: e.blockLabel
		};
		return {
			state: this._state,
			planId: this._plan ? this._plan.id : null,
			planName: this._plan ? this._plan.name : null,
			cursor: entry ? { flatIndex: entry.flatIndex, itemIndex: entry.itemIndex, stepIndex: entry.stepIndex, repetition: entry.repetition } : null,
			stepCount: this._flat.length,
			current: describe(entry) || null,
			next: describe(next) || null,
			stepElapsed: { seconds: Math.round(this._step.seconds), metres: Math.round(this._step.metres) },
			planElapsed: { seconds: Math.round(this._elapsed.seconds), metres: Math.round(this._elapsed.metres) },
			stepRemaining: remaining.step,
			planRemaining: remaining.plan,
			override: this._override,
			controlIncline: this._plan ? this._plan.controlIncline !== false : true,
			estimated: this._estimated,
			endReason: this._endReason,
			message: this._message
		};
	}

	_emitState() {
		this.emit('state', this.snapshot());
	}

	// On app start the session is always idle; nothing resumes (FR-015a).
	dispose() {
		this._reset();
		this._state = 'idle';
	}
}

module.exports = { PlaybackEngine, WAITING_MESSAGE, RESUME_MESSAGE, STOPPED_GRACE_MS, RESEND_AFTER_MS };
