// Builds the web UI (src/api/web-src) into src/api/web-dist on any OS.
// The output folder is set in angular.json; web-dist is committed so a Raspberry Pi never builds it.
const { spawnSync } = require('node:child_process');
const path = require('path');

const webSrc = path.join(__dirname, '..', 'src', 'api', 'web-src');
const ngCli = path.join(webSrc, 'node_modules', '@angular', 'cli', 'bin', 'ng.js');

const result = spawnSync(process.execPath, [ngCli, 'build', '--configuration', 'production'], { cwd: webSrc, stdio: 'inherit' });
if (result.error) {
	console.error(`Could not run the Angular build: ${result.error.message}. Run "npm ci --prefix src/api/web-src" first.`);
}
process.exitCode = result.status ?? 1;
