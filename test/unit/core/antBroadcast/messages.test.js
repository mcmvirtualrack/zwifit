// ANT serial messages for the transmit channels: sync 0xA4, length, message ID, payload, XOR
// checksum (ANT Message Protocol 7.1). ant-plus-next builds the same frames but does not export
// its builder.
const m = require('../../../../src/core/antBroadcast/messages');

const checksum = bytes => bytes.reduce((x, b) => x ^ b, 0);

test('channel set-up messages', () => {
	expect(m.assignChannel(3)).toEqual([0xA4, 3, 0x42, 3, 0x10, 0, checksum([0xA4, 3, 0x42, 3, 0x10, 0])]);
	expect(m.setChannelId(3, 0x1234, 124, 5)).toEqual([0xA4, 5, 0x51, 3, 0x34, 0x12, 124, 5, checksum([0xA4, 5, 0x51, 3, 0x34, 0x12, 124, 5])]);
	expect(m.setFrequency(3, 57).slice(0, 5)).toEqual([0xA4, 2, 0x45, 3, 57]);
	expect(m.setPeriod(3, 8134).slice(0, 6)).toEqual([0xA4, 3, 0x43, 3, 0xC6, 0x1F]);
	expect(m.openChannel(4).slice(0, 4)).toEqual([0xA4, 1, 0x4B, 4]);
	expect(m.closeChannel(5).slice(0, 4)).toEqual([0xA4, 1, 0x4C, 5]);
	expect(m.unassignChannel(6).slice(0, 4)).toEqual([0xA4, 1, 0x41, 6]);
});

test('broadcast data carries exactly 8 bytes', () => {
	const frame = m.broadcastData(3, [1, 2, 3, 4, 5, 6, 7, 8]);
	expect(frame).toEqual([0xA4, 9, 0x4E, 3, 1, 2, 3, 4, 5, 6, 7, 8, checksum(frame.slice(0, -1))]);
	expect(() => m.broadcastData(3, [1, 2, 3])).toThrow();
	expect(() => m.broadcastData(3, [1, 2, 3, 4, 5, 6, 7, 256])).toThrow();
});

test('arguments outside their byte widths are refused', () => {
	expect(() => m.assignChannel(8)).toThrow();
	expect(() => m.setChannelId(3, 0, 124, 5)).toThrow();
	expect(() => m.setChannelId(3, 65536, 124, 5)).toThrow();
	expect(() => m.setPeriod(3, 70000)).toThrow();
});

test('parse reads the ID, channel and data of a frame from the stick', () => {
	expect(m.parse(Uint8Array.from([0xA4, 3, 0x40, 3, 0x01, 0x03, 0]))).toEqual({ id: 0x40, channel: 3, data: [0x01, 0x03] });
	expect(m.parse(Uint8Array.from([0xA4]))).toBeNull();
	expect(m.parse(null)).toBeNull();
	expect(m.parse(Uint8Array.from([0x00, 1, 0x40, 3, 0]))).toBeNull();
});
