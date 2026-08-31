import { defineConfig, configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

// Three suites, one runner. The app suite has always been here. The portal suite is
// new, and it needs its own aliases because webportal/src reaches the shared code
// through '@shared' and stubs Capacitor out (there is no native layer on the web).
// The portal-functions suite is server code and shares neither.
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
            // The portal bundles ITS copy of the SDK (webportal/vite.config.ts does
            // the same), so the suite exercises the version the portal ships rather
            // than the app's newer one.
            '@anthropic-ai/sdk': path.resolve(__dirname, './webportal/node_modules/@anthropic-ai/sdk'),
          },
        },
        test: {
          ...shared,
          name: 'portal',
          setupFiles: './webportal/src/test/setup.ts',
          include: ['webportal/src/**/*.{test,spec}.{js,ts,jsx,tsx}'],
        },
      },
      {
        // The Pages Functions are server code, so their tests run in the node
        // environment rather than jsdom, and load none of the browser setup above.
        //
        // That is not cosmetic. vitest maps jsdom to vite's CLIENT environment, where
        // noExternal is on and a Node builtin cannot be bundled at all. Under it,
        // userStore.sqlite.test.ts died on the specifier - 'Cannot bundle Node.js
        // built-in node:sqlite' - before its own try/catch and describe.skipIf could
        // run, so the skip its author wrote for Node 20 never fired. Under node the
        // import stays external: it skips on Node 20, which CI pins, and runs against
        // real SQLite on Node 22 and up.
        //
        // These files live in webportal/functions-tests, deliberately NOT under
        // webportal/functions, and two build stages enforce that. The Pages Functions
        // bundler compiles every file it finds in the functions directory into the
        // deployed Worker, so this file's top-level await took a whole deploy down.
        // Before that, `tsc --noEmit` fails on the vitest import, because Cloudflare
        // builds with the root directory set to webportal and no repo-root
        // node_modules exists there. webportal/tsconfig.json spells both out, and
        // webportal/functions-tests/tsconfigSeam.test.ts pins the rule.
        test: {
          globals: true,
          environment: 'node',
          name: 'portal-functions',
          include: ['webportal/functions-tests/**/*.{test,spec}.{js,ts}'],
        },
      },
    ],
  },
})
