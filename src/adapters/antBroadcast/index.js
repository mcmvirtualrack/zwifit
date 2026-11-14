// ANT+ broadcast (specs/003-ant-plus-broadcast): Zwifit appears as up to four ANT+ sensors, a
// footpod, heart rate monitor, power meter and treadmill (fitness equipment), on transmit
// channels 3–6 of the stick AntSensors already uses for reception (channels 0–2). AntSensors owns
// the stick; this adapter sets its channels up on 'stick' and forgets them on 'stick-lost'.
//
// Transmit only (FR-008): anything a receiver sends on these channels (control pages, requests)
// is dropped. Nothing here can reach the treadmill.
const EventEmitter = require('events');
const crypto = require('crypto');
const msg = require('../../core/antBroadcast/messages');
const { validInput, createCounters, advance, powerEvent } = require('../../core/antBroadcast/counters');
const { nextPage, createSchedule } = require('../../core/antBroadcast/schedule');

const KINDS = ['footpod', 'hr', 'power', 'treadmill'];
// research.md R3: channel, device type, transmission type, period (32768 / Hz).
const PROFILES = {
	footpod: { channel: 3, deviceType: 124, transType: 5, period: 8134 },
	hr: { channel: 4, deviceType: 120, transType: 1, period: 8070 },
	power: { channel: 5, deviceType: 11, transType: 5, period: 8182 },
	treadmill: { channel: 6, deviceType: 17, transType: 5, period: 8192 }
};
const RF_CHANNEL = 57;
const RESPONSE_TIMEOUT_MS = 2000;
// Wait before trying again to set up a channel the stick refused.
const RETRY_MS = 5000;
const NOTES = {
	hr: { missing: 'No heart rate right now', ant: 'Heart rate comes from an ANT+ sensor; pair your device with it directly' },
	power: { missing: 'No power right now', ant: 'Power comes from an ANT+ sensor; pair your device with it directly' },
	failed: 'Could not start this sensor on the ANT+ stick. Trying again…'
};
const RESTART_REASON = 'Restart Zwifit to use the ANT+ stick for broadcasting (it was not in use when Zwifit started).';
const PAUSED_REASON = 'Paused while scanning for sensors';

const kindOf = channel => KINDS.find(k => PROFILES[k].channel === channel);

class AntBroadcast extends EventEmitter {
	constructor({ host, getSettings, saveDeviceNumbers, now = Date.now, randomInt = crypto.randomInt, getLimits = () => ({}), responseTimeoutMs = RESPONSE_TIMEOUT_MS, retryMs = RETRY_MS }) {
		super();
		this._host = host || null;
		this._getSettings = getSettings;
		this._saveDeviceNumbers = saveDeviceNumbers;
		this._now = now;
		this._randomInt = randomInt;
		this._getLimits = getLimits;
		this._responseTimeoutMs = responseTimeoutMs;
		this._retryMs = retryMs;
		this._stopped = true;
		this._stick = null;
		this._hostSpoke = false;
		// kind → { state: 'opening' | 'open' | 'closing', deviceNumber, schedule }
		this._channels = new Map();
		// kind → time a set-up failed (retried after retryMs)
		this._failed = new Map();
		// Running totals per sensor; never reset while Zwifit runs.
		this._counters = Object.fromEntries(KINDS.map(k => [k, createCounters()]));
		this._lastTxAt = {};
		this._input = validInput(null);
		this._pendingNumbers = null;
		this._waiters = new Set();
		this._work = Promise.resolve();
		this._lastStatus = '';
		this._onStick = stick => this._attach(stick);
		this._onStickLost = stick => this._detach(stick);
		this._onHostStatus = () => {
			this._hostSpoke = true;
			this._refresh();
		};
		this._onRead = data => this._read(data);
	}

	_settings() {
		const all = this._getSettings() || {};
		const s = all.antBroadcast || {};
		return { ...s, rebroadcastAnt: { ...s.rebroadcastAnt } };
	}

	deviceNumbers() {
		return { ...this._settings().deviceNumbers, ...this._pendingNumbers };
	}

