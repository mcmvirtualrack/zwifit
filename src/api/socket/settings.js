// `settings` on connect and `settings:write` (allow-listed fields only, see settings-write schema).
// onChange() runs after every accepted write (e.g. so the ANT+ broadcast applies switches at once).
function registerSettings({ server, settingsRepo, onChange = () => {} }) {
	server.onConnection(socket => socket.emit('settings', settingsRepo.publicView()));
	server.handle('settings:write', 'settings-write', async ({ payload }) => {
		await settingsRepo.update(payload);
		const view = settingsRepo.publicView();
		server.io.emit('settings', view);
		onChange();
		return view;
	});
}

module.exports = { registerSettings };
