// Zwifit entry point. Options: --simulate (or ZWIFIT_SIMULATE=1) uses the built-in simulated
// treadmill. SHUTDOWN_ONDISCONNECT=1 exits with code 99 when the treadmill disconnects
// (raspberrypi.sh uses this to power the Pi down).
//
// The process started by `npm start` is a small supervisor: it runs Zwifit itself as a child (same
// terminal) and starts it again when it exits with RESTART_CODE, which is what Settings → Restart
// Zwifit does. Any other exit code ends the supervisor with that code. ZWIFIT_NO_SUPERVISOR=1 runs
// Zwifit directly (no restart button). ZWIFIT_NO_HARDWARE=1 (tests) leaves Bluetooth and ANT+ alone.
const { fork } = require('child_process');
const onDeath = require('death');
const { createApp } = require('./src/app');
const { needsSetup, runSetup, terminalAsk } = require('./src/cli/setup');
const log = require('./src/lib/log');
const { AppError } = require('./src/lib/errors');

const RESTART_CODE = 75;
const CHILD_ENV = 'ZWIFIT_SUPERVISED';
const simulate = process.argv.includes('--simulate') || process.env.ZWIFIT_SIMULATE === '1';

function supervise() {
	let child = null;
	const start = () => {
		child = fork(__filename, process.argv.slice(2), { env: { ...process.env, [CHILD_ENV]: '1' }, stdio: 'inherit' });
		child.on('exit', (code, signal) => {
			if (code === RESTART_CODE) {
				log.info('Restarting Zwifit…');
				start();
				return;
			}
			process.exit(code ?? (signal ? 1 : 0));
		});
	};
	// Ctrl+C reaches the child too (same terminal); it stops cleanly and its exit ends this process.
	// A signal sent to this process alone (e.g. by a service manager) is passed on.
	for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
		process.on(signal, () => {
			if (child && child.exitCode === null && signal !== 'SIGINT') {
				child.kill(signal);
			}
		});
	}
	start();
}

async function main() {
	if (!simulate && needsSetup() && process.stdin.isTTY) {
		const terminal = terminalAsk();
		try {
			if (!await runSetup({ ask: terminal.ask })) {
				process.exitCode = 1;
				return;
			}
		}
		finally {
			terminal.close();
		}
	}
	const supervised = process.env[CHILD_ENV] === '1';
	let app;
	// Settings → Restart Zwifit: stop cleanly, then the supervisor starts a fresh process.
	const restart = supervised
		? () => setTimeout(async () => {
			await app.stop();
			process.exit(RESTART_CODE);
		}, 300)
		: null;
	const noHardware = process.env.ZWIFIT_NO_HARDWARE === '1';
	app = await createApp({ simulate, restart, disableBroadcast: noHardware, disableSensors: noHardware });
	if (process.env.SHUTDOWN_ONDISCONNECT === '1') {
		app.treadmill.on('disconnected', async () => {
			log.info('Treadmill disconnected; shutting down (SHUTDOWN_ONDISCONNECT).');
			await app.stop();
			process.exit(99);
		});
	}
	onDeath(async () => {
		await app.stop();
		process.exit(0);
	});
	if (supervised) {
		// The supervisor went away (killed): stop too, rather than run on unseen.
		process.on('disconnect', async () => {
			await app.stop();
			process.exit(0);
		});
	}
	await app.start();
}

if (process.env[CHILD_ENV] !== '1' && process.env.ZWIFIT_NO_SUPERVISOR !== '1') {
	supervise();
}
else {
	main().catch(err => {
		log.error('Zwifit could not start', log.safeError(err));
		if (err.details) {
			log.error('Details', err.details);
		}
		if (!(err instanceof AppError)) {
			// Console only: the cause of an unexpected failure (the logger still masks secrets).
			log.error('Cause', { message: err.message, errno: err.code, stack: err.stack });
		}
		// Exit even though adapters opened before the failure may still hold the event loop.
		process.exit(1);
	});
}
