// Picks the BroadcastAdapter. The bleno adapter is added by T043 and required only when used.
const { NullBroadcast } = require('./null');

function create(settings, { disabled = false } = {}) {
	const { ftms, rsc, hr = true } = settings.broadcast;
	if (disabled || (!ftms && !rsc && !hr)) {
		return new NullBroadcast();
	}
	const { BlenoBroadcast } = require('./bleno');
	return new BlenoBroadcast({ settings });
}

module.exports = { create };
