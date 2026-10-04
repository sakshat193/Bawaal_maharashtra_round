import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.VITE_PROXY_TARGET || 'http://localhost:8000';

  return {
    plugins: [react()],
    base: './',
    // Only imported inside the PoW Worker, which Vite's dep scan doesn't follow; avoids a mid-session reload.
    optimizeDeps: { include: ['hash-wasm'] },
    server: {
      host: true,
      port: 5173,
      allowedHosts: ['.trycloudflare.com'],
      fs: { allow: ['..'] },
      proxy: {
        // changeOrigin so VITE_PROXY_TARGET can be a remote https host (Render)
        '/api': { target, changeOrigin: true },
        '/platform': { target, changeOrigin: true }
      }
    }
  };
});
