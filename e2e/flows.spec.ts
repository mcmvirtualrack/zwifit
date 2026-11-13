import { expect, test } from '@playwright/test';
import { pair, treadmill } from './helpers/pair';

test('an unpaired visitor sees only the pairing screen', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'Pair this device' })).toBeVisible();
	await expect(page.getByRole('navigation')).toHaveCount(0);
	await expect(page.getByText('Speed', { exact: true })).toHaveCount(0);
	await page.goto('/history');
	await expect(page.getByRole('heading', { name: 'Pair this device' })).toBeVisible();
});

test('a treadmill disconnect is shown within 5 s', async ({ page }) => {
	await pair(page);
	await treadmill('disconnect');
	await expect(page.getByText('Treadmill not connected.')).toBeVisible({ timeout: 5000 });
	await expect(page.getByText('Treadmill switched off')).toBeVisible();
	await treadmill('reconnect');
	await expect(page.getByText('Treadmill not connected.')).toHaveCount(0, { timeout: 5000 });
});

test('the dashboard Stop button stops the belt and Start restarts it', async ({ page }) => {
	await pair(page);
	await treadmill('belt', 6);
	const speed = page.locator('.live__speed-value');
	await expect(speed).not.toHaveText('0.0', { timeout: 10000 });
	await page.getByRole('button', { name: 'Stop', exact: true }).click();
	await expect(speed).toHaveText('0.0', { timeout: 10000 });
	await page.getByRole('button', { name: 'Start', exact: true }).click();
	await expect(speed).not.toHaveText('0.0', { timeout: 10000 });
});

test('the page links sit in the header, top right on wider screens, and mark the current page', async ({ page }) => {
	await pair(page);
	const nav = page.getByRole('navigation', { name: 'Main' });
	for (const name of ['Dashboard', 'Workout', 'Plans', 'History', 'Settings']) {
		await expect(nav.getByRole('link', { name: new RegExp(`^${name}`) })).toBeVisible();
	}
	await nav.getByRole('link', { name: 'History' }).click();
	await expect(nav.getByRole('link', { name: 'History' })).toHaveAttribute('aria-current', 'page');
	const box = await nav.boundingBox();
	const width = page.viewportSize()!.width;
	expect(box!.y).toBeLessThan(160);
	if (width > 640) {
		const header = await page.locator('.topbar').boundingBox();
		expect(Math.abs(box!.x + box!.width - (header!.x + header!.width))).toBeLessThan(2);
	}
});

test('after stopping a plan you can go back to it, edit it and delete it from the editor', async ({ page }) => {
	await pair(page);
	await treadmill('belt', 5);
	const name = `Throwaway ${Date.now()}`;
	await page.goto('/plans/new');
	await page.getByLabel('Name').fill(name);
	await page.getByRole('button', { name: 'Save' }).click();
	await expect(page).toHaveURL(/\/plans\/[0-9A-Z]{26}$/);
	await page.getByRole('button', { name: 'Start', exact: true }).click();
	await expect(page).toHaveURL(/\/workout$/);
	page.once('dialog', dialog => dialog.accept());
	await page.getByRole('button', { name: 'Stop' }).click();
	await expect(page.getByText('Stopped by you')).toBeVisible();

	// The finished screen offers the way back instead of greyed-out controls.
	await expect(page.getByRole('button', { name: 'Pause' })).toHaveCount(0);
	await page.getByRole('link', { name: 'Edit this plan' }).click();
	await expect(page.getByRole('heading', { name: 'Edit plan' })).toBeVisible();

	// Leaving with unsaved changes asks first; dismissing stays in the editor.
	await page.getByLabel('Name').fill(`${name} changed`);
	page.once('dialog', dialog => dialog.dismiss());
	await page.getByRole('link', { name: '← Back to plans' }).first().click();
	await expect(page.getByRole('heading', { name: 'Edit plan' })).toBeVisible();

	page.once('dialog', dialog => dialog.accept());
	await page.getByRole('button', { name: 'Delete plan' }).click();
	await expect(page).toHaveURL(/\/plans$/);
	await expect(page.getByText(name)).toHaveCount(0);
});

