// BroadcastAdapter that broadcasts nothing: for tests, and when both FTMS and RSC are off.
const EventEmitter = require('events');

class NullBroadcast extends EventEmitter {
	constructor({ reason = 'Bluetooth broadcast is turned off.' } = {}) {
		super();
		this._status = { available: false, reason, poweredOn: false, advertising: false, clients: 0, devices: [] };
	}

	async start() {
		this.emit('status', { ...this._status });
	}

	async stop() {}

	update() {}

	status() {
		return { ...this._status };
	}
}

module.exports = { NullBroadcast };
