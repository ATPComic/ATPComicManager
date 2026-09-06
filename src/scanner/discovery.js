import { promises as fs } from 'node:fs';
import path from 'node:path';
import { isImageFile, parseImageFilename } from '../validation/filename.js';
import { matchesRecognitionRule } from '../recognition-store.js';

const FOLDER_PATTERN = /^\d{8}(?:_x)?$/;
const MONTH_PATTERN = /^\d{6}$/;
const IGNORED_DIRECTORY_NAMES = new Set(['Reading', 'themes', 'node_modules', '.git', '.vscode']);
const MAX_DISCOVERY_DEPTH = 5;

async function readEntries(directoryPath) {
  try {
    return await fs.readdir(directoryPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function looksLikeArchiveRoot(directoryPath, rules) {
  const entries = await readEntries(directoryPath);
  return entries.some((entry) => {
    if (entry.isDirectory()) {
      return FOLDER_PATTERN.test(entry.name) || MONTH_PATTERN.test(entry.name) || matchesRecognitionRule(entry.name, rules);
    }
    if (entry.isFile()) {
      return isImageFile(entry.name) && parseImageFilename(entry.name) !== null;
    }
    return false;
  });
}

function isIgnoredDirectory(entryName) {
  return IGNORED_DIRECTORY_NAMES.has(entryName) || entryName.startsWith('.');
}

async function walkForRoots(directoryPath, depth = 0, rules = []) {
  if (depth > MAX_DISCOVERY_DEPTH) {
    return [];
  }

  if (await looksLikeArchiveRoot(directoryPath, rules)) {
    return [directoryPath];
  }

  const entries = await readEntries(directoryPath);
  const discovered = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || isIgnoredDirectory(entry.name)) {
      continue;
    }
    const childPath = path.join(directoryPath, entry.name);
    discovered.push(...await walkForRoots(childPath, depth + 1, rules));
  }

  return discovered;
}

export async function discoverArchiveRoots(workspaceRoot, explicitArchiveRoot, rules = []) {
  const roots = [];

  if (explicitArchiveRoot) {
    try {
      const stat = await fs.stat(explicitArchiveRoot);
      if (stat.isDirectory()) {
        roots.push(explicitArchiveRoot);
        return roots;
      }
    } catch {
      // Fall back to discovery.
    }
  }

  const workspaceArchive = path.join(workspaceRoot, 'Archive');
  try {
    const stat = await fs.stat(workspaceArchive);
    if (stat.isDirectory()) {
      roots.push(workspaceArchive);
      return roots;
    }
  } catch {
    // Continue with workspace discovery.
  }

  const discovered = await walkForRoots(workspaceRoot, 0, rules);
  const seen = new Set();
  for (const root of discovered) {
    if (seen.has(root)) {
      continue;
    }
    seen.add(root);
    roots.push(root);
  }

  if (roots.length === 0) {
    roots.push(workspaceRoot);
  }

  return roots;
}
