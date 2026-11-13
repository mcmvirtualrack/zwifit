// Pairing attempt limits (research R6): 5 failures per IP in 15 minutes locks that IP for
// 15 minutes; 30 failures in an hour from anywhere suspend pairing until a new code is made.
const { systemClock } = require('../platform/clock');

const MINUTE = 60 * 1000;
const MAX_TRACKED_IPS = 10000;

function createRateLimit({
	clock = systemClock,
	perIp = 5,
	windowMs = 15 * MINUTE,
	lockMs = 15 * MINUTE,
	globalMax = 30,
	globalWindowMs = 60 * MINUTE,
	suspended = false
} = {}) {
	const ips = new Map();
	let globalFailures = [];
	let isSuspendedNow = suspended;

	function entryFor(ip, now) {
		let entry = ips.get(ip);
		if (entry && entry.lockedUntil <= now && now - entry.firstAt > windowMs) {
			ips.delete(ip);
			entry = undefined;
		}
		return entry;
	}

	function check(ip) {
		if (isSuspendedNow) {
			return { allowed: false, reason: 'SUSPENDED' };
		}
		const now = clock.now();
		const entry = entryFor(ip, now);
		if (entry && entry.lockedUntil > now) {
			return { allowed: false, reason: 'LOCKED_OUT', retryAfterSeconds: Math.ceil((entry.lockedUntil - now) / 1000) };
		}
		return { allowed: true };
	}

	function prune(now) {
		for (const [ip, entry] of ips) {
			if (entry.lockedUntil <= now && now - entry.firstAt > windowMs) {
				ips.delete(ip);
			}
		}
		// Still too many (a flood within one window): drop the oldest.
		while (ips.size >= MAX_TRACKED_IPS) {
			ips.delete(ips.keys().next().value);
		}
	}

	function fail(ip) {
		const now = clock.now();
		let entry = entryFor(ip, now);
		if (!entry) {
			if (ips.size >= MAX_TRACKED_IPS) {
				prune(now);
			}
			entry = { count: 0, firstAt: now, lockedUntil: 0 };
			ips.set(ip, entry);
		}
		entry.count++;
		if (entry.count >= perIp) {
			entry.lockedUntil = now + lockMs;
		}

		globalFailures = globalFailures.filter(t => now - t < globalWindowMs);
		globalFailures.push(now);
		if (globalFailures.length >= globalMax) {
			isSuspendedNow = true;
		}
	}

	function succeed(ip) {
		ips.delete(ip);
	}

	// A new pairing code lifts the global suspension.
	function reset() {
		isSuspendedNow = false;
		globalFailures = [];
	}

	return {
		check,
		fail,
		succeed,
		reset,
		isSuspended: () => isSuspendedNow,
		suspend: () => { isSuspendedNow = true; },
		trackedIps: () => ips.size
	};
}

module.exports = { createRateLimit };
