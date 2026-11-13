// Paired devices in devices.json (data-model.md "Paired Device"). Only SHA-256 token hashes are
// stored. A device expires 90 days after it was last seen.
const crypto = require('crypto');
const path = require('path');
const atomicFile = require('./atomicFile');
const ids = require('../lib/ids');
const { AppError } = require('../lib/errors');
const { systemClock } = require('../platform/clock');

const EXPIRY_MS = 90 * 24 * 60 * 60 * 1000;
const TOUCH_INTERVAL_MS = 60 * 1000;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

function cleanName(name) {
	const trimmed = typeof name === 'string' ? name.trim() : '';
	if (!trimmed || trimmed.length > 40 || CONTROL_CHARS.test(trimmed)) {
		throw new AppError('BAD_NAME', 'Device name must be 1 to 40 characters.');
	}
	return trimmed;
}

function createDevicesRepo({ dir, clock = systemClock }) {
	const file = path.join(dir, 'devices.json');
	let devices = [];

	const iso = ms => new Date(ms).toISOString();
	const isLive = device => Date.parse(device.expiresAt) > clock.now();
	const copy = device => ({ ...device });

	function save() {
		return atomicFile.writeJson(file, { version: 1, devices });
	}

	async function load() {
		const data = await atomicFile.readJson(file);
		devices = data && Array.isArray(data.devices) ? data.devices : [];
		const live = devices.filter(isLive);
		if (live.length !== devices.length) {
			devices = live;
			await save();
		}
	}

	function list() {
		return devices.filter(isLive).map(copy);
	}

	async function add({ name, tokenHash, ip }) {
		if (typeof tokenHash !== 'string' || !HASH_PATTERN.test(tokenHash)) {
			throw new Error('tokenHash must be a SHA-256 hex digest');
		}
		const now = clock.now();
		const device = {
			id: ids.newId(),
			name: cleanName(name),
			tokenHash,
			pairedAt: iso(now),
			lastSeenAt: iso(now),
			expiresAt: iso(now + EXPIRY_MS),
			...(ip ? { ip } : {})
		};
		devices.push(device);
		await save();
		return copy(device);
	}

	function findByTokenHash(tokenHash) {
		const device = devices.find(d => d.tokenHash === tokenHash);
		return device && isLive(device) ? copy(device) : null;
	}

	// Renews expiry. Writes at most once a minute per device.
	async function touch(id) {
		const device = devices.find(d => d.id === id);
		if (!device || !isLive(device)) {
			return null;
		}
		const now = clock.now();
		if (now - Date.parse(device.lastSeenAt) >= TOUCH_INTERVAL_MS) {
			device.lastSeenAt = iso(now);
			device.expiresAt = iso(now + EXPIRY_MS);
			await save();
		}
		return copy(device);
	}

	// The address a device last used its cookie from (shown in Settings, and what "trust" pins).
	async function seenFrom(id, ip) {
		const device = devices.find(d => d.id === id);
		if (!device || !ip || device.ip === ip) {
			return;
		}
		device.ip = ip;
		await save();
	}

	// trusted: requests from the device's last address count as this device without its cookie,
	// for browsers that will not keep one (e.g. a locked-down Surface Hub). false clears it.
	async function setTrusted(id, trusted) {
		const device = devices.find(d => d.id === id);
		if (!device || !isLive(device)) {
			return null;
		}
		if (trusted && !device.ip) {
			throw new AppError('NO_ADDRESS', 'Zwifit has not seen this device\'s address yet. Open Zwifit on it once, then try again.');
		}
		if (trusted) {
			assertAddressFree(device.ip, id);
		}
		device.trustedIp = trusted ? device.ip : null;
		await save();
		return copy(device);
	}

	// A device let in by its address alone, typed in Settings: no pairing, no usable token.
	async function addTrusted({ name, ip }) {
		assertAddressFree(ip);
		const tokenHash = crypto.randomBytes(32).toString('hex');
		const device = await add({ name, tokenHash, ip });
		return setTrusted(device.id, true);
	}

	// Changes a device's address (e.g. its DHCP lease changed); a trusted one stays trusted there.
	async function setAddress(id, ip) {
		const device = devices.find(d => d.id === id);
		if (!device || !isLive(device)) {
			return null;
		}
		assertAddressFree(ip, id);
		device.ip = ip;
		if (device.trustedIp) {
			device.trustedIp = ip;
		}
		await save();
		return copy(device);
	}

	function assertAddressFree(ip, exceptId) {
		if (devices.some(d => d.id !== exceptId && isLive(d) && d.trustedIp === ip)) {
			throw new AppError('ADDRESS_TAKEN', 'Another device is already trusted at that address.');
		}
	}

	function findByTrustedIp(ip) {
		const device = ip ? devices.find(d => d.trustedIp === ip) : null;
		return device && isLive(device) ? copy(device) : null;
	}

	async function rename(id, name) {
		const device = devices.find(d => d.id === id);
		if (!device || !isLive(device)) {
			return null;
		}
		device.name = cleanName(name);
		await save();
		return copy(device);
	}

	async function remove(id) {
		const before = devices.length;
		devices = devices.filter(d => d.id !== id);
		if (devices.length === before) {
			return false;
		}
		await save();
		return true;
	}

	return { load, list, add, addTrusted, findByTokenHash, findByTrustedIp, touch, seenFrom, setTrusted, setAddress, rename, remove };
}

module.exports = { createDevicesRepo, EXPIRY_MS, TOUCH_INTERVAL_MS };
