import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';
import { apiRoutes } from './server/api.mjs';

export default defineConfig(() => {
  const appPlugin = {
    name: 'app-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url && req.url.startsWith('/api/')) {
          const handled = apiRoutes(req, res);
          if (!handled) {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ error: 'Not found' }));
          }
          return;
        }
        next();
      });
    },
  };

  return {
    plugins: [react(), tailwindcss(), appPlugin],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'index.html'),
          calibrate: path.resolve(__dirname, 'calibrate.html'),
          players: path.resolve(__dirname, 'players.html'),
        },
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
