<script setup>
import { directoryAccess, restoreDirectoryAccess } from '../pages/access.js';
import { pagesText } from '../../../public/locales/pages.js';
async function restore() { try { await restoreDirectoryAccess(); } catch { /* Keep the recovery action available. */ } }
</script>
<template>
  <aside v-if="directoryAccess.root && (directoryAccess.status !== 'granted' || directoryAccess.error)" class="pages-access-banner" role="status">
    <span>{{ pagesText(directoryAccess.status === 'granted' ? 'readError' : 'permission') }}</span>
    <var-button size="small" text @click="restore">{{ pagesText('retry') }}</var-button>
  </aside>
</template>
<style scoped>
.pages-access-banner { position: fixed; z-index: 210; top: var(--titlebar-height); left: 50%; transform: translateX(-50%); width: min(640px, calc(100vw - 24px)); display: flex; align-items: center; gap: 8px; padding: 8px 12px; border: 1px solid var(--warning); border-radius: 12px; background: var(--surface-high); font-size: 13px; }
.pages-access-banner > span { flex: 1; }
</style>
