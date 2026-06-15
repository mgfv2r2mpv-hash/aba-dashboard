import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nm = (pkg: string) => path.resolve(__dirname, 'node_modules', pkg);

// The shared ../src files live outside webportal/, so bare package imports
// (react, xlsx, …) can't walk up to webportal/node_modules via normal Node
// resolution.  Alias every shared package to the local copy.
const pkgAliases = [
  'react', 'react/jsx-runtime', 'react-dom', 'date-fns', 'uuid', 'xlsx',
].reduce((acc, pkg) => ({ ...acc, [pkg]: nm(pkg) }), {} as Record<string, string>);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Shared source from the parent project
      '@shared': path.resolve(__dirname, '../src'),
      // Capacitor stub — useMediaQuery.ts uses registerPlugin('Device')
      '@capacitor/core': path.resolve(__dirname, 'src/stubs/capacitorCore.ts'),
      // Anthropic SDK stub — ComplianceDashboard → FixItPanel → claudeScheduler
      // pulls in the SDK import; we stub it since the portal is read-only
      '@anthropic-ai/sdk': path.resolve(__dirname, 'src/stubs/anthropicSdk.ts'),
      // Force all bare package imports (including those from ../src) to webportal's copy
      ...pkgAliases,
    },
    dedupe: ['react', 'react-dom'],
  },
  worker: {
    format: 'es',
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 800,
  },
});
