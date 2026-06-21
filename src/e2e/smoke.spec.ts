import { test, expect } from '@playwright/test';

// Minimal boot smoke test. The E2E suite was previously empty (src/e2e did not
// exist), so the Playwright job had nothing to run once the server started.
// This asserts the web app loads and mounts React into #root, independent of
// whichever first-load surface (setup wizard / upload) renders.
test('app boots and renders into #root', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/SAssi Cal/);
  // Vite dev cold-compiles the module graph on first request, so React can take
  // several seconds to mount on a fresh CI server — allow generous time.
  await expect(page.locator('#root')).not.toBeEmpty({ timeout: 30_000 });
});
