import { defineConfig, configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    // Playwright E2E specs live in src/e2e and match the include glob below
    // (*.spec.ts); they use the Playwright runner, not vitest, so exclude them.
    exclude: [...configDefaults.exclude, 'src/e2e/**'],
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
    include: ['src/**/*.{test,spec}.{js,ts,jsx,tsx}'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