	async start() {
		if (!this._stopped) {
			return;
		}
		this._stopped = false;
		if (this._host) {
			this._host.on('stick', this._onStick);
			this._host.on('stick-lost', this._onStickLost);
			this._host.on('status', this._onHostStatus);
			if (this._host.stickReady()) {
				this._attach(this._host.currentStick());
			}
		}
		this._reconcile();
		await this._work;
		this._refresh();
	}

	async stop() {
		if (this._stopped) {
			return;
		}
		this._stopped = true;
		if (this._host) {
			this._host.off('stick', this._onStick);
			this._host.off('stick-lost', this._onStickLost);
			this._host.off('status', this._onHostStatus);
		}
		await this._queue(async () => {
			for (const kind of [...this._channels.keys()]) {
				await this._close(kind);
			}
		});
		if (this._stick) {
			this._stick.off('read', this._onRead);
			this._stick = null;
		}
		this._rejectWaiters();
	}

	// Latest merged treadmill status (kph and incline already 0 while disconnected).
	update(status) {
		this._input = validInput(status, this._getLimits() || {});
		this._reconcile();
		this._refresh();
	}

	// Settings changed: apply the switches now instead of on the next treadmill update (R7).
	refresh() {
		if (!this._stopped) {
			this._reconcile();
		}
		this._refresh();
	}

	// New random device numbers for every sensor; open channels reopen under them at once.
	async renumber() {
		const current = Object.values(this.deviceNumbers());
		const numbers = {};
		for (const kind of KINDS) {
			numbers[kind] = this._draw([...current, ...Object.values(numbers)]);
		}
		await this._queue(() => this._persist(numbers));
		this._reconcile();
		await this._work;
		this._refresh();
		return { ...numbers };
	}

	status() {
		const s = this._settings();
		if (!s.enabled) {
			return { state: 'off', sensors: [] };
		}
		const numbers = this.deviceNumbers();
		const sensors = KINDS.filter(k => s[k] !== false).map(kind => {
			const sending = this._channels.get(kind)?.state === 'open';
			const entry = { kind, deviceNumber: numbers[kind] ?? null, sending };
			const note = sending ? null : this._note(kind, s);
			return note ? { ...entry, note } : entry;
		});
		if (!this._host) {
			return { state: 'error', reason: RESTART_REASON, needsRestart: true, sensors };
		}
		if (!this._stick) {
			const host = this._host.status() || {};
			if (host.scan && host.scan.active) {
				return { state: 'paused', reason: PAUSED_REASON, sensors };
			}
			if (this._hostSpoke && host.available === false && host.reason) {
				return { state: 'error', reason: host.reason, sensors };
			}
			return { state: 'starting', sensors };
		}
		const opening = sensors.some(x => this._channels.get(x.kind)?.state === 'opening');
		return { state: opening && !sensors.some(x => x.sending) ? 'starting' : 'broadcasting', sensors };
	}

	_note(kind, s) {
		if (this._failed.has(kind)) {
			return NOTES.failed;
		}
		if (kind === 'hr' || kind === 'power') {
			if (this._input[kind] === null) {
				return NOTES[kind].missing;
			}
			if (!this._allowed(kind, s)) {
				return NOTES[kind].ant;
			}
		}
		return null;
	}

	_allowed(kind, s) {
		return this._input[`${kind}Source`] !== 'ant' || s.rebroadcastAnt[kind] === true;
	}

	_wanted(kind, s) {
		if (!s.enabled || s[kind] === false) {
			return false;
		}
		if (kind === 'hr' || kind === 'power') {
			return this._input[kind] !== null && this._allowed(kind, s);
		}
		return true;
	}

	_refresh() {
		const status = this.status();
		const json = JSON.stringify(status);
		if (json !== this._lastStatus) {
			this._lastStatus = json;
			this.emit('status', status);
		}
	}

	// Runs channel work one step at a time, in order.
	_queue(fn) {
		const run = this._work.then(fn).catch(() => {});
		this._work = run;
		return run;
	}

