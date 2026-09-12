import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { scanWorkspace } from './scanner/scanner.js';
import { mergeSharedLibrary, readLibrary, writeLibrary } from './model/library.js';
import { loadThemes, saveTheme, deleteTheme, renameTheme, mergeSharedThemes } from './themes/store.js';
import { createPlan } from './planner/planner.js';
import { applyPlan } from './apply/apply.js';
import { loadTagState, mergeTagStates, saveTagState } from './tag-store.js';
import { getThumbnailPath } from './thumbnail-cache.js';
import { loadVariantAssignments, saveVariantAssignments, alignVariantTokens } from './variant-store.js';
import { normalizeVariantAssignments } from '../public/variant-assignment-model.js';
import { loadRecognitionState, saveRecognitionState, mergeRecognitionStates } from './recognition-store.js';
import { loadSharedImport, normalizeSharedImport } from './shared-import-store.js';
import { initializeStorage } from './storage/initialize.js';
import { withDatabase } from './storage/database.js';
import { attachImageReferences, resolveImageReference } from './image-reference.js';
import { portableLibrary, assertPortableJson } from './shared-export.js';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const publicRoot = path.join(currentDirectory, '..', 'dist');

function isPathInside(parentPath, candidatePath) {
  const relative = path.relative(parentPath, candidatePath);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function sendMissingImage(response) {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="1280" viewBox="0 0 960 1280"><rect width="960" height="1280" fill="#18191d"/><path d="M330 520h300v240H330zM390 640l70-70 55 55 45-45 70 90H390z" fill="none" stroke="#73757e" stroke-width="18" stroke-linejoin="round"/><text x="480" y="820" text-anchor="middle" fill="#c5c5ce" font-family="Segoe UI,sans-serif" font-size="34">Missing image</text></svg>';
  response.writeHead(200, { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'no-store' });
  response.end(svg);
}

function mergeVariantStates(current, imported) {
  const left = normalizeVariantAssignments(current);
  const right = normalizeVariantAssignments(imported);
  return normalizeVariantAssignments({
    version: Math.max(left.version, right.version),
    episodes: { ...left.episodes, ...right.episodes },
    peekRelations: { ...left.peekRelations, ...right.peekRelations },
    pageMappings: { ...(left.pageMappings ?? {}), ...(right.pageMappings ?? {}) }
  });
}

function getImageContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.png') return 'image/png';
  if (extension === '.gif') return 'image/gif';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.avif') return 'image/avif';
  if (extension === '.bmp') return 'image/bmp';
  if (extension === '.tif' || extension === '.tiff') return 'image/tiff';
  return 'image/jpeg';
}

async function streamImage(request, response, filePath) {
  const stat = await fs.stat(filePath);
  const etag = `W/\"${stat.size}-${Math.trunc(stat.mtimeMs)}\"`;
  if (request.headers['if-none-match'] === etag) {
    response.writeHead(304, { etag });
    response.end();
    return;
  }
  response.writeHead(200, {
    'content-type': getImageContentType(filePath),
    'content-length': stat.size,
    'cache-control': 'private, max-age=3600',
    etag
  });
  createReadStream(filePath).pipe(response);
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8') || '{}';
  return JSON.parse(text);
}

