import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export function pagesPlugin() {
  return {
    name: 'atp-pages',
    transformIndexHtml(html) {
      return html.replace('</head>', '<link rel="manifest" href="/ATPComicManager/manifest.webmanifest"><meta name="theme-color" content="#101114"></head>');
    },
    generateBundle(_options, bundle) {
      const base = '/ATPComicManager/';
      this.emitFile({ type: 'asset', fileName: 'pwa-icon.png', source: readFileSync(new URL('../design/atp-comic/icon.png', import.meta.url)) });
      this.emitFile({ type: 'asset', fileName: 'missing-image.svg', source: readFileSync(new URL('../public/missing-image.svg', import.meta.url)) });
      this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: JSON.stringify({
        id: base, name: 'ATP Comic', short_name: 'ATP Comic', start_url: base, scope: base,
        display: 'standalone', background_color: '#101114', theme_color: '#101114',
        icons: [{ src: 'pwa-icon.png', sizes: 'any', type: 'image/png', purpose: 'any' }]
      }) });
      const files = [...new Set([...Object.keys(bundle), 'index.html', 'privacy/index.html', 'tags.html', 'variants.html', 'warnings.html', 'pwa-icon.png', 'missing-image.svg', 'manifest.webmanifest'])].map(file => base + file);
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