	_reconcile() {
		if (this._reconciling) {
			this._again = true;
			return;
		}
		this._reconciling = true;
		this._queue(async () => {
			do {
				this._again = false;
				await this._reconcileOnce();
			} while (this._again && !this._stopped);
		}).finally(() => {
			this._reconciling = false;
			this._refresh();
		});
	}

	async _reconcileOnce() {
		const s = this._settings();
		if (s.enabled && !this._stopped) {
			await this._ensureNumbers();
		}
		const numbers = this.deviceNumbers();
		for (const kind of KINDS) {
			const channel = this._channels.get(kind);
			const wanted = !this._stopped && this._stick && this._wanted(kind, s);
			if (channel && (!wanted || channel.deviceNumber !== numbers[kind])) {
				await this._close(kind);
			}
			if (wanted && !this._channels.has(kind) && numbers[kind]) {
				const failedAt = this._failed.get(kind);
				if (failedAt === undefined || this._now() - failedAt >= this._retryMs) {
					await this._open(kind, numbers[kind]);
				}
			}
		}
	}

	_draw(taken) {
		for (let i = 0; i < 100; i++) {
			const n = this._randomInt(1, 65536);
			if (Number.isInteger(n) && n >= 1 && n <= 65535 && !taken.includes(n)) {
				return n;
			}
		}
		throw new Error('Could not draw a free ANT+ device number');
	}

	async _ensureNumbers() {
		const numbers = this.deviceNumbers();
		const missing = KINDS.filter(k => !Number.isInteger(numbers[k]));
		if (!missing.length) {
			return;
		}
		for (const kind of missing) {
			numbers[kind] = this._draw(Object.values(numbers).filter(Number.isInteger));
		}
		await this._persist(numbers);
	}

	async _persist(numbers) {
		this._pendingNumbers = { ...numbers };
		try {
			await this._saveDeviceNumbers({ ...numbers });
			this._pendingNumbers = null;
		}
		catch {
			// Kept in memory; saved again the next time numbers change.
		}
	}

	_attach(stick) {
		if (!stick || this._stopped || stick === this._stick) {
			return;
		}
		if (this._stick) {
			this._detach(this._stick);
		}
		this._stick = stick;
		this._failed.clear();
		stick.on('read', this._onRead);
		this._reconcile();
		this._refresh();
	}

	// The host is letting go of the stick: forget the channels without writing to it.
	_detach(stick) {
		if (!stick || stick !== this._stick) {
			return;
		}
		stick.off('read', this._onRead);
		this._stick = null;
		this._channels.clear();
		this._rejectWaiters();
		this._refresh();
	}

	_rejectWaiters() {
		for (const w of this._waiters) {
			clearTimeout(w.timer);
			w.reject(new Error('ANT+ stick released'));
		}
		this._waiters.clear();
	}

	_read(data) {
		const frame = msg.parse(data);
		if (!frame) {
			return;
		}
		const kind = kindOf(frame.channel);
		if (!kind) {
			return;
		}
		if (frame.id === msg.ID.CHANNEL_EVENT) {
			for (const w of [...this._waiters]) {
				if (w.channel === frame.channel && w.match(frame.data)) {
					this._waiters.delete(w);
					clearTimeout(w.timer);
					w.resolve(frame.data);
				}
			}
			if (frame.data[0] === 0x01 && frame.data[1] === msg.EVENT_TX && this._channels.get(kind)?.state === 'open') {
				this._send(kind);
			}
		}
		// Anything else on our channels (acknowledged, broadcast or burst data from a receiver,
		// e.g. FE control pages 48–51 or request page 70) is ignored: FR-008.
	}

	_wait(channel, match) {
		return new Promise((resolve, reject) => {
			const w = { channel, match, resolve, reject };
			w.timer = setTimeout(() => {
				this._waiters.delete(w);
				reject(new Error('The ANT+ stick did not answer'));
			}, this._responseTimeoutMs);
			this._waiters.add(w);
		});
	}

