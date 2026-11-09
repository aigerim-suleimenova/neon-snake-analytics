import { readFileSync } from 'node:fs';

import { defineConfig, type Plugin } from 'vite';

/**
 * GameInterface.init() runs each file as a classic script, so the game ships as one IIFE bundle
 * (game.js + game.css) next to index.html. In development the same two URLs are served by a shim,
 * so `pnpm dev` also loads the game through init() while keeping Vite's module graph and hot reload.
 */
const famobiEntry = (): Plugin => ({
  name: 'famobi-entry',
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      const path = request.url?.split('?')[0];
      if (path === '/game.js') {
        response.setHeader('Content-Type', 'text/javascript');
        // init() runs this from a blob URL, which cannot resolve relative imports, hence the absolute URL.
        response.end("import(new URL('/src/main.ts', location.href).href);");
        return;
      }
      if (path === '/game.css') {
        // Vite injects the styles imported by main.ts itself.
        response.setHeader('Content-Type', 'text/css');
        response.end('');
        return;
      }
      next();
    });
  },
  generateBundle() {
    // Library mode does not emit index.html, so it is copied next to the bundle.
    this.emitFile({ type: 'asset', fileName: 'index.html', source: readFileSync('index.html', 'utf8') });
  }
});

export default defineConfig(({ command }) => ({
  base: './',
  plugins: [famobiEntry()],
  // Library mode leaves process.env.NODE_ENV in dependencies untouched.
  define: command === 'build' ? { 'process.env.NODE_ENV': JSON.stringify('production') } : {},
  build: {
    lib: {
      entry: 'src/main.ts',
      name: 'NeonSnake',
      formats: ['iife'],
      fileName: () => 'game.js',
      cssFileName: 'game'
    }
  }
}));
