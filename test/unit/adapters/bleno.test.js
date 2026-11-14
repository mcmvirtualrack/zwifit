const EventEmitter = require('events');
const { BlenoBroadcast, noAdapterReason } = require('../../../src/adapters/broadcast/bleno');
// The real GATT classes (pure JS, no adapter needed), so the tests follow @stoprocent/bleno's API.
const Characteristic = require('@stoprocent/bleno/lib/characteristic');
const PrimaryService = require('@stoprocent/bleno/lib/primary-service');

function fakeBleno(state = 'poweredOn') {
	const bleno = new EventEmitter();
	bleno.state = state;
	bleno.Characteristic = Characteristic;
	bleno.PrimaryService = PrimaryService;
	bleno.startAdvertising = jest.fn((name, uuids) => Promise.resolve().then(() => bleno.emit('advertisingStart', null)));
	bleno.stopAdvertising = jest.fn();
	bleno.setServices = jest.fn();
	bleno.disconnect = jest.fn();
	return bleno;
}

const settingsWith = (ftms, rsc, hr = false) => ({ broadcast: { ftms, rsc, hr } });

let broadcast;
afterEach(async () => {
	if (broadcast) {
		await broadcast.stop();
		broadcast = null;
	}
	jest.useRealTimers();
});

const flush = () => new Promise(resolve => setImmediate(resolve));

test.each([
	[true, false, ['1826']],
	[false, true, ['1814']],
	[true, true, ['1826', '1814']]
])('ftms=%s rsc=%s advertises %j and registers those services', async (ftms, rsc, uuids) => {
	const bleno = fakeBleno();
	broadcast = new BlenoBroadcast({ settings: settingsWith(ftms, rsc), bleno });
	await broadcast.start();
	await flush();
	expect(bleno.startAdvertising).toHaveBeenCalledWith('Zwifit', uuids);
	expect(bleno.setServices.mock.calls[0][0].map(s => s.uuid)).toEqual(uuids);
	expect(broadcast.status()).toEqual({ available: true, poweredOn: true, advertising: true, clients: 0, devices: [] });
});

test('the first state is picked up even if bleno reported it before we listened', async () => {
	const bleno = fakeBleno('poweredOn');
	broadcast = new BlenoBroadcast({ settings: settingsWith(true, false), bleno });
	await broadcast.start();
	expect(bleno.startAdvertising).toHaveBeenCalledTimes(1);
});

test('update() is sent to Zwift at 5 Hz using the existing calculators, ramped', async () => {
	jest.useFakeTimers();
	const bleno = fakeBleno();
	broadcast = new BlenoBroadcast({ settings: settingsWith(true, true), bleno });
	await broadcast.start();
	const [ftmsService, rscService] = bleno.startAdvertising.mock.calls.length ? broadcast._gatt.services : [];
	const ftmsData = ftmsService.characteristics[0];
	const rscData = rscService.characteristics[0];
	const ftmsPackets = [];
	const rscPackets = [];
	// What bleno does when Zwift subscribes: (connection, maxValueSize, updateValueCallback).
	ftmsData.emit('subscribe', 'zwift', 20, buffer => ftmsPackets.push(buffer));
	rscData.emit('subscribe', 'zwift', 20, buffer => rscPackets.push(buffer));

	broadcast.update({ kph: 10, incline: 2, hr: 140, cadence: 160 });
	jest.advanceTimersByTime(1000);
	expect(ftmsPackets).toHaveLength(5);
	expect(rscPackets).toHaveLength(5);
	const speedOf = buffer => buffer.readUInt16LE(2) / 100;
	expect(speedOf(ftmsPackets[0])).toBeCloseTo(2, 1);
	expect(speedOf(ftmsPackets[4])).toBeGreaterThan(speedOf(ftmsPackets[0]));
	jest.advanceTimersByTime(10000);
	expect(speedOf(ftmsPackets[ftmsPackets.length - 1])).toBe(10);
});

