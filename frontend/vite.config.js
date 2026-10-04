import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.VITE_PROXY_TARGET || 'http://localhost:8000';

  return {
    plugins: [react()],
    base: './',
    server: {
      host: true,
      port: 5173,
      allowedHosts: ['.trycloudflare.com'],
      fs: { allow: ['..'] },
      proxy: {
        '/api': target,
        '/platform': target
      }
    }
  };
});
