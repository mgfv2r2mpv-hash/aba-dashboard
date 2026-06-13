import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nm = (pkg: string) => path.resolve(__dirname, 'node_modules', pkg);

// The shared ../src files live outside webportal/, so their bare package
// imports (react, xlsx, …) can't walk up to find webportal/node_modules via
// normal Node resolution.  Force every bare import to the local copy.
const pkgAliases = ['react', 'react/jsx-runtime', 'react-dom', 'date-fns', 'uuid', 'xlsx'].reduce(
  (acc, pkg) => ({ ...acc, [pkg]: nm(pkg) }),
  {} as Record<string, string>,
);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../src'),
      ...pkgAliases,
    },
    dedupe: ['react', 'react-dom'],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
