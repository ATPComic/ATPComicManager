<script setup>
import MdiIcon from './MdiIcon.vue';
defineProps({ icon: String, label: String, description: String, href: String });
</script>

<template>
  <component :is="href ? 'a' : 'button'" v-ripple class="app-menu-item" :class="{ 'has-description': description }" :href="href" :type="href ? undefined : 'button'" :target="href ? '_blank' : undefined" :rel="href ? 'noopener noreferrer' : undefined">
    <MdiIcon :path="icon" />
    <span><span>{{ label }}</span><small v-if="description">{{ description }}</small></span>
  </component>
</template>

<style scoped>
.app-menu-item { position: relative; overflow: hidden; display: grid; grid-template-columns: 24px minmax(0, 1fr); align-items: center; gap: 10px; width: 100%; min-height: 44px; padding: 8px 12px; border: 0; border-radius: 12px; background: transparent; color: var(--text); font: inherit; font-size: 14px; text-decoration: none; text-align: left; cursor: pointer; }
.app-menu-item:hover, .app-menu-item:focus-visible { background: var(--surface-high); }
.app-menu-item > span { display: grid; gap: 2px; min-width: 0; }
.app-menu-item small { color: var(--muted); font-size: 12px; line-height: 1.4; }
.has-description { min-height: 58px; }
</style>
