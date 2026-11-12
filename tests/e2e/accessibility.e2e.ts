import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/** T12 — automated accessibility scan (WCAG 2.1 A/AA) on the primary surfaces. */

async function scan(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const summary = results.violations.map((v) => (
    `${v.id} (${v.impact}): ${v.help}\n  ${v.nodes.map((n) => `${n.target.join(' ')} → ${n.failureSummary?.replace(/\n/g, ' ')}`).join('\n  ')}`
  ));
  expect(summary, `${label} accessibility violations:\n${summary.join('\n\n')}`).toEqual([]);
}

test('public pages have no WCAG A/AA violations', async ({ page }) => {
  for (const route of ['/', '/pricing', '/login']) {
    await page.goto(route);
    await expect(page.locator('#root')).not.toBeEmpty();
    await scan(page, route);
  }
});

test('the authenticated app has no WCAG A/AA violations', async ({ page }) => {
  for (const route of ['/app', '/app/leads', '/app/pipeline', '/app/tasks', '/app/reports', '/app/data', '/app/team', '/app/settings']) {
    await page.goto(route);
    await expect(page.locator('main, .main').first()).toBeVisible();
    await scan(page, route);
  }
});

test('the app has no WCAG A/AA violations at 375px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const route of ['/app', '/app/leads', '/app/pipeline']) {
    await page.goto(route);
    await expect(page.locator('main, .main').first()).toBeVisible();
    await scan(page, `${route} @375px`);
  }
});
