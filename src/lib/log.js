// Logger that never writes secrets or health data: tokens, pairing codes, cookies and heart rate
// are masked at any depth before a line reaches the sink.
const { AppError } = require('./errors');

const SENSITIVE_KEYS = new Set(['token', 'code', 'cookie', 'tokenHash', 'codeHash', 'hr', 'samples']);
const MASK = '[redacted]';
const COOKIE_PATTERN = /zwifit_device=[^;\s]*/g;

function redact(value, ancestors = new Set()) {
	if (typeof value === 'string') {
		return value.replace(COOKIE_PATTERN, `zwifit_device=${MASK}`);
	}
	if (value instanceof Error) {
		return redact(value.message, ancestors);
	}
	if (value === null || typeof value !== 'object') {
		return value;
	}
	if (ancestors.has(value)) {
		return '[circular]';
	}
	ancestors.add(value);
	let out;
	if (Array.isArray(value)) {
		out = value.map(item => redact(item, ancestors));
	}
	else {
		out = {};
		for (const [key, item] of Object.entries(value)) {
			out[key] = SENSITIVE_KEYS.has(key) ? MASK : redact(item, ancestors);
		}
	}
	ancestors.delete(value);
	return out;
}

function defaultSink(level, text) {
	const write = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
	write(text);
}

let sink = defaultSink;

function setSink(fn) {
	sink = fn || defaultSink;
}

function write(level, message, meta) {
	let text = `${new Date().toISOString()} ${level.toUpperCase()} ${redact(String(message))}`;
	if (meta !== undefined) {
		text += ' ' + JSON.stringify(redact(meta));
	}
	sink(level, text);
}

// What a client may see about an error: AppError fields, or a generic message for anything else.
function safeError(err) {
	if (err instanceof AppError) {
		const out = { code: err.code, message: err.message };
		if (err.details !== undefined) {
			out.details = err.details;
		}
		return out;
	}
	return { code: 'INTERNAL', message: 'Something went wrong.' };
}

module.exports = {
	redact,
	setSink,
	safeError,
	info: (message, meta) => write('info', message, meta),
	warn: (message, meta) => write('warn', message, meta),
	error: (message, meta) => write('error', message, meta)
};
