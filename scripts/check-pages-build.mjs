import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

const root = resolve('dist-pages');
const base = '/ATPComicManager/';
for (const page of ['index.html', 'privacy/index.html', 'tags.html', 'variants.html', 'warnings.html']) {
  const html = await readFile(resolve(root, page), 'utf8');
  for (const [, url] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    if (/^(https?:|data:|#)/.test(url)) continue;
    assert.ok(url.startsWith(base), `${page}: unexpected asset base ${url}`);
    const file = resolve(root, url.slice(base.length));
    assert.ok(file.startsWith(root + sep), `Asset escapes build: ${url}`);
    assert.ok((await stat(file)).isFile(), `Missing asset: ${url}`);
  }
  // The upload-leak guarantee depends on this policy surviving the build.
  const policy = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
  assert.ok(policy, `${page}: missing Content-Security-Policy meta`);
  for (const directive of ["default-src 'self'", "connect-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'none'"]) {
    assert.ok(policy[1].includes(directive), `${page}: Content-Security-Policy is missing ${directive}`);
  }
  assert.doesNotMatch(html, /\bsrc="https?:\/\//, `${page}: loads an external resource`);
}
const manifest = JSON.parse(await readFile(resolve(root, 'manifest.webmanifest'), 'utf8'));
assert.equal(manifest.start_url, base);
assert.equal(manifest.scope, base);
assert.ok((await readdir(resolve(root, 'assets'))).some(file => file.endsWith('.wasm')), 'SQLite WASM is missing');
for (const file of ['sw.js', 'favicon.svg', 'icon-192.png', 'icon-512.png', 'manifest.webmanifest', 'missing-image.svg']) assert.ok((await stat(resolve(root, file))).size > 0);
console.log('Pages routes, asset paths, manifest, CSP and SQLite WASM verified.');
