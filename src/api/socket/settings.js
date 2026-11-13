// `settings` on connect and `settings:write` (allow-listed fields only, see settings-write schema).
function registerSettings({ server, settingsRepo }) {
	server.onConnection(socket => socket.emit('settings', settingsRepo.publicView()));
	server.handle('settings:write', 'settings-write', async ({ payload }) => {
		await settingsRepo.update(payload);
		const view = settingsRepo.publicView();
		server.io.emit('settings', view);
		return view;
	});
}

module.exports = { registerSettings };
