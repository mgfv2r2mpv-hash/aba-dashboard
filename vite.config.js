import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: path.resolve(__dirname, 'public'),
  publicDir: path.resolve(__dirname, 'public-assets'),
  plugins: [react()],
  define: {
    // Baked at build time so the device can display which bundle it has,
    // to catch stale ios/App/App/public/ copies that didn't get cap-copied.
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'dist-client'),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Anthropic SDK loads lazily (only when AI is used), so keep it
          // out of the main bundle entirely.
          if (id.includes('@anthropic-ai')) return 'vendor-anthropic';
          // date-fns is only needed by the Calendar view.
          if (id.includes('date-fns')) return 'vendor-date-fns';
          // React runtime is always needed — bundle it separately so the
          // browser caches it independently of app code.
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) return 'vendor-react';
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
