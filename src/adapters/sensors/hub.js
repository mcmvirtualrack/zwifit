// The ANT+ and Bluetooth sensors as one source for the merge: the freshest reading of each kind
// wins, tagged with where it came from ('ant' or 'ble').
const EventEmitter = require('events');

const ANT_OFF = { available: false, reason: 'ANT+ is switched off in Settings.', devices: [], scan: { active: false }, found: [] };
const BLE_OFF = { available: false, reason: 'Bluetooth sensors are switched off.', devices: [], scan: { active: false }, found: [], connections: [] };

class SensorHub extends EventEmitter {
	constructor({ ant = null, bluetooth = null } = {}) {
		super();
		this.ant = ant;
		this.bluetooth = bluetooth;
		for (const [name, sensors] of [['ant', ant], ['ble', bluetooth]]) {
			if (sensors) {
				sensors.on('reading', reading => this.emit('reading', { ...reading, source: name }));
				sensors.on('status', () => this.emit('status', this.status()));
			}
		}
	}

	latest(kind) {
		let best = null;
		for (const [source, sensors] of [['ant', this.ant], ['ble', this.bluetooth]]) {
			const reading = sensors && sensors.latest(kind);
			if (reading && (!best || reading.at > best.at)) {
				best = { ...reading, source };
			}
		}
		return best;
	}

	// The latest reading of a kind from one transport ('ant' or 'ble'), or null.
	latestFrom(kind, source) {
		const sensors = source === 'ant' ? this.ant : source === 'ble' ? this.bluetooth : null;
		const reading = sensors && sensors.latest(kind);
		return reading ? { ...reading, source } : null;
	}

	status() {
		return {
			ant: this.ant ? this.ant.status() : ANT_OFF,
			bluetooth: this.bluetooth ? this.bluetooth.status() : BLE_OFF
		};
	}

	async start() {
		await Promise.all([this.ant && this.ant.start(), this.bluetooth && this.bluetooth.start()]);
	}

	async stop() {
		await Promise.allSettled([this.ant && this.ant.stop(), this.bluetooth && this.bluetooth.stop()]);
	}
}

module.exports = { SensorHub, ANT_OFF, BLE_OFF };
