<script setup>
import { computed, ref, watchEffect } from 'vue';
import { locale, t } from '../../public/i18n.js';
import { privacyContent, privacyUpdated } from '../../public/locales/privacy.js';
import { appPath } from './navigation.js';
import SettingsMenu from './components/SettingsMenu.vue';
import MdiIcon from './components/MdiIcon.vue';
import { mdiChevronLeft } from './icons.js';

const selectedLocale = ref(locale);
function changeLocale(value) {
  localStorage.setItem('comic-manager.locale', value);
  window.location.reload();
}
const text = (key) => t(key, {}, selectedLocale.value);
const content = computed(() => privacyContent[selectedLocale.value] ?? privacyContent.en);
const links = {
  pages: 'https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages',
  github: 'https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement',
  issues: 'https://github.com/ATPComic/ATPComicManager/issues'
};
function inlineParts(paragraph) {
  return paragraph.split(/(\[[^\]]+\]\((?:pages|github|issues)\))/g).filter(Boolean).map(part => {
    const match = part.match(/^\[([^\]]+)\]\((pages|github|issues)\)$/);
    return match ? { text: match[1], href: links[match[2]] } : { text: part };
  });
}
const options = computed(() => [
  { value: 'en', label: text('languageEnglish') }, { value: 'ja', label: text('languageJapanese') },
  { value: 'zh-CN', label: text('languageChineseSimplified') }, { value: 'zh-TW', label: text('languageChineseTraditional') }
]);
watchEffect(() => { document.documentElement.lang = selectedLocale.value; document.title = `${text('privacy')} · ATP Comic`; });
</script>

<template>
  <div class="privacy-page">
    <header class="privacy-bar">
      <a :href="appPath('/')"><MdiIcon :path="mdiChevronLeft" /><span>ATP Comic</span></a>
      <SettingsMenu v-model="selectedLocale" :options="options" @change="changeLocale" />
    </header>
    <main class="privacy-scroll">
      <article>
        <h1>{{ text('privacy') }}</h1>
        <p class="privacy-updated">{{ text('privacyUpdated') }} <time :datetime="privacyUpdated">{{ privacyUpdated }}</time></p>
        <p v-if="selectedLocale !== 'en'" class="privacy-translation">{{ text('privacyTranslation') }} <button @click="selectedLocale = 'en'">English</button></p>
        <div class="privacy-summary"><p v-for="paragraph in content.summary.split('\n\n')" :key="paragraph">{{ paragraph }}</p></div>
        <section v-for="([heading, paragraph], index) in content.sections" :key="index" :aria-labelledby="`privacy-${index}`">
          <h2 :id="`privacy-${index}`">{{ heading }}</h2>
          <p v-for="part in paragraph.split('\n\n')" :key="part"><template v-for="(inline, partIndex) in inlineParts(part)" :key="partIndex"><a v-if="inline.href" :href="inline.href" target="_blank" rel="noopener noreferrer">{{ inline.text }}</a><template v-else>{{ inline.text }}</template></template></p>
        </section>
      </article>
    </main>
  </div>
</template>

<style scoped>
.privacy-page { height: 100dvh; display: flex; flex-direction: column; }
.privacy-bar { height: var(--titlebar-height); min-height: var(--titlebar-height); width: env(titlebar-area-width, 100%); margin-left: env(titlebar-area-x, 0px); display: flex; align-items: center; justify-content: space-between; padding: 0 16px; border-bottom: 1px solid var(--outline-soft); -webkit-app-region: drag; }
.privacy-bar > * { -webkit-app-region: no-drag; }
.privacy-bar a { display: flex; align-items: center; gap: 8px; text-decoration: none; color: inherit; }
.privacy-scroll { overflow-y: auto; flex: 1; min-height: 0; }
article { max-width: 800px; margin: auto; padding: 40px 24px 64px; line-height: 1.8; overflow-wrap: anywhere; }
h1 { margin: 0; font-size: 32px; font-weight: 500; }
h2 { margin: 32px 0 8px; font-size: 20px; font-weight: 500; }
p { margin: 8px 0; }
.privacy-updated { color: var(--muted); font-size: 13px; }
.privacy-translation { color: var(--muted); font-size: 14px; }
.privacy-translation button { color: var(--primary); background: none; border: 0; padding: 4px; text-decoration: underline; cursor: pointer; }
.privacy-summary { margin-top: 24px; }
article a { color: var(--primary); text-underline-offset: 3px; }
@media (max-width: 600px) { article { padding: 24px 20px 40px; } .privacy-bar { padding-top: env(safe-area-inset-top); } }
</style>
