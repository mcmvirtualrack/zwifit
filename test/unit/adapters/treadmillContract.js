// Shared TreadmillAdapter contract (contracts/adapters.md). Each adapter's test file calls this
// with a factory: makeAdapter({ limits, canResume, heartRate }) → { adapter, ready?, sent?, cleanup? }.
// Uses Jest fake timers; the factory must build the adapter after they are installed.

const LIMITS = { minKph: 0, maxKph: 20, minIncline: 0, maxIncline: 15 };

function treadmillContract(name, makeAdapter) {
	describe(`${name} adapter contract`, () => {
		let made;
		const build = options => {
			made = makeAdapter({ limits: LIMITS, ...options });
			return made.adapter;
		};

		beforeEach(() => {
			jest.useFakeTimers();
		});

		afterEach(async () => {
			if (made) {
				await made.adapter.stop();
				if (made.cleanup) {
					await made.cleanup();
				}
				made = null;
			}
			jest.useRealTimers();
		});

		const nextStatus = adapter => new Promise(resolve => adapter.once('status', resolve));
		// start(), then wait until the test double reports the (fake) hardware connected.
		const startReady = async adapter => {
			await adapter.start();
			if (made.ready) {
				await made.ready();
			}
		};

		test('declares transport and capabilities', () => {
			const adapter = build();
			expect(['wifi', 'ble', 'simulated']).toContain(adapter.transport);
			expect(adapter.capabilities).toEqual({
				canControl: expect.any(Boolean),
				canPause: expect.any(Boolean),
				canResume: expect.any(Boolean)
			});
		});

		test('start() resolves', async () => {
			const adapter = build();
			await expect(adapter.start()).resolves.toBeUndefined();
		});

		test('emits status in km/h with hr null when absent', async () => {
			const adapter = build({ heartRate: false });
			const status = nextStatus(adapter);
			await startReady(adapter);
			jest.advanceTimersByTime(1000);
			const s = await status;
			expect(typeof s.kph).toBe('number');
			expect(s.kph).toBeGreaterThanOrEqual(0);
			expect(typeof s.incline).toBe('number');
			expect(s.hr).toBeNull();
			expect(typeof s.estimatedSpeed).toBe('boolean');
			expect(typeof s.connected).toBe('boolean');
		});

		test('limits() is null or a full limits object', () => {
			const limits = build().limits();
			if (limits !== null) {
				expect(limits).toEqual({
					minKph: expect.any(Number), maxKph: expect.any(Number),
					minIncline: expect.any(Number), maxIncline: expect.any(Number)
				});
			}
		});

		test.each([
			[{ kph: 25 }, 'ABOVE_MAX_SPEED'],
			[{ kph: -1 }, 'BELOW_MIN_SPEED'],
			[{ incline: 16 }, 'ABOVE_MAX_INCLINE'],
			[{ kph: Number.NaN }, 'NOT_A_NUMBER']
		])('setTarget(%j) rejects with OUT_OF_RANGE / %s instead of clamping', async (target, code) => {
			const adapter = build();
			await startReady(adapter);
			await expect(adapter.setTarget(target)).rejects.toMatchObject({
				code: 'OUT_OF_RANGE',
				details: [expect.objectContaining({ code })]
			});
			if (made.sent) {
				expect(made.sent()).toEqual([]);
			}
		});

		test('setTarget within limits resolves', async () => {
			const adapter = build();
			await startReady(adapter);
			await expect(adapter.setTarget({ kph: 8, incline: 2 })).resolves.toBeUndefined();
		});

		test('resumeBelt rejects RESUME_UNSUPPORTED when the adapter cannot resume', async () => {
			const adapter = build({ canResume: false });
			await adapter.start();
			expect(adapter.capabilities.canResume).toBe(false);
			await expect(adapter.resumeBelt()).rejects.toMatchObject({ code: 'RESUME_UNSUPPORTED' });
		});

		test('stop() clears its timers', async () => {
			const adapter = build();
			await adapter.start();
			await adapter.stop();
			expect(jest.getTimerCount()).toBe(0);
		});
	});
}

module.exports = { treadmillContract, LIMITS };
