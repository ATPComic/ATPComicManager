<script setup>
import { computed, ref } from 'vue';
import { t } from '../../../public/i18n.js';
import { settingsLabels } from '../../../public/locales/settings.js';
import { themePresets } from '../../../public/theme-palette.js';
import { version } from '../../../package.json';
import { appPath } from '../navigation.js';
import { isAndroidApp } from '../api.js';
import { selectedTheme, selectTheme } from '../theme.js';
import { mdiCogOutline, mdiInformationOutline, mdiDeleteOutline, mdiCheck, mdiTranslate, mdiPaletteOutline } from '../icons.js';
import MdiIcon from './MdiIcon.vue';
import AppMenuItem from './AppMenuItem.vue';
import PreviewCacheControl from './PreviewCacheControl.vue';

const props = defineProps({ modelValue: { type: String, required: true }, options: { type: Array, default: () => [] } });
const emit = defineEmits(['update:modelValue', 'change']);
const labels = computed(() => settingsLabels[props.modelValue] ?? settingsLabels.en);
const text = key => t(key, {}, props.modelValue);
const open = ref(false);
const cache = ref(null);
function changeLanguage(value) {
  if (value === props.modelValue) return;
  emit('update:modelValue', value);
  emit('change', value);
}
function openCache() { open.value = false; cache.value.open(); }
</script>

<template>
  <var-menu v-model:show="open" class="settings-menu" placement="bottom-end" :offset-y="8" popover-class="app-menu-popover">
    <var-button text round size="small" class="settings-trigger" :aria-label="labels.settings" :title="labels.settings" :aria-expanded="open" aria-haspopup="dialog"><MdiIcon :path="mdiCogOutline" /></var-button>
    <template #menu>
      <section class="settings-panel" role="dialog" :aria-label="labels.settings">
        <h2>{{ labels.settings }}</h2>
        <fieldset><legend class="settings-heading"><MdiIcon :path="mdiTranslate" />{{ text('language') }}</legend>
          <div class="settings-options"><button v-for="option in options" :key="option.value" v-ripple type="button" :aria-pressed="modelValue === option.value" @click="changeLanguage(option.value)">{{ option.label }}</button></div>
        </fieldset>
        <fieldset><legend class="settings-heading"><MdiIcon :path="mdiPaletteOutline" />{{ labels.theme }}</legend>
          <div class="settings-options"><button v-for="(palette, id) in themePresets" :key="id" v-ripple type="button" :aria-pressed="selectedTheme === id" @click="selectTheme(id)"><span class="theme-swatch" :style="{ background: palette.primary, color: palette['on-primary'] }"><MdiIcon v-if="selectedTheme === id" :path="mdiCheck" /></span>{{ labels[id] }}</button></div>
        </fieldset>
        <AppMenuItem v-if="!isAndroidApp" :icon="mdiDeleteOutline" :label="text('previewCache')" @click="openCache" />
        <section class="settings-about" :aria-label="text('about')">
          <h3 class="settings-heading"><MdiIcon :path="mdiInformationOutline" />{{ text('about') }}</h3>
          <p class="about-links">
            <span>ATP Comic <span class="about-version">v{{ version }}</span></span>
            <a :href="appPath('/privacy/')" target="_blank" rel="noopener noreferrer" @click="open = false">{{ text('privacy') }}</a>
            <a href="https://github.com/ATPComic/ATPComicManager" target="_blank" rel="noopener noreferrer" @click="open = false">GitHub</a>
          </p>
        </section>
      </section>
    </template>
  </var-menu>
  <PreviewCacheControl v-if="!isAndroidApp" ref="cache" hide-trigger />
</template>

<style scoped>
.settings-panel { width: min(340px, calc(100vw - 24px)); max-height: calc(100dvh - 80px); overflow-y: auto; padding: 12px; }
.settings-panel h2 { margin: 4px 8px 16px; font-size: 18px; font-weight: 500; }
.settings-panel fieldset { border: 0; min-width: 0; padding: 0 0 16px; margin: 0; }
.settings-heading { display: flex; align-items: center; gap: 8px; margin: 0 8px 8px; padding: 0; font-size: 14px; font-weight: 500; }
.settings-options { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-inline: 4px; }
.settings-options button { position: relative; display: flex; align-items: center; gap: 8px; min-height: 40px; padding: 6px 10px; border: 1px solid var(--outline); border-radius: 12px; background: transparent; color: var(--text); cursor: pointer; overflow: hidden; }
.settings-options button[aria-pressed="true"] { background: var(--secondary-container); color: var(--on-secondary-container); border-color: var(--primary); }
.theme-swatch { display: grid; place-items: center; flex: 0 0 24px; height: 24px; border-radius: 50%; }
.about-version { color: var(--muted); font-size: 12px; }
.settings-about { border-top: 1px solid var(--outline-soft); margin-top: 8px; padding-top: 12px; }
.about-links { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin: 12px 8px 4px; font-size: 13px; }
.about-links > span { margin-right: auto; white-space: nowrap; }
.about-links a { color: var(--primary); text-decoration: underline; text-underline-offset: 3px; white-space: nowrap; }
</style>
