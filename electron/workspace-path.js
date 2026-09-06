import path from 'node:path';

export function resolveDefaultWorkspace({
  currentWorkingDirectory,
  executablePath,
  isPackaged,
  portableExecutableDirectory
}) {
  if (portableExecutableDirectory) return path.resolve(portableExecutableDirectory);
  if (isPackaged) return path.dirname(path.resolve(executablePath));
  return path.resolve(currentWorkingDirectory);
}
