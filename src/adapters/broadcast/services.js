// Bluetooth GATT services Zwift reads: Fitness Machine (FTMS, 0x1826) treadmill data, Running
// Speed and Cadence (RSC, 0x1814), Heart Rate (0x180D; Zwift ignores the heart rate inside FTMS) and
// Cycling Power (0x1818), which is how running power meters such as Stryd present power.
// Built from the bleno module passed in, so nothing loads the native library until the broadcast
// adapter starts. Packet layouts are in src/bluetooth/*/calculator.js.

// Fitness Machine Feature (0x2ACC): two little-endian uint32 flag fields, machine features then
// target settings. We report inclination (bit 3), heart rate (bit 10) and, when power is added,
// power measurement (bit 14): what the Treadmill Data packets carry. No settable targets. (The original code sent the text
// "0000000000000000", i.e. bytes 0x30, which claimed features Zwifit never sends.)
const ftmsFeatures = power => Buffer.from([0x08, power ? 0x44 : 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
// Cycling Power Feature (0x2A65): uint32, no optional features. Sensor Location (0x2A5D): 0 = other.
const CP_FEATURES = Buffer.from([0x00, 0x00, 0x00, 0x00]);
const CP_LOCATION = Buffer.from([0x00]);
// RSC Feature (0x2A54): uint16, no optional features.
const RSC_FEATURES = Buffer.from([0x00, 0x00]);

function readOnlyCharacteristic(bleno, uuid, value) {
	return new bleno.Characteristic({
		uuid,
		properties: ['read'],
		value: null,
		// @stoprocent/bleno passes the connection first (the original bleno did not).
		onReadRequest(connection, offset, callback) {
			if (offset > value.length) {
				callback(this.RESULT_INVALID_OFFSET, null);
				return;
			}
			callback(this.RESULT_SUCCESS, value.subarray(offset));
		}
	});
}

function notifyCharacteristic(bleno, uuid) {
	return new bleno.Characteristic({ uuid, properties: ['notify'], value: null });
}

// Heart Rate Measurement (0x2A37): flags (8-bit value, sensor contact supported and detected), bpm.
function heartRateBuffer(bpm) {
	return Buffer.from([0x06, Math.max(0, Math.min(255, Math.round(bpm)))]);
}

// Cycling Power Measurement (0x2A63): flags (none), instantaneous power (sint16, watts).
function powerBuffer(watts) {
	const buffer = Buffer.alloc(4);
	buffer.writeInt16LE(Math.max(0, Math.min(32767, Math.round(watts))), 2);
	return buffer;
}

function createServices(bleno, { ftms, rsc, hr, power, ftmsPower, name }) {
	const services = [];
	const measurements = {};
	if (ftms) {
		measurements.ftms = notifyCharacteristic(bleno, '2ACD');
		services.push(new bleno.PrimaryService({
			name,
			uuid: '1826',
			characteristics: [measurements.ftms, readOnlyCharacteristic(bleno, '2ACC', ftmsFeatures(ftmsPower))]
		}));
	}
	if (rsc) {
		measurements.rsc = notifyCharacteristic(bleno, '2A53');
		services.push(new bleno.PrimaryService({
			name,
			uuid: '1814',
			characteristics: [measurements.rsc, readOnlyCharacteristic(bleno, '2A54', RSC_FEATURES)]
		}));
	}
	if (hr) {
		measurements.hr = notifyCharacteristic(bleno, '2A37');
		services.push(new bleno.PrimaryService({
			name,
			uuid: '180D',
			characteristics: [measurements.hr]
		}));
	}
	if (power) {
		measurements.power = notifyCharacteristic(bleno, '2A63');
		services.push(new bleno.PrimaryService({
			name,
			uuid: '1818',
			characteristics: [measurements.power, readOnlyCharacteristic(bleno, '2A65', CP_FEATURES), readOnlyCharacteristic(bleno, '2A5D', CP_LOCATION)]
		}));
	}
	return { services, measurements, uuids: services.map(s => s.uuid) };
}

module.exports = { createServices, heartRateBuffer, powerBuffer };
