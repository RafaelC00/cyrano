import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const AGENT = `http://127.0.0.1:${process.env.AGENT_PORT ?? 4200}`;
const PLATFORM = `http://127.0.0.1:${process.env.PLATFORM_PORT ?? 4100}`;

// The backend binds to localhost and sends no CORS headers on purpose, so the browser only ever
// talks to this origin and the dev/preview server forwards /api/agent and /api/platform.
const proxy = {
  '/api/agent': { target: AGENT, changeOrigin: false, rewrite: (p: string) => p.replace(/^\/api\/agent/, '') },
  '/api/platform': { target: PLATFORM, changeOrigin: false, rewrite: (p: string) => p.replace(/^\/api\/platform/, '') },
};

export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5173, proxy },
  preview: { host: '127.0.0.1', port: 5174, proxy },
});