	// Writes a configuration command and waits for the stick's RESPONSE_NO_ERROR.
	async _command(stick, bytes) {
		const [, , id, channel] = bytes;
		const answered = this._wait(channel, data => data[0] === id);
		// If the write throws, nobody awaits `answered`; it still settles (timeout or release).
		answered.catch(() => {});
		await stick.write(Uint8Array.from(bytes));
		const [, code] = await answered;
		if (code !== 0) {
			throw new Error(`The ANT+ stick refused the command (code ${code})`);
		}
	}

	async _open(kind, deviceNumber) {
		const stick = this._stick;
		const p = PROFILES[kind];
		const channel = { state: 'opening', deviceNumber, schedule: createSchedule() };
		this._channels.set(kind, channel);
		this._refresh();
		try {
			for (const bytes of [
				msg.assignChannel(p.channel),
				msg.setChannelId(p.channel, deviceNumber, p.deviceType, p.transType),
				msg.setFrequency(p.channel, RF_CHANNEL),
				msg.setPeriod(p.channel, p.period),
				msg.openChannel(p.channel)
			]) {
				await this._command(stick, bytes);
			}
		}
		catch {
			if (this._stick === stick && this._channels.get(kind) === channel) {
				this._channels.delete(kind);
				this._failed.set(kind, this._now());
			}
			return;
		}
		if (this._stick !== stick || this._channels.get(kind) !== channel) {
			return;
		}
		this._failed.delete(kind);
		channel.state = 'open';
		// HR beats and power events count from now, not from the last time the channel was open.
		if (kind === 'hr' || kind === 'power') {
			this._lastTxAt[kind] = this._now();
		}
		// Load the first page so the channel never sends an empty buffer.
		this._send(kind);
		this._refresh();
	}

	async _close(kind) {
		const channel = this._channels.get(kind);
		const stick = this._stick;
		this._channels.delete(kind);
		if (!channel || !stick) {
			return;
		}
		channel.state = 'closing';
		const ch = PROFILES[kind].channel;
		try {
			const closed = this._wait(ch, data => data[0] === 0x01 && data[1] === msg.EVENT_CHANNEL_CLOSED);
			closed.catch(() => {});
			await this._command(stick, msg.closeChannel(ch));
			await closed;
			await this._command(stick, msg.unassignChannel(ch));
		}
		catch {
			// The stick went away or is reset on the next open; nothing more to do here.
		}
	}

	_values(kind, counters) {
		const input = this._input;
		const kph = input.kph ?? 0;
		const moving = kph > 0;
		const strides = typeof input.cadence === 'number' ? input.cadence / 2 : null;
		switch (kind) {
			case 'footpod':
				return { seconds: counters.seconds, metres: counters.metres, kph, strides: counters.strides, cadence: strides, moving };
			case 'hr':
				return { prevBeatTime: counters.prevBeatTime, beatTime: counters.beatTime, beats: counters.beats, hr: input.hr ?? 0 };
			case 'power':
				return { events: counters.events, accumulatedPower: counters.accumulatedPower, power: input.power ?? 0 };
			default:
				return { elapsed: counters.seconds, metres: counters.metres, kph, hr: input.hr, incline: input.incline ?? 0, cadence: strides, climb: counters.climb, moving };
		}
	}

	// Answers an EVENT_TX: advances this sensor's counters and writes its next page.
	_send(kind) {
		const channel = this._channels.get(kind);
		const stick = this._stick;
		if (!channel || !stick) {
			return;
		}
		const now = this._now();
		const last = this._lastTxAt[kind];
		this._lastTxAt[kind] = now;
		let counters = advance(this._counters[kind], this._input, last === undefined ? 0 : now - last);
		if (kind === 'power') {
			counters = powerEvent(counters, this._input.power);
		}
		this._counters[kind] = counters;
		const { page, state } = nextPage(kind, channel.schedule, this._values(kind, counters));
		channel.schedule = state;
		Promise.resolve()
			.then(() => stick.write(Uint8Array.from(msg.broadcastData(PROFILES[kind].channel, page))))
			.catch(() => {
				// The stick vanished mid-write; AntSensors notices and sends 'stick-lost'.
			});
	}
}

module.exports = { AntBroadcast, PROFILES, KINDS };
