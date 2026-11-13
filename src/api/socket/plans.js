// Plan commands (contracts/api.md): plans:list|get|save|duplicate|delete, and plans:changed.
const { AppError } = require('../../lib/errors');

function registerPlans({ server, plansRepo, isRunning = () => false }) {
	const changed = (id, deleted) => server.io.emit('plans:changed', deleted ? { id, deleted: true } : { id });

	server.handle('plans:list', null, () => plansRepo.list());
	server.handle('plans:get', 'plans-get', ({ payload }) => plansRepo.get(payload.id));
	server.handle('plans:save', 'plans-save', async ({ payload }) => {
		const plan = await plansRepo.save(payload);
		changed(plan.id);
		return plan;
	});
	server.handle('plans:duplicate', 'plans-duplicate', async ({ payload }) => {
		const plan = await plansRepo.duplicate(payload.id, payload.name);
		changed(plan.id);
		return plan;
	});
	server.handle('plans:delete', 'plans-delete', async ({ payload }) => {
		if (isRunning(payload.id)) {
			throw new AppError('PLAN_RUNNING', 'Stop the plan before deleting it.');
		}
		await plansRepo.remove(payload.id);
		changed(payload.id, true);
	});
}

module.exports = { registerPlans };
