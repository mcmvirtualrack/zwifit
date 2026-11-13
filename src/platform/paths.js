// Per-OS data directory (research R7). Everything Zwifit stores lives here, never in the repo.
const fs = require('fs');
const os = require('os');
const path = require('path');

function dataDir({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
	if (env.ZWIFIT_DATA_DIR) {
		return path.resolve(env.ZWIFIT_DATA_DIR);
	}
	if (platform === 'win32') {
		const appData = env.APPDATA || path.win32.join(home, 'AppData', 'Roaming');
		return path.win32.join(appData, 'Zwifit');
	}
	if (platform === 'darwin') {
		return path.posix.join(home, 'Library', 'Application Support', 'Zwifit');
	}
	const xdg = env.XDG_DATA_HOME || path.posix.join(home, '.local', 'share');
	return path.posix.join(xdg, 'zwifit');
}

// Creates dir (and parents) readable only by the current user on POSIX.
function ensureDataDir(dir = dataDir()) {
	fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
	if (process.platform !== 'win32') {
		fs.chmodSync(dir, 0o700);
	}
	return dir;
}

// Where the legacy settings.conf / routes.conf live: the repository root.
function legacyDir() {
	return path.resolve(__dirname, '..', '..');
}

module.exports = { dataDir, ensureDataDir, legacyDir };
