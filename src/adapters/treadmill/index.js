// Picks the TreadmillAdapter for the configured transport (contracts/adapters.md "Loading rules").
// wifi and ble adapters are added by T041/T042; their modules are required only when selected.
const { AppError } = require('../../lib/errors');
const { effectiveLimits } = require('../../core/limits');

const TRANSPORTS = {
	simulated: () => require('./simulated').SimulatedTreadmill,
	wifi: () => require('./wifi').WifiTreadmill,
	ble: () => require('./ble').BleTreadmill
};

function create(settings, { simulate = false } = {}) {
	const transport = simulate ? 'simulated' : settings.treadmill.transport;
	const load = TRANSPORTS[transport];
	if (!load) {
		throw new AppError('UNSUPPORTED_TRANSPORT', `Unknown treadmill connection "${transport}".`);
	}
	const Adapter = load();
	return new Adapter({
		settings,
		limits: effectiveLimits(settings.limits, null),
		fallbackKph: settings.fallbackKph ?? null
	});
}

module.exports = { create, TRANSPORTS: Object.keys(TRANSPORTS) };
