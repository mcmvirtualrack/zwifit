// Device pairing (research R6). The 8-character code is printed to the host console, and a code a
// paired device asks for in Settings is also shown on its screen (that one pairs a single device
// and expires after 10 minutes). pairing.json holds its SHA-256 hash and is re-read on every
// attempt, so `npm run pair` takes effect while the app is running. Devices receive a random
// token, stored only as a hash.
const crypto = require('crypto');
const path = require('path');
const atomicFile = require('../storage/atomicFile');
const { AppError } = require('../lib/errors');
const log = require('../lib/log');
const { deviceNameFrom, DEFAULT_DEVICE_NAME } = require('../lib/deviceName');
const { systemClock } = require('../platform/clock');

const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 8;
const TOKEN_BYTES = 32;
const SHOWN_CODE_MS = 10 * 60 * 1000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const LOOK_ALIKES = { O: '0', I: '1', L: '1' };

const sha256 = text => crypto.createHash('sha256').update(text).digest('hex');

function generateCode() {
	let code = '';
	for (let i = 0; i < CODE_LENGTH; i++) {
		code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
	}
	return code;
}

// Accepts "abcd-efgh", spaces and Crockford look-alikes; returns the canonical code or null.
function normalizeCode(input) {
	if (typeof input !== 'string') {
		return null;
	}
	const code = input.toUpperCase().replace(/[\s-]/g, '').replace(/[OIL]/g, c => LOOK_ALIKES[c]);
	if (code.length !== CODE_LENGTH || [...code].some(c => !CODE_ALPHABET.includes(c))) {
		return null;
	}
	return code;
}

const formatCode = code => `${code.slice(0, 4)}-${code.slice(4)}`;

function hashToken(token) {
	return sha256(token);
}

function sameHash(a, b) {
	const left = Buffer.from(a, 'hex');
	const right = Buffer.from(b, 'hex');
	return left.length === right.length && crypto.timingSafeEqual(left, right);
}

// "::ffff:192.168.1.5" (IPv4 on a dual-stack socket) → "192.168.1.5".
const plainAddress = ip => (typeof ip === 'string' && ip ? ip.replace(/^::ffff:/, '') : null);

function defaultPrinter(code) {
	// Deliberately console, not the redacting logger: this is the one place the code is shown.
	console.log(`Pairing code: ${code}`);
}

function createPairing({ dir, devices, rateLimit, clock = systemClock, printCode = defaultPrinter }) {
	const file = path.join(dir, 'pairing.json');

	const readState = async () => (await atomicFile.readJson(file)) || null;

	// Restores a persisted global suspension into the rate limiter.
	async function load() {
		const state = await readState();
		if (state && state.suspended) {
			rateLimit.suspend();
		}
	}

	// shown: the code is also returned to a paired device's screen (Settings → Paired devices), so
	// it pairs one device only and expires after SHOWN_CODE_MS. Returns { code, expiresAt? }.
	async function regenerateCode({ shown = false } = {}) {
		const code = generateCode();
		const now = clock.now();
		const expiresAt = shown ? new Date(now + SHOWN_CODE_MS).toISOString() : undefined;
		await atomicFile.writeJson(file, {
			version: 1,
			codeHash: sha256(code),
			createdAt: new Date(now).toISOString(),
			...(shown ? { expiresAt, singleUse: true } : {}),
			suspended: false
		});
		rateLimit.reset();
		printCode(formatCode(code));
		return { code: formatCode(code), ...(expiresAt ? { expiresAt } : {}) };
	}

	// Makes a code on first run. Returns true when a new code was printed.
	async function ensureCode() {
		if (await readState()) {
			return false;
		}
		await regenerateCode();
		return true;
	}

	async function suspend() {
		const state = await readState();
		if (state && !state.suspended) {
			await atomicFile.writeJson(file, { ...state, suspended: true });
		}
	}

	async function pair({ code, deviceName, ip, userAgent }) {
		let state = await readState();
		if (state && !state.suspended && rateLimit.isSuspended()) {
			// Someone ran `npm run pair` in another process: the new code lifts the suspension.
			rateLimit.reset();
		}
		if (state && state.suspended) {
			rateLimit.suspend();
		}
		const allowed = rateLimit.check(ip);
		if (!allowed.allowed) {
			if (allowed.reason === 'SUSPENDED') {
				throw new AppError('PAIRING_SUSPENDED', 'Pairing is paused after too many wrong codes. Run "npm run pair" on the host for a new code.');
			}
			throw new AppError('LOCKED_OUT', 'Too many wrong codes. Try again later.', { retryAfterSeconds: allowed.retryAfterSeconds });
		}

		const normalized = normalizeCode(code);
		state = await readState();
		const usable = state && state.codeHash && !(state.expiresAt && clock.now() > Date.parse(state.expiresAt));
		if (!usable || !normalized || !sameHash(sha256(normalized), state.codeHash)) {
			// Why, for the owner's console only (the device just hears "not right").
			const why = !state ? 'no code made yet' : state.usedAt && !state.codeHash ? 'that code was already used' : !usable ? 'that code expired' : 'wrong code';
			log.warn(`Pairing refused: ${why}`, { ip });
			rateLimit.fail(ip);
			if (rateLimit.isSuspended()) {
				await suspend();
			}
			throw new AppError('BAD_CODE', 'That pairing code is not right, or it has expired or was already used.');
		}

		rateLimit.succeed(ip);
		if (state.singleUse) {
			// A code shown on screen pairs one device; the next one needs a new code.
			await atomicFile.writeJson(file, { ...state, codeHash: null, usedAt: new Date(clock.now()).toISOString() });
		}
		const token = crypto.randomBytes(TOKEN_BYTES).toString('base64url');
		// Without a name typed in, name it after its browser ("iPhone · Safari").
		const name = (typeof deviceName === 'string' && deviceName.trim()) || deviceNameFrom(userAgent) || DEFAULT_DEVICE_NAME;
		const device = await devices.add({ name, tokenHash: hashToken(token), ip: plainAddress(ip) });
		log.info(`Paired "${name}"`, { ip });
		return { token, device };
	}

	// Token from the device cookie → the device (renewing its expiry), or null. Without a valid
	// cookie, a request from an address the owner trusted for a device counts as that device.
	async function authenticate(token, ip) {
		const address = plainAddress(ip);
		const byToken = typeof token === 'string' && TOKEN_PATTERN.test(token) ? devices.findByTokenHash(hashToken(token)) : null;
		if (byToken) {
			await devices.seenFrom(byToken.id, address);
			return devices.touch(byToken.id);
		}
		const trusted = devices.findByTrustedIp(address);
		return trusted ? devices.touch(trusted.id) : null;
	}

	return { load, regenerateCode, ensureCode, pair, authenticate };
}

module.exports = { createPairing, generateCode, normalizeCode, hashToken, CODE_ALPHABET };
