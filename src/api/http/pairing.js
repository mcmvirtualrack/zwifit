// Pairing and device endpoints (contracts/api.md "HTTP endpoints").
const net = require('net');
const express = require('express');
const contracts = require('../../contracts');
const guards = require('../../security/httpGuards');
const { AppError } = require('../../lib/errors');
const log = require('../../lib/log');
const { deviceNameFrom, DEFAULT_DEVICE_NAME } = require('../../lib/deviceName');

const COOKIE = 'zwifit_device';
const MAX_AGE_SECONDS = 90 * 24 * 60 * 60;
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function readCookie(header, name = COOKIE) {
	if (typeof header !== 'string') {
		return undefined;
	}
	for (const part of header.split(';')) {
		const eq = part.indexOf('=');
		if (eq > 0 && part.slice(0, eq).trim() === name) {
			return part.slice(eq + 1).trim();
		}
	}
	return undefined;
}

function deviceCookie(token, secure) {
	return `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${MAX_AGE_SECONDS}${secure ? '; Secure' : ''}`;
}

function clearedCookie(secure) {
	return `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? '; Secure' : ''}`;
}

const isLoopbackAddress = address => LOOPBACK.has(address);

// A typed-in client address: an IPv4 or IPv6 address (no names, ranges or ports), as sockets report it.
function cleanAddress(input) {
	const ip = String(input).trim().replace(/^[|]$/g, '').replace(/^::ffff:/i, '').toLowerCase();
	if (!net.isIP(ip)) {
		throw new AppError('INVALID', 'Enter an IP address such as 192.168.1.50.', [{ path: 'ip', code: 'BAD_ADDRESS', message: 'Enter an IP address such as 192.168.1.50.' }]);
	}
	return ip;
}

// Devices as clients see them: never the token hash.
const publicDevice = (device, currentId) => ({
	id: device.id,
	name: device.name,
	pairedAt: device.pairedAt,
	lastSeenAt: device.lastSeenAt,
	expiresAt: device.expiresAt,
	ip: device.ip || null,
	trusted: !!device.trustedIp,
	current: device.id === currentId
});

// Middleware: only paired devices continue; sets req.device.
function createRequirePaired(pairing) {
	return async function requirePaired(req, res, next) {
		const device = await pairing.authenticate(readCookie(req.headers.cookie), req.socket.remoteAddress);
		if (!device) {
			next(new AppError('NOT_PAIRED', 'This device is not paired.'));
			return;
		}
		req.device = device;
		next();
	};
}

function createPairingRouter({ pairing, devices, onDeviceRevoked = () => {} }) {
	const router = express.Router();
	const requirePaired = createRequirePaired(pairing);

	router.get('/api/session', async (req, res) => {
		let device = await pairing.authenticate(readCookie(req.headers.cookie), req.socket.remoteAddress);
		// Devices paired before names were automatic are still called "Device": name them now.
		if (device && device.name === DEFAULT_DEVICE_NAME) {
			const name = deviceNameFrom(req.headers['user-agent']);
			device = (name && await devices.rename(device.id, name)) || device;
		}
		res.json(device ? { paired: true, deviceName: device.name } : { paired: false });
	});

	router.post('/api/pair', async (req, res) => {
		const errors = contracts.validate('pair-body', req.body);
		if (errors.length) {
			throw new AppError('INVALID', 'Enter the 8-character pairing code.', errors);
		}
		try {
			const { token } = await pairing.pair({ code: req.body.code, deviceName: req.body.deviceName, ip: req.socket.remoteAddress, userAgent: req.headers['user-agent'] });
			res.set('Set-Cookie', deviceCookie(token, req.secure));
			res.status(204).end();
		}
		catch (err) {
			if (err.code === 'LOCKED_OUT') {
				const { retryAfterSeconds } = err.details;
				res.set('Retry-After', String(retryAfterSeconds));
				res.status(429).json({ error: err.code, message: err.message, retryAfterSeconds });
				return;
			}
			throw err;
		}
	});

	router.post('/api/unpair', requirePaired, async (req, res) => {
		await devices.remove(req.device.id);
		onDeviceRevoked(req.device.id);
		res.set('Set-Cookie', clearedCookie(req.secure));
		res.status(204).end();
	});

	router.get('/api/devices', requirePaired, (req, res) => {
		res.json(devices.list().map(device => publicDevice(device, req.device.id)));
	});

	// A client let in by its address, typed in Settings (no pairing; e.g. a Surface Hub whose
	// browser will not keep a cookie).
	router.post('/api/devices', requirePaired, async (req, res) => {
		const errors = contracts.validate('device-add', req.body);
		if (errors.length) {
			throw new AppError('INVALID', 'Enter a name (1 to 40 characters) and an IP address.', errors);
		}
		const device = await devices.addTrusted({ name: req.body.name, ip: cleanAddress(req.body.ip) });
		log.info(`Added "${device.name}": no code needed from ${device.trustedIp}`);
		res.status(201).json(publicDevice(device, req.device.id));
	});

	router.patch('/api/devices/:id', guards.validateId, requirePaired, async (req, res) => {
		const errors = contracts.validate('device-rename', req.body);
		if (errors.length) {
			throw new AppError('INVALID', 'Device name must be 1 to 40 characters.', errors);
		}
		let device = null;
		if (req.body.name !== undefined) {
			device = await devices.rename(req.params.id, req.body.name);
		}
		if (req.body.ip !== undefined) {
			device = await devices.setAddress(req.params.id, cleanAddress(req.body.ip));
		}
		if (req.body.trusted !== undefined) {
			device = await devices.setTrusted(req.params.id, req.body.trusted);
			if (device) {
				log.info(device.trustedIp ? `"${device.name}" needs no code from ${device.trustedIp}` : `"${device.name}" needs its pairing again`);
			}
		}
		if (!device) {
			throw new AppError('NOT_FOUND', 'No such device.');
		}
		res.json(publicDevice(device, req.device.id));
	});

	router.delete('/api/devices/:id', guards.validateId, requirePaired, async (req, res) => {
		if (!await devices.remove(req.params.id)) {
			throw new AppError('NOT_FOUND', 'No such device.');
		}
		onDeviceRevoked(req.params.id);
		res.status(204).end();
	});

	// A paired device asks for a code to pair another one; it is shown on its screen (and printed to
	// the console), pairs one device only and expires after 10 minutes.
	router.post('/api/pairing-code', requirePaired, async (req, res) => {
		res.json(await pairing.regenerateCode({ shown: true }));
	});

	return router;
}

module.exports = { createPairingRouter, createRequirePaired, readCookie, isLoopbackAddress, COOKIE, MAX_AGE_SECONDS };
