import path from 'node:path';

export function toPosixPath(value) {
  return value.split(path.sep).join('/');
}

export function relativePosixPath(from, to) {
  return toPosixPath(path.relative(from, to));
}

export function resolvePathInside(rootPath, candidatePath) {
  const root = path.resolve(rootPath);
  const candidate = path.isAbsolute(candidatePath)
    ? path.resolve(candidatePath)
    : path.resolve(root, candidatePath);
  const relative = path.relative(root, candidate);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Output path escapes the Reading directory: ${candidate}`);
  }
  return candidate;
}

export function sortEpisodeIds(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

export function getFolderBaseName(folderName) {
  return folderName.endsWith('_x') ? folderName.slice(0, -2) : folderName;
}
