// workouts:list|get|samples|delete and workouts:changed. Health data: paired devices only, never logged.
function registerWorkouts({ server, workoutsRepo }) {
	server.handle('workouts:list', 'workouts-list', ({ payload }) => workoutsRepo.list(payload || {}));
	server.handle('workouts:get', 'workouts-get', ({ payload }) => workoutsRepo.get(payload.id));
	server.handle('workouts:samples', 'workouts-samples', ({ payload }) => workoutsRepo.samples(payload.id, payload));
	server.handle('workouts:delete', 'workouts-delete', async ({ payload }) => {
		await workoutsRepo.remove(payload.id);
		server.io.emit('workouts:changed', { id: payload.id, deleted: true });
	});
}

module.exports = { registerWorkouts };
