import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// 5174 is the dashboard's origin in the backend's CORS allowlist; strictPort keeps Vite from
// silently moving to another port (4173 is the game's preview port).
const port = 5174;

export default defineConfig({
  plugins: [react()],
  server: { port, strictPort: true },
  preview: { port, strictPort: true },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts']
  }
});
