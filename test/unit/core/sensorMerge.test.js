const EventEmitter = require('events');
const { MergedTreadmill, FRESH_MS } = require('../../../src/core/sensorMerge');

function setup({ sensorsSettings } = {}) {
	let now = 100000;
	const treadmill = Object.assign(new EventEmitter(), {
		transport: 'wifi',
		capabilities: { canControl: true, canPause: true, canResume: true },
		limits: () => ({ minKph: 1 }),
		setTarget: jest.fn(async () => {}),
		pauseBelt: jest.fn(async () => {}),
		resumeBelt: jest.fn(async () => {}),
		start: jest.fn(async () => {}),
		stop: jest.fn(async () => {})
	});
	const latest = {};
	const sensors = Object.assign(new EventEmitter(), { latest: kind => latest[kind] || null });
	const settings = { sensors: sensorsSettings };
	const merged = new MergedTreadmill({ treadmill, sensors, getSettings: () => settings, now: () => now });
	const seen = [];
	merged.on('status', s => seen.push(s));
	const read = (kind, value) => {
		latest[kind] = { value, deviceId: 1, at: now };
		sensors.emit('reading', { kind, value });
	};
	return { treadmill, merged, seen, read, advance: ms => { now += ms; }, settings };
}

const base = { connected: true, kph: 8, incline: 1, hr: 120, estimatedSpeed: false };

test('auto: a live ANT+ heart rate wins over the treadmill pulse, until it goes quiet', () => {
	const { treadmill, seen, read, advance } = setup();
	treadmill.emit('status', base);
	expect(seen.at(-1)).toMatchObject({ hr: 120, hrSource: 'treadmill' });
	read('hr', 141);
	expect(seen.at(-1)).toMatchObject({ kph: 8, hr: 141, hrSource: 'ant' });
	advance(FRESH_MS + 1);
	treadmill.emit('status', base);
	expect(seen.at(-1)).toMatchObject({ hr: 120, hrSource: 'treadmill' });
});

test('cadence comes from the footpod, else the treadmill, else is left out', () => {
	const { treadmill, seen, read } = setup();
	treadmill.emit('status', base);
	expect(seen.at(-1).cadence).toBeUndefined();
	treadmill.emit('status', { ...base, cadence: 150 });
	expect(seen.at(-1)).toMatchObject({ cadence: 150, cadenceSource: 'treadmill' });
	read('cadence', 172);
	expect(seen.at(-1)).toMatchObject({ cadence: 172, cadenceSource: 'ant' });
});

test('running power comes only from ANT+ (Stryd), is dropped when stale, and can be turned off', () => {
	const { treadmill, seen, read, advance, settings } = setup();
	treadmill.emit('status', base);
	expect(seen.at(-1).power).toBeUndefined();
	read('power', 248);
	expect(seen.at(-1)).toMatchObject({ power: 248, powerSource: 'ant' });
	advance(FRESH_MS + 1);
	treadmill.emit('status', base);
	expect(seen.at(-1).power).toBeUndefined();
	read('power', 250);
	settings.sensors = { powerSource: 'off' };
	treadmill.emit('status', base);
	expect(seen.at(-1).power).toBeUndefined();
	expect(seen.at(-1).powerSource).toBeUndefined();
});

test('a fixed source ignores the other one', () => {
	const { treadmill, seen, read, settings } = setup({ sensorsSettings: { hrSource: 'treadmill' } });
	treadmill.emit('status', base);
	read('hr', 150);
	expect(seen.at(-1)).toMatchObject({ hr: 120, hrSource: 'treadmill' });
	settings.sensors = { hrSource: 'ant' };
	treadmill.emit('status', { ...base, hr: 0 });
	expect(seen.at(-1)).toMatchObject({ hr: 150, hrSource: 'ant' });
	settings.sensors = { hrSource: 'ant' };
	treadmill.emit('status', { ...base, hr: 130 });
	expect(seen.at(-1).hr).toBe(150);
});

test('a disconnected treadmill\'s stale pulse is dropped, but ANT+ heart rate still comes through', () => {
	const { treadmill, seen, read } = setup();
	treadmill.emit('status', { ...base, connected: false, hr: 118, cadence: 150 });
	expect(seen.at(-1)).toMatchObject({ connected: false, hr: null, hrSource: null });
	expect(seen.at(-1).cadence).toBeUndefined();
	read('hr', 60);
	expect(seen.at(-1)).toMatchObject({ connected: false, hr: 60, hrSource: 'ant' });
});

test('the "sensor" mode (and its older name "ant") ignores the treadmill pulse', () => {
	const { treadmill, seen, settings, read } = setup({ sensorsSettings: { hrSource: 'sensor' } });
	treadmill.emit('status', base);
	expect(seen.at(-1)).toMatchObject({ hr: null, hrSource: null });
	read('hr', 150);
	expect(seen.at(-1)).toMatchObject({ hr: 150, hrSource: 'ant' });
	settings.sensors = { hrSource: 'ant' };
	treadmill.emit('status', base);
	expect(seen.at(-1)).toMatchObject({ hr: 150, hrSource: 'ant' });
});

