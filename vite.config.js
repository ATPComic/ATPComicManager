import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { pagesPlugin } from './scripts/pages-plugin.mjs';

export default defineConfig(({ mode }) => ({
  base: mode === 'pages' ? '/ATPComicManager/' : '/',
  worker: { format: 'es' },
  root: fileURLToPath(new URL('./ui', import.meta.url)),
  publicDir: false,
  plugins: [mode === 'pages' && pagesPlugin(), vue({
    template: {
      compilerOptions: {
        isCustomElement: (tag) => tag.startsWith('md-')
      }
    }
  })],
  build: {
    outDir: fileURLToPath(new URL(mode === 'pages' ? './dist-pages' : './dist', import.meta.url)),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('./ui/index.html', import.meta.url)),
        privacy: fileURLToPath(new URL('./ui/privacy/index.html', import.meta.url)),
        tags: fileURLToPath(new URL('./ui/tags.html', import.meta.url)),
        warnings: fileURLToPath(new URL('./ui/warnings.html', import.meta.url)),
        variants: fileURLToPath(new URL('./ui/variants.html', import.meta.url))
      }
    }
  }
}));
