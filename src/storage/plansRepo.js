// Training plans in plans/<id>.json. Names are unique (ignoring case). Plans are re-validated on
// load against the current limits: a plan that no longer fits is flagged, never deleted.
const fs = require('fs');
const path = require('path');
const atomicFile = require('./atomicFile');
const ids = require('../lib/ids');
const log = require('../lib/log');
const { AppError } = require('../lib/errors');
const { systemClock } = require('../platform/clock');
const { validatePlan } = require('../core/plans/validate');
const { totals } = require('../core/plans/totals');

const clone = value => JSON.parse(JSON.stringify(value));
const SERVER_FIELDS = ['id', 'createdAt', 'updatedAt'];

function createPlansRepo({ dir, clock = systemClock, getLimits = () => undefined }) {
	const plansDir = path.join(dir, 'plans');
	const plans = new Map();
	let problems = [];

	const fileFor = id => path.join(plansDir, `${id}.json`);
	const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

	async function load() {
		plans.clear();
		problems = [];
		let files = [];
		try {
			files = (await fs.promises.readdir(plansDir)).filter(name => name.endsWith('.json'));
		}
		catch (err) {
			if (err.code !== 'ENOENT') {
				throw err;
			}
		}
		for (const file of files) {
			try {
				const plan = await atomicFile.readJson(path.join(plansDir, file));
				const errors = validatePlan(plan);
				if (errors.length || !ids.isId(plan.id) || `${plan.id}.json` !== file) {
					problems.push({ file, code: 'INVALID_PLAN', details: errors });
					continue;
				}
				plans.set(plan.id, plan);
			}
			catch (err) {
				problems.push({ file, code: err.code === 'CORRUPT_FILE' ? 'CORRUPT_FILE' : 'UNREADABLE' });
			}
		}
		for (const problem of problems) {
			log.warn('Skipped a plan file that could not be loaded', { file: problem.file, code: problem.code });
		}
	}

	function summary(plan) {
		const limitErrors = validatePlan(plan, { limits: getLimits() });
		const out = { id: plan.id, name: plan.name, totals: totals(plan), updatedAt: plan.updatedAt };
		if (limitErrors.length) {
			out.problems = limitErrors;
		}
		return out;
	}

	function list() {
		return [...plans.values()].sort((a, b) => a.name.localeCompare(b.name)).map(summary);
	}

	function get(id) {
		const plan = plans.get(id);
		if (!plan) {
			throw new AppError('NOT_FOUND', 'No such plan.');
		}
		return clone(plan);
	}

	function has(id) {
		return plans.has(id);
	}

	function assertNameFree(name, exceptId) {
		for (const plan of plans.values()) {
			if (plan.id !== exceptId && sameName(plan.name, name)) {
				throw new AppError('NAME_TAKEN', 'A plan with that name already exists.', [{ path: 'name', code: 'NAME_TAKEN', message: 'A plan with that name already exists.' }]);
			}
		}
	}

	function freeName(base) {
		const trimmed = base.trim().slice(0, 70);
		if (![...plans.values()].some(p => sameName(p.name, trimmed))) {
			return trimmed;
		}
		for (let n = 2; ; n++) {
			const candidate = `${trimmed} (${n})`;
			if (![...plans.values()].some(p => sameName(p.name, candidate))) {
				return candidate;
			}
		}
	}

	// Create (no id) or update (existing id). Returns the stored plan.
	async function save(input) {
		const data = clone(input);
		const existing = data.id ? plans.get(data.id) : null;
		if (data.id && !existing) {
			throw new AppError('NOT_FOUND', 'No such plan.');
		}
		delete data.createdAt;
		delete data.updatedAt;
		if (typeof data.name === 'string') {
			data.name = data.name.trim();
		}
		const errors = validatePlan(data, { limits: getLimits() });
		if (errors.length) {
			throw new AppError('INVALID_PLAN', 'The plan has problems.', errors);
		}
		assertNameFree(data.name, data.id);
		const now = new Date(clock.now()).toISOString();
		const plan = { ...data, id: data.id || ids.newId(), createdAt: existing ? existing.createdAt : now, updatedAt: now };
		await atomicFile.writeJson(fileFor(plan.id), plan);
		plans.set(plan.id, plan);
		return clone(plan);
	}

	async function duplicate(id, name) {
		const source = get(id);
		for (const field of SERVER_FIELDS) {
			delete source[field];
		}
		source.name = name ? name.trim() : freeName(`${source.name} (copy)`);
		return save(source);
	}

	// A plan file from export: gets a new id; a clashing name gets a number.
	async function importPlan(file) {
		const data = clone(file);
		for (const field of SERVER_FIELDS) {
			delete data[field];
		}
		if (typeof data.name === 'string') {
			data.name = freeName(data.name);
		}
		return save(data);
	}

	async function remove(id) {
		if (!plans.has(id)) {
			throw new AppError('NOT_FOUND', 'No such plan.');
		}
		await atomicFile.remove(fileFor(id));
		plans.delete(id);
	}

	return { load, list, get, has, save, duplicate, importPlan, remove, problems: () => clone(problems) };
}

module.exports = { createPlansRepo };
