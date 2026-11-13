// `control:set`: manual speed/incline from a paired device. Checked against the effective limits
// before the adapter sees it; out of range is refused, never clamped. While a plan runs, the change
// is an override for the rest of the current step (FR-019).
// `control:start` / `control:stop`: the dashboard's Start and Stop buttons.
const { AppError } = require('../../lib/errors');
const { assertTarget, effectiveLimits } = require('../../core/limits');

function registerControl({ server, treadmill, settingsRepo, engine }) {
	server.handle('control:set', 'control-set', async ({ payload }) => {
		assertTarget(payload, effectiveLimits(settingsRepo.get().limits, treadmill.limits()));
		if (engine && engine.state === 'running') {
			await engine.override(payload);
			return;
		}
		await treadmill.setTarget(payload);
	});

	// Restarts the belt where the treadmill allows it. Consoles that must be started by hand (iFit
	// over Wi-Fi) refuse with RESUME_UNSUPPORTED, so the belt never starts from a phone unexpectedly.
	server.handle('control:start', null, async () => {
		if (engine && engine.isActive()) {
			throw new AppError('PLAN_RUNNING', 'A plan is running. Use Resume on the workout screen.');
		}
		if (!treadmill.capabilities.canResume) {
			throw new AppError('RESUME_UNSUPPORTED', 'Start the belt from the treadmill console.');
		}
		await treadmill.resumeBelt();
	});

	// Always allowed: ends a running plan (saved as stopped by the user) and stops the belt.
	// Adapters refuse with NOT_CONNECTED when the treadmill is not there.
	server.handle('control:stop', null, async () => {
		if (engine && engine.isActive()) {
			await engine.stop();
		}
		await treadmill.pauseBelt();
	});
}

module.exports = { registerControl };
