// Training programs (multi-week schedules, src/core/programs/generate.js) in programs/<id>.json.
// A day's workout becomes a plan the first time it is started; its id is kept on the day.
const fs = require('fs');
const path = require('path');
const atomicFile = require('./atomicFile');
const ids = require('../lib/ids');
const log = require('../lib/log');
const { AppError } = require('../lib/errors');
const { systemClock } = require('../platform/clock');

const clone = value => JSON.parse(JSON.stringify(value));

function createProgramsRepo({ dir, clock = systemClock }) {
	const programsDir = path.join(dir, 'programs');
	const programs = new Map();
	const fileFor = id => path.join(programsDir, `${id}.json`);

	async function load() {
		programs.clear();
		let files = [];
		try {
			files = (await fs.promises.readdir(programsDir)).filter(name => name.endsWith('.json'));
		}
		catch (err) {
			if (err.code !== 'ENOENT') {
				throw err;
			}
		}
		for (const file of files) {
			try {
				const program = await atomicFile.readJson(path.join(programsDir, file));
				if (!program || !ids.isId(program.id) || `${program.id}.json` !== file || !Array.isArray(program.days)) {
					throw new Error('bad shape');
				}
				programs.set(program.id, program);
			}
			catch {
				log.warn('Skipped a program file that could not be loaded', { file });
			}
		}
	}

	// Newest first.
	function list() {
		return [...programs.values()]
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
			.map(clone);
	}

	function get(id) {
		const program = programs.get(id);
		if (!program) {
			throw new AppError('NOT_FOUND', 'No such program.');
		}
		return clone(program);
	}

	async function write(program) {
		await atomicFile.writeJson(fileFor(program.id), program);
		programs.set(program.id, clone(program));
		return clone(program);
	}

	async function create(generated) {
		return write({ ...clone(generated), id: ids.newId(), schemaVersion: 1, createdAt: new Date(clock.now()).toISOString() });
	}

	// Remembers which plan a day's workout was saved as.
	async function setDayPlan(id, date, planId) {
		const program = get(id);
		const day = program.days.find(d => d.date === date);
		if (!day) {
			throw new AppError('NOT_FOUND', 'No workout on that day.');
		}
		day.planId = planId;
		return write(program);
	}

	// A custom program after an edit: same id and createdAt, new days.
	async function replace(id, next) {
		const current = get(id);
		return write({ ...clone(next), id, schemaVersion: current.schemaVersion, createdAt: current.createdAt, updatedAt: new Date(clock.now()).toISOString() });
	}

	async function remove(id) {
		if (!programs.has(id)) {
			throw new AppError('NOT_FOUND', 'No such program.');
		}
		await atomicFile.remove(fileFor(id));
		programs.delete(id);
	}

	return { load, list, get, create, replace, setDayPlan, remove };
}

module.exports = { createProgramsRepo };
