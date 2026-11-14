const fs = require('fs');
const os = require('os');
const path = require('path');
const { registerSensors } = require('../../../src/api/socket/sensors');
const { createSettingsRepo } = require('../../../src/storage/settingsRepo');
const contracts = require('../../../src/contracts');

async function setup() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zwifit-sensors-'));
	const settingsRepo = createSettingsRepo({ dir, legacyDir: dir });
	await settingsRepo.init();
	const handlers = new Map();
	const server = { io: { emit: jest.fn() }, handle: (event, schema, handler) => handlers.set(event, { schema, handler }) };
	const ant = {
		startScan: jest.fn(() => ({ endsAt: 1000 })),
		describe: jest.fn(id => ({ id, kinds: ['power', 'cadence'], name: 'Stryd' })),
		reconnect: jest.fn(async () => {})
	};
	const bluetooth = {
		startScan: jest.fn(() => ({ endsAt: 2000 })),
		describe: jest.fn(id => ({ id, kinds: ['hr'], name: 'Polar H10' })),
		refresh: jest.fn()
	};
	registerSensors({ server, ant, bluetooth, settingsRepo, log: { warn: jest.fn(), safeError: e => e } });
	// Validates the payload against the handler's schema, like the real server does.
	const call = (event, payload) => {
		const { schema, handler } = handlers.get(event);
		const errors = contracts.validate(schema, payload);
		if (errors.length) {
			throw Object.assign(new Error('invalid'), { code: 'INVALID' });
		}
		return handler({ payload });
	};
	return { call, settingsRepo, ant, bluetooth, server };
}

test('scan starts on the chosen transport', async () => {
	const { call, ant, bluetooth } = await setup();
	expect(await call('sensors:scan', { transport: 'ant' })).toEqual({ endsAt: new Date(1000).toISOString() });
	await call('sensors:scan', { transport: 'bluetooth' });
	expect(ant.startScan).toHaveBeenCalled();
	expect(bluetooth.startScan).toHaveBeenCalled();
	expect(() => call('sensors:scan', { transport: 'wifi' })).toThrow(expect.objectContaining({ code: 'INVALID' }));
});

test('connecting an ANT+ sensor picks its device number for every kind it measures; forget undoes it', async () => {
	const { call, settingsRepo, ant, server } = await setup();
	await call('sensors:connect', { transport: 'ant', id: '31877' });
	expect(settingsRepo.get().sensors.antDevices).toEqual({ power: 31877, cadence: 31877 });
	expect(ant.reconnect).toHaveBeenCalled();
	expect(server.io.emit).toHaveBeenCalledWith('settings', expect.objectContaining({ sensors: expect.any(Object) }));
	await call('sensors:forget', { transport: 'ant', id: '31877' });
	expect(settingsRepo.get().sensors.antDevices).toEqual({});
});

test('a Bluetooth sensor is remembered once and can be forgotten', async () => {
	const { call, settingsRepo, bluetooth } = await setup();
	await call('sensors:connect', { transport: 'bluetooth', id: 'aa01' });
	await call('sensors:connect', { transport: 'bluetooth', id: 'aa01' });
	expect(settingsRepo.get().sensors.bluetooth).toEqual([{ id: 'aa01', name: 'Polar H10', kinds: ['hr'] }]);
	expect(bluetooth.refresh).toHaveBeenCalledTimes(2);
	await call('sensors:forget', { transport: 'bluetooth', id: 'aa01' });
	expect(settingsRepo.get().sensors.bluetooth).toEqual([]);
	expect(() => call('sensors:connect', { transport: 'bluetooth', id: 'bad id!' })).toThrow(expect.objectContaining({ code: 'INVALID' }));
});

test('a sensor can be given its own name; a blank name clears it, and a settings save keeps it', async () => {
	const { call, settingsRepo, server } = await setup();
	expect(await call('sensors:rename', { transport: 'ant', id: '4242', name: '  My   Epix ' })).toEqual({ transport: 'ant', id: '4242', name: 'My Epix' });
	await call('sensors:rename', { transport: 'bluetooth', id: 'aa01', name: 'Chest strap' });
	expect(settingsRepo.get().sensors.names).toEqual({ 'ant:4242': 'My Epix', 'bluetooth:aa01': 'Chest strap' });
	expect(server.io.emit).toHaveBeenCalledWith('settings', expect.objectContaining({ sensors: expect.objectContaining({ names: expect.any(Object) }) }));
	// Saving the Settings form (which doesn't send names) leaves them alone.
	await settingsRepo.update({ sensors: { powerSmoothing: 10 } });
	expect(settingsRepo.get().sensors.names['ant:4242']).toBe('My Epix');
	expect(await call('sensors:rename', { transport: 'ant', id: '4242', name: '   ' })).toMatchObject({ name: null });
	expect(settingsRepo.get().sensors.names).toEqual({ 'bluetooth:aa01': 'Chest strap' });
	expect(() => call('sensors:rename', { transport: 'ant', id: '4242', name: 'x'.repeat(41) })).toThrow(expect.objectContaining({ code: 'INVALID' }));
	expect(() => call('sensors:rename', { transport: 'ant', id: 'bad id', name: 'x' })).toThrow(expect.objectContaining({ code: 'INVALID' }));
});
