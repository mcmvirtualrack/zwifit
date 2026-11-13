// Workouts: workouts/<id>.json (summary) and workouts/<id>.samples.ndjson (one sample per line,
// appended and flushed each second). Kept until the user deletes them (FR-019e).
const fs = require('fs');
const path = require('path');
const atomicFile = require('./atomicFile');
const ids = require('../lib/ids');
const log = require('../lib/log');
const { AppError } = require('../lib/errors');
const { rebuildFromSamples } = require('../core/history/recorder');
const { parseSamples } = require('../core/history/summarize');

const clone = value => JSON.parse(JSON.stringify(value));

function createWorkoutsRepo({ dir }) {
	const workoutsDir = path.join(dir, 'workouts');
	const workouts = new Map();

	const summaryFile = id => path.join(workoutsDir, `${id}.json`);
	const samplesFile = id => path.join(workoutsDir, `${id}.samples.ndjson`);

	async function readSamplesText(id) {
		try {
			return await fs.promises.readFile(samplesFile(id), 'utf8');
		}
		catch (err) {
			if (err.code === 'ENOENT') {
				return '';
			}
			throw err;
		}
	}

	// Loads summaries and closes any workout a crash left open (endedAt null) as appRestart.
	async function load() {
		workouts.clear();
		let files = [];
		try {
			files = (await fs.promises.readdir(workoutsDir)).filter(name => /^[0-9A-HJKMNP-TV-Z]{26}\.json$/.test(name));
		}
		catch (err) {
			if (err.code !== 'ENOENT') {
				throw err;
			}
		}
		const recovered = [];
		for (const file of files) {
			let workout;
			try {
				workout = await atomicFile.readJson(path.join(workoutsDir, file));
			}
			catch {
				log.warn('Skipped a workout file that could not be read', { file });
				continue;
			}
			if (!workout || !ids.isId(workout.id)) {
				continue;
			}
			if (!workout.endedAt) {
				workout = rebuildFromSamples(workout, await readSamplesText(workout.id));
				await atomicFile.writeJson(summaryFile(workout.id), workout);
				recovered.push(workout.id);
			}
			workouts.set(workout.id, workout);
		}
		return { recovered };
	}

	async function create(header) {
		workouts.set(header.id, clone(header));
		await atomicFile.writeJson(summaryFile(header.id), header);
	}

	function appendSample(id, sample) {
		return atomicFile.appendLine(samplesFile(id), sample);
	}

	async function finish(workout) {
		workouts.set(workout.id, clone(workout));
		await atomicFile.writeJson(summaryFile(workout.id), workout);
	}

	const listEntry = w => ({
		id: w.id,
		planId: w.planId,
		planName: w.planName,
		startedAt: w.startedAt,
		endedAt: w.endedAt,
		endReason: w.endReason,
		totals: w.totals
	});

	// Newest first. `before` (ISO time) pages back through older workouts.
	function list({ before, limit = 20 } = {}) {
		const cutoff = before ? Date.parse(before) : Infinity;
		return [...workouts.values()]
			.filter(w => Date.parse(w.startedAt) < cutoff)
			.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
			.slice(0, Math.min(Math.max(limit, 1), 100))
			.map(listEntry);
	}

	// Every workout of these plans (newest first), e.g. to mark a program's days done.
	function forPlans(planIds) {
		const wanted = new Set(planIds);
		return [...workouts.values()]
			.filter(w => wanted.has(w.planId))
			.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
			.map(listEntry);
	}

	function get(id) {
		const workout = workouts.get(id);
		if (!workout) {
			throw new AppError('NOT_FOUND', 'No such workout.');
		}
		const out = clone(workout);
		delete out.planSnapshot;
		return out;
	}

	function getFull(id) {
		const workout = workouts.get(id);
		if (!workout) {
			throw new AppError('NOT_FOUND', 'No such workout.');
		}
		return clone(workout);
	}

	async function samples(id, { fromIndex = 0, limit = 3600 } = {}) {
		get(id);
		const all = parseSamples(await readSamplesText(id));
		const size = Math.min(Math.max(limit, 1), 3600);
		return { total: all.length, fromIndex, samples: all.slice(fromIndex, fromIndex + size) };
	}

	async function allSamples(id) {
		get(id);
		return parseSamples(await readSamplesText(id));
	}

	async function remove(id) {
		get(id);
		await atomicFile.remove(summaryFile(id));
		await atomicFile.remove(samplesFile(id));
		workouts.delete(id);
	}

	return { load, create, appendSample, finish, list, forPlans, get, getFull, samples, allSamples, remove };
}

module.exports = { createWorkoutsRepo };
