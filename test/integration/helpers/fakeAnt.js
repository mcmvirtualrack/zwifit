// A fake ant-plus-next for integration tests: a stick that opens, answers every channel command
// with RESPONSE_NO_ERROR (EVENT_CHANNEL_CLOSED after a close) and records what was written, plus
// receive sensors that record their channels.
const EventEmitter = require('events');

function fakeAntLib() {
	const made = { sticks: [], sensors: [] };
	class Stick extends EventEmitter {
		constructor() {
			super();
			this.written = [];
			made.sticks.push(this);
		}

		async open() {
			setImmediate(() => this.emit('startup'));
			return true;
		}

		async write(bytes) {
			const frame = Array.from(bytes);
			this.written.push(frame);
			const [, , id, ch] = frame;
			if (id === 0x4E) {
				return;
			}
			setImmediate(() => {
				this.emit('read', Uint8Array.from([0xA4, 3, 0x40, ch, id, 0, 0]));
				if (id === 0x4C) {
					this.emit('read', Uint8Array.from([0xA4, 3, 0x40, ch, 0x01, 0x07, 0]));
				}
			});
		}

		tx(ch) {
			this.emit('read', Uint8Array.from([0xA4, 3, 0x40, ch, 0x01, 0x03, 0]));
		}

		// Channels opened and not closed since.
		openChannels() {
			const open = new Set();
			for (const [, , id, ch] of this.written) {
				if (id === 0x4B) {
					open.add(ch);
				}
				if (id === 0x4C) {
					open.delete(ch);
				}
			}
			return [...open].sort();
		}

		pages(ch) {
			return this.written.filter(f => f[2] === 0x4E && f[3] === ch).map(f => f.slice(4, 12));
		}
	}
	const sensor = kind => class extends EventEmitter {
		constructor(stick) {
			super();
			this.stick = stick;
			this.kind = kind;
			this.attached = [];
			made.sensors.push(this);
		}

		async attach(channel, deviceId) {
			this.attached.push([channel, deviceId]);
		}
	};
	const scanner = () => class extends EventEmitter {
		async scan() {}
	};
	const lib = {
		GarminStick2: Stick,
		GarminStick3: class extends Stick {
			async open() {
				return false;
			}
		},
		HeartRateSensor: sensor('hr'),
		StrideSpeedDistanceSensor: sensor('cadence'),
		BicyclePowerSensor: sensor('power'),
		HeartRateScanner: scanner(),
		StrideSpeedDistanceScanner: scanner(),
		BicyclePowerScanner: scanner()
	};
	return { lib, made, stick: () => made.sticks.find(s => s.constructor === Stick && s.written) };
}

module.exports = { fakeAntLib };
