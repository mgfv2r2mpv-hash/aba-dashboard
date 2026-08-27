import { defineConfig, configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

// Two suites, one runner. The app suite has always been here; the portal suite is
// new, and it needs its own aliases because webportal/src reaches the shared code
// through '@shared' and stubs Capacitor out (there is no native layer on the web).
const shared = {
  globals: true,
  environment: 'jsdom' as const,
  setupFiles: './src/test/setup.ts',
}

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        'src/test/',
        'src/e2e/**',
        '**/*.d.ts',
        '**/index.ts',
      ],
      lines: 80,
      functions: 80,
      branches: 75,
      statements: 80,
    },
    projects: [
      {
        plugins: [react()],
        resolve: {
          alias: {
            '@': path.resolve(__dirname, './src'),
          },
        },
        test: {
          ...shared,
          name: 'app',
          // Playwright E2E specs live in src/e2e and match the include glob below
          // (*.spec.ts); they use the Playwright runner, not vitest, so exclude them.
          exclude: [...configDefaults.exclude, 'src/e2e/**'],
          include: ['src/**/*.{test,spec}.{js,ts,jsx,tsx}'],
        },
      },
      {
        plugins: [react()],
        resolve: {
          alias: {
            '@shared': path.resolve(__dirname, './src'),
            '@capacitor/core': path.resolve(__dirname, './webportal/src/stubs/capacitorCore.ts'),
          },
        },
        test: {
          ...shared,
          name: 'portal',
          setupFiles: './webportal/src/test/setup.ts',
          include: ['webportal/src/**/*.{test,spec}.{js,ts,jsx,tsx}'],
        },
      },
    ],
  },
})
