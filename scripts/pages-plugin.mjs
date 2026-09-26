import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export function pagesPlugin() {
  return {
    name: 'atp-pages',
    generateBundle(_options, bundle) {
      const base = '/ATPComicManager/';
      this.emitFile({ type: 'asset', fileName: 'missing-image.svg', source: readFileSync(new URL('../public/missing-image.svg', import.meta.url)) });
      const files = [...new Set([
        ...Object.keys(bundle),
        'index.html', 'privacy/index.html', 'tags.html', 'variants.html', 'warnings.html',
        'favicon.svg', 'favicon-32.png', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png',
        'missing-image.svg', 'manifest.webmanifest'
      ])].map(file => base + file);
      const policy = readFileSync(new URL('../public/thumbnail-policy.js', import.meta.url), 'utf8').replace(/^export /gm, '');
      const dimensions = readFileSync(new URL('../public/image-dimensions.js', import.meta.url), 'utf8').replace(/^export /gm, '');
      const cache = readFileSync(new URL('../public/preview-cache.js', import.meta.url), 'utf8').replace(/^export /gm, '');
      const template = readFileSync(new URL('../ui/src/platform/pwa/sw.js', import.meta.url), 'utf8').replace('/* THUMBNAIL_POLICY */', [policy, dimensions, cache].join('\n'));
      const version = createHash('sha256').update(JSON.stringify(files)).update(template).digest('hex').slice(0, 12);
      const source = template
        .replace('__APP_CACHE__', `atp-pages-app-${version}`).replace('__APP_FILES__', JSON.stringify(files));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    }
  };
}
