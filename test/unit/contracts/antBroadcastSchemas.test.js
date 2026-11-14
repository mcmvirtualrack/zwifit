const contracts = require('../../../src/contracts');
const { DEFAULT_SETTINGS } = require('../../../src/storage/settingsRepo');

const withAnt = antBroadcast => ({ ...JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), antBroadcast });
const full = {
	enabled: true,
	footpod: true,
	hr: false,
	power: true,
	treadmill: false,
	rebroadcastAnt: { hr: true, power: false },
	deviceNumbers: { footpod: 1, hr: 65535, power: 300, treadmill: 4242 }
};

test('the defaults carry ANT+ broadcast switched off and valid', () => {
	expect(DEFAULT_SETTINGS.antBroadcast).toEqual({ enabled: false, footpod: true, hr: true, power: true, treadmill: true, rebroadcastAnt: { hr: false, power: false } });
	expect(contracts.validate('settings', DEFAULT_SETTINGS)).toEqual([]);
});

test('a full antBroadcast object is valid settings', () => {
	expect(contracts.validate('settings', withAnt(full))).toEqual([]);
});

test('settings without antBroadcast stay valid (existing installs)', () => {
	const old = withAnt(undefined);
	delete old.antBroadcast;
	expect(contracts.validate('settings', old)).toEqual([]);
});

test.each([0, 65536, 1.5, -3, '12'])('device number %p is rejected', number => {
	const errors = contracts.validate('settings', withAnt({ ...full, deviceNumbers: { footpod: number } }));
	expect(errors.map(e => e.path)).toContain('antBroadcast.deviceNumbers.footpod');
});

test('unknown properties are rejected at every level', () => {
	expect(contracts.validate('settings', withAnt({ ...full, speed: true })).map(e => e.code)).toContain('UNKNOWN_PROPERTY');
	expect(contracts.validate('settings', withAnt({ ...full, rebroadcastAnt: { cadence: true } })).map(e => e.code)).toContain('UNKNOWN_PROPERTY');
	expect(contracts.validate('settings', withAnt({ ...full, deviceNumbers: { bike: 5 } })).map(e => e.code)).toContain('UNKNOWN_PROPERTY');
});

test('a paired device may write the switches but not the device numbers', () => {
	expect(contracts.validate('settings-write', { antBroadcast: { enabled: true, hr: false, rebroadcastAnt: { power: true } } })).toEqual([]);
	const errors = contracts.validate('settings-write', { antBroadcast: { deviceNumbers: { footpod: 5 } } });
	expect(errors).toEqual([expect.objectContaining({ code: 'UNKNOWN_PROPERTY', path: 'antBroadcast.deviceNumbers' })]);
	expect(contracts.validate('settings-write', { antBroadcast: {} }).length).toBeGreaterThan(0);
	expect(contracts.validate('settings-write', { antBroadcast: { enabled: 'yes' } }).map(e => e.code)).toContain('WRONG_TYPE');
});

test('ant-broadcast:renumber takes an empty object only', () => {
	expect(contracts.validate('ant-broadcast-renumber', {})).toEqual([]);
	expect(contracts.validate('ant-broadcast-renumber', { footpod: 5 }).map(e => e.code)).toContain('UNKNOWN_PROPERTY');
	expect(contracts.validate('ant-broadcast-renumber', null).length).toBeGreaterThan(0);
});
