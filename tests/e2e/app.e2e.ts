import { expect, test, type Page } from '@playwright/test';

/**
 * T12 — mobile and keyboard flows, plus a console-error sweep.
 * Runs against the production build served by server/index.js.
 */

const APP_PAGES = ['/app', '/app/leads', '/app/pipeline', '/app/tasks', '/app/reports', '/app/data', '/app/team', '/app/settings', '/app/audit'];
const PUBLIC_PAGES = ['/', '/pricing', '/privacy', '/terms'];

async function overflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

test.describe('console hygiene', () => {
  test('no console errors or page exceptions across every route', async ({ page }) => {
    const problems: string[] = [];
    page.on('console', (msg) => { if (msg.type() === 'error') problems.push(`console: ${msg.text()}`); });
    page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));

    for (const route of [...PUBLIC_PAGES, '/login', ...APP_PAGES]) {
      await page.goto(route);
      await page.waitForLoadState('load');
      await expect(page.locator('#root')).not.toBeEmpty();
    }

    expect(problems, problems.join('\n')).toEqual([]);
  });
});

test.describe('responsive layout', () => {
  for (const viewport of [
    { name: 'mobile 375px', width: 375, height: 812 },
    { name: 'tablet 768px', width: 768, height: 1024 },
    { name: 'desktop 1280px', width: 1280, height: 900 },
  ]) {
    test(`${viewport.name}: no horizontal page overflow and no clipped content`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

      for (const route of ['/app', '/app/leads', '/app/pipeline', '/app/tasks', '/app/reports']) {
        await page.goto(route);
        await expect(page.locator('main, .main').first()).toBeVisible();
        // Tables and the kanban scroll inside their own containers, never the page.
        expect(await overflow(page), `${route} overflows at ${viewport.width}px`).toBeLessThanOrEqual(1);
      }
    });
  }

  test('mobile navigation collapses into a toggle that opens the sidebar', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/app');

    const toggle = page.getByRole('button', { name: 'Toggle navigation' });
    const sidebar = page.locator('aside.sidebar');
    await expect(toggle).toBeVisible();
    await expect(sidebar).not.toHaveClass(/\bopen\b/);

    await toggle.click();
    await expect(sidebar).toHaveClass(/\bopen\b/);
    await expect(page.getByRole('link', { name: 'Pipeline', exact: true })).toBeVisible();

    await page.getByRole('link', { name: 'Pipeline', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/pipeline$/);
    // The drawer closes itself after navigation.
    await expect(sidebar).not.toHaveClass(/\bopen\b/);
  });

  test('desktop shows the sidebar without the mobile toggle', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/app');
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Toggle navigation' })).toBeHidden();
  });

  test('the public capture form is usable at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    // `page.request` reuses this context's session cookie.
    const forms = await page.request.get('/api/v1/capture-forms');
    expect(forms.ok()).toBeTruthy();
    const publicId = (await forms.json())?.data?.form?.public_id as string;
    expect(publicId).toBeTruthy();

    await page.goto(`/form/${publicId}`);
    await expect(page.getByRole('heading').first()).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(1);
  });
});

test.describe('keyboard operation', () => {
  test('keyboard focus is always visible', async ({ page }) => {
    await page.goto('/app');
    await expect(page.locator('main, .main').first()).toBeVisible();

    const seen: string[] = [];
    for (let i = 0; i < 8; i += 1) {
      await page.keyboard.press('Tab');
      const focused = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const style = getComputedStyle(el);
        return {
          tag: el.tagName.toLowerCase(),
          label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40),
          outlineStyle: style.outlineStyle,
          outlineWidth: Number.parseFloat(style.outlineWidth) || 0,
          boxShadow: style.boxShadow,
        };
      });
      if (focused) seen.push(focused.label || focused.tag);
      if (focused) {
        const visible = (focused.outlineStyle !== 'none' && focused.outlineWidth >= 2) || focused.boxShadow !== 'none';
        expect(visible, `focused element "${focused.label || focused.tag}" has no visible focus indicator`).toBe(true);
      }
    }
    expect(seen.length).toBeGreaterThanOrEqual(5);
  });

  test('kanban cards move with the keyboard and persist', async ({ page }) => {
    await page.goto('/app/pipeline');
    const board = page.locator('[aria-label="Pipeline board"]');
    await expect(board).toBeVisible();

    const firstColumn = board.locator('.kanban-col').first();
    const card = firstColumn.locator('.lead-card').first();
    const leadName = (await card.locator('.card-title').first().innerText()).trim();

    const next = card.getByRole('button', { name: /^Move / }).last();
    await expect(next).toBeEnabled();
    await next.focus();
    await page.keyboard.press('Enter');

    await expect(page.getByText('Stage transition saved.')).toBeVisible();
    await expect(board.locator('.kanban-col').nth(1).locator('.lead-card', { hasText: leadName })).toBeVisible();

    // Put the demo data back where it was.
    const moved = board.locator('.kanban-col').nth(1).locator('.lead-card', { hasText: leadName }).first();
    const prev = moved.getByRole('button', { name: /^Move / }).first();
    await prev.focus();
    await page.keyboard.press('Enter');
    await expect(board.locator('.kanban-col').first().locator('.lead-card', { hasText: leadName })).toBeVisible();
  });

  test('a rejected transition leaves the card in its column', async ({ page }) => {
    await page.goto('/app/pipeline');
    const board = page.locator('[aria-label="Pipeline board"]');
    await expect(board).toBeVisible();

    await page.route('**/api/v1/leads/*/transition', (route) =>
      route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'INVALID_TRANSITION', message: 'That stage change is not allowed.' } }),
      }));

    const firstColumn = board.locator('.kanban-col').first();
    const card = firstColumn.locator('.lead-card').first();
    const leadName = (await card.locator('.card-title').first().innerText()).trim();
    await card.getByRole('button', { name: /^Move / }).last().click();

    await expect(page.getByText('That stage change is not allowed.')).toBeVisible();
    await expect(board.locator('.kanban-col').first().locator('.lead-card', { hasText: leadName })).toBeVisible();
  });

  test('the pipeline table alternative is keyboard navigable', async ({ page }) => {
    await page.goto('/app/pipeline');
    await page.getByRole('button', { name: 'Table view' }).click();
    const table = page.locator('table.table');
    await expect(table).toBeVisible();
    const select = table.locator('select').first();
    await select.focus();
    await expect(select).toBeFocused();
    await expect(select).toHaveAttribute('aria-label', /^Stage for /);
  });
});
