// ANT serial messages for transmit (master) channels: sync 0xA4, length, message ID, payload, XOR
// checksum. ant-plus-next builds the same frames internally but does not export its builder.
const SYNC = 0xA4;
const ID = {
	CHANNEL_EVENT: 0x40,
	UNASSIGN: 0x41,
	ASSIGN: 0x42,
	PERIOD: 0x43,
	FREQUENCY: 0x45,
	OPEN: 0x4B,
	CLOSE: 0x4C,
	BROADCAST_DATA: 0x4E,
	CHANNEL_ID: 0x51
};
// Bidirectional master channel on network 0 (the ANT+ network key the library sets up).
const CHANNEL_TYPE_TRANSMIT = 0x10;
const EVENT_TX = 0x03;
const EVENT_CHANNEL_CLOSED = 0x07;

function byte(value, min = 0, max = 255) {
	if (!Number.isInteger(value) || value < min || value > max) {
		throw new RangeError(`ANT message field out of range: ${value}`);
	}
	return value;
}

function frame(id, payload) {
	const bytes = [SYNC, payload.length, id, ...payload];
	return [...bytes, bytes.reduce((x, b) => x ^ b, 0)];
}

const channel = ch => byte(ch, 0, 7);
const word = (v, min) => {
	byte(v, min, 0xFFFF);
	return [v & 0xFF, v >> 8];
};

const assignChannel = ch => frame(ID.ASSIGN, [channel(ch), CHANNEL_TYPE_TRANSMIT, 0]);
const setChannelId = (ch, deviceNumber, deviceType, transType) => frame(ID.CHANNEL_ID, [channel(ch), ...word(deviceNumber, 1), byte(deviceType, 0, 127), byte(transType)]);
const setFrequency = (ch, rf) => frame(ID.FREQUENCY, [channel(ch), byte(rf, 0, 124)]);
const setPeriod = (ch, period) => frame(ID.PERIOD, [channel(ch), ...word(period, 1)]);
const openChannel = ch => frame(ID.OPEN, [channel(ch)]);
const closeChannel = ch => frame(ID.CLOSE, [channel(ch)]);
const unassignChannel = ch => frame(ID.UNASSIGN, [channel(ch)]);

function broadcastData(ch, page) {
	if (!Array.isArray(page) || page.length !== 8) {
		throw new RangeError('An ANT+ data page is 8 bytes');
	}
	return frame(ID.BROADCAST_DATA, [channel(ch), ...page.map(b => byte(b))]);
}

// { id, channel, data } of one frame from the stick ('read' event), or null if it isn't one.
function parse(msg) {
	if (!msg || typeof msg.length !== 'number' || msg.length < 4 || msg[0] !== SYNC) {
		return null;
	}
	const length = msg[1];
	return { id: msg[2], channel: msg[3], data: Array.from(msg).slice(4, 3 + length) };
}

module.exports = { assignChannel, setChannelId, setFrequency, setPeriod, openChannel, closeChannel, unassignChannel, broadcastData, parse, ID, EVENT_TX, EVENT_CHANNEL_CLOSED };
