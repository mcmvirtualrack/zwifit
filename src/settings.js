// Compatibility shim: the flat settings object the legacy modules (src/ifit.js, src/ble/**,
// src/oneTimeSetup.js) expect, backed by settings.json v2 via src/storage/settingsRepo.
// New code uses settingsRepo directly. Remove once the legacy modules become adapters.
const { createSettingsRepo, BLE_INTERNALS } = require('./storage/settingsRepo');
const log = require('./lib/log');

const TREADMILL_KEYS = ['ip', 'lastIP', 'bleCode', 'bleDeviceName', ...BLE_INTERNALS];
const FLAT_KEYS = ['metric', 'speedOffset', 'speedMultiplier', 'broadcastRSC', 'broadcastFTMS', 'ble', ...TREADMILL_KEYS];

let repo = null;

function getRepo() {
	if (!repo) {
		repo = createSettingsRepo();
	}
	return repo;
}

function applyFlat(settings) {
	exports.version = settings.version;
	exports.metric = settings.metric;
	exports.speedOffset = settings.speedOffset;
	exports.speedMultiplier = settings.speedMultiplier;
	exports.broadcastFTMS = settings.broadcast.ftms;
	exports.broadcastRSC = settings.broadcast.rsc;
	exports.ble = settings.treadmill.transport === 'ble';
	for (const key of TREADMILL_KEYS) {
		exports[key] = settings.treadmill[key] === undefined ? null : settings.treadmill[key];
	}
}

function toV2() {
	const next = getRepo().get();
	next.metric = !!exports.metric;
	next.speedOffset = exports.speedOffset;
	next.speedMultiplier = exports.speedMultiplier;
	next.broadcast = { ftms: !!exports.broadcastFTMS, rsc: !!exports.broadcastRSC };
	next.treadmill.transport = exports.ble ? 'ble' : 'wifi';
	for (const key of TREADMILL_KEYS) {
		if (exports[key] === null || exports[key] === undefined) {
			delete next.treadmill[key];
		}
		else {
			next.treadmill[key] = exports[key];
		}
	}
	next.treadmill.ip = next.treadmill.ip || null;
	next.treadmill.lastIP = next.treadmill.lastIP || null;
	next.treadmill.bleCode = next.treadmill.bleCode || null;
	return next;
}

// Returns true when settings were found (settings.json or legacy settings.conf), false on first run.
function load() {
	try {
		const { source } = getRepo().load();
		applyFlat(getRepo().get());
		if (source === 'settings.conf') {
			save();
		}
		return source !== 'defaults';
	}
	catch (err) {
		log.error('Could not load settings', log.safeError(err));
		return false;
	}
}

function save() {
	Promise.resolve()
		.then(() => getRepo().replace(toV2()))
		.catch(err => log.error('Could not save settings', log.safeError(err)));
}

function toJSON() {
	const out = { version: exports.version };
	for (const key of FLAT_KEYS) {
		out[key] = exports[key];
	}
	return out;
}

// Only known keys are copied; anything else is ignored.
function fromJSON(json) {
	for (const key of FLAT_KEYS) {
		if (json && Object.prototype.hasOwnProperty.call(json, key)) {
			exports[key] = json[key];
		}
	}
}

exports.version = 2;
exports.metric = false;
exports.speedOffset = 0;
exports.speedMultiplier = 1;
exports.broadcastRSC = false;
exports.broadcastFTMS = true;
exports.ble = false;
for (const key of TREADMILL_KEYS) {
	exports[key] = null;
}
exports.load = load;
exports.save = save;
exports.toJSON = toJSON;
exports.fromJSON = fromJSON;