test('a measured belt speed goes to Zwift as is, from the first packet; a set speed is eased', async () => {
	jest.useFakeTimers();
	const bleno = fakeBleno();
	broadcast = new BlenoBroadcast({ settings: settingsWith(true, false), bleno });
	await broadcast.start();
	const packets = [];
	broadcast._gatt.services[0].characteristics[0].emit('subscribe', 'zwift', 20, buffer => packets.push(buffer));
	const speedOf = buffer => buffer.readUInt16LE(2) / 100;
	broadcast.update({ kph: 9.6, incline: 1, measuredSpeed: true });
	jest.advanceTimersByTime(200);
	expect(speedOf(packets.at(-1))).toBe(9.6);
	broadcast.update({ kph: 10.3, incline: 1, measuredSpeed: true });
	jest.advanceTimersByTime(200);
	expect(speedOf(packets.at(-1))).toBe(10.3);
	// The console's set speed jumps; it is eased toward 12 instead.
	broadcast.update({ kph: 12, incline: 1, measuredSpeed: false });
	jest.advanceTimersByTime(200);
	expect(speedOf(packets.at(-1))).toBeGreaterThan(10.3);
	expect(speedOf(packets.at(-1))).toBeLessThan(12);
});

test('Zwift connecting and leaving updates the client count', async () => {
	const bleno = fakeBleno();
	broadcast = new BlenoBroadcast({ settings: settingsWith(true, false), bleno });
	await broadcast.start();
	bleno.emit('accept', 'aa:bb', 64);
	expect(broadcast.status().clients).toBe(1);
	bleno.emit('disconnect', 'aa:bb', 64);
	expect(broadcast.status().clients).toBe(0);
});

test('each client is listed with the services it reads, and reported so it can be remembered', async () => {
	const bleno = fakeBleno();
	broadcast = new BlenoBroadcast({ settings: settingsWith(true, false, true), bleno });
	await broadcast.start();
	const reported = [];
	broadcast.on('client', client => reported.push(client));
	const [ftmsService, hrService] = broadcast._gatt.services;

	bleno.emit('accept', 'f4:26:79:30:5a:10', 24);
	ftmsService.characteristics[0].emit('subscribe', 24, 20, () => {});
	hrService.characteristics[0].emit('subscribe', 24, 20, () => {});
	expect(broadcast.status().devices).toEqual([{ address: 'f4:26:79:30:5a:10', services: ['Fitness Machine', 'Heart Rate'] }]);
	expect(reported.at(-1)).toEqual({ address: 'f4:26:79:30:5a:10', services: ['Fitness Machine', 'Heart Rate'] });

	hrService.characteristics[0].emit('unsubscribe', 24);
	expect(broadcast.status().devices[0].services).toEqual(['Fitness Machine']);
	// A subscription from a handle we never saw accepted is ignored.
	ftmsService.characteristics[0].emit('subscribe', 99, 20, () => {});
	expect(broadcast.status().devices).toHaveLength(1);

	bleno.emit('disconnect', 'f4:26:79:30:5a:10', 24);
	expect(broadcast.status().devices).toEqual([]);
});

test('when bleno cannot load under WSL, the reason points at attach-bluetooth.ps1', async () => {
	broadcast = new BlenoBroadcast({ settings: settingsWith(true, false), loadBleno: () => { throw new Error('no hci'); }, wsl: true });
	const status = new Promise(resolve => broadcast.once('status', resolve));
	await broadcast.start();
	expect(await status).toMatchObject({ available: false, reason: expect.stringContaining('scripts/wsl/attach-bluetooth.ps1') });
});

test('with no adapter attached, bleno throwing "No such device" on the first listener is reported, not thrown', async () => {
	const bleno = fakeBleno('unknown');
	bleno.on('newListener', () => { throw new Error('No such device'); });
	broadcast = new BlenoBroadcast({ settings: settingsWith(true, false), bleno, wsl: true });
	await broadcast.start();
	expect(broadcast.status()).toMatchObject({ available: false, reason: noAdapterReason(true) });
	expect(broadcast._timer).toBeNull();
});

test('elsewhere the reason is a generic "No Bluetooth" message', async () => {
	broadcast = new BlenoBroadcast({ settings: settingsWith(true, false), loadBleno: () => { throw new Error('no hci'); }, wsl: false });
	await broadcast.start();
	expect(broadcast.status().reason).toBe(noAdapterReason(false));
	expect(broadcast.status().reason).toMatch(/^No Bluetooth/);
});

