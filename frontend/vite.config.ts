import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    strictPort: true,
    proxy: {
      '/api': { target: process.env['SONORA_BACKEND_URL'] || 'http://127.0.0.1:8080', changeOrigin: false },
      '/auth': { target: process.env['SONORA_BACKEND_URL'] || 'http://127.0.0.1:8080', changeOrigin: false },
    },
  },
});
