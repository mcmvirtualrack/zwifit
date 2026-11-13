import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { pair, treadmill } from './helpers/pair';

const SCREENS = ['/', '/plans', '/plans/new', '/programs', '/workout', '/history', '/settings'];

test.beforeEach(async ({ page }) => {
	await pair(page);
	await treadmill('belt', 8);
});

for (const screen of SCREENS) {
	test(`${screen} fits the width, has 48 px controls and no serious accessibility issues`, async ({ page }) => {
		await page.goto(screen);
		await page.waitForTimeout(800);

		const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
		expect(overflow).toBeLessThanOrEqual(0);

		const small = await page.locator('button.btn:visible, a.btn:visible').evaluateAll(elements => elements
			.map(el => ({ text: (el.textContent || el.getAttribute('aria-label') || '').trim(), box: el.getBoundingClientRect() }))
			.filter(({ box }) => box.width < 47.5 || box.height < 47.5)
			.map(({ text, box }) => `${text} ${Math.round(box.width)}×${Math.round(box.height)}`));
		expect(small).toEqual([]);

		const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
		const serious = results.violations.filter(v => v.impact === 'serious' || v.impact === 'critical');
		expect(serious.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).slice(0, 3).join(', ')}`)).toEqual([]);
	});
}
