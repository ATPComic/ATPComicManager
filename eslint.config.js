import js from '@eslint/js';
import globals from 'globals';
import pluginVue from 'eslint-plugin-vue';

// Lint only. The goal is catching real defects and keeping a small set of
// project-wide conventions consistent, not reformatting the source.
export default [
  {
    ignores: ['dist/**', 'dist-pages/**', 'release/**', 'generated/**', 'node_modules/**', 'neeview/**', 'android/**']
  },
  js.configs.recommended,
  ...pluginVue.configs['flat/essential'],
  {
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
      'prefer-const': 'error',
      'object-shorthand': ['error', 'properties'],
      'padding-line-between-statements': ['error',
        { blankLine: 'always', prev: ['function', 'export'], next: ['function', 'export'] }
      ]
    }
  },
  {
    files: ['src/**/*.js', 'scripts/**/*.mjs', 'test/**/*.js', 'electron/**/*.{js,cjs,mjs}', 'vite.config.js'],
    languageOptions: { globals: { ...globals.node } }
  },
  {
    files: ['public/**/*.js', 'ui/**/*.{js,vue}'],
    languageOptions: { globals: { ...globals.browser } }
  },
  {
    // Upload-leak guard: browser code must not open network channels. The only
    // allowed egress is the same-origin app surface, which must opt out at the
    // call site with an explicit eslint-disable and a justification.
    files: ['public/**/*.js', 'ui/**/*.{js,vue}'],
    rules: {
      'no-restricted-globals': ['error',
        { name: 'fetch', message: 'Browser code may only use the same-origin app surface; add an explicit eslint-disable with a same-origin justification.' },
        { name: 'XMLHttpRequest', message: 'Network egress is not allowed in browser code.' },
        { name: 'WebSocket', message: 'Network egress is not allowed in browser code.' },
        { name: 'EventSource', message: 'Network egress is not allowed in browser code.' },
        { name: 'RTCPeerConnection', message: 'Peer connections can leak addresses and are not allowed.' },
        { name: 'importScripts', message: 'Loading remote scripts is not allowed.' }
      ],
      'no-restricted-properties': ['error',
        { object: 'navigator', property: 'sendBeacon', message: 'Beacon uploads are not allowed.' },
        { object: 'navigator', property: 'share', message: 'Sharing leaves the app boundary and is not allowed.' }
      ]
    }
  },
  {
    files: ['ui/src/platform/pwa/sw.js'],
    languageOptions: {
      globals: {
        ...globals.serviceworker,
        // Injected by scripts/pages-plugin.mjs at build time.
        __APP_CACHE__: 'readonly',
        __APP_FILES__: 'readonly',
        PAGES_ASSETS_DB: 'readonly',
        createAssetsDbOpener: 'readonly',
        createImageQueue: 'readonly',
        thumbnailFingerprint: 'readonly',
        thumbnailProfile: 'readonly',
        imageDimensions: 'readonly',
        previewCacheEntry: 'readonly'
      }
    }
  },
  {
    files: ['ui/src/platform/pwa/database.worker.js'],
    languageOptions: { globals: { ...globals.worker } }
  }
];
