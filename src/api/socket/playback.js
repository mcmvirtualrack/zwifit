// playback:start|pause|resume|skip|stop|intensity. `playback` goes to every paired client on any change and
// at 1 Hz while running, so all views show the same session (FR-018).
function registerPlayback({ server, engine, plansRepo }) {
	server.onConnection(socket => socket.emit('playback', engine.snapshot()));
	engine.on('state', snapshot => server.io.emit('playback', snapshot));

	server.handle('playback:start', 'playback-start', async ({ payload, device }) => {
		const plan = plansRepo.get(payload.planId);
		await engine.start(plan, { deviceId: device.id });
		return engine.snapshot();
	});
	server.handle('playback:pause', null, async () => {
		await engine.pause();
	});
	server.handle('playback:resume', null, async () => {
		await engine.resume();
	});
	server.handle('playback:skip', null, async () => {
		await engine.skip();
	});
	server.handle('playback:intensity', 'playback-intensity', async ({ payload }) => {
		await engine.setIntensity(payload.percent);
		return engine.snapshot();
	});
	server.handle('playback:stop', null, async () => {
		await engine.stop();
	});
}

module.exports = { registerPlayback };
