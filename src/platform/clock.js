// Time source injected into playback, recorder and security code so tests can control time.
// Looks timers up at call time so Jest fake timers apply.
const systemClock = {
	now: () => Date.now(),
	setTimeout: (fn, ms) => setTimeout(fn, ms),
	clearTimeout: handle => clearTimeout(handle),
	setInterval: (fn, ms) => setInterval(fn, ms),
	clearInterval: handle => clearInterval(handle)
};

module.exports = { systemClock, now: () => systemClock.now() };
