import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { parseImageFilename, parseUndatedImageFilename } from '../src/validation/filename.js';
import { loadRecognitionState, saveRecognitionState, normalizeRecognitionState } from '../src/recognition-store.js';
import { LibraryDatabase } from '../src/storage/database.js';
import { startServer } from '../src/server.js';
import { resolveWorkspaceConfig } from '../src/utils/cli.js';

test('filename markers have no built-in words and match case-insensitive whole segments', () => {
  for (const word of ['noEffect','no_effects','clean']) {
    assert.equal(parseImageFilename(`20260101_${word}_a1.png`).variant,'a');
    const marked = parseImageFilename(`20260101_${word}_a1.png`,[word.toUpperCase()]);
    assert.equal(marked.variant,null);
    assert.equal(marked.assignmentToken,`a1_${word.toLowerCase()}`);
  }
  assert.equal(parseImageFilename('20260101_unclean_a1.png',['clean']).variant,'a');
  assert.equal(parseImageFilename('20260101_a1_x.png',['x']).variant,null);
  assert.equal(parseImageFilename('20260101_a1_x.png',['x']).assignmentToken,'a1_x');
  assert.equal(parseUndatedImageFilename('clean_001.png',['clean']).assignmentToken,'001_clean');
  assert.equal(parseImageFilename('20260101_alt_clean_a1.png',['clean','alt']).assignmentToken,
    parseImageFilename('20260101_alt_clean_a1.png',['alt','CLEAN','alt']).assignmentToken);
});

test('recognition markers normalize, persist, and can be removed without losing dates or folder rules', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'atp-markers-db-'));
  const file = path.join(root,'library.sqlite');
  const input = {rules:[{id:'sets',prefix:'Set-',suffix:''}],episodeDates:{'folder:Set-One':'2026-01-01'},identityMarkers:[' Clean ','clean','alt_version','']};
  const saved = await saveRecognitionState(file,input);
  assert.deepEqual(saved.identityMarkers,['clean','alt_version']);
  assert.deepEqual(await loadRecognitionState(file),saved);
  await saveRecognitionState(file,{...saved,identityMarkers:[]});
  assert.deepEqual(await loadRecognitionState(file),{...saved,identityMarkers:[]});
  for (const identityMarkers of [['.*'],['two words'],['a'.repeat(65)],'clean']) {
    assert.throws(()=>normalizeRecognitionState({identityMarkers}));
  }
});

test('version one databases gain an empty marker table without changing existing data', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'atp-markers-upgrade-'));
  const file = path.join(root,'library.sqlite');
  const previous = new LibraryDatabase(file);
  previous.meta('keep','value');
  previous.db.exec('DROP TABLE filename_markers; PRAGMA user_version=1;');
  previous.close();
  const upgraded = new LibraryDatabase(file);
  try {
    assert.equal(upgraded.meta('keep'),'value');
    assert.deepEqual(upgraded.readRecognition().identityMarkers,[]);
    assert.equal(upgraded.all('PRAGMA user_version')[0].user_version,2);
  } finally {upgraded.close();}
});

test('recognition API persists markers, rescans each folder layout, and keeps manual assignments', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'atp-markers-api-'));
  for (const [directory,name] of [['20260101','20260101_clean_a1.png'],['202602','20260201_clean_a1.png'],['Set-One','clean_001.png']]) {
    await fs.mkdir(path.join(root,'Archive',directory),{recursive:true});
    await fs.writeFile(path.join(root,'Archive',directory,name),'fixture');
  }
  const config = await resolveWorkspaceConfig({workspace:root,host:'127.0.0.1',port:0});
  const server = await startServer(config);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const put = (route,value) => fetch(base+route,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(value)});
    const recognition = {rules:[{id:'sets',prefix:'Set-',suffix:''}],episodeDates:{},identityMarkers:['Clean']};
    const saved = await put('/api/recognition',recognition);
    assert.equal(saved.status,200);
    const {library} = await saved.json();
    for (const id of ['20260101','20260201']) {
      assert.equal(library.episodes[id].files[0].assignmentToken,'a1_clean');
      assert.deepEqual(library.episodes[id].files[0].assignments,[]);
    }
    assert.equal(library.episodes['folder:Archive/Set-One'].files[0].assignmentToken,'001_clean');
    assert.deepEqual((await loadRecognitionState(config.databasePath)).identityMarkers,['clean']);
    const assigned = await put('/api/variants',{version:3,episodes:{'20260101':{b:['a1_clean']}}});
    assert.equal(assigned.status,200);
    const rescan = await put('/api/recognition',recognition);
    assert.deepEqual((await rescan.json()).library.episodes['20260101'].files[0].assignments,[{variant:'b',pageNumber:1}]);
    const removed = await put('/api/recognition',{...recognition,identityMarkers:[]});
    assert.equal((await removed.json()).library.episodes['20260201'].files[0].variant,'a');
    const db = new DatabaseSync(config.databasePath);
    try {assert.equal(db.prepare('SELECT COUNT(*) AS count FROM filename_markers').get().count,0);} finally {db.close();}
  } finally {
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
  }
});
