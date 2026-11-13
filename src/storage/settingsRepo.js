// settings.json v2 in the data directory (data-model.md "Settings"). Migrates the legacy YAML
// settings.conf from the repository root once, leaving that file untouched.
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const contracts = require('../contracts');
const paths = require('../platform/paths');
const atomicFile = require('./atomicFile');
const { AppError } = require('../lib/errors');

const DEFAULT_SETTINGS = Object.freeze({
	version: 2,
	metric: false,
	treadmill: { transport: 'wifi', ip: null, lastIP: null, bleCode: null },
	speedOffset: 0,
	speedMultiplier: 1,
	fallbackKph: null,
	limits: { minKph: 0, maxKph: 20, minIncline: 0, maxIncline: 15 },
	cooldownKph: 3.2,
	broadcast: { ftms: true, rsc: false, hr: true },
	sensors: { ant: true, hrSource: 'auto', cadenceSource: 'auto', powerSource: 'auto' },
	server: { port: 1337, host: '0.0.0.0', tls: null }
});

// Kept in settings.json for the BLE adapter but never sent to, or written by, clients.
const BLE_INTERNALS = ['bleActivation', 'bleDetails', 'bleServices', 'bleAdvertisingData', 'bleScanData'];

const clone = value => JSON.parse(JSON.stringify(value));
const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function merge(base, patch) {
	const out = clone(base);
	for (const [key, value] of Object.entries(patch)) {
		out[key] = isPlainObject(value) && isPlainObject(out[key]) ? merge(out[key], value) : value;
	}
	return out;
}

function invalid(details) {
	return new AppError('INVALID_SETTINGS', 'Settings are not valid.', details);
}

// Schema plus the rules JSON Schema can't express.
function validateSettings(settings) {
	const errors = contracts.validate('settings', settings);
	if (errors.length) {
		return errors;
	}
	const { limits, cooldownKph, fallbackKph, server } = settings;
	if (limits.minKph >= limits.maxKph) {
		errors.push({ path: 'limits.minKph', code: 'MIN_NOT_BELOW_MAX', message: 'Minimum speed must be below maximum speed.' });
	}
	if (limits.minIncline >= limits.maxIncline) {
		errors.push({ path: 'limits.minIncline', code: 'MIN_NOT_BELOW_MAX', message: 'Minimum incline must be below maximum incline.' });
	}
	if (cooldownKph < limits.minKph || cooldownKph > limits.maxKph) {
		errors.push({ path: 'cooldownKph', code: 'OUTSIDE_LIMITS', message: 'Cool-down speed must be within the speed limits.' });
	}
	if (fallbackKph !== null && fallbackKph !== undefined && (fallbackKph < limits.minKph || fallbackKph > limits.maxKph)) {
		errors.push({ path: 'fallbackKph', code: 'OUTSIDE_LIMITS', message: 'Fallback speed must be within the speed limits.' });
	}
	if (server.tls && !server.tls.certPath !== !server.tls.keyPath) {
		errors.push({ path: 'server.tls', code: 'TLS_INCOMPLETE', message: 'HTTPS needs both a certificate and a key file.' });
	}
	if (server.tls && server.tls.port && server.tls.port === server.port) {
		errors.push({ path: 'server.tls.port', code: 'PORT_CLASH', message: 'The HTTPS port must differ from the main port.' });
	}
	return errors;
}

function migrateLegacy(legacy) {
	const out = clone(DEFAULT_SETTINGS);
	const has = key => legacy[key] !== undefined && legacy[key] !== null;
	if (has('metric')) {
		out.metric = !!legacy.metric;
	}
	out.treadmill.transport = legacy.ble ? 'ble' : 'wifi';
	for (const key of ['ip', 'lastIP', 'bleDeviceName', ...BLE_INTERNALS]) {
		if (has(key)) {
			out.treadmill[key] = legacy[key];
		}
	}
	if (has('bleCode')) {
		out.treadmill.bleCode = String(legacy.bleCode);
	}
	for (const key of ['speedOffset', 'speedMultiplier']) {
		if (has(key)) {
			out[key] = legacy[key];
		}
	}
	if (has('broadcastFTMS')) {
		out.broadcast.ftms = !!legacy.broadcastFTMS;
	}
	if (has('broadcastRSC')) {
		out.broadcast.rsc = !!legacy.broadcastRSC;
	}
	return out;
}

function createSettingsRepo({ dir = paths.dataDir(), legacyDir = paths.legacyDir() } = {}) {
	const file = path.join(dir, 'settings.json');
	const legacyFile = path.join(legacyDir, 'settings.conf');
	let current = null;
	let needsSave = false;

	// Synchronous so the legacy startup code can use it. Returns how the settings were found.
	function load() {
		let loaded = atomicFile.readJsonSync(file);
		let source = 'settings.json';
		if (loaded === undefined) {
			if (fs.existsSync(legacyFile)) {
				// js-yaml 4 load() is safe: no custom types or code execution.
				loaded = migrateLegacy(yaml.load(fs.readFileSync(legacyFile, 'utf8')) || {});
				source = 'settings.conf';
			}
			else {
				loaded = clone(DEFAULT_SETTINGS);
				source = 'defaults';
			}
			needsSave = true;
		}
		const errors = validateSettings(loaded);
		if (errors.length) {
			throw invalid(errors);
		}
		current = loaded;
		return { source };
	}

	async function save() {
		await atomicFile.writeJson(file, current);
		needsSave = false;
	}

	async function init() {
		const result = load();
		if (needsSave) {
			await save();
		}
		return result;
	}

	function get() {
		if (!current) {
			throw new Error('Settings not loaded');
		}
		return clone(current);
	}

	async function commit(next) {
		const errors = validateSettings(next);
		if (errors.length) {
			throw invalid(errors);
		}
		await atomicFile.writeJson(file, next);
		current = next;
		return clone(current);
	}

	// A change from a paired device: only fields in settings-write.schema.json.
	async function update(partial) {
		const errors = contracts.validate('settings-write', partial);
		if (errors.length) {
			throw invalid(errors);
		}
		return commit(merge(get(), partial));
	}

	// Whole-settings replacement for trusted host-side code (setup, BLE activation).
	async function replace(next) {
		return commit(clone(next));
	}

	function publicView() {
		const view = get();
		for (const key of BLE_INTERNALS) {
			delete view.treadmill[key];
		}
		return view;
	}

	return { file, load, init, save, get, update, replace, publicView };
}

module.exports = { createSettingsRepo, validateSettings, migrateLegacy, DEFAULT_SETTINGS, BLE_INTERNALS };
