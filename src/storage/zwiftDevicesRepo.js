// Devices that have connected to the Zwift broadcast, in zwift-devices.json, so the dashboard can
// list them by a name the user gives them. Bluetooth tells us only the address (phones and Apple
// TVs often use a private one that changes), so the user can rename or forget each entry.
const path = require('path');
const atomicFile = require('./atomicFile');
const { AppError } = require('../lib/errors');
const { systemClock } = require('../platform/clock');

const MAX_DEVICES = 20;
const ADDRESS = /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/;
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

function cleanName(name) {
	const trimmed = typeof name === 'string' ? name.trim() : '';
	if (!trimmed || trimmed.length > 40 || CONTROL_CHARS.test(trimmed)) {
		throw new AppError('BAD_NAME', 'Device name must be 1 to 40 characters.');
	}
	return trimmed;
}

// Until renamed: "Bluetooth device ··5A:10".
function defaultName(address) {
	return `Bluetooth device ··${address.slice(-5).toUpperCase()}`;
}

function createZwiftDevicesRepo({ dir, clock = systemClock }) {
	const file = path.join(dir, 'zwift-devices.json');
	let devices = [];

	const save = () => atomicFile.writeJson(file, { version: 1, devices });
	const find = address => devices.find(d => d.address === address);
	const copy = d => ({ ...d, services: [...d.services] });

	async function load() {
		const data = await atomicFile.readJson(file);
		devices = data && Array.isArray(data.devices)
			? data.devices.filter(d => d && ADDRESS.test(d.address)).map(d => ({ ...d, services: Array.isArray(d.services) ? d.services : [] }))
			: [];
	}

	// Most recently seen first.
	function list() {
		return devices.map(copy).sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
	}

	// Records a connection (and any services it uses); keeps the newest MAX_DEVICES.
	async function seen(address, services = []) {
		const key = String(address).toLowerCase();
		if (!ADDRESS.test(key)) {
			return;
		}
		const now = new Date(clock.now()).toISOString();
		let device = find(key);
		if (!device) {
			device = { address: key, name: defaultName(key), named: false, firstSeenAt: now, lastSeenAt: now, services: [] };
			devices.push(device);
		}
		device.lastSeenAt = now;
		for (const service of services) {
			if (!device.services.includes(service)) {
				device.services.push(service);
			}
		}
		devices = list().slice(0, MAX_DEVICES);
		await save();
	}

	async function rename(address, name) {
		const device = find(String(address).toLowerCase());
		if (!device) {
			throw new AppError('NOT_FOUND', 'That device is not in the list.');
		}
		device.name = cleanName(name);
		device.named = true;
		await save();
		return copy(device);
	}

	async function forget(address) {
		const before = devices.length;
		devices = devices.filter(d => d.address !== String(address).toLowerCase());
		if (devices.length === before) {
			throw new AppError('NOT_FOUND', 'That device is not in the list.');
		}
		await save();
	}

	return { load, list, seen, rename, forget };
}

module.exports = { createZwiftDevicesRepo, defaultName };
