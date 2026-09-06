import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

// Validate the actual SQL used by Android, even when no emulator is attached.
test('Android catalog SQL prepares and enforces episode ownership', () => {
  const source = readFileSync(new URL('../android/app/src/main/java/io/github/atpcomic/manager/LibraryDatabase.java',import.meta.url),'utf8');
  const statements = [...source.matchAll(/db\.execSQL\("([^"]+)"/g)].map(match=>match[1]);
  const db = new DatabaseSync(':memory:');
  try {
    for (const sql of statements.filter(sql=>sql.startsWith('CREATE '))) db.exec(sql);
    for (const sql of statements.filter(sql=>!sql.startsWith('CREATE '))) db.prepare(sql);
    db.exec("INSERT INTO episodes VALUES ('one','One',NULL,'android-reading'); INSERT INTO episodes VALUES ('two','Two',NULL,'android-reading'); INSERT INTO variants VALUES ('two','b'); INSERT INTO images VALUES ('one',0,'1.png','001/1.png','content://image',0);");
    assert.throws(()=>db.exec("INSERT INTO image_assignments VALUES ('one',0,'b',1,0)"), /FOREIGN KEY/);
    db.exec("INSERT INTO variants VALUES ('one','a'); INSERT INTO image_assignments VALUES ('one',0,'a',1,0);");
    assert.equal(db.prepare('SELECT page FROM image_assignments').get().page,1);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  } finally {db.close();}
});
