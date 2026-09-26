import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { applyRelease, compareVersions, parseVersion, repositorySlug, verifyTag } from '../scripts/release.mjs';

const PACKAGE = '{\n  "name": "atp-comic",\n  "version": "0.1.6",\n  "private": true\n}\n';
const LOCK = `{
  "name": "atp-comic",
  "version": "0.1.6",
  "lockfileVersion": 3,
  "packages": {
    "": {
      "name": "atp-comic",
      "version": "0.1.6",
      "dependencies": {}
    },
    "node_modules/foo": {
      "version": "0.1.6"
    }
  }
}
`;
const GRADLE = `android {
    defaultConfig {
        applicationId "io.github.atpcomic.manager"
        versionCode 6
        versionName "0.1.5"
    }
}
`;

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atp-release-'));
  await fs.writeFile(path.join(root, 'package.json'), PACKAGE);
  await fs.writeFile(path.join(root, 'package-lock.json'), LOCK);
  await fs.mkdir(path.join(root, 'android', 'app'), { recursive: true });
  await fs.writeFile(path.join(root, 'android', 'app', 'build.gradle'), GRADLE);
  return root;
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

test('release versions are parsed and compared as semver', () => {
  assert.equal(parseVersion('0.2.0'), '0.2.0');
  assert.equal(parseVersion('v0.2.0'), '0.2.0');
  assert.equal(parseVersion('0.2'), null);
  assert.equal(parseVersion('next'), null);
  assert.ok(compareVersions('0.2.0', '0.1.6') > 0);
  assert.ok(compareVersions('0.1.6', '0.2.0') < 0);
  assert.equal(compareVersions('v1.0.0', '1.0.0'), 0);
  assert.throws(() => compareVersions('0.1.6', 'oops'), /Invalid version/);
});

test('release repository slugs come from ssh aliases and https urls', () => {
  assert.equal(repositorySlug('git@atp_github:ATPComic/ATPComicManager.git'), 'ATPComic/ATPComicManager');
  assert.equal(repositorySlug('https://github.com/ATPComic/ATPComicManager.git'), 'ATPComic/ATPComicManager');
  assert.equal(repositorySlug(''), null);
});

test('release bump updates package, lock, and android without touching dependency versions', async () => {
  const root = await fixture();
  try {
    const result = applyRelease(root, '0.2.0');
    assert.equal(result.from, '0.1.6');
    assert.equal(result.to, '0.2.0');
    assert.deepEqual(result.android, { versionName: { from: '0.1.5', to: '0.2.0' }, versionCode: { from: 6, to: 7 } });

    const pkg = await readJson(path.join(root, 'package.json'));
    const lock = await readJson(path.join(root, 'package-lock.json'));
    const gradle = await fs.readFile(path.join(root, 'android', 'app', 'build.gradle'), 'utf8');
    assert.equal(pkg.version, '0.2.0');
    assert.equal(lock.version, '0.2.0');
    assert.equal(lock.packages[''].version, '0.2.0');
    assert.equal(lock.packages['node_modules/foo'].version, '0.1.6');
    assert.match(gradle, /versionName "0\.2\.0"/);
    assert.match(gradle, /versionCode 7/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('release bump rejects invalid or non-increasing versions without touching files', async () => {
  const root = await fixture();
  try {
    assert.throws(() => applyRelease(root, '0.1.6'), /must be greater/);
    assert.throws(() => applyRelease(root, 'nope'), /Invalid version/);
    assert.equal((await readJson(path.join(root, 'package.json'))).version, '0.1.6');
    assert.match(await fs.readFile(path.join(root, 'android', 'app', 'build.gradle'), 'utf8'), /versionName "0\.1\.5"/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('release dry run reports without writing', async () => {
  const root = await fixture();
  try {
    const result = applyRelease(root, '0.2.0', { write: false });
    assert.equal(result.to, '0.2.0');
    assert.equal((await readJson(path.join(root, 'package.json'))).version, '0.1.6');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('release tag verification requires v plus the package version', async () => {
  const root = await fixture();
  try {
    assert.equal(verifyTag(root, 'v0.1.6'), '0.1.6');
    assert.throws(() => verifyTag(root, 'v0.2.0'), /does not match/);
    assert.throws(() => verifyTag(root, '0.1.6'), /does not match/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});