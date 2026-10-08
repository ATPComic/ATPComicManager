import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { brandingPlugin } from './scripts/branding-plugin.mjs';
import { pagesPlugin } from './scripts/pages-plugin.mjs';

export default defineConfig(({ mode }) => {
  const pages = mode === 'pages';
  // GitHub Pages serves the canonical app at /ATPComicManager/ on a shared
  // origin. PAGES_BASE lets a preview (e.g. the develop branch) build into a
  // subpath; the service worker and storage layer namespace themselves per base.
  const base = pages ? process.env.PAGES_BASE || '/ATPComicManager/' : '/';
  return {
    base,
    worker: { format: 'es' },
    root: fileURLToPath(new URL('./ui', import.meta.url)),
    publicDir: false,
    plugins: [
      brandingPlugin({ base }),
      pages && pagesPlugin({ base }),
      vue({
        template: {
          compilerOptions: {
            isCustomElement: (tag) => tag.startsWith('md-')
          }
        }
      })
    ],
    build: {
      outDir: fileURLToPath(new URL(pages ? './dist-pages' : './dist', import.meta.url)),
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
  };
});
