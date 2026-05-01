import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: process.env.GITHUB_PAGES === 'true' ? '/jiaye-tianxia/' : '/',
  plugins: [react()],
  build: {
    assetsInlineLimit: 0
  }
});
