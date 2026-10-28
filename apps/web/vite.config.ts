import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

function forceExitPlugin() {
  return {
    name: 'force-exit',
    closeBundle() {
      // Force exit once bundling is completely written to disk
      // Resolves Node 26.x event-loop hang on lingering FileHandle microtasks
      setTimeout(() => process.exit(0), 100);
    },
  };
}

const apiTarget = process.env.VITE_PROXY_TARGET || 'http://localhost:4000';

export default defineConfig({
  // forceExitPlugin only works around a Node 26 event-loop hang; opt in with VITE_FORCE_EXIT=1
  plugins: [react(), ...(process.env.VITE_FORCE_EXIT ? [forceExitPlugin()] : [])],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
      '/webdav': {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
});