test('the source of a hub reading carries through', () => {
	const EventEmitterLocal = require('events');
	const treadmill = Object.assign(new EventEmitterLocal(), { transport: 'wifi', capabilities: {}, limits: () => null });
	const sensors = Object.assign(new EventEmitterLocal(), { latest: kind => (kind === 'hr' ? { value: 133, at: 100000, source: 'ble' } : null) });
	const merged = new MergedTreadmill({ treadmill, sensors, getSettings: () => ({}), now: () => 100000 });
	const seen = [];
	merged.on('status', s => seen.push(s));
	treadmill.emit('status', base);
	expect(seen.at(-1)).toMatchObject({ hr: 133, hrSource: 'ble' });
});

test('no heart rate anywhere is null, not 0', () => {
	const { treadmill, seen } = setup();
	treadmill.emit('status', { ...base, hr: null });
	expect(seen.at(-1)).toMatchObject({ hr: null, hrSource: null });
});

test('commands, limits and events pass straight through to the treadmill', async () => {
	const { treadmill, merged } = setup();
	await merged.setTarget({ kph: 5 });
	await merged.pauseBelt();
	await merged.resumeBelt();
	expect(treadmill.setTarget).toHaveBeenCalledWith({ kph: 5 });
	expect(treadmill.pauseBelt).toHaveBeenCalled();
	expect(treadmill.resumeBelt).toHaveBeenCalled();
	expect(merged.limits()).toEqual({ minKph: 1 });
	expect(merged.capabilities).toBe(treadmill.capabilities);
	const discovered = jest.fn();
	merged.on('discovered', discovered);
	treadmill.emit('discovered', { ip: '10.0.0.9' });
	expect(discovered).toHaveBeenCalledWith({ ip: '10.0.0.9' });
});

test('a reading before any treadmill status emits nothing', () => {
	const { seen, read } = setup();
	read('hr', 140);
	expect(seen).toEqual([]);
});

// A hub-like sensors object with separate ANT+ and Bluetooth readings.
function hubSetup(sensorsSettings = {}) {
	let now = 100000;
	const treadmill = Object.assign(new EventEmitter(), { transport: 'wifi', capabilities: {}, limits: () => null });
	const latest = { ant: {}, ble: {} };
	const sensors = Object.assign(new EventEmitter(), {
		latest: kind => latest.ant[kind] || latest.ble[kind] || null,
		latestFrom: (kind, source) => (latest[source][kind] ? { ...latest[source][kind], source } : null)
	});
	const settings = { sensors: sensorsSettings };
	const merged = new MergedTreadmill({ treadmill, sensors, getSettings: () => settings, now: () => now });
	const seen = [];
	merged.on('status', s => seen.push(s));
	const read = (source, kind, value) => {
		latest[source][kind] = { value, deviceId: 1, at: now };
		sensors.emit('reading', { kind, value, source });
	};
	return { treadmill, seen, read, settings, advance: ms => { now += ms; } };
}

test('auto takes ANT+ first, then Bluetooth, then the treadmill; ant / ble / off pick one', () => {
	const { treadmill, seen, read, settings } = hubSetup();
	treadmill.emit('status', base);
	read('ble', 'hr', 131);
	expect(seen.at(-1)).toMatchObject({ hr: 131, hrSource: 'ble' });
	read('ant', 'hr', 141);
	expect(seen.at(-1)).toMatchObject({ hr: 141, hrSource: 'ant' });
	settings.sensors = { hrSource: 'ble' };
	treadmill.emit('status', base);
	expect(seen.at(-1)).toMatchObject({ hr: 131, hrSource: 'ble' });
	settings.sensors = { hrSource: 'off' };
	treadmill.emit('status', base);
	expect(seen.at(-1)).toMatchObject({ hr: null, hrSource: null });
	settings.sensors = { powerSource: 'ble', powerSmoothing: 1 };
	read('ant', 'power', 250);
	expect(seen.at(-1).power).toBeUndefined();
	read('ble', 'power', 240);
	expect(seen.at(-1)).toMatchObject({ power: 240, powerSource: 'ble' });
});

test('power is averaged over the chosen seconds (3 by default), per source', () => {
	const { treadmill, seen, read, settings, advance } = hubSetup();
	treadmill.emit('status', base);
	read('ant', 'power', 200);
	advance(1000);
	read('ant', 'power', 260);
	expect(seen.at(-1).power).toBe(230);
	advance(3000);
	read('ant', 'power', 300);
	expect(seen.at(-1).power).toBe(300);
	settings.sensors = { powerSmoothing: 10 };
	read('ant', 'power', 200);
	expect(seen.at(-1).power).toBe(240);
});