test.each([
	['poweredOff', /hciconfig hci0 up/],
	['unauthorized', /setcap/],
	['unsupported', /No Bluetooth/]
])('state %s is unavailable with an actionable reason', async (state, reason) => {
	broadcast = new BlenoBroadcast({ settings: settingsWith(true, false), bleno: fakeBleno(state), wsl: false });
	await broadcast.start();
	expect(broadcast.status()).toMatchObject({ available: false, reason: expect.stringMatching(reason) });
});

test('stop() clears the timer and stops advertising (no disconnect on macOS)', async () => {
	jest.useFakeTimers();
	const bleno = fakeBleno();
	broadcast = new BlenoBroadcast({ settings: settingsWith(true, false), bleno, platform: 'darwin' });
	await broadcast.start();
	await broadcast.stop();
	expect(jest.getTimerCount()).toBe(0);
	expect(bleno.stopAdvertising).toHaveBeenCalled();
	expect(bleno.disconnect).not.toHaveBeenCalled();
	broadcast = null;
});

test('feature characteristics answer reads and reject bad offsets', async () => {
	const bleno = fakeBleno();
	broadcast = new BlenoBroadcast({ settings: settingsWith(true, false), bleno });
	await broadcast.start();
	const feature = broadcast._gatt.services[0].characteristics[1];
	const reply = jest.fn();
	// bleno emits readRequest with (connection, offset, callback).
	feature.emit('readRequest', 'zwift', 0, reply);
	expect(reply).toHaveBeenCalledWith(Characteristic.RESULT_SUCCESS, expect.any(Buffer));
	// Two uint32 flag fields: inclination (bit 3) and heart rate (bit 10); no target settings.
	const value = reply.mock.calls[0][1];
	expect(value).toHaveLength(8);
	expect(value.readUInt32LE(0)).toBe((1 << 3) | (1 << 10));
	expect(value.readUInt32LE(4)).toBe(0);
	feature.emit('readRequest', 'zwift', 99, reply);
	expect(reply).toHaveBeenLastCalledWith(Characteristic.RESULT_INVALID_OFFSET, null);
});

test('heart rate is on unless switched off, and is advertised as a Heart Rate sensor', async () => {
	const bleno = fakeBleno();
	broadcast = new BlenoBroadcast({ settings: { broadcast: { ftms: true, rsc: false } }, bleno });
	await broadcast.start();
	expect(bleno.startAdvertising).toHaveBeenCalledWith('Zwifit', ['1826', '180D']);
	expect(broadcast._gatt.services[1].characteristics.map(c => c.uuid.toLowerCase())).toEqual(['2a37']);
});

test('the treadmill pulse is sent once a second as reported, and not at all without a pulse', async () => {
	jest.useFakeTimers();
	const bleno = fakeBleno();
	broadcast = new BlenoBroadcast({ settings: settingsWith(true, false, true), bleno });
	await broadcast.start();
	const [ftmsService, hrService] = broadcast._gatt.services;
	const hrPackets = [];
	const ftmsPackets = [];
	hrService.characteristics[0].emit('subscribe', 'zwift', 20, buffer => hrPackets.push(buffer));
	ftmsService.characteristics[0].emit('subscribe', 'zwift', 20, buffer => ftmsPackets.push(buffer));

	broadcast.update({ kph: 10, incline: 0, hr: null, cadence: 0 });
	jest.advanceTimersByTime(2000);
	expect(hrPackets).toHaveLength(0);

	broadcast.update({ kph: 10, incline: 0, hr: 142, cadence: 0 });
	jest.advanceTimersByTime(3000);
	expect(hrPackets).toHaveLength(3);
	// flags 0x06 (8-bit value, sensor contact detected), then the bpm unramped.
	expect(hrPackets[0]).toEqual(Buffer.from([0x06, 142]));
	// The FTMS packet carries it too (last byte, heart-rate flag set).
	const last = ftmsPackets[ftmsPackets.length - 1];
	expect(last.readUInt16LE(0) & 0x0100).toBe(0x0100);
	expect(last[last.length - 1]).toBe(142);

	broadcast.update({ kph: 10, incline: 0, hr: null, cadence: 0 });
	jest.advanceTimersByTime(3000);
	expect(hrPackets).toHaveLength(3);
});

