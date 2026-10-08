import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { schema, saveCatalog, loadCatalog } from './catalog.js';
import { pagesOpfsDirectory, pagesOpfsPoolName } from '../../../../public/pages-assets-db.js';

function openDatabase(base) {
  return (ready ??= (async () => {
    const sqlite3 = await sqlite3InitModule();
    const pool = await sqlite3.installOpfsSAHPoolVfs({ name: pagesOpfsPoolName(base), directory: pagesOpfsDirectory(base) });
    const db = new pool.OpfsSAHPoolDb('/library.sqlite');
    db.exec(schema);
    return db;
  })());
}
let ready;

let queue = Promise.resolve();
self.onmessage = ({ data: { id, operation, state, base = '/' } }) => {
  queue = queue.then(async () => {
    try {
      const db = await openDatabase(base);
      if (operation === 'save') saveCatalog(db, state);
      self.postMessage({ id, result: loadCatalog(db) });
    } catch { self.postMessage({ id, error: 'pagesStorageError' }); }
  });
};
