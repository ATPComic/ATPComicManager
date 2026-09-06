package io.github.atpcomic.manager;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;

/** The phone stores its imported reading catalog, not a second JSON snapshot. */
public final class LibraryDatabase extends SQLiteOpenHelper {
    public LibraryDatabase(Context context) { super(context, "library.sqlite", null, 1); }
    @Override public void onConfigure(SQLiteDatabase db) { db.setForeignKeyConstraintsEnabled(true); }
    @Override public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL)");
        db.execSQL("CREATE TABLE episodes(id TEXT PRIMARY KEY,title TEXT NOT NULL,date TEXT,layout TEXT)");
        db.execSQL("CREATE TABLE variants(episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,name TEXT NOT NULL,PRIMARY KEY(episode_id,name))");
        db.execSQL("CREATE TABLE images(episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,position INTEGER NOT NULL CHECK(position>=0),name TEXT NOT NULL,relative_path TEXT,uri TEXT,missing INTEGER NOT NULL,PRIMARY KEY(episode_id,position))");
        db.execSQL("CREATE TABLE image_assignments(episode_id TEXT NOT NULL,image_position INTEGER NOT NULL,variant TEXT NOT NULL,page INTEGER NOT NULL CHECK(page>0),position INTEGER NOT NULL,PRIMARY KEY(episode_id,image_position,variant),FOREIGN KEY(episode_id,image_position) REFERENCES images(episode_id,position) ON DELETE CASCADE,FOREIGN KEY(episode_id,variant) REFERENCES variants(episode_id,name) ON DELETE CASCADE)");
        db.execSQL("CREATE TABLE peek_relations(episode_id TEXT NOT NULL,source TEXT NOT NULL,target TEXT,PRIMARY KEY(episode_id,source),CHECK(target IS NULL OR source<>target),FOREIGN KEY(episode_id,source) REFERENCES variants(episode_id,name) ON DELETE CASCADE,FOREIGN KEY(episode_id,target) REFERENCES variants(episode_id,name) ON DELETE CASCADE)");
        db.execSQL("CREATE TABLE collections(id INTEGER PRIMARY KEY,title TEXT NOT NULL UNIQUE)");
        db.execSQL("CREATE TABLE collection_episodes(collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,position INTEGER NOT NULL,PRIMARY KEY(collection_id,episode_id),UNIQUE(collection_id,position))");
        db.execSQL("CREATE TABLE warnings(id INTEGER PRIMARY KEY,episode_id TEXT REFERENCES episodes(id) ON DELETE CASCADE,details TEXT NOT NULL)");
        db.execSQL("CREATE INDEX collection_episode_lookup ON collection_episodes(episode_id)");
        db.execSQL("CREATE INDEX variant_pages ON image_assignments(episode_id,variant,page)");
    }
    @Override public void onUpgrade(SQLiteDatabase db,int oldVersion,int newVersion) { throw new IllegalStateException("Unsupported database upgrade"); }
    public String rootUri() {
        try (Cursor cursor = getReadableDatabase().rawQuery("SELECT value FROM metadata WHERE key='root-uri'", null)) {
            return cursor.moveToFirst() ? cursor.getString(0) : null;
        }
    }
    private static String optional(JSONObject object,String key) { return object.isNull(key) ? null : object.optString(key,null); }
    public void replace(JSObject state,String uri) throws Exception {
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            db.execSQL("DELETE FROM collections");
            db.execSQL("DELETE FROM warnings");
            db.execSQL("DELETE FROM episodes");
            db.execSQL("DELETE FROM metadata");
            JSONObject library = state.getJSONObject("library");
            JSONObject episodes = library.getJSONObject("episodes");
            Iterator<String> ids = episodes.keys();
            while (ids.hasNext()) {
                String id = ids.next();
                JSONObject episode = episodes.getJSONObject(id);
                db.execSQL("INSERT INTO episodes VALUES (?,?,?,?)",new Object[]{id,episode.optString("title",id),optional(episode,"date"),episode.optString("layout","android-reading")});
                JSONObject variants = episode.optJSONObject("variants");
                if (variants != null) {
                    Iterator<String> names = variants.keys();
                    while(names.hasNext()) db.execSQL("INSERT OR IGNORE INTO variants VALUES (?,?)",new Object[]{id,names.next()});
                }
                JSONArray files = episode.getJSONArray("files");
                for(int i=0;i<files.length();i++) {
                    JSONObject file = files.getJSONObject(i);
                    db.execSQL("INSERT INTO images VALUES (?,?,?,?,?,?)",new Object[]{id,i,file.optString("name"),optional(file,"relativePath"),optional(file,"androidUri"),file.optBoolean("missing") ? 1 : 0});
                    JSONArray assignments = file.optJSONArray("assignments");
                    if(assignments == null) continue;
                    for(int j=0;j<assignments.length();j++) {
                        JSONObject assignment = assignments.getJSONObject(j);
                        String variant = assignment.getString("variant");
                        db.execSQL("INSERT OR IGNORE INTO variants VALUES (?,?)",new Object[]{id,variant});
                        db.execSQL("INSERT INTO image_assignments VALUES (?,?,?,?,?)",new Object[]{id,i,variant,assignment.getInt("pageNumber"),j});
                    }
                }
                JSONObject relations = episode.optJSONObject("peekRelations");
                if(relations != null) {
                    Iterator<String> sources = relations.keys();
                    while(sources.hasNext()) {
                        String source = sources.next(); String target = optional(relations,source);
                        db.execSQL("INSERT OR IGNORE INTO variants VALUES (?,?)",new Object[]{id,source});
                        if(target != null) db.execSQL("INSERT OR IGNORE INTO variants VALUES (?,?)",new Object[]{id,target});
                        db.execSQL("INSERT INTO peek_relations VALUES (?,?,?)",new Object[]{id,source,target});
                    }
                }
            }
            JSONArray themes = state.getJSONArray("themes");
            for(int i=0;i<themes.length();i++) {
                JSONObject theme = themes.getJSONObject(i);
                db.execSQL("INSERT INTO collections VALUES (?,?)",new Object[]{i,theme.getString("title")});
                JSONArray members = theme.getJSONArray("episodes");
                for(int j=0;j<members.length();j++) db.execSQL("INSERT OR IGNORE INTO collection_episodes VALUES (?,?,?)",new Object[]{i,members.getString(j),j});
            }
            JSONArray warnings = library.optJSONArray("warnings");
            if(warnings != null) for(int i=0;i<warnings.length();i++) {
                JSONObject warning = warnings.getJSONObject(i);
                db.execSQL("INSERT INTO warnings(episode_id,details) VALUES (?,?)",new Object[]{optional(warning,"episodeId"),warning.toString()});
            }
            db.execSQL("INSERT INTO metadata VALUES ('root-uri',?)",new Object[]{uri});
            db.execSQL("INSERT INTO metadata VALUES ('location',?)",new Object[]{state.optString("locationName","Reading")});
            db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
    }
    public JSObject read(JSObject state) throws Exception {
        SQLiteDatabase db = getReadableDatabase();
        JSObject library = (JSObject) state.get("library");
        JSObject episodes = new JSObject();
        try(Cursor c=db.rawQuery("SELECT * FROM episodes",null)) {
            while(c.moveToNext()) {
                JSObject episode = new JSObject();
                episode.put("title",c.getString(1)); episode.put("date",c.isNull(2)?JSONObject.NULL:c.getString(2)); episode.put("layout",c.getString(3));
                episode.put("files",new JSArray()); episode.put("variants",new JSObject()); episode.put("peekRelations",new JSObject());
                episode.put("warnings",new JSArray()); episode.put("errors",new JSArray());
                episodes.put(c.getString(0),episode);
            }
        }
        try(Cursor c=db.rawQuery("SELECT * FROM variants",null)) {
            while(c.moveToNext()) episodes.getJSONObject(c.getString(0)).getJSONObject("variants").put(c.getString(1),new JSArray());
        }
        try(Cursor c=db.rawQuery("SELECT * FROM images ORDER BY episode_id,position",null)) {
            while(c.moveToNext()) {
                JSObject file = new JSObject(); file.put("name",c.getString(2)); file.put("relativePath",c.getString(3));
                if(!c.isNull(4)) file.put("androidUri",c.getString(4));
                file.put("missing",c.getInt(5)!=0); file.put("assignments",new JSArray());
                episodes.getJSONObject(c.getString(0)).getJSONArray("files").put(file);
            }
        }
        try(Cursor c=db.rawQuery("SELECT * FROM image_assignments ORDER BY position",null)) {
            while(c.moveToNext()) {
                JSONObject episode = episodes.getJSONObject(c.getString(0));
                JSObject assignment = new JSObject(); assignment.put("variant",c.getString(2)); assignment.put("pageNumber",c.getInt(3));
                episode.getJSONArray("files").getJSONObject(c.getInt(1)).getJSONArray("assignments").put(assignment);
                episode.getJSONObject("variants").getJSONArray(c.getString(2)).put(c.getInt(3));
            }
        }
        try(Cursor c=db.rawQuery("SELECT * FROM peek_relations",null)) {
            while(c.moveToNext()) episodes.getJSONObject(c.getString(0)).getJSONObject("peekRelations").put(c.getString(1),c.isNull(2)?JSONObject.NULL:c.getString(2));
        }
        JSArray themes = new JSArray(); Map<Integer,JSObject> byId = new LinkedHashMap<>();
        try(Cursor c=db.rawQuery("SELECT * FROM collections ORDER BY id",null)) {
            while(c.moveToNext()) { JSObject theme = new JSObject(); theme.put("title",c.getString(1));theme.put("episodes",new JSArray());theme.put("tags",new JSObject());byId.put(c.getInt(0),theme);themes.put(theme); }
        }
        try(Cursor c=db.rawQuery("SELECT * FROM collection_episodes ORDER BY position",null)) {
            while(c.moveToNext()) byId.get(c.getInt(0)).getJSONArray("episodes").put(c.getString(1));
        }
        JSArray warnings = new JSArray();
        try(Cursor c=db.rawQuery("SELECT details FROM warnings ORDER BY id",null)) { while(c.moveToNext()) warnings.put(new JSONObject(c.getString(0))); }
        library.put("episodes",episodes);library.put("warnings",warnings);state.put("themes",themes);state.put("initialized",true);
        try(Cursor c=db.rawQuery("SELECT value FROM metadata WHERE key='location'",null)) {
            if(c.moveToFirst()) {state.put("locationName",c.getString(0));state.getJSONObject("runtime").put("workspaceRoot",c.getString(0));}
        }
        return state;
    }
}
