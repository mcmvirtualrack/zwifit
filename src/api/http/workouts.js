// GET /api/workouts/:id/export.csv (contracts/workout-export-csv.md; units follow the current
// setting) and /export.fit (Garmin FIT activity for Garmin Connect, Strava and others).
const { toCsv, csvFileName } = require('../../core/history/csv');
const { toFit, fitFileName } = require('../../core/history/fit');

function mountWorkouts(router, { requirePaired, validateId, workoutsRepo, settingsRepo }) {
	router.get('/api/workouts/:id/export.csv', validateId, requirePaired, async (req, res) => {
		const workout = workoutsRepo.get(req.params.id);
		const samples = await workoutsRepo.allSamples(req.params.id);
		res.set('Content-Disposition', `attachment; filename="${csvFileName(workout)}"`);
		res.type('text/csv; charset=utf-8').send(toCsv(workout, samples, { metric: settingsRepo.get().metric }));
	});

	router.get('/api/workouts/:id/export.fit', validateId, requirePaired, async (req, res) => {
		const workout = workoutsRepo.get(req.params.id);
		const samples = await workoutsRepo.allSamples(req.params.id);
		res.set('Content-Disposition', `attachment; filename="${fitFileName(workout)}"`);
		res.type('application/vnd.ant.fit').send(toFit(workout, samples));
	});
}

module.exports = { mountWorkouts };
