import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './src/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['html'],
    ['json', { outputFile: 'test-results/e2e-results.json' }],
    ['junit', { outputFile: 'test-results/e2e-junit.xml' }],
  ],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  // Serve the production build via `vite preview`, not the dev server. The Vite
  // root is `public/`, whose index.html loads the entry as `../src/index.tsx`
  // (outside the dev-server root → 404, React never mounts). The build bundles
  // that entry correctly, so previewing dist-client serves the real, working app
  // and starts deterministically (no dep pre-bundle). This also fixes the prior
  // failure where Playwright waited on 5173 while Vite serves 3000.
  webServer: {
    command: 'npm run build:client && npx vite preview --port 3000 --strictPort',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
})
