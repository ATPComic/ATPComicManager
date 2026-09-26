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
      'object-shorthand': ['error', 'properties']
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