test('build "Intervals 6×" in the editor, run, pause, resume, stop, then find it in history and download the CSV', async ({ page }) => {
	await pair(page);
	await treadmill('belt', 6);

	// Build the plan (SC-003: well under 3 minutes of scripted steps).
	const started = Date.now();
	await page.goto('/plans/new');
	const name = `Intervals 6x ${Date.now()}`;
	await page.getByLabel('Name').fill(name);
	const warmup = page.locator('.item').first();
	await warmup.getByRole('button', { name: 'Pace' }).click();
	await warmup.getByLabel(/^Pace/).fill('10:00');
	await expect(warmup.getByText('= 6.0 mph')).toBeVisible();
	await page.getByRole('button', { name: '+ Repeat block' }).click();
	const block = page.locator('.item--block');
	await block.getByLabel('Repeat (1–99)').fill('6');
	const blockSteps = block.locator('.block-step');
	await blockSteps.nth(0).getByLabel('Speed (mph)').fill('8');
	await blockSteps.nth(0).getByLabel('Time (h:mm:ss)').fill('2:00');
	await blockSteps.nth(1).getByLabel('Speed (mph)').fill('5');
	await blockSteps.nth(1).getByLabel('Time (h:mm:ss)').fill('1:00');
	await page.getByRole('button', { name: '+ Step', exact: true }).click();
	await expect(page.locator('.items > .item')).toHaveCount(3);
	const cooldown = page.locator('.items > .item').nth(2);
	await cooldown.getByLabel('Label').fill('Cool-down');
	await cooldown.getByLabel('Speed (mph)').fill('4');
	await cooldown.getByLabel('Incline (%)').fill('0');
	await cooldown.getByRole('button', { name: 'Distance' }).click();
	await cooldown.getByLabel('Distance (mi)').fill('0.5');
	await expect(page.locator('.editor__totals')).toContainText('30:30');
	await expect(page.locator('.editor__totals')).toContainText('3.10');
	await page.getByRole('button', { name: 'Save' }).click();
	await expect(page.getByText('Plan saved.').first()).toBeVisible();
	expect(Date.now() - started).toBeLessThan(180_000);

	// Run it.
	await page.getByRole('button', { name: 'Start', exact: true }).click();
	await expect(page).toHaveURL(/\/workout$/);
	await expect(page.getByText('Running')).toBeVisible();
	await page.getByRole('button', { name: 'Pause' }).click();
	await expect(page.getByText('Paused', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Resume' }).click();
	await expect(page.getByText('Running')).toBeVisible();
	// A few seconds of samples for the History charts.
	await page.waitForTimeout(3500);
	page.once('dialog', dialog => dialog.accept());
	await page.getByRole('button', { name: 'Stop' }).click();
	await expect(page.getByText('Stopped by you')).toBeVisible();

	// History and CSV.
	await page.getByRole('link', { name: 'History', exact: true }).first().click();
	await page.getByRole('link', { name: new RegExp(name) }).first().click();
	await expect(page.getByRole('heading', { name })).toBeVisible();
	const download = page.waitForEvent('download');
	await page.getByRole('link', { name: 'Export CSV' }).click();
	expect((await download).suggestedFilename()).toMatch(/^zwifit-\d{4}-\d{2}-\d{2}-Intervals-6x-\d+\.csv$/);
	const fit = page.waitForEvent('download');
	await page.getByRole('link', { name: 'Export FIT' }).click();
	expect((await fit).suggestedFilename()).toMatch(/\.fit$/);

	// Charts: arrow keys move the readout across pace and heart rate.
	const charts = page.getByRole('group', { name: 'Charts' });
	await expect(charts).toBeVisible();
	await charts.focus();
	await page.keyboard.press('End');
	await expect(page.locator('.wchart__tip')).toContainText('Heart rate');
	await page.getByRole('button', { name: 'Distance' }).click();
	await expect(page.locator('.wchart__axis')).toContainText('mi');
});