async function serveStatic(requestPath) {
  const safePath = requestPath === '/' ? '/index.html' : requestPath;
  const filePath = path.resolve(publicRoot, safePath.replace(/^\//, ''));
  if (!isPathInside(publicRoot, filePath)) {
    const error = new Error('Static asset not found');
    error.code = 'ENOENT';
    throw error;
  }
  const data = await fs.readFile(filePath);
  const contentType = filePath.endsWith('.html')
    ? 'text/html; charset=utf-8'
    : filePath.endsWith('.css')
      ? 'text/css; charset=utf-8'
      : filePath.endsWith('.js')
        ? 'text/javascript; charset=utf-8'
        : filePath.endsWith('.svg')
          ? 'image/svg+xml'
          : 'application/octet-stream';
  return { data, contentType };
}

export async function startServer(config) {
  await initializeStorage(config);
  let libraryCache = null;
  let libraryCacheStamp = null;

  async function loadLibrary() {
    try {
      const stat = await fs.stat(config.databasePath);
      const stamp = `${stat.mtimeMs}:${stat.size}`;
      if (libraryCache && libraryCacheStamp === stamp) {
        return libraryCache;
      }
      libraryCache = attachImageReferences(await readLibrary(config.databasePath));
      libraryCacheStamp = stamp;
      return libraryCache;
    } catch (error) { throw new Error(`Cannot read library database: ${error.message}`, { cause: error }); }
  }

  async function updateLibrary(library) {
    attachImageReferences(library);
    await writeLibrary(config.databasePath, library);
    libraryCache = library;
    const stat = await fs.stat(config.databasePath);
    libraryCacheStamp = `${stat.mtimeMs}:${stat.size}`;
  }

  async function scanLibrary() {
    const storedAssignments = await loadVariantAssignments(config.databasePath);
    const recognition = await loadRecognitionState(config.databasePath);
    const variantAssignments = alignVariantTokens(storedAssignments, await readLibrary(config.databasePath), recognition.identityMarkers);
    if (JSON.stringify(variantAssignments) !== JSON.stringify(storedAssignments)) await saveVariantAssignments(config.databasePath, variantAssignments);
    const library = await scanWorkspace(config.workspaceRoot, config.archiveRoot, variantAssignments, recognition);
    const shared = await loadSharedImport(config.databasePath);
    return shared ? mergeSharedLibrary(library, shared.library, recognition.identityMarkers) : library;
  }

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host}`);

      if (url.pathname.startsWith('/api/state')) {
        const library = await loadLibrary();
        const themes = await loadThemes(config.databasePath);
        const tags = await loadTagState(config.databasePath);
        const variantAssignments = await loadVariantAssignments(config.databasePath);
        const recognition = await loadRecognitionState(config.databasePath);
        sendJson(response, 200, {
          library,
          themes,
          tags,
          variantAssignments,
          recognition,
          runtime: { workspaceRoot: config.workspaceRoot }
        });
        return;
      }

      if (url.pathname === '/api/variants' && request.method === 'GET') {
        sendJson(response, 200, { variantAssignments: await loadVariantAssignments(config.databasePath) });
        return;
      }

      if (url.pathname === '/api/variants' && request.method === 'PUT') {
        await saveVariantAssignments(config.databasePath, await readBody(request));
        const library = await scanLibrary();
        await updateLibrary(library);
        sendJson(response, 200, { ok: true, variantAssignments: await loadVariantAssignments(config.databasePath), library });
        return;
      }

      if (url.pathname === '/api/tags' && request.method === 'GET') {
        sendJson(response, 200, { tags: await loadTagState(config.databasePath) });
        return;
      }

      if (url.pathname === '/api/tags' && request.method === 'PUT') {
        const tags = await saveTagState(config.databasePath, await readBody(request));
        sendJson(response, 200, { ok: true, tags });
        return;
      }

      if (url.pathname === '/api/recognition' && request.method === 'PUT') {
        const recognition = await saveRecognitionState(config.databasePath, await readBody(request));
        const library = await scanLibrary();
        await updateLibrary(library);
        sendJson(response, 200, { ok: true, recognition, library });
        return;
      }

      if (url.pathname === '/api/scan' && request.method === 'POST') {
        const library = await scanLibrary();
        await updateLibrary(library);
        sendJson(response, 200, { ok: true, library });
        return;
      }

      if (url.pathname === '/api/image' && request.method === 'GET') {
        const episodeId = url.searchParams.get('episodeId');
        const library = await loadLibrary();
        const episode = library.episodes?.[episodeId];
        const file = resolveImageReference(episode, url.searchParams);

        if (!episodeId || !episode || !file) {
          sendJson(response, 404, { error: 'Image not found' });
          return;
        }

        if (file.missing || !file.absolutePath) {
          sendMissingImage(response);
          return;
        }

        await streamImage(request, response, file.absolutePath);
        return;
      }

      if (url.pathname === '/api/themes' && request.method === 'GET') {
        const themes = await loadThemes(config.databasePath);
        sendJson(response, 200, { themes });
        return;
      }

      if (url.pathname === '/api/themes' && request.method === 'POST') {
        const body = await readBody(request);
        const library = await loadLibrary();
        const existing = (await loadThemes(config.databasePath)).find(theme => theme.title === body.title);
        // Permit removal/reordering of legacy missing entries, but never create
        // new memberships from arbitrary browser URLs or unknown episode IDs.
        if (!Array.isArray(body.episodes) || body.episodes.some(id => typeof id !== 'string' || (!Object.hasOwn(library.episodes, id) && !(existing?.episodes ?? []).includes(id)))) {
          sendJson(response, 400, { error: 'Collection contains an unknown episode' });
          return;
        }
        const theme = await saveTheme(config.databasePath, body);
        sendJson(response, 200, { ok: true, theme });
        return;
      }

      if (url.pathname.startsWith('/api/themes/') && request.method === 'DELETE') {
        const title = decodeURIComponent(url.pathname.slice('/api/themes/'.length));
        await deleteTheme(config.databasePath, title);
        sendJson(response, 200, { ok: true });
        return;
      }

      if (['/api/thumbnail', '/api/image-info'].includes(url.pathname) && request.method === 'GET') {
        const episodeId = url.searchParams.get('episodeId');
        const library = await loadLibrary();
        const file = resolveImageReference(library.episodes?.[episodeId], url.searchParams);
        if (!episodeId || !file) {
          sendJson(response, 404, { error: 'Image not found' });
          return;
        }
        if (file.missing || !file.absolutePath) {
          if (url.pathname === '/api/image-info') {
            sendJson(response, 200, { width: 2, height: 3 });
            return;
          }
          sendMissingImage(response);
          return;
        }
        if (url.pathname === '/api/image-info') {
          const metadata = await sharp(file.absolutePath).metadata();
          const rotated = [5, 6, 7, 8].includes(metadata.orientation);
          sendJson(response, 200, {
            width: rotated ? metadata.height : metadata.width,
            height: rotated ? metadata.width : metadata.height
          });
          return;
        }
        const thumbnailPath = await getThumbnailPath({
          ...(url.searchParams.get('size') === 'preview' ? { width: 960, height: 1440, quality: 85 } : {}),
          sourcePath: file.absolutePath,
          cacheRoot: config.thumbnailCacheRoot ?? path.join(config.workspaceRoot, '.comic-manager-cache', 'thumbnails')
        });
        await streamImage(request, response, thumbnailPath);
        return;
      }

      if (url.pathname.startsWith('/api/themes/') && request.method === 'PATCH') {
        const currentTitle = decodeURIComponent(url.pathname.slice('/api/themes/'.length));
        const body = await readBody(request);
        const theme = await renameTheme(config.databasePath, currentTitle, body.title);
        sendJson(response, 200, { ok: true, theme });
        return;
      }

      if (url.pathname === '/api/export/json' && request.method === 'POST') {
        const library = await loadLibrary();
        const tags = await loadTagState(config.databasePath);
        const variants = await loadVariantAssignments(config.databasePath);
        const recognition = await loadRecognitionState(config.databasePath);
        const themes = await loadThemes(config.databasePath);
        const exported = { library: portableLibrary(library), tags, variants, recognition, themes };
        assertPortableJson(exported);
        sendJson(response, 200, { ok: true, export: exported });
        return;
      }

      if (url.pathname === '/api/import/json' && request.method === 'POST') {
        const imported = normalizeSharedImport(await readBody(request));
        const tags = mergeTagStates(await loadTagState(config.databasePath), imported.tags);
        const variants = mergeVariantStates(await loadVariantAssignments(config.databasePath), alignVariantTokens(imported.variants, imported.library, imported.recognition.identityMarkers));
        const recognition = mergeRecognitionStates(await loadRecognitionState(config.databasePath), imported.recognition);
        const themes = mergeSharedThemes(await loadThemes(config.databasePath), imported.themes);
        const library = mergeSharedLibrary(await scanWorkspace(config.workspaceRoot,config.archiveRoot,variants,recognition), imported.library, recognition.identityMarkers);
        withDatabase(config.databasePath, db => db.transaction(() => {
          db.writeLibrary(imported.library,'shared'); db.meta('shared','1');
          db.writeTags(tags); db.writeVariants(variants); db.writeRecognition(recognition); db.writeLibrary(library);
          for (const theme of themes) db.writeTheme(theme);
        }));
        libraryCache = null;
        const missingCount = (library.warnings ?? []).filter((warning) => warning.type?.startsWith('missing-imported-')).length;
        sendJson(response, 200, { ok: true, library: attachImageReferences(library), tags, variants, recognition, themes, missingCount });
        return;
      }

      if (url.pathname === '/api/apply' && request.method === 'POST') {
        const library = await scanLibrary();
        await updateLibrary(library);
        const themes = await loadThemes(config.databasePath);
        const plan = createPlan(library, themes, config);
        await applyPlan(plan);
        sendJson(response, 200, { ok: true, plan });
        return;
      }

      const staticAsset = await serveStatic(url.pathname);
      response.writeHead(200, { 'content-type': staticAsset.contentType });
      response.end(staticAsset.data);
    } catch (error) {
      sendJson(response, 500, { error: error.message ?? String(error) });
    }
  });

  const host = config.host ?? '127.0.0.1';
  const port = config.port ?? 3000;
  await new Promise((resolve) => server.listen(port, host, resolve));
  const address = server.address();
  const listeningPort = typeof address === 'object' && address ? address.port : port;
  console.log(`ATP Comic listening on http://${host}:${listeningPort}`);
  return server;
}
