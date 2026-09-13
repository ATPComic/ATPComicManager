import { t } from '../../../public/i18n.js';
import { setReaderAssetUrlResolver } from '../../../public/reader-model.js';
import { normalizeVariantAssignments } from '../../../public/variant-assignment-model.js';
import { applyVariantAssignments } from '../../../src/model/variant-assignments.js';
import { portableLibrary, assertPortableJson } from '../../../src/shared-export.js';
import { assetStore, pruneAssets, storeAssetEntries } from './assets.js';
import { collectDirectoryFiles, indexImportedFiles, matchImportedFile, readSharedCatalog } from './import-model.js';

let worker;
let nextId = 0;
const requests = new Map();
let state;
let initializing;
function database(operation, state) {
  if (!worker) {
    worker = new Worker(new URL('./database.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      const pending = requests.get(data.id);
      requests.delete(data.id);
      if (data.error) pending?.reject(new Error(t(data.error)));
      else pending?.resolve(data.result);
    };
    worker.onerror = () => { for (const pending of requests.values()) pending.reject(new Error(t('pagesStorageError'))); requests.clear(); };
    window.addEventListener('pagehide', () => worker.terminate(), { once: true });
    window.addEventListener('pageshow', event => { if (event.persisted) window.location.reload(); });
  }
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    requests.set(id, { resolve, reject });
    worker.postMessage({ id, operation, state });
  });
}
export function initializePages() {
  return initializing ??= (async () => {
    if (!('serviceWorker' in navigator)) throw new Error(t('pagesStorageError'));
    await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL });
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
    state = await database('load');
    setReaderAssetUrlResolver((kind, episode, index, identity, size) => {
      const files = state.library.episodes[episode]?.files ?? [];
      const file = identity ? (files[index]?.assetKey === identity ? files[index] : files.find(candidate => candidate.assetKey === identity)) : files[index];
      return `${import.meta.env.BASE_URL}__image?key=${encodeURIComponent(file?.assetKey ?? '')}&size=${kind === 'image' ? 'original' : size ?? 'small'}`;
    });
    return state;
  })();
}
async function persist(next) {
  state = await database('save', next);
  return structuredClone(state);
}

export async function importPagesFiles({ catalog, directory }, progress = () => {}) {
  await initializePages();
  const next = readSharedCatalog(JSON.parse(await catalog.text()));
  const previousDirectory = await assetStore('directory');
  const sameDirectory = previousDirectory && await directory.isSameEntry(previousDirectory);
  const previousNamespace = sameDirectory ? await assetStore('directoryNamespace') : null;
  const namespace = previousNamespace || crypto.randomUUID();
  const files = await collectDirectoryFiles(directory);
  const fileIndex = indexImportedFiles(files);
  const references = Object.values(next.library.episodes).flatMap(episode => episode.files);
  const imported = new Map();
  const entries = [];
  let missing = 0;
  for (let index = 0; index < references.length; index++) {
    const reference = references[index];
    const source = matchImportedFile(reference, fileIndex);
    reference.missing = !source;
    if (source) {
      let cached = imported.get(source);
      if (!cached) {
        const key = `${namespace}:${source.webkitRelativePath.split('/').slice(1).join('/')}`;
        cached = { assetKey: key };
        entries.push([key, { handle: source.handle }]);
        imported.set(source, cached);
      }
      if (cached) Object.assign(reference, cached);
    }
    if (reference.missing) missing++;
    progress(index + 1, references.length);
  }
  await storeAssetEntries(entries, !!sameDirectory);
  await persist(next);
  await storeAssetEntries([['directory', directory], ['directoryNamespace', namespace]]);
  await pruneAssets(new Set(['directory', 'directoryNamespace', ...references.filter(file => !file.missing).map(file => file.assetKey)]));
  return { missingCount: missing };
}

let operations = Promise.resolve();
export function pagesRequest(url, options = {}) {
  const operation = operations.then(() => handleRequest(url, options));
  operations = operation.catch(() => {});
  return operation;
}

async function handleRequest(url, options = {}) {
  await initializePages();
  const method = options.method ?? 'GET';
  const body = options.body ? JSON.parse(options.body) : {};
  if (url === '/api/cache/preview' && ['GET', 'DELETE'].includes(method)) {
    const response = await fetch(`${import.meta.env.BASE_URL}__preview-cache`, { method });
    if (!response.ok) throw new Error(t('pagesStorageError'));
    return response.json();
  }
  if (url === '/api/state') return structuredClone({ ...state, initialized: true, runtime: { workspaceRoot: '' } });
  if (url === '/api/scan') return { library: structuredClone(state.library) };
  if (url === '/api/variants' && method === 'GET') return { variantAssignments: structuredClone(state.variantAssignments) };
  if (url === '/api/export/json') {
    const exported = { library: portableLibrary(state.library), tags: state.tags, variants: state.variantAssignments, themes: state.themes, recognition: state.recognition };
    assertPortableJson(exported);
    return { export: structuredClone(exported) };
  }
  const next = structuredClone(state);
  if (url === '/api/variants' && method === 'PUT') {
    next.variantAssignments = normalizeVariantAssignments(body);
    applyVariantAssignments(next.library, next.variantAssignments, next.recognition.identityMarkers ?? []);
  } else if (url === '/api/tags' && method === 'PUT') next.tags = body;
  else if (url === '/api/recognition' && method === 'PUT') {
    next.recognition = body;
    for (const [id, episode] of Object.entries(next.library.episodes)) {
      if (episode.layout === 'rule-folder') episode.date = body.episodeDates?.[id] ?? null;
    }
  }
  else if (url === '/api/themes' && method === 'POST') {
    const index = next.themes.findIndex(theme => theme.title === body.title);
    if (index < 0) next.themes.push(body); else next.themes[index] = body;
  } else if (url.startsWith('/api/themes/') && ['DELETE', 'PATCH'].includes(method)) {
    const title = decodeURIComponent(url.slice('/api/themes/'.length));
    if (method === 'DELETE') next.themes = next.themes.filter(theme => theme.title !== title);
    else { const theme = next.themes.find(theme => theme.title === title); if (theme) theme.title = body.title; }
  } else throw new Error(t('pagesUnavailable'));
  const saved = await persist(next);
  return { ok: true, ...saved };
}
