PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS episodes (id TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS sources (id INTEGER PRIMARY KEY, path TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS episode_records (
 dataset TEXT NOT NULL CHECK(dataset IN ('library','shared')), episode_id TEXT NOT NULL REFERENCES episodes(id),
 source_id INTEGER REFERENCES sources(id), layout TEXT, title TEXT, date TEXT, source_key TEXT, missing INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(dataset,episode_id)
);
CREATE TABLE IF NOT EXISTS source_tokens (
 episode_id TEXT NOT NULL REFERENCES episodes(id), token TEXT NOT NULL, PRIMARY KEY(episode_id,token)
);
CREATE TABLE IF NOT EXISTS variants (
 episode_id TEXT NOT NULL REFERENCES episodes(id), name TEXT NOT NULL, PRIMARY KEY(episode_id,name)
);
CREATE TABLE IF NOT EXISTS images (
 dataset TEXT NOT NULL, episode_id TEXT NOT NULL, position INTEGER NOT NULL CHECK(position>=0),
 source_id INTEGER REFERENCES sources(id), name TEXT NOT NULL, relative_path TEXT, absolute_path TEXT,
 token TEXT, source_page INTEGER, variant_source TEXT, missing INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(dataset,episode_id,position),
 FOREIGN KEY(dataset,episode_id) REFERENCES episode_records(dataset,episode_id) ON DELETE CASCADE,
 FOREIGN KEY(episode_id,token) REFERENCES source_tokens(episode_id,token)
);
CREATE TABLE IF NOT EXISTS image_assignments (
 dataset TEXT NOT NULL, episode_id TEXT NOT NULL, image_position INTEGER NOT NULL, variant TEXT NOT NULL, page INTEGER NOT NULL CHECK(page>0), position INTEGER NOT NULL,
 PRIMARY KEY(dataset,episode_id,image_position,variant),
 FOREIGN KEY(dataset,episode_id,image_position) REFERENCES images(dataset,episode_id,position) ON DELETE CASCADE,
 FOREIGN KEY(episode_id,variant) REFERENCES variants(episode_id,name)
);
CREATE TABLE IF NOT EXISTS scan_variants (
 dataset TEXT NOT NULL, episode_id TEXT NOT NULL, variant TEXT NOT NULL,
 PRIMARY KEY(dataset,episode_id,variant),
 FOREIGN KEY(dataset,episode_id) REFERENCES episode_records(dataset,episode_id) ON DELETE CASCADE,
 FOREIGN KEY(episode_id,variant) REFERENCES variants(episode_id,name)
);
CREATE TABLE IF NOT EXISTS scan_pages (
 dataset TEXT NOT NULL, episode_id TEXT NOT NULL, variant TEXT NOT NULL, page INTEGER NOT NULL,
 PRIMARY KEY(dataset,episode_id,variant,page),
 FOREIGN KEY(dataset,episode_id,variant) REFERENCES scan_variants(dataset,episode_id,variant) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS peek_relations (
 scope TEXT NOT NULL CHECK(scope IN ('library','shared','manual')), episode_id TEXT NOT NULL, source TEXT NOT NULL, target TEXT,
 PRIMARY KEY(scope,episode_id,source), CHECK(target IS NULL OR target<>source),
 FOREIGN KEY(episode_id,source) REFERENCES variants(episode_id,name),
 FOREIGN KEY(episode_id,target) REFERENCES variants(episode_id,name)
);
CREATE TABLE IF NOT EXISTS edited_episodes (episode_id TEXT PRIMARY KEY REFERENCES episodes(id));
CREATE TABLE IF NOT EXISTS manual_variants (
 episode_id TEXT NOT NULL REFERENCES edited_episodes(episode_id) ON DELETE CASCADE, variant TEXT NOT NULL,
 PRIMARY KEY(episode_id,variant), FOREIGN KEY(episode_id,variant) REFERENCES variants(episode_id,name)
);
CREATE TABLE IF NOT EXISTS manual_assignments (
 episode_id TEXT NOT NULL, variant TEXT NOT NULL, token TEXT NOT NULL, position INTEGER NOT NULL CHECK(position>=0), page INTEGER CHECK(page>0),
 PRIMARY KEY(episode_id,variant,token), UNIQUE(episode_id,variant,position),
 FOREIGN KEY(episode_id,variant) REFERENCES manual_variants(episode_id,variant) ON DELETE CASCADE,
 FOREIGN KEY(episode_id,token) REFERENCES source_tokens(episode_id,token)
);
CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY, name TEXT NOT NULL, emoji TEXT NOT NULL, color TEXT, position INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS tags (
 category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE, id TEXT NOT NULL, parent_id TEXT, name TEXT NOT NULL, emoji TEXT NOT NULL, position INTEGER NOT NULL,
 PRIMARY KEY(category_id,id), CHECK(parent_id IS NULL OR parent_id<>id),
 FOREIGN KEY(category_id,parent_id) REFERENCES tags(category_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE IF NOT EXISTS collections (id INTEGER PRIMARY KEY, title TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS collection_episodes (
 collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE, episode_id TEXT NOT NULL REFERENCES episodes(id), position INTEGER NOT NULL CHECK(position>=0),
 PRIMARY KEY(collection_id,episode_id), UNIQUE(collection_id,position)
);
CREATE TABLE IF NOT EXISTS episode_tags (
 episode_id TEXT NOT NULL REFERENCES episodes(id), category_id TEXT NOT NULL, tag_id TEXT NOT NULL,
 PRIMARY KEY(episode_id,category_id,tag_id), FOREIGN KEY(category_id,tag_id) REFERENCES tags(category_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS collection_tags (
 collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE, category_id TEXT NOT NULL, tag_id TEXT NOT NULL,
 PRIMARY KEY(collection_id,category_id,tag_id), FOREIGN KEY(category_id,tag_id) REFERENCES tags(category_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS recognition_rules (id TEXT PRIMARY KEY, prefix TEXT NOT NULL, suffix TEXT NOT NULL, position INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS filename_markers (marker TEXT PRIMARY KEY, position INTEGER NOT NULL UNIQUE CHECK(position>=0));
CREATE TABLE IF NOT EXISTS episode_dates (episode_id TEXT PRIMARY KEY REFERENCES episodes(id), date TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS warnings (
 id INTEGER PRIMARY KEY, dataset TEXT NOT NULL, episode_id TEXT REFERENCES episodes(id), scope TEXT NOT NULL, position INTEGER NOT NULL,
 details TEXT NOT NULL CHECK(json_valid(details))
);
CREATE INDEX IF NOT EXISTS collection_episode_lookup ON collection_episodes(episode_id);
CREATE INDEX IF NOT EXISTS tag_parent_lookup ON tags(category_id,parent_id,position);
CREATE INDEX IF NOT EXISTS episode_tag_lookup ON episode_tags(category_id,tag_id);
CREATE INDEX IF NOT EXISTS collection_tag_lookup ON collection_tags(category_id,tag_id);
CREATE INDEX IF NOT EXISTS image_variant_pages ON image_assignments(episode_id,variant,page);
CREATE INDEX IF NOT EXISTS record_dates ON episode_records(dataset,date);
CREATE TRIGGER IF NOT EXISTS tags_no_cycle_insert BEFORE INSERT ON tags WHEN NEW.parent_id IS NOT NULL BEGIN
 SELECT RAISE(ABORT,'Tag hierarchy cycle') WHERE EXISTS (
  WITH RECURSIVE ancestors(id) AS (SELECT NEW.parent_id UNION SELECT t.parent_id FROM tags t JOIN ancestors a ON t.id=a.id WHERE t.category_id=NEW.category_id AND t.parent_id IS NOT NULL)
  SELECT 1 FROM ancestors WHERE id=NEW.id
 );
END;
CREATE TRIGGER IF NOT EXISTS tags_no_cycle_update BEFORE UPDATE OF parent_id,category_id ON tags WHEN NEW.parent_id IS NOT NULL BEGIN
 SELECT RAISE(ABORT,'Tag hierarchy cycle') WHERE EXISTS (
  WITH RECURSIVE ancestors(id) AS (SELECT NEW.parent_id UNION SELECT t.parent_id FROM tags t JOIN ancestors a ON t.id=a.id WHERE t.category_id=NEW.category_id AND t.parent_id IS NOT NULL)
  SELECT 1 FROM ancestors WHERE id=NEW.id
 );
END;
PRAGMA user_version = 2;
