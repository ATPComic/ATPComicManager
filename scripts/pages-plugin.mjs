import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

// A service worker cannot import modules, so shared sources are inlined as
// plain text. Fail loudly when a module still exports after stripping instead
// of emitting a worker that only breaks at runtime.
function inlineShared(file) {
  const source = readFileSync(new URL(`../public/${file}`, import.meta.url), 'utf8').replace(/^export /gm, '').replace(/\n+$/, '');
  assert.ok(!/\bexport\b/.test(source), `${file} has an export the service worker cannot inline`);
  return source;
}

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
      const shared = ['pages-assets-db.js', 'thumbnail-policy.js', 'image-dimensions.js', 'preview-cache.js'].map(inlineShared).join('\n\n');
      const template = readFileSync(new URL('../ui/src/platform/pwa/sw.js', import.meta.url), 'utf8').replace('/* SHARED_MODULES */', shared);
      const version = createHash('sha256').update(JSON.stringify(files)).update(template).digest('hex').slice(0, 12);
      const source = template
        .replace('__APP_CACHE__', `atp-pages-app-${version}`).replace('__APP_FILES__', JSON.stringify(files));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    }
  };
}
