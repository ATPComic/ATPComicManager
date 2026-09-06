import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import os from 'node:os';
import { resolveDefaultWorkspace } from '../electron/workspace-path.js';

test('portable executable directory is the default workspace', () => {
  assert.equal(resolveDefaultWorkspace({
    currentWorkingDirectory: path.join(os.tmpdir(), 'source'),
    executablePath: path.join(os.tmpdir(), 'unpacked', 'ATP Comic.exe'),
    isPackaged: true,
    portableExecutableDirectory: path.join(os.tmpdir(), 'Comics')
  }), path.join(os.tmpdir(), 'Comics'));
});

test('a packaged non-portable app defaults to its executable directory', () => {
  assert.equal(resolveDefaultWorkspace({
    currentWorkingDirectory: path.join(os.tmpdir(), 'elsewhere'),
    executablePath: path.join(os.tmpdir(), 'Apps', 'ATP Comic', 'ATP Comic.exe'),
    isPackaged: true
  }), path.join(os.tmpdir(), 'Apps', 'ATP Comic'));
});

test('development mode defaults to the current working directory', () => {
  assert.equal(resolveDefaultWorkspace({
    currentWorkingDirectory: path.join(os.tmpdir(), 'source'),
    executablePath: path.join(os.tmpdir(), 'Electron', 'electron'),
    isPackaged: false
  }), path.join(os.tmpdir(), 'source'));
});
