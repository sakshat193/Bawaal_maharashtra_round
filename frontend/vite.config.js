import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    proxy: {
      '/api': { target: process.env.VITE_PROXY_TARGET || 'http://localhost:8000', changeOrigin: true },
      '/platform': { target: process.env.VITE_PROXY_TARGET || 'http://localhost:8000', changeOrigin: true },
      '/demo-payment': {
        target: 'http://127.0.0.1:8001',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/demo-payment/, '')
      }
    }
  }
});
