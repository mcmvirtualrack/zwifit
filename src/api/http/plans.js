// Plan file export and import (contracts/api.md). The body parser for /api/plans/import allows 1 MB.
const { AppError } = require('../../lib/errors');

const safeFileName = name => (name.replace(/[^A-Za-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'plan');

function mountPlans(router, { requirePaired, validateId, plansRepo, onChanged = () => {} }) {
	router.get('/api/plans/:id/export', validateId, requirePaired, (req, res) => {
		const plan = plansRepo.get(req.params.id);
		delete plan.id;
		delete plan.createdAt;
		delete plan.updatedAt;
		res.set('Content-Disposition', `attachment; filename="${safeFileName(plan.name)}.zwifit-plan.json"`);
		res.type('application/json').send(JSON.stringify(plan, null, '\t'));
	});

	router.post('/api/plans/import', requirePaired, async (req, res) => {
		if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
			throw new AppError('INVALID_PLAN', 'That is not a Zwifit plan file.');
		}
		const plan = await plansRepo.importPlan(req.body);
		onChanged(plan.id);
		res.status(201).json({ id: plan.id });
	});
}

module.exports = { mountPlans, safeFileName };
