import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [preact()],
  base: '/Motion/',
  publicDir: 'public',
  server: {
    port: 5500,
    strictPort: true,
    host: true,
  },
  preview: {
    port: 5500,
  },
  build: {
    outDir: 'dist',
  },
});