test('switching heart rate off leaves the Heart Rate service out', async () => {
	const bleno = fakeBleno();
	broadcast = new BlenoBroadcast({ settings: settingsWith(true, false, false), bleno });
	await broadcast.start();
	expect(bleno.startAdvertising).toHaveBeenCalledWith('Zwifit', ['1826']);
});

test('nothing is sent before a client subscribes, and sending stops after it unsubscribes', async () => {
	jest.useFakeTimers();
	const bleno = fakeBleno();
	broadcast = new BlenoBroadcast({ settings: settingsWith(true, false), bleno });
	await broadcast.start();
	const data = broadcast._gatt.services[0].characteristics[0];
	jest.advanceTimersByTime(1000);
	const packets = [];
	data.emit('subscribe', 'zwift', 20, buffer => packets.push(buffer));
	jest.advanceTimersByTime(1000);
	data.emit('unsubscribe', 'zwift');
	jest.advanceTimersByTime(1000);
	expect(packets).toHaveLength(5);
});

test('sensor power goes out as a Cycling Power sensor, and inside the Fitness Machine data when asked', async () => {
	jest.useFakeTimers();
	const bleno = fakeBleno();
	broadcast = new BlenoBroadcast({ settings: { broadcast: { ftms: true, rsc: false, hr: false, power: true, ftmsPower: true } }, bleno });
	await broadcast.start();
	const services = broadcast._gatt.services;
	expect(services.map(s => s.uuid)).toEqual(['1826', '1818']);
	const ftms = [];
	const power = [];
	services[0].characteristics[0].emit('subscribe', 'zwift', 20, buffer => ftms.push(buffer));
	services[1].characteristics[0].emit('subscribe', 'zwift', 20, buffer => power.push(buffer));

	broadcast.update({ kph: 12, incline: 1, hr: 0, cadence: 0, power: 248 });
	jest.advanceTimersByTime(200);
	// Cycling Power Measurement: no flags, 248 W.
	expect(power.at(-1).toString('hex')).toBe('0000f800');
	// Treadmill Data: flag bit 12 (force on belt and power) set, force 0, power 248 at the end.
	expect(ftms.at(-1).readUInt16LE(0) & 0x1000).toBe(0x1000);
	expect(ftms.at(-1).subarray(-4).toString('hex')).toBe('0000f800');

	// No sensor power: the power meter stays quiet and the Fitness Machine data leaves power out.
	broadcast.update({ kph: 12, incline: 1, hr: 0, cadence: 0, power: 0 });
	const sent = power.length;
	jest.advanceTimersByTime(400);
	expect(power).toHaveLength(sent);
	expect(ftms.at(-1).readUInt16LE(0) & 0x1000).toBe(0);
});

test('power is not broadcast unless switched on', async () => {
	const bleno = fakeBleno();
	broadcast = new BlenoBroadcast({ settings: settingsWith(true, true), bleno });
	await broadcast.start();
	expect(broadcast._gatt.services.map(s => s.uuid)).not.toContain('1818');
});

test('after another program resets the adapter, the broadcast forgets its clients and advertises again', async () => {
	const bleno = fakeBleno();
	broadcast = new BlenoBroadcast({ settings: settingsWith(true, false), bleno });
	await broadcast.start();
	await flush();
	bleno.emit('accept', 'aa:bb:cc:dd:ee:ff', 64);
	expect(broadcast.status().clients).toBe(1);
	bleno.startAdvertising.mockClear();
	broadcast.adapterReset(5);
	broadcast.adapterReset(5);
	await new Promise(resolve => setTimeout(resolve, 20));
	expect(bleno.stopAdvertising).toHaveBeenCalled();
	expect(bleno.startAdvertising).toHaveBeenCalledTimes(1);
	expect(bleno.startAdvertising).toHaveBeenCalledWith('Zwifit', ['1826']);
	expect(broadcast.status()).toMatchObject({ clients: 0, devices: [], advertising: true });
});

test('a reset after stop() does nothing', async () => {
	const bleno = fakeBleno();
	broadcast = new BlenoBroadcast({ settings: settingsWith(true, false), bleno });
	await broadcast.start();
	await flush();
	broadcast.adapterReset(5);
	await broadcast.stop();
	broadcast = null;
	bleno.startAdvertising.mockClear();
	await new Promise(resolve => setTimeout(resolve, 20));
	expect(bleno.startAdvertising).not.toHaveBeenCalled();
});
