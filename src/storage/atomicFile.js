// Crash-safe JSON storage: write to a temp file, fsync, then rename over the target.
// Writes to the same path are queued so they never interleave.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class CorruptFileError extends Error {
	constructor(fileName) {
		// Only the base name: absolute paths stay out of messages that may reach clients or logs.
		super(`${fileName} is not valid JSON`);
		this.name = 'CorruptFileError';
		this.code = 'CORRUPT_FILE';
		this.fileName = fileName;
	}
}

const queues = new Map();

function enqueue(file, task) {
	const key = path.resolve(file);
	const previous = queues.get(key) || Promise.resolve();
	const next = previous.catch(() => {}).then(task);
	queues.set(key, next);
	const cleanup = () => {
		if (queues.get(key) === next) {
			queues.delete(key);
		}
	};
	next.then(cleanup, cleanup);
	return next;
}

function writeJson(file, data) {
	const text = JSON.stringify(data, null, '\t') + '\n';
	return enqueue(file, async () => {
		await fs.promises.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
		const tmp = `${file}.${crypto.randomBytes(6).toString('hex')}.tmp`;
		try {
			const handle = await fs.promises.open(tmp, 'w', 0o600);
			try {
				await handle.writeFile(text, 'utf8');
				await handle.sync();
			}
			finally {
				await handle.close();
			}
			await fs.promises.rename(tmp, file);
		}
		catch (err) {
			await fs.promises.rm(tmp, { force: true });
			throw err;
		}
	});
}

function parse(text, file) {
	try {
		return JSON.parse(text);
	}
	catch {
		throw new CorruptFileError(path.basename(file));
	}
}

async function readJson(file) {
	let text;
	try {
		text = await fs.promises.readFile(file, 'utf8');
	}
	catch (err) {
		if (err.code === 'ENOENT') {
			return undefined;
		}
		throw err;
	}
	return parse(text, file);
}

function readJsonSync(file) {
	let text;
	try {
		text = fs.readFileSync(file, 'utf8');
	}
	catch (err) {
		if (err.code === 'ENOENT') {
			return undefined;
		}
		throw err;
	}
	return parse(text, file);
}

// Appends one JSON object as a line (NDJSON).
function appendLine(file, obj) {
	const line = JSON.stringify(obj) + '\n';
	return enqueue(file, async () => {
		await fs.promises.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
		await fs.promises.appendFile(file, line, { encoding: 'utf8', mode: 0o600 });
	});
}

function remove(file) {
	return enqueue(file, () => fs.promises.rm(file, { force: true }));
}

module.exports = { writeJson, readJson, readJsonSync, appendLine, remove, CorruptFileError };
