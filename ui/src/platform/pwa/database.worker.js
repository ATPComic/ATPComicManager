import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { schema, saveCatalog, loadCatalog } from './catalog.js';

const ready = (async () => {
  const sqlite3 = await sqlite3InitModule();
  const pool = await sqlite3.installOpfsSAHPoolVfs({ name: 'atp-pages-v1', directory: '/atp-comic-pages-v1' });
  const db = new pool.OpfsSAHPoolDb('/library.sqlite');
  db.exec(schema);
  return db;
})();
let queue = Promise.resolve();
self.onmessage = ({ data: { id, operation, state } }) => {
  queue = queue.then(async () => {
    try {
      const db = await ready;
      if (operation === 'save') saveCatalog(db, state);
      self.postMessage({ id, result: loadCatalog(db) });
    } catch { self.postMessage({ id, error: 'pagesStorageError' }); }
  });
};
