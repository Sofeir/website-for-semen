import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const here = import.meta.dirname;
const demoDir = path.resolve(here, 'src/demo');
const serverSrc = path.resolve(here, '../server/src');

/**
 * Демо-сборка (`vite build --mode demo`): серверный код целиком запускается в браузере.
 * Модули, которым нужны Node, файловая система или реальная база, подменяются файлами из src/demo.
 */
const SWAPS: Record<string, string> = {
  config: 'config.ts',
  'auth/session': 'session.ts',
  'notify/hub': 'hub.ts',
  'db/migrate': 'migrate.ts',
  'documents/render': 'render.ts',
  'routes/files': 'stubs.ts',
  'routes/import': 'stubs.ts',
};

function demoSwap(): Plugin {
  return {
    name: 'demo-swap',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!importer || !source.startsWith('.')) return null;
      const abs = path.resolve(path.dirname(importer), source).replace(/\\/g, '/').replace(/\.ts$/, '');
      const root = serverSrc.replace(/\\/g, '/') + '/';
      if (!abs.startsWith(root)) return null;
      const target = SWAPS[abs.slice(root.length)];
      if (!target) return null;
      const file = path.join(demoDir, target);
      // stubs.ts экспортирует оба роутера; остальные файлы подменяются один в один
      return this.resolve(file, importer, { ...options, skipSelf: true });
    },
  };
}

export default defineConfig(({ mode }) => {
  const demo = mode === 'demo';
  return {
    base: demo ? '/website-for-semen/' : '/',
    plugins: [...(demo ? [demoSwap()] : []), react()],
    define: demo ? { 'import.meta.env.VITE_DEMO': JSON.stringify('1') } : {},
    resolve: {
      alias: {
        '@': path.resolve(here, 'src'),
        ...(demo
          ? {
              express: path.join(demoDir, 'express-shim.ts'),
              pg: path.join(demoDir, 'pg-shim.ts'),
              'node:path': path.join(demoDir, 'node-shims.ts'),
              'node:url': path.join(demoDir, 'node-shims.ts'),
            }
          : {}),
      },
    },
    server: {
      port: 5179,
      strictPort: true,
      proxy: {
        '/api': {
          target: 'http://localhost:8431',
          changeOrigin: false,
        },
      },
    },
    preview: { port: 5179 },
    build: {
      target: 'es2022',
      sourcemap: false,
      chunkSizeWarningLimit: 600,
      ...(demo ? { outDir: 'dist-demo' } : {}),
    },
    ...(demo ? { worker: { format: 'es' as const } } : {}),
  };
});
