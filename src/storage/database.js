import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { parseImageFilename } from '../validation/filename.js';

const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

const clean = (record) => Object.fromEntries(Object.entries(record).filter(([, value]) => value !== null && value !== undefined));

export class LibraryDatabase {
  constructor(file) {
    mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.statements = new Map();
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    const version = this.db.prepare('PRAGMA user_version').get().user_version;
    if (version > 2) { this.db.close(); throw new Error(`Unsupported database version: ${version}`); }
    if (version === 0) this.db.exec(schema);
    if (version === 1) this.transaction(() => {
      this.db.exec('CREATE TABLE filename_markers (marker TEXT PRIMARY KEY, position INTEGER NOT NULL UNIQUE CHECK(position>=0)); PRAGMA user_version=2;');
    });
  }
  statement(sql) { if (!this.statements.has(sql)) this.statements.set(sql,this.db.prepare(sql)); return this.statements.get(sql); }
  all(sql, ...args) { return this.statement(sql).all(...args); }
  run(sql, ...args) { return this.statement(sql).run(...args); }
  meta(key, value) {
    if (value !== undefined) this.run('INSERT INTO metadata VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, String(value));
    return this.db.prepare('SELECT value FROM metadata WHERE key=?').get(key)?.value;
  }
  transaction(action) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const value = action(); this.db.exec('COMMIT'); return value; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  close() { this.db.close(); }
  episode(id) { this.run('INSERT OR IGNORE INTO episodes VALUES (?)', id); }
  variant(id, name) { this.episode(id); this.run('INSERT OR IGNORE INTO variants VALUES (?,?)', id, name); }
  token(id, token) { if (token != null) this.run('INSERT OR IGNORE INTO source_tokens VALUES (?,?)', id, token); }
  source(value) {
    if (!value) return null;
    this.run('INSERT OR IGNORE INTO sources(path) VALUES (?)', value);
    return this.db.prepare('SELECT id FROM sources WHERE path=?').get(value).id;
  }
  putRelations(scope, episode, relations) {
    for (const [source, target] of Object.entries(relations ?? {})) {
      this.variant(episode, source);
      if (target != null) this.variant(episode, target);
      this.run('INSERT INTO peek_relations VALUES (?,?,?,?)', scope, episode, source, target);
    }
  }
  writeLibrary(input, dataset = 'library') {
    this.run('DELETE FROM episode_records WHERE dataset=?', dataset);
    this.run('DELETE FROM warnings WHERE dataset=?', dataset);
    this.run('DELETE FROM peek_relations WHERE scope=?', dataset);
    this.meta(`${dataset}.generatedAt`, input.generatedAt ?? '');
    const warning = (item, scope, position, id = item.episodeId ?? null) => {
      if (id) this.episode(id);
      this.run('INSERT INTO warnings(dataset,episode_id,scope,position,details) VALUES (?,?,?,?,?)', dataset, id, scope, position, JSON.stringify(item));
    };
    (input.warnings ?? []).forEach((item, index) => warning(item, 'library', index));
    for (const [id, episode] of Object.entries(input.episodes ?? {})) {
      this.episode(id);
      this.run('INSERT INTO episode_records VALUES (?,?,?,?,?,?,?,?)', dataset, id, this.source(episode.source), episode.layout ?? null, episode.title ?? null, episode.date ?? null, episode.sourceKey ?? null, Number(Boolean(episode.missing)));
      for (const [name, pages] of Object.entries(episode.variants ?? {})) {
        this.variant(id, name);
        this.run('INSERT INTO scan_variants VALUES (?,?,?)', dataset, id, name);
        for (const page of new Set(pages)) this.run('INSERT INTO scan_pages VALUES (?,?,?,?)', dataset, id, name, page);
      }
      this.putRelations(dataset, id, episode.peekRelations);
      for (const [position, file] of (episode.files ?? []).entries()) {
        this.token(id, file.assignmentToken);
        const absolutePath = file.source && file.absolutePath === path.join(file.source, file.name) ? null : file.absolutePath ?? null;
        this.run('INSERT INTO images VALUES (?,?,?,?,?,?,?,?,?,?,?)', dataset, id, position, this.source(file.source), file.name, file.relativePath ?? null, absolutePath, file.assignmentToken ?? null, file.sourcePageNumber ?? null, file.variantSource ?? null, Number(Boolean(file.missing)));
        const parsed = parseImageFilename(file.name);
        const assignments = file.assignments ?? (file.variant ? [{ variant: file.variant, pageNumber: file.pageNumber }] : parsed?.variant ? [{variant:parsed.variant,pageNumber:parsed.pageNumber}] : []);
        for (const [order, assignment] of assignments.entries()) {
          this.variant(id, assignment.variant);
          this.run('INSERT INTO image_assignments VALUES (?,?,?,?,?,?)', dataset, id, position, assignment.variant, assignment.pageNumber, order);
        }
      }
      (episode.warnings ?? []).forEach((item, index) => warning(item, 'episode-warning', index, id));
      (episode.errors ?? []).forEach((item, index) => warning(item, 'episode-error', index, id));
    }
  }
  readLibrary(dataset = 'library') {
    const result = { generatedAt: this.meta(`${dataset}.generatedAt`) ?? '', episodes: {}, warnings: [] };
    for (const r of this.all('SELECT e.*,s.path source FROM episode_records e LEFT JOIN sources s ON s.id=e.source_id WHERE dataset=?', dataset)) {
      result.episodes[r.episode_id] = { ...clean({ source: r.source, layout: r.layout, title: r.title, date: r.date, sourceKey: r.source_key }), ...(r.missing ? { missing: true } : {}), files: [], variants: {}, peekRelations: {}, warnings: [], errors: [] };
    }
    for (const r of this.all('SELECT i.*,s.path source FROM images i LEFT JOIN sources s ON s.id=i.source_id WHERE dataset=? ORDER BY episode_id,position', dataset)) {
      result.episodes[r.episode_id].files.push({ ...clean({ name: r.name, relativePath: r.relative_path, absolutePath: r.absolute_path ?? (r.source ? path.join(r.source,r.name) : null), source: r.source, assignmentToken: r.token, sourcePageNumber: r.source_page, variantSource: r.variant_source }), ...(r.missing ? { missing: true } : {}), assignments: [] });
    }
    for (const r of this.all('SELECT * FROM image_assignments WHERE dataset=? ORDER BY position', dataset)) {
      const file = result.episodes[r.episode_id].files[r.image_position];
      file.assignments.push({ variant: r.variant, pageNumber: r.page });
      if (file.assignments.length === 1) { file.variant = r.variant; file.pageNumber = r.page; }
    }
    for (const r of this.all('SELECT * FROM scan_variants WHERE dataset=?', dataset)) result.episodes[r.episode_id].variants[r.variant] = [];
    for (const r of this.all('SELECT * FROM scan_pages WHERE dataset=? ORDER BY page', dataset)) result.episodes[r.episode_id].variants[r.variant].push(r.page);
    for (const r of this.all('SELECT * FROM peek_relations WHERE scope=?', dataset)) result.episodes[r.episode_id].peekRelations[r.source] = r.target;
    for (const r of this.all('SELECT * FROM warnings WHERE dataset=? ORDER BY position', dataset)) {
      const item = JSON.parse(r.details);
      if (r.scope === 'library') result.warnings.push(item);
      else result.episodes[r.episode_id][r.scope === 'episode-error' ? 'errors' : 'warnings'].push(item);
    }
    return result;
  }
  writeVariants(state) {
    this.run('DELETE FROM edited_episodes');
    this.run("DELETE FROM peek_relations WHERE scope='manual'");
    this.meta('variants.version', state.version);
    for (const [id, variants] of Object.entries(state.episodes ?? {})) {
      this.episode(id);
      this.run('INSERT INTO edited_episodes VALUES (?)', id);
      for (const [name, tokens] of Object.entries(variants)) {
        this.variant(id, name);
        this.run('INSERT INTO manual_variants VALUES (?,?)', id, name);
        for (const [index, token] of tokens.entries()) {
          this.token(id, token);
          this.run('INSERT INTO manual_assignments VALUES (?,?,?,?,?)', id, name, token, index, state.pageMappings?.[id]?.[name]?.[token] ?? null);
        }
      }
    }
    for (const [id, relations] of Object.entries(state.peekRelations ?? {})) this.putRelations('manual', id, relations);
  }
  readVariants() {
    const result = { version: Number(this.meta('variants.version') ?? 3), episodes: {}, peekRelations: {} };
    const mappings = {};
    for (const r of this.all('SELECT * FROM edited_episodes')) result.episodes[r.episode_id] = {};
    for (const r of this.all('SELECT * FROM manual_variants')) result.episodes[r.episode_id][r.variant] = [];
    for (const r of this.all('SELECT * FROM manual_assignments ORDER BY position')) {
      result.episodes[r.episode_id][r.variant].push(r.token);
      if (r.page != null) ((mappings[r.episode_id] ??= {})[r.variant] ??= {})[r.token] = r.page;
    }
    for (const r of this.all("SELECT * FROM peek_relations WHERE scope='manual'")) (result.peekRelations[r.episode_id] ??= {})[r.source] = r.target;
    if (Object.keys(mappings).length) result.pageMappings = mappings;
    return result;
  }
  readTags() {
    const categories = this.all('SELECT * FROM categories ORDER BY position').map(r => ({ id: r.id, name: r.name, emoji: r.emoji, ...(r.color ? { color: r.color } : {}), values: [] }));
    const byCategory = new Map(categories.map(c => [c.id, c]));
    const rows = this.all('SELECT * FROM tags ORDER BY position');
    const nodes = new Map(rows.map(r => [JSON.stringify([r.category_id,r.id]), { id: r.id, name: r.name, emoji: r.emoji, values: [] }]));
    for (const r of rows) {
      const parent = r.parent_id ? nodes.get(JSON.stringify([r.category_id,r.parent_id])) : byCategory.get(r.category_id);
      parent.values.push(nodes.get(JSON.stringify([r.category_id,r.id])));
    }
    const episodeTags = {};
    for (const r of this.all('SELECT * FROM episode_tags')) ((episodeTags[r.episode_id] ??= {})[r.category_id] ??= []).push(r.tag_id);
    return { version: 3, categories, episodeTags };
  }
  tagAssignments(table, ownerColumn, owner, tags) {
    for (const [category, values] of Object.entries(tags ?? {})) for (const value of values) {
      if (!this.statement('SELECT 1 FROM tags WHERE category_id=? AND id=?').get(category, value)) {
        this.run("INSERT OR IGNORE INTO categories VALUES (?,?,'',NULL,(SELECT COALESCE(MAX(position),-1)+1 FROM categories))",category,category);
        this.run("INSERT INTO tags VALUES (?,?,NULL,?,'',(SELECT COALESCE(MAX(position),-1)+1 FROM tags WHERE category_id=?))",category,value,value,category);
      }
      this.run(`INSERT OR IGNORE INTO ${table}(${ownerColumn},category_id,tag_id) VALUES (?,?,?)`, owner, category, value);
    }
  }
  writeTags(state) {
    const collectionTags = this.all('SELECT * FROM collection_tags');
    this.run('DELETE FROM categories');
    const walk = (category, values, parent = null) => {
      for (const [index, value] of values.entries()) {
        this.run('INSERT INTO tags VALUES (?,?,?,?,?,?)', category, value.id, parent, value.name ?? '', value.emoji ?? '', index);
        walk(category, value.values ?? [], value.id);
      }
    };
    for (const [index, category] of state.categories.entries()) {
      this.run('INSERT INTO categories VALUES (?,?,?,?,?)', category.id, category.name ?? '', category.emoji ?? '', category.color ?? null, index);
      walk(category.id, category.values ?? []);
    }
    for (const [id, tags] of Object.entries(state.episodeTags)) { this.episode(id); this.tagAssignments('episode_tags','episode_id',id,tags); }
    for (const r of collectionTags) {
      if (this.statement('SELECT 1 FROM tags WHERE category_id=? AND id=?').get(r.category_id,r.tag_id)) this.tagAssignments('collection_tags','collection_id',r.collection_id,{ [r.category_id]: [r.tag_id] });
    }
  }
  readThemes() {
    const themes = this.all('SELECT * FROM collections ORDER BY title').map(r => ({ id: r.id, title: r.title, episodes: [], tags: {} }));
    const byId = new Map(themes.map(r => [r.id,r]));
    for (const r of this.all('SELECT * FROM collection_episodes ORDER BY position')) byId.get(r.collection_id).episodes.push(r.episode_id);
    for (const r of this.all('SELECT * FROM collection_tags')) (byId.get(r.collection_id).tags[r.category_id] ??= []).push(r.tag_id);
    return themes.map(({ id, ...theme }) => theme);
  }
  writeTheme(theme) {
    this.run('INSERT OR IGNORE INTO collections(title) VALUES (?)', theme.title);
    const id = this.db.prepare('SELECT id FROM collections WHERE title=?').get(theme.title).id;
    this.run('DELETE FROM collection_episodes WHERE collection_id=?', id);
    this.run('DELETE FROM collection_tags WHERE collection_id=?', id);
    for (const [index, episode] of [...new Set(theme.episodes ?? [])].entries()) {
      this.episode(episode); this.run('INSERT INTO collection_episodes VALUES (?,?,?)', id, episode, index);
    }
    this.tagAssignments('collection_tags','collection_id',id,theme.tags);
  }
  writeRecognition(state) {
    this.run('DELETE FROM filename_markers');
    for (const [index, marker] of (state.identityMarkers ?? []).entries()) this.run('INSERT INTO filename_markers VALUES (?,?)', marker, index);
    this.run('DELETE FROM recognition_rules'); this.run('DELETE FROM episode_dates');
    for (const [index, r] of state.rules.entries()) this.run('INSERT INTO recognition_rules VALUES (?,?,?,?)',r.id,r.prefix,r.suffix,index);
    for (const [id,date] of Object.entries(state.episodeDates)) { this.episode(id); this.run('INSERT INTO episode_dates VALUES (?,?)',id,date); }
  }
  readRecognition() {
    return { version: 1, rules: this.all('SELECT id,prefix,suffix FROM recognition_rules ORDER BY position').map(r => ({...r})), episodeDates: Object.fromEntries(this.all('SELECT * FROM episode_dates').map(r => [r.episode_id,r.date])), identityMarkers: this.all('SELECT marker FROM filename_markers ORDER BY position').map(r => r.marker) };
  }
}

export function storageFor(file) {
  const database = path.resolve(file);
  return {
    read(kind) { return withDatabase(database, db => kind === 'library' ? db.readLibrary() : kind === 'tags' ? db.readTags() : kind === 'variants' ? db.readVariants() : kind === 'themes' ? db.readThemes() : kind === 'recognition' ? db.readRecognition() : db.meta('shared') ? { library: db.readLibrary('shared'), tags: db.readTags(), variants: db.readVariants() } : null); },
    write(kind, value) { return withDatabase(database, db => db.transaction(() => {
      if (kind === 'library') db.writeLibrary(value);
      if (kind === 'tags') db.writeTags(value);
      if (kind === 'variants') db.writeVariants(value);
      if (kind === 'theme') db.writeTheme(value);
      if (kind === 'recognition') db.writeRecognition(value);
      if (kind === 'shared') { db.writeLibrary(value.library,'shared'); db.meta('shared','1'); }
      return value;
    })); },
    renameTheme(current, next) { return withDatabase(database, db => db.transaction(() => { db.run('UPDATE collections SET title=? WHERE title=?',next,current); return db.readThemes().find(t => t.title===next); })); },
    deleteTheme(title) { return withDatabase(database, db => db.transaction(() => db.run('DELETE FROM collections WHERE title=?',title))); }
  };
}
export function withDatabase(file, action) { const db = new LibraryDatabase(file); try { return action(db); } finally { db.close(); } }
