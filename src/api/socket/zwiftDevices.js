// zwift-devices:list|rename|forget and zwift-devices:changed: devices that have connected to the
// Zwift broadcast, remembered with a name the user chooses. Paired devices only.
function registerZwiftDevices({ server, repo, broadcast, log }) {
	const changed = () => server.io.emit('zwift-devices:changed', {});

	broadcast.on('client', ({ address, services }) => {
		repo.seen(address, services).then(changed, err => log.warn('Could not remember the Zwift device', log.safeError(err)));
	});

	server.handle('zwift-devices:list', null, () => repo.list());
	server.handle('zwift-devices:rename', 'zwift-devices-rename', async ({ payload }) => {
		const device = await repo.rename(payload.address, payload.name);
		changed();
		return device;
	});
	server.handle('zwift-devices:forget', 'zwift-devices-forget', async ({ payload }) => {
		await repo.forget(payload.address);
		changed();
	});
}

module.exports = { registerZwiftDevices };
