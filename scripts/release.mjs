import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)$/;
const VERSION_LINE = /^(\s*)"version": "[^"]+",$/gm;

export function parseVersion(value) {
  const match = VERSION_PATTERN.exec(String(value ?? '').trim());
  return match ? `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}` : null;
}

export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) throw new Error(`Invalid version: ${!a ? left : right}`);
  const [aMajor, aMinor, aPatch] = a.split('.').map(Number);
  const [bMajor, bMinor, bPatch] = b.split('.').map(Number);
  return aMajor - bMajor || aMinor - bMinor || aPatch - bPatch;
}

export function repositorySlug(remoteUrl) {
  const match = String(remoteUrl ?? '').trim().match(/[:/]([^/:]+)\/([^/]+?)(?:\.git)?$/);
  return match ? `${match[1]}/${match[2]}` : null;
}

function read(file) {
  return readFileSync(file, 'utf8');
}

function replaceVersionLines(content, version, limit) {
  let replaced = 0;
  const next = content.replace(VERSION_LINE, (line, indent) => {
    if (replaced >= limit) return line;
    replaced++;
    return `${indent}"version": "${version}",`;
  });
  return { next, replaced };
}

function bumpGradle(content, version) {
  const name = content.match(/versionName\s+"([^"]*)"/);
  const code = content.match(/versionCode\s+(\d+)/);
  if (!name || !code) throw new Error('android/app/build.gradle: versionName or versionCode not found');
  return {
    previousName: name[1],
    previousCode: Number(code[1]),
    next: content.replace(/versionName\s+"[^"]*"/, `versionName "${version}"`).replace(/versionCode\s+\d+/, `versionCode ${Number(code[1]) + 1}`)
  };
}

export function applyRelease(root, input, { write = true } = {}) {
  const version = parseVersion(input);
  if (!version) throw new Error(`Invalid version "${input}"; expected X.Y.Z`);
  const packagePath = path.join(root, 'package.json');
  const lockPath = path.join(root, 'package-lock.json');
  const gradlePath = path.join(root, 'android', 'app', 'build.gradle');

  const current = parseVersion(JSON.parse(read(packagePath)).version);
  if (!current) throw new Error('package.json has an invalid version');
  if (compareVersions(version, current) <= 0) throw new Error(`New version ${version} must be greater than ${current}`);

  const packageEdit = replaceVersionLines(read(packagePath), version, 1);
  if (packageEdit.replaced !== 1) throw new Error('package.json: version field not found');
  const lockEdit = replaceVersionLines(read(lockPath), version, 2);
  if (lockEdit.replaced !== 2) throw new Error('package-lock.json: expected the root and packages[""] versions');
  const gradle = bumpGradle(read(gradlePath), version);

  const nextPackage = JSON.parse(packageEdit.next);
  const nextLock = JSON.parse(lockEdit.next);
  if (nextPackage.version !== version || nextLock.version !== version || nextLock.packages?.['']?.version !== version) {
    throw new Error('Version rewrite failed its own check');
  }

  if (write) {
    writeFileSync(packagePath, packageEdit.next);
    writeFileSync(lockPath, lockEdit.next);
    writeFileSync(gradlePath, gradle.next);
  }

  return {
    from: current,
    to: version,
    files: ['package.json', 'package-lock.json', 'android/app/build.gradle'],
    android: { versionName: { from: gradle.previousName, to: version }, versionCode: { from: gradle.previousCode, to: gradle.previousCode + 1 } }
  };
}

export function verifyTag(root, tag) {
  const version = JSON.parse(read(path.join(root, 'package.json'))).version;
  if (String(tag ?? '').trim() !== `v${version}`) throw new Error(`Release tag "${tag}" does not match package.json version ${version}`);
  return version;
}

function repository(root) {
  try {
    return repositorySlug(execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: root, encoding: 'utf8' }));
  } catch {
    return null;
  }
}

function printSummary(result, dryRun) {
  const { from, to, android } = result;
  console.log(`${dryRun ? '[dry run] ' : ''}Release version ${from} -> ${to}`);
  console.log(`  package.json, package-lock.json, android/app/build.gradle (versionName ${android.versionName.from} -> ${to}, versionCode ${android.versionCode.from} -> ${android.versionCode.to})`);
  console.log('');
  console.log('Next steps:');
  console.log(`  git switch -c chore/release-v${to}`);
  console.log('  git add package.json package-lock.json android/app/build.gradle');
  console.log(`  git commit -m "chore(release): prepare v${to}"`);
  console.log(`  git push -u origin chore/release-v${to}`);
  const slug = repository(projectRoot);
  const repoFlag = slug ? ` --repo ${slug}` : '';
  console.log(`  gh pr create${repoFlag} --base main --head chore/release-v${to} --title "chore(release): prepare v${to}" --body "..."`);
  console.log('');
  console.log('After the PR is merged:');
  console.log('  git switch main && git pull --ff-only');
  console.log(`  git tag -a v${to} -m "ATP Comic v${to}"`);
  console.log(`  git push origin v${to}`);
}

async function main(argv) {
  const [command, ...rest] = argv;
  if (command === '--verify') {
    const version = verifyTag(projectRoot, rest[0]);
    console.log(`Release tag matches package.json version ${version}.`);
    return;
  }
  const dryRun = command === '--dry-run';
  const version = dryRun ? rest[0] : command;
  if (!version) throw new Error('Usage: node scripts/release.mjs <version> | --dry-run <version> | --verify <tag>');
  printSummary(applyRelease(projectRoot, version, { write: !dryRun }), dryRun);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}