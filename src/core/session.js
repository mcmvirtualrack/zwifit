// Pure helpers for live session values (ported from the time/distance tracking and ramping in the
// old src/bluetooth/index.js). No timers or I/O: callers pass the current time.

const IDLE_RESET_MS = 60 * 60 * 1000;

// Distance and moving time. Resets when the belt starts again after an hour stopped.
function createOdometer() {
	return { metres: 0, seconds: 0, lastAt: null, stoppedSince: null };
}

function advanceOdometer(state, kph, now) {
	const next = { ...state };
	const moving = kph > 0;
	if (moving && next.stoppedSince !== null && now - next.stoppedSince >= IDLE_RESET_MS) {
		next.metres = 0;
		next.seconds = 0;
	}
	if (moving && next.lastAt !== null && next.stoppedSince === null) {
		const elapsed = Math.max(0, (now - next.lastAt) / 1000);
		next.seconds += elapsed;
		next.metres += kph * 1000 / 3600 * elapsed;
	}
	next.stoppedSince = moving ? null : (next.stoppedSince ?? now);
	next.lastAt = now;
	return next;
}

// Moves `current` 20 % of the way to `target` per call, snapping when within `snap`
// (the old broadcaster's 5 Hz smoothing, so Zwift sees gradual changes).
function ramp(current, target, snap = 0.04) {
	const delta = target - current;
	return Math.abs(delta) <= snap ? target : current + delta * 0.2;
}

module.exports = { createOdometer, advanceOdometer, ramp, IDLE_RESET_MS };
