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

export default defineConfig({
  plugins: [react(), forceExitPlugin()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      '/webdav': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
