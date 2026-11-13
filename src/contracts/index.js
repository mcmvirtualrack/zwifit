// JSON Schema validation for everything that enters the app: API payloads, plan files, settings.
// Schemas are compiled once at load. validate() returns [{ path, code, message }], empty when valid.
const fs = require('fs');
const path = require('path');
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');

const SCHEMA_DIR = path.join(__dirname, 'schemas');
const SUFFIX = '.schema.json';
const MAX_ERRORS = 50;

const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
addFormats(ajv);

const validators = new Map();
const files = fs.readdirSync(SCHEMA_DIR).filter(name => name.endsWith(SUFFIX)).sort();
for (const file of files) {
	ajv.addSchema(JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, file), 'utf8')));
}
for (const file of files) {
	const name = file.slice(0, -SUFFIX.length);
	validators.set(name, ajv.getSchema(`https://zwifit.local/schemas/${name}.json`));
}

// "/items/2/steps/0/targetKph" → "items[2].steps[0].targetKph"
function toPath(pointer, extra) {
	const parts = pointer.split('/').slice(1).map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'));
	if (extra !== undefined) {
		parts.push(extra);
	}
	let out = '';
	for (const part of parts) {
		out += /^\d+$/.test(part) ? `[${part}]` : (out ? `.${part}` : part);
	}
	return out;
}

function describe(err) {
	const p = err.params;
	switch (err.keyword) {
		case 'additionalProperties':
			return { extra: p.additionalProperty, code: 'UNKNOWN_PROPERTY', message: `"${p.additionalProperty}" is not allowed here.` };
		case 'required':
			return { extra: p.missingProperty, code: 'REQUIRED', message: `"${p.missingProperty}" is required.` };
		case 'type':
			return { code: 'WRONG_TYPE', message: `Must be ${p.type}.` };
		case 'const':
			return { code: 'NOT_ALLOWED', message: `Must be ${JSON.stringify(p.allowedValue)}.` };
		case 'enum':
			return { code: 'NOT_ALLOWED', message: `Must be one of ${p.allowedValues.map(v => JSON.stringify(v)).join(', ')}.` };
		case 'minimum':
		case 'exclusiveMinimum':
			return { code: 'TOO_SMALL', message: `Must be ${p.comparison} ${p.limit}.` };
		case 'maximum':
		case 'exclusiveMaximum':
			return { code: 'TOO_LARGE', message: `Must be ${p.comparison} ${p.limit}.` };
		case 'multipleOf':
			return { code: 'BAD_STEP', message: `Must be a multiple of ${p.multipleOf}.` };
		case 'minLength':
			return { code: 'TOO_SHORT', message: `Must be at least ${p.limit} characters.` };
		case 'maxLength':
			return { code: 'TOO_LONG', message: `Must be at most ${p.limit} characters.` };
		case 'minItems':
			return { code: 'TOO_FEW', message: `Must have at least ${p.limit} entries.` };
		case 'maxItems':
			return { code: 'TOO_MANY', message: `Must have at most ${p.limit} entries.` };
		case 'minProperties':
			return { code: 'EMPTY', message: 'Must not be empty.' };
		case 'pattern':
		case 'format':
			return { code: 'BAD_FORMAT', message: 'Has an invalid format or characters.' };
		default:
			return { code: 'INVALID', message: 'Is not valid.' };
	}
}

function validate(name, data) {
	const validator = validators.get(name);
	if (!validator) {
		throw new Error(`Unknown schema ${name}`);
	}
	if (validator(data)) {
		return [];
	}
	const out = [];
	const seen = new Set();
	for (const err of validator.errors) {
		// "if" and "anyOf" only summarize errors already reported for the failing branch.
		// "must be null" is the other branch of a nullable field; the real problem is reported too.
		if (err.keyword === 'if' || err.keyword === 'anyOf' || (err.keyword === 'type' && err.params.type === 'null')) {
			continue;
		}
		const { extra, code, message } = describe(err);
		const entry = { path: toPath(err.instancePath, extra), code, message };
		const key = `${entry.path}|${entry.code}`;
		if (!seen.has(key)) {
			seen.add(key);
			out.push(entry);
		}
		if (out.length >= MAX_ERRORS) {
			break;
		}
	}
	return out;
}

module.exports = { validate, schemaNames: () => [...validators.keys()] };
