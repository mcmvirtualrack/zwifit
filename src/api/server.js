// Control server: Express 5 for pages and pairing, Socket.IO 4 for live data and commands.
// Only paired devices on the page's own origin get a socket (contracts/api.md).
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const express = require('express');
const { Server } = require('socket.io');
const contracts = require('../contracts');
const guards = require('../security/httpGuards');
const log = require('../lib/log');
const { AppError } = require('../lib/errors');
const { createPairingRouter, createRequirePaired, readCookie } = require('./http/pairing');

// Bodies are 256 KB, except plan imports (1 MB).
const BODY_LIMITS = { '/api/plans/import': '1mb' };

const MAX_COMMANDS_PER_SECOND = 20;
const MAX_EVENT_NAME_LOGGED = 40;

function createServer({
	pairing,
	devices,
	tls = null,
	staticDir = path.join(__dirname, 'web-dist'),
	routes = () => {}
}) {
	// tls without a port: the main port is HTTPS. tls.port: HTTPS on that port as well, the main
	// port staying plain HTTP (for browsers that insist on HTTPS, e.g. a managed Edge).
	const securePort = tls && tls.port ? tls.port : null;
	const secure = !!tls && !securePort;
	const app = express();
	app.disable('x-powered-by');
	app.set('trust proxy', false);

	const httpsOf = () => https.createServer({ cert: fs.readFileSync(tls.certPath), key: fs.readFileSync(tls.keyPath) }, app);
	const httpServer = secure ? httpsOf() : http.createServer(app);
	const httpsServer = securePort ? httpsOf() : null;

	const io = new Server(httpServer, {
		serveClient: false,
		maxHttpBufferSize: 256 * 1024,
		// Refuse rebinding host names before any transport is opened (Origin is checked on connect).
		allowRequest: (req, callback) => callback(null, guards.isAllowedHost(req.headers.host)),
		// Only the page itself may open a socket; no cross-origin access.
		cors: { origin: false }
	});
	if (httpsServer) {
		io.attach(httpsServer);
	}

	const handlers = new Map();
	const connectionListeners = [];
	const revokeDevice = deviceId => io.in(`device:${deviceId}`).disconnectSockets(true);

	app.use(guards.securityHeaders);
	app.use(guards.hostCheck);
	app.use(guards.originCheck);
	const parsers = { default: guards.jsonBody() };
	for (const [route, limit] of Object.entries(BODY_LIMITS)) {
		parsers[route] = guards.jsonBody(limit);
	}
	app.use('/api', (req, res, next) => (parsers[req.originalUrl.split('?')[0]] || parsers.default)(req, res, next));
	app.use(createPairingRouter({ pairing, devices, onDeviceRevoked: revokeDevice }));
	// Feature routes (plans, workouts). requirePaired guards each one.
	const router = express.Router();
	routes(router, { requirePaired: createRequirePaired(pairing), validateId: guards.validateId });
	app.use(router);
	app.use('/api', (req, res, next) => next(new AppError('NOT_FOUND', 'No such endpoint.')));
	app.use(express.static(staticDir, { index: 'index.html', dotfiles: 'ignore' }));
	// Client-side routes (/plans, /history, ...) get the app shell.
	app.get(/^\/(?!api\/|socket\.io\/)[^.]*$/, (req, res, next) => {
		res.sendFile(path.join(staticDir, 'index.html'), err => err && next());
	});
	app.use(guards.errorHandler);

	// Handshake: same origin, then a valid device cookie.
	io.use(async (socket, next) => {
		const headers = socket.handshake.headers;
		if (!guards.isAllowedHost(headers.host) || !guards.isSameOrigin(headers, socket.handshake.secure)) {
			log.warn('Live connection refused: not from the Zwifit page', { host: headers.host, origin: headers.origin || null, secure: socket.handshake.secure });
			next(new Error('BAD_ORIGIN'));
			return;
		}
		const device = await pairing.authenticate(readCookie(headers.cookie), socket.handshake.address);
		if (!device) {
			log.warn('Live connection refused: device not paired', { host: headers.host, cookieSent: !!readCookie(headers.cookie) });
			next(new Error('NOT_PAIRED'));
			return;
		}
		socket.data.deviceId = device.id;
		socket.data.token = readCookie(headers.cookie);
		socket.join(`device:${device.id}`);
		next();
	});

	io.on('connection', socket => {
		let windowStart = 0;
		let count = 0;

		// Drop events nobody registered, logging only the (truncated) name.
		socket.use(([event], next) => {
			if (handlers.has(event)) {
				next();
				return;
			}
			log.warn('Dropped unknown socket event', { event: String(event).slice(0, MAX_EVENT_NAME_LOGGED) });
		});

		for (const [event, { schema, handler }] of handlers) {
			socket.on(event, async (...args) => {
				const ack = typeof args[args.length - 1] === 'function' ? args.pop() : () => {};
				const payload = args[0];
				const now = Date.now();
				if (now - windowStart >= 1000) {
					windowStart = now;
					count = 0;
				}
				if (++count > MAX_COMMANDS_PER_SECOND) {
					ack({ ok: false, error: 'RATE_LIMITED', message: 'Too many commands. Slow down.' });
					return;
				}
				try {
					// Each command re-checks the pairing (and renews it), so revocation and expiry apply immediately.
					const device = await pairing.authenticate(socket.data.token, socket.handshake.address);
					if (!device) {
						ack({ ok: false, error: 'NOT_PAIRED', message: 'This device is not paired.' });
						socket.disconnect(true);
						return;
					}
					if (schema) {
						const errors = contracts.validate(schema, payload);
						if (errors.length) {
							throw new AppError('INVALID', 'That request is not valid.', errors);
						}
					}
					else if (payload !== undefined && payload !== null && !(typeof payload === 'object' && Object.keys(payload).length === 0)) {
						throw new AppError('INVALID', 'This command takes no data.');
					}
					const data = await handler({ payload, device, socket });
					ack(data === undefined ? { ok: true } : { ok: true, data });
				}
				catch (err) {
					const safe = log.safeError(err);
					if (safe.code === 'INTERNAL') {
						log.error(`Socket handler ${event} failed`, { message: err.message });
					}
					const reply = { ok: false, error: safe.code, message: safe.message };
					if (safe.details !== undefined) {
						reply.details = safe.details;
					}
					ack(reply);
				}
			});
		}

		for (const listener of connectionListeners) {
			listener(socket);
		}
	});

	// Called with each newly connected (paired) socket, e.g. to send it the current state.
	function onConnection(listener) {
		connectionListeners.push(listener);
	}

	// Registers a client → server command. schema: a name in src/contracts/schemas, or null for none.
	function handle(event, schema, handler) {
		handlers.set(event, { schema, handler });
	}

	function listenOn(srv, port, host) {
		return new Promise((resolve, reject) => {
			srv.once('error', err => {
				if (err.code === 'EADDRINUSE') {
					reject(new AppError('PORT_IN_USE', `Port ${port} is already in use. Is Zwifit already running? Stop it (Ctrl+C) or change server.port.`));
				}
				else if (err.code === 'EACCES') {
					reject(new AppError('PORT_DENIED', `Not allowed to listen on port ${port}. Use a port above 1024.`));
				}
				else {
					reject(err);
				}
			});
			srv.listen(port, host, () => {
				srv.removeAllListeners('error');
				resolve(srv.address());
			});
		});
	}

	// Resolves with the main port's address; the extra HTTPS port (if any) is open by then too.
	async function listen(port, host) {
		const address = await listenOn(httpServer, port, host);
		if (httpsServer) {
			try {
				await listenOn(httpsServer, securePort, host);
			}
			catch (err) {
				httpServer.close();
				throw err;
			}
		}
		return address;
	}

	async function close() {
		io.disconnectSockets(true);
		// io.close() closes the server attached last (the HTTPS one); the main one is closed here.
		await new Promise(resolve => io.close(() => resolve()));
		if (httpsServer && httpServer.listening) {
			await new Promise(resolve => httpServer.close(() => resolve()));
		}
	}

	return { app, io, httpServer, httpsServer, secure, securePort, handle, onConnection, listen, close, revokeDevice };
}

module.exports = { createServer, MAX_COMMANDS_PER_SECOND };
