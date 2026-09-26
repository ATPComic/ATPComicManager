import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const artwork = fileURLToPath(new URL('../design/atp-comic/icon.svg', import.meta.url));
const foreground = fileURLToPath(new URL('../design/atp-comic/foreground.svg', import.meta.url));

const THEME_COLOR = '#101114';
const MASKABLE_BACKGROUND = '#171b26';
const PNG_ICONS = {
  'favicon-32.png': 32,
  'apple-touch-icon.png': 180,
  'icon-192.png': 192,
  'icon-512.png': 512
};

// Emits the favicon set and web app manifest for every build so the browser,
// PWA install and Windows package all share the same identity and colours.
export function brandingPlugin({ base = '/' } = {}) {
  const href = (name) => `${base}${name}`;
  return {
    name: 'atp-branding',
    transformIndexHtml(html) {
      const tags = [
        `<link rel="icon" type="image/svg+xml" href="${href('favicon.svg')}">`,
        `<link rel="icon" type="image/png" sizes="32x32" href="${href('favicon-32.png')}">`,
        `<link rel="apple-touch-icon" sizes="180x180" href="${href('apple-touch-icon.png')}">`,
        `<link rel="manifest" href="${href('manifest.webmanifest')}">`,
        `<meta name="theme-color" content="${THEME_COLOR}">`,
        `<meta name="color-scheme" content="dark">`
      ].join('');
      return html.replace('</head>', `${tags}</head>`);
    },
    async generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'favicon.svg', source: readFileSync(artwork) });
      for (const [fileName, size] of Object.entries(PNG_ICONS)) {
        this.emitFile({ type: 'asset', fileName, source: await sharp(artwork).resize(size, size).png().toBuffer() });
      }
      const inner = 340;
      const maskable = await sharp({ create: { width: 512, height: 512, channels: 4, background: MASKABLE_BACKGROUND } })
        .composite([{ input: await sharp(foreground).resize(inner, inner).png().toBuffer(), gravity: 'centre' }])
        .png()
        .toBuffer();
      this.emitFile({ type: 'asset', fileName: 'icon-maskable-512.png', source: maskable });
      this.emitFile({
        type: 'asset',
        fileName: 'manifest.webmanifest',
        source: `${JSON.stringify({
          id: base,
          name: 'ATP Comic',
          short_name: 'ATP Comic',
          description: 'Arrange, tag, and peek through a local comic archive.',
          start_url: base,
          scope: base,
          display: 'standalone',
          background_color: THEME_COLOR,
          theme_color: THEME_COLOR,
          icons: [
            { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
          ]
        }, null, 2)}\n`
      });
    }
  };
}
