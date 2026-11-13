import { defineConfig, devices } from '@playwright/test';

// Browsers × viewports (phone 360, tablet 768, desktop 1280) × light/dark (spec SC-009).
const viewports = [
	{ name: 'phone', viewport: { width: 360, height: 740 } },
	{ name: 'tablet', viewport: { width: 768, height: 1024 } },
	{ name: 'desktop', viewport: { width: 1280, height: 800 } }
];
const browsers = [
	{ name: 'chromium', use: devices['Desktop Chrome'] },
	{ name: 'firefox', use: devices['Desktop Firefox'] },
	{ name: 'webkit', use: devices['Desktop Safari'] }
];
const only = process.env.E2E_BROWSERS ? process.env.E2E_BROWSERS.split(',') : browsers.map(b => b.name);

export default defineConfig({
	testDir: './e2e',
	timeout: 60_000,
	fullyParallel: false,
	workers: 1,
	reporter: [['list']],
	use: { baseURL: 'http://127.0.0.1:1348', trace: 'retain-on-failure' },
	projects: browsers.filter(b => only.includes(b.name)).flatMap(browser => viewports.flatMap(size => (['light', 'dark'] as const).map(colorScheme => ({
		name: `${browser.name}-${size.name}-${colorScheme}`,
		use: { ...browser.use, viewport: size.viewport, colorScheme }
	})))),
	webServer: {
		command: 'node e2e/helpers/start-sim.js',
		url: 'http://127.0.0.1:1348/api/session',
		reuseExistingServer: false,
		timeout: 30_000,
		stdout: 'ignore'
	}
});
