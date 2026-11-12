import { expect, test as setup } from '@playwright/test';

const STORAGE = 'test-results/.auth/demo.json';

// Sign in once through the real form, then reuse the session cookie for every
// spec. This also keeps us well under the login rate limit (10/min per IP).
setup('sign in as the demo owner', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('demo@leadpulse.example');
  await page.getByLabel('Password').fill('demo12345');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole('heading', { name: 'Overview', level: 2 }).first()).toBeVisible();
  await page.context().storageState({ path: STORAGE });
});
