import { defineConfig } from 'vite';

export default defineConfig({
  root: 'apps/web',
  publicDir: '../../.bigssh/web-assets',
  build: { outDir: '../../dist/web', emptyOutDir: true },
  server: { headers: { 'X-Content-Type-Options': 'nosniff' } },
});
