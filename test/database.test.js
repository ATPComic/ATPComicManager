import test from 'node:test';
import { normalizeTagState } from '../src/tag-store.js';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { LibraryDatabase, storageFor } from '../src/storage/database.js';
import { initializeStorage } from '../src/storage/initialize.js';
import { resolveWorkspaceConfig } from '../src/utils/cli.js';

test('SQLite persists its workspace and preserves relations and explicit empty variants', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'atp-sqlite-'));
  const config = await resolveWorkspaceConfig({workspace:root});
  await initializeStorage(config);
  const storage = storageFor(config.databasePath);
  const episode = '20260906';
  const source = path.join(root,'Archive',episode);
  const files = [{name:'page.png',absolutePath:path.join(source,'page.png'),source,relativePath:'20260906/page.png',assignmentToken:'1',sourcePageNumber:1,assignments:[{variant:'a',pageNumber:1}]}];
  storage.write('library',{episodes:{[episode]:{title:'Title',date:'2026-09-06',layout:'rule-folder',source,files,variants:{a:[1],b:[]},peekRelations:{a:null}}},warnings:[]});
  storage.write('tags', normalizeTagState({categories:[{id:'cat',name:'Category',values:[{id:'parent',name:'Parent',values:[{id:'child',name:'Child'}]}]}],episodeTags:{[episode]:{cat:['child']}}}));
  storage.write('variants',{version:4,episodes:{[episode]:{a:['1'],b:[]}},pageMappings:{[episode]:{a:{'1':7}}},peekRelations:{[episode]:{a:null}}});
  storage.write('theme',{title:'Main',episodes:[episode],tags:{cat:['parent']}});
  await initializeStorage(config);
  assert.equal(storage.read('library').episodes[episode].files[0].absolutePath,path.join(source,'page.png'));
  assert.deepEqual(storage.read('variants').episodes[episode].b,[]);
  assert.equal(storage.read('variants').pageMappings[episode].a['1'],7);
  assert.equal(storage.read('tags').categories[0].values[0].values[0].id,'child');
  assert.deepEqual(storage.read('themes')[0].tags,{cat:['parent']});
  storage.renameTheme('Main','Renamed');
  assert.deepEqual(storage.read('themes')[0].episodes,[episode]);
  storage.deleteTheme('Renamed');
  assert.equal(storage.read('library').episodes[episode].files.length,1);
  await fs.writeFile(path.join(root,'library.json'),'{}');
  await initializeStorage(config);
  assert.equal(storage.read('library').episodes[episode].title,'Title');
  const database = new LibraryDatabase(config.databasePath);
  assert.deepEqual(database.all('PRAGMA foreign_key_check'),[]);
  assert.equal(database.all('PRAGMA integrity_check')[0].integrity_check,'ok');
  database.close();
});

test('foreign keys reject cross-episode page assignments and failed writes roll back', () => {
  const db = new LibraryDatabase(':memory:');
  try {
    db.transaction(() => db.writeLibrary({episodes:{one:{files:[{name:'x.png',assignments:[]}],variants:{a:[]}},two:{files:[],variants:{b:[]}}},warnings:[]}));
    assert.throws(()=>db.transaction(()=>db.run("INSERT INTO image_assignments VALUES ('library','one',0,'b',1,0)")), /FOREIGN KEY/);
    assert.throws(()=>db.transaction(()=>{ db.run("DELETE FROM episode_records WHERE episode_id='one'"); throw new Error('rollback'); }),/rollback/);
    assert.equal(db.readLibrary().episodes.one.files.length,1);
    assert.deepEqual(db.all('PRAGMA foreign_key_check'),[]);
    db.transaction(()=>db.writeTags({categories:[{id:'c',name:'C',values:[{id:'a',name:'A',values:[{id:'b',name:'B',values:[]}]}]}],episodeTags:{}}));
    assert.throws(()=>db.transaction(()=>db.run("UPDATE tags SET parent_id='b' WHERE category_id='c' AND id='a'")), /hierarchy cycle/);
  } finally {db.close();}
});

test('retired JSON state is ignored, even when damaged', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'atp-no-json-'));
  await fs.writeFile(path.join(root,'library.json'),'{broken');
  const config = await resolveWorkspaceConfig({workspace:root});
  await initializeStorage(config);
  assert.deepEqual(storageFor(config.databasePath).read('library').episodes,{});
  assert.equal(await fs.readFile(path.join(root,'library.json'),'utf8'),'{broken');
});
