import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  // The project may live under a junction / symlinked folder on Windows.
  // Keeping the original path avoids realpath lookups that fail inside the sandbox.
  resolve: {
    preserveSymlinks: true,
  },
  server: {
    host: '127.0.0.1',
    port: 24118,
    strictPort: true,
    fs: {
      strict: false,
    },
  },
  build: {
    target: 'es2020',
    sourcemap: false,
  },
});
