import { expect, Page } from '@playwright/test';

export const APP = 'http://127.0.0.1:1348';
const CONTROL = 'http://127.0.0.1:1349';

// Acts as the treadmill through the test launcher (e2e/helpers/start-sim.js).
export async function treadmill(action: 'disconnect' | 'reconnect' | 'belt', kph?: number): Promise<void> {
	const url = action === 'belt' ? `${CONTROL}/belt?kph=${kph ?? 0}` : `${CONTROL}/${action}`;
	const res = await fetch(url, { method: 'POST' });
	expect(res.ok).toBe(true);
}

// The code the server printed at start (written to a file by the launcher).
export async function pairingCode(): Promise<string> {
	const res = await fetch(`${CONTROL}/code`, { method: 'POST' });
	return (await res.text()).trim();
}

export async function pair(page: Page, name = 'E2E device'): Promise<void> {
	await page.goto('/');
	await page.getByLabel('Pairing code').fill(await pairingCode());
	await page.getByLabel('Device name (optional)').fill(name);
	await page.getByRole('button', { name: 'Pair' }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeAttached();
}
