import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { writeThemeIndexFile } from '../planner/themeIndex.js';
import { resolvePathInside } from '../utils/path.js';

async function ensureFolder(folderPath) {
  await fs.mkdir(folderPath, { recursive: true });
}

function isSameFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

async function readTargetStat(target) {
  try {
    return await fs.lstat(target);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function ensureLink(source, target) {
  await ensureFolder(path.dirname(target));
  const sourceStat = await fs.stat(source);
  if (!sourceStat.isFile()) {
    throw new Error(`Hard-link source is not a regular file: ${source}`);
  }

  const targetStat = await readTargetStat(target);
  if (targetStat) {
    if (!targetStat.isFile() || targetStat.isSymbolicLink()) {
      throw new Error(`Refusing to replace a non-file Reading target: ${target}`);
    }
    if (isSameFile(sourceStat, targetStat)) return;
    if (targetStat.nlink <= 1) {
      throw new Error(`Refusing to replace an unmanaged Reading file: ${target}`);
    }
  }

  const temporaryPath = path.join(path.dirname(target), `.comic-manager-${randomUUID()}.tmp`);
  try {
    await fs.link(source, temporaryPath);
    await fs.rename(temporaryPath, target);
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
  }
}

function validatePlan(plan) {
  if (!plan?.readingRoot) throw new Error('Plan is missing its Reading directory.');
  const readingRoot = path.resolve(plan.readingRoot);
  const steps = (plan.steps ?? []).map((step) => {
    if (!['create-folder', 'create-hard-link', 'write-theme-index'].includes(step?.type)) {
      throw new Error(`Unsupported plan step: ${step?.type ?? '<missing>'}`);
    }
    const stepPath = step.type === 'create-hard-link' ? step.target : step.path;
    const outputPath = resolvePathInside(readingRoot, String(stepPath ?? ''));
    if (step.type === 'create-hard-link') {
      if (!step.source) throw new Error('Hard-link plan step is missing its source.');
      return { ...step, source: path.resolve(step.source), target: outputPath };
    }
    if (step.type === 'write-theme-index' && path.basename(outputPath) !== '.theme-index.json') {
      throw new Error(`Invalid theme index target: ${outputPath}`);
    }
    return { ...step, path: outputPath };
  });
  return steps;
}

export async function applyPlan(plan) {
  const steps = validatePlan(plan);
  for (const step of steps) {
    if (step.type === 'create-folder') {
      await ensureFolder(step.path);
      continue;
    }
    if (step.type === 'create-hard-link') {
      await ensureLink(step.source, step.target);
      continue;
    }
    if (step.type === 'write-theme-index') {
      await ensureFolder(path.dirname(step.path));
      await writeThemeIndexFile(path.dirname(step.path), step.themeIndex);
      continue;
    }
  }
}
