import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// 每次构建给 Service Worker 一个新的缓存名，旧版本的 hash 资源在 activate 时被整体清掉
function stampServiceWorker(): Plugin {
  let outDir = 'dist';
  return {
    name: 'stamp-service-worker',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      const file = resolve(outDir, 'sw.js');
      const buildId = Date.now().toString(36);
      writeFileSync(file, readFileSync(file, 'utf8').replaceAll('__BUILD_ID__', buildId));
    }
  };
}

export default defineConfig({
  base: process.env.GITHUB_PAGES === 'true' ? '/jiaye-tianxia/' : '/',
  plugins: [react(), stampServiceWorker()],
  build: {
    assetsInlineLimit: 0
  }
});
