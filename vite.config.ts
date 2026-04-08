import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  root: 'src',
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@models': resolve(__dirname, 'electron/models')
    }
  },
  build: {
    outDir: '../dist/renderer',
    emptyOutDir: true,
    target: 'chrome120'
  },
  server: {
    port: 8101,
    strictPort: true,
    fs: {
      // Allow serving files from one level up (for `@models` alias into electron/models).
      allow: ['..']
    }
  }
});
