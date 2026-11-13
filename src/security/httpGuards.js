// Express middleware for the rules in contracts/api.md "Common rules": security headers, Origin
// check, body limits, id validation and error responses that never leak internals.
const net = require('net');
const os = require('os');
const express = require('express');
const ids = require('../lib/ids');
const log = require('../lib/log');

const CSP = "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; frame-ancestors 'none'";
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// HTTP status for each error code a handler may throw as an AppError.
const STATUS = {
	NOT_PAIRED: 401,
	BAD_CODE: 401,
	BAD_ORIGIN: 403,
	FORBIDDEN: 403,
	NOT_FOUND: 404,
	LOCKED_OUT: 429,
	PAIRING_SUSPENDED: 429,
	TOO_LARGE: 413,
	BAD_JSON: 400,
	BAD_ID: 400,
	INVALID: 422,
	INVALID_PLAN: 422,
	NAME_TAKEN: 409,
	ADDRESS_TAKEN: 409,
	PLAN_RUNNING: 409,
	INTERNAL: 500
};

function securityHeaders(req, res, next) {
	res.removeHeader('X-Powered-By');
	res.set('Content-Security-Policy', CSP);
	res.set('X-Content-Type-Options', 'nosniff');
	res.set('Referrer-Policy', 'no-referrer');
	if (req.path === '/api' || req.path.startsWith('/api/')) {
		res.set('Cache-Control', 'no-store');
	}
	next();
}

function originOf(value) {
	try {
		return new URL(value).origin;
	}
	catch {
		return null;
	}
}

// True when the Origin (or, failing that, the Referer) is this server's own scheme+host+port.
function isSameOrigin(headers, secure) {
	const claimed = headers.origin ? headers.origin : headers.referer ? originOf(headers.referer) : null;
	if (!claimed || !headers.host) {
		return false;
	}
	return claimed === `${secure ? 'https' : 'http'}://${headers.host}`;
}

// DNS-rebinding guard: a hostile site can point its own name at this PC, making it "same origin".
// Only IP addresses, localhost, this computer's name (optionally .local/.lan/.home) and names listed
// in ZWIFIT_ALLOWED_HOSTS (comma separated) are accepted in the Host header.
function createHostCheck({ hostname = os.hostname(), extra = process.env.ZWIFIT_ALLOWED_HOSTS || '' } = {}) {
	const names = new Set(['localhost', hostname.toLowerCase()]);
	for (const suffix of ['.local', '.lan', '.home']) {
		names.add(`${hostname.toLowerCase()}${suffix}`);
	}
	for (const name of extra.split(',').map(n => n.trim().toLowerCase()).filter(Boolean)) {
		names.add(name);
	}
	return function isAllowedHost(hostHeader) {
		if (typeof hostHeader !== 'string' || !hostHeader) {
			return false;
		}
		const host = hostHeader.startsWith('[') ? hostHeader.slice(1, hostHeader.indexOf(']')) : hostHeader.replace(/:\d+$/, '');
		return net.isIP(host) !== 0 || names.has(host.toLowerCase());
	};
}

const isAllowedHost = createHostCheck();

function hostCheck(req, res, next) {
	if (isAllowedHost(req.headers.host)) {
		next();
		return;
	}
	sendError(res, 403, 'BAD_HOST', 'Open Zwifit by its IP address or this computer\'s name.');
}

function sendError(res, status, error, message, extra) {
	res.status(status).json({ error, message, ...extra });
}

function originCheck(req, res, next) {
	if (SAFE_METHODS.has(req.method) || isSameOrigin(req.headers, req.secure)) {
		next();
		return;
	}
	sendError(res, 403, 'BAD_ORIGIN', 'This request did not come from the Zwifit page.');
}

function jsonBody(limit = '256kb') {
	return express.json({ limit, strict: true });
}

function validateId(req, res, next) {
	if (ids.isId(req.params.id)) {
		next();
		return;
	}
	sendError(res, 400, 'BAD_ID', 'That id is not valid.');
}

// Last middleware. Body-parser errors, AppErrors and everything else, without internals.
// Express recognises error handlers by their four parameters, so `next` stays.
function errorHandler(err, req, res, next) {
	if (err.type === 'entity.too.large') {
		sendError(res, 413, 'TOO_LARGE', 'The request body is too large.');
		return;
	}
	if (err.type === 'entity.parse.failed') {
		sendError(res, 400, 'BAD_JSON', 'The request body is not valid JSON.');
		return;
	}
	const safe = log.safeError(err);
	if (safe.code === 'INTERNAL') {
		log.error(`Unhandled error on ${req.method} ${req.path}`, { message: err.message });
	}
	const extra = {};
	if (safe.details !== undefined) {
		extra.details = safe.details;
		if (safe.details && safe.details.retryAfterSeconds !== undefined) {
			res.set('Retry-After', String(safe.details.retryAfterSeconds));
		}
	}
	sendError(res, STATUS[safe.code] || 422, safe.code, safe.message, extra);
}

module.exports = { CSP, securityHeaders, isSameOrigin, originCheck, hostCheck, isAllowedHost, createHostCheck, jsonBody, validateId, errorHandler, STATUS };
