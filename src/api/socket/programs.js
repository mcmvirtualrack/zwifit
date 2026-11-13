// Training programs (contracts/api.md): programs:preview|create|list|get|delete|start, and
// programs:changed. A day is done once a workout of its plan completed.
const { AppError } = require('../../lib/errors');
const { generateProgram } = require('../../core/programs/generate');

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_AHEAD_MS = 2 * 365 * DAY_MS;

function registerPrograms({ server, programsRepo, plansRepo, workoutsRepo, engine, getLimits, now = Date.now }) {
	const changed = (id, deleted) => server.io.emit('programs:changed', deleted ? { id, deleted: true } : { id });

	function generate(input) {
		const race = Date.parse(`${input.raceDate}T00:00:00Z`);
		const today = Date.parse(new Date(now()).toISOString().slice(0, 10) + 'T00:00:00Z');
		if (Number.isNaN(race) || race < today || race > today + MAX_AHEAD_MS) {
			throw new AppError('INVALID', 'Pick a race date from today up to two years ahead.', [{ path: 'raceDate', code: 'OUT_OF_RANGE', message: 'Pick a race date from today up to two years ahead.' }]);
		}
		const program = generateProgram(input, getLimits());
		if (input.name) {
			program.name = input.name.trim();
		}
		return program;
	}

	// Each day with done / workoutId from the workouts of its plan.
	function withProgress(program) {
		const planIds = program.days.map(d => d.planId).filter(Boolean);
		const workouts = planIds.length ? workoutsRepo.forPlans(planIds) : [];
		for (const day of program.days) {
			const mine = workouts.filter(w => day.planId && w.planId === day.planId);
			const completed = mine.find(w => w.endReason === 'completed');
			day.done = !!completed;
			day.workoutId = (completed || mine[0] || {}).id || null;
		}
		return program;
	}

	function summary(program) {
		const done = withProgress(program).days.filter(d => d.done).length;
		return { id: program.id, name: program.name, goal: program.goal, weeks: program.weeks, raceDate: program.raceDate, startDate: program.startDate, runs: program.days.length, done };
	}

	server.handle('programs:preview', 'programs-input', ({ payload }) => generate(payload));
	server.handle('programs:create', 'programs-input', async ({ payload }) => {
		const program = await programsRepo.create(generate(payload));
		changed(program.id);
		return program;
	});
	server.handle('programs:list', null, () => programsRepo.list().map(summary));
	server.handle('programs:get', 'programs-id', ({ payload }) => withProgress(programsRepo.get(payload.id)));
	server.handle('programs:delete', 'programs-id', async ({ payload }) => {
		await programsRepo.remove(payload.id);
		changed(payload.id, true);
	});

	// Saves the day's workout as a plan (once) and starts it.
	server.handle('programs:start', 'programs-start', async ({ payload, device }) => {
		const program = programsRepo.get(payload.id);
		const day = program.days.find(d => d.date === payload.date);
		if (!day) {
			throw new AppError('NOT_FOUND', 'No workout on that day.');
		}
		let planId = day.planId && plansRepo.has(day.planId) ? day.planId : null;
		if (!planId) {
			const plan = await plansRepo.importPlan({
				schemaVersion: 1,
				name: `${program.name.slice(0, 40)} · W${day.week} ${day.weekday} · ${day.title}`.slice(0, 80),
				description: `${day.description} (${program.name}, week ${day.week}, ${day.date})`.slice(0, 500),
				authoredUnits: 'metric',
				controlIncline: true,
				items: day.items
			});
			planId = plan.id;
			await programsRepo.setDayPlan(program.id, day.date, planId);
			server.io.emit('plans:changed', { id: planId });
			changed(program.id);
		}
		await engine.start(plansRepo.get(planId), { deviceId: device.id });
		return engine.snapshot();
	});
}

module.exports = { registerPrograms };
