const { createRateLimit } = require('../../../src/security/rateLimit');

const MIN = 60 * 1000;
let now;
let limiter;
beforeEach(() => {
	now = 1_000_000;
	limiter = createRateLimit({ clock: { now: () => now } });
});

const failTimes = (ip, n) => {
	for (let i = 0; i < n; i++) {
		limiter.fail(ip);
	}
};

test('allows attempts until 5 failures, then locks the IP for 15 minutes', () => {
	failTimes('10.0.0.2', 4);
	expect(limiter.check('10.0.0.2')).toEqual({ allowed: true });
	limiter.fail('10.0.0.2');
	expect(limiter.check('10.0.0.2')).toEqual({ allowed: false, reason: 'LOCKED_OUT', retryAfterSeconds: 900 });
	now += 10 * MIN;
	expect(limiter.check('10.0.0.2')).toEqual({ allowed: false, reason: 'LOCKED_OUT', retryAfterSeconds: 300 });
	now += 5 * MIN;
	expect(limiter.check('10.0.0.2')).toEqual({ allowed: true });
});

test('failures older than 15 minutes do not count', () => {
	failTimes('10.0.0.2', 4);
	now += 16 * MIN;
	failTimes('10.0.0.2', 4);
	expect(limiter.check('10.0.0.2').allowed).toBe(true);
});

test('one IP being locked does not affect another', () => {
	failTimes('10.0.0.2', 5);
	expect(limiter.check('10.0.0.3')).toEqual({ allowed: true });
});

test('a success clears only that IP', () => {
	failTimes('10.0.0.2', 4);
	failTimes('10.0.0.3', 4);
	limiter.succeed('10.0.0.3');
	limiter.fail('10.0.0.3');
	limiter.fail('10.0.0.2');
	expect(limiter.check('10.0.0.3').allowed).toBe(true);
	expect(limiter.check('10.0.0.2').allowed).toBe(false);
});

test('30 failures within an hour from any IPs suspend pairing until reset', () => {
	for (let i = 0; i < 30; i++) {
		limiter.fail(`10.0.1.${i}`);
	}
	expect(limiter.isSuspended()).toBe(true);
	expect(limiter.check('10.0.9.9')).toEqual({ allowed: false, reason: 'SUSPENDED' });
	now += 2 * 60 * MIN;
	expect(limiter.check('10.0.9.9')).toEqual({ allowed: false, reason: 'SUSPENDED' });
	limiter.reset();
	expect(limiter.check('10.0.9.9')).toEqual({ allowed: true });
});

test('29 failures spread over more than an hour do not suspend', () => {
	for (let i = 0; i < 29; i++) {
		limiter.fail(`10.0.1.${i}`);
	}
	now += 61 * MIN;
	limiter.fail('10.0.2.1');
	expect(limiter.isSuspended()).toBe(false);
});

test('can start suspended (persisted state)', () => {
	limiter = createRateLimit({ clock: { now: () => now }, suspended: true });
	expect(limiter.check('10.0.0.2')).toEqual({ allowed: false, reason: 'SUSPENDED' });
});

test('tracked IPs are bounded', () => {
	for (let i = 0; i < 20000; i++) {
		limiter.fail(`ip-${i}`);
		now += 1;
	}
	expect(limiter.trackedIps()).toBeLessThanOrEqual(10000);
});
