package io.github.atpcomic.manager;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
import androidx.documentfile.provider.DocumentFile;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Iterator;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

@CapacitorPlugin(name = "AtpLibrary")
public class AtpLibraryPlugin extends Plugin {
    private static final String PREFERENCES = "atp-library";
    private static final String ROOT_URI = "root-uri";
    private final Map<String, Map<String, DocumentFile>> directoryCache = new LinkedHashMap<>();

    @PluginMethod
    public void chooseDirectory(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        String previous;
        try (LibraryDatabase database = new LibraryDatabase(getContext())) { previous = database.rootUri(); }
        if (previous == null) previous = getContext().getSharedPreferences(PREFERENCES, 0).getString(ROOT_URI, null);
        if (android.os.Build.VERSION.SDK_INT >= 26 && previous != null && previous.startsWith("content:")) {
            intent.putExtra(android.provider.DocumentsContract.EXTRA_INITIAL_URI, Uri.parse(previous));
        }
        startActivityForResult(call, intent, "directoryChosen");
    }

    @ActivityCallback
    private void directoryChosen(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            call.reject("Directory selection was cancelled");
            return;
        }
        Uri uri = data.getData();
        try {
            int flags = data.getFlags() & Intent.FLAG_GRANT_READ_URI_PERMISSION;
            if (flags != 0) getContext().getContentResolver().takePersistableUriPermission(uri, flags);
            loadState(call, uri, true);
        } catch (Exception error) {
            call.reject(error.getMessage(), error);
        }
    }

    @PluginMethod
    public void getState(PluginCall call) {
        String value;
        try (LibraryDatabase database = new LibraryDatabase(getContext())) { value = database.rootUri(); }
        if (value == null) value = getContext().getSharedPreferences(PREFERENCES, 0).getString(ROOT_URI, null);
        if (value == null) {
            call.resolve(emptyState());
            return;
        }
        loadState(call, Uri.parse(value), false);
    }

    private void loadState(PluginCall call, Uri uri, boolean remember) {
        new Thread(() -> {
            try {
                Uri savedUri = uri;
                DocumentFile root = "file".equals(uri.getScheme())
                    ? DocumentFile.fromFile(new File(uri.getPath())) : DocumentFile.fromTreeUri(getContext(), uri);
                if (root == null || !root.canRead()) throw new IllegalStateException("The selected Reading directory is unavailable");
                if (!remember) {
                    try (LibraryDatabase database = new LibraryDatabase(getContext())) {
                        if (uri.toString().equals(database.rootUri())) { call.resolve(database.read(baseState())); return; }
                    }
                }
                synchronized (directoryCache) {
                    directoryCache.clear();
                    JSObject state = buildState(root);
                    if (remember && Boolean.TRUE.equals(call.getBoolean("copyToApp", false))) {
                        File parent = getContext().getExternalFilesDir(null);
                        if (parent == null) throw new IllegalStateException("App storage is unavailable");
                        File destination = new File(parent, "Libraries/" + java.util.UUID.randomUUID());
                        copyDirectory(root, destination);
                        root = DocumentFile.fromFile(destination);
                        savedUri = root.getUri();
                        directoryCache.clear();
                        state = buildState(root);
                    }
                    try (LibraryDatabase database = new LibraryDatabase(getContext())) { database.replace(state,savedUri.toString()); }
                    call.resolve(state);
                }
            } catch (Exception error) {
                if (remember) call.reject(error.getMessage(), error);
                else {
                    JSObject state = emptyState();
                    state.put("locationError", error.getMessage());
                    call.resolve(state);
                }
            }
        }, "atp-library-loader").start();
    }

    private void copyDirectory(DocumentFile source, File target) throws Exception {
        if (!target.mkdirs() && !target.isDirectory()) throw new IllegalStateException("Cannot create library directory");
        for (DocumentFile child : source.listFiles()) {
            String name = child.getName();
            if (name == null || name.equals(".") || name.equals("..") || name.contains("/") || name.contains("\\")) continue;
            File output = new File(target, name);
            if (child.isDirectory()) copyDirectory(child, output);
            else if (child.isFile()) {
                try (InputStream input = getContext().getContentResolver().openInputStream(child.getUri());
                     FileOutputStream stream = new FileOutputStream(output)) {
                    if (input == null) throw new IllegalStateException("Cannot read " + name);
                    byte[] buffer = new byte[65536];
                    int count;
                    while ((count = input.read(buffer)) != -1) stream.write(buffer, 0, count);
                }
            }
        }
    }

    private JSObject emptyState() {
        JSObject state = baseState();
        state.put("initialized", false);
        return state;
    }

    private JSObject baseState() {
        JSObject state = new JSObject();
        JSObject library = new JSObject();
        library.put("generatedAt", "");
        library.put("episodes", new JSObject());
        library.put("warnings", new JSArray());
        state.put("library", library);
        state.put("themes", new JSArray());
        JSObject tags = new JSObject();
        tags.put("version", 3);
        tags.put("categories", new JSArray());
        tags.put("episodeTags", new JSObject());
        state.put("tags", tags);
        JSObject recognition = new JSObject();
        recognition.put("version", 1);
        recognition.put("rules", new JSArray());
        recognition.put("episodeDates", new JSObject());
        state.put("recognition", recognition);
        JSObject runtime = new JSObject();
        runtime.put("workspaceRoot", "");
        runtime.put("platform", "android");
        state.put("runtime", runtime);
        return state;
    }

    private JSObject buildState(DocumentFile root) throws Exception {
        JSObject state = baseState();
        JSObject library = (JSObject) state.get("library");
        JSObject episodes = (JSObject) library.get("episodes");
        JSArray warnings = (JSArray) library.get("warnings");
        JSArray themes = (JSArray) state.get("themes");
        int indexCount = 0;

        DocumentFile rootIndex = root.findFile(".theme-index.json");
        if (rootIndex != null && rootIndex.isFile()) {
            readTheme(root, rootIndex, episodes, warnings, themes);
            indexCount++;
        } else {
            for (DocumentFile child : root.listFiles()) {
                if (!child.isDirectory()) continue;
                DocumentFile index = child.findFile(".theme-index.json");
                if (index == null || !index.isFile()) continue;
                readTheme(child, index, episodes, warnings, themes);
                indexCount++;
            }
        }
        if (indexCount == 0) throw new IllegalStateException("No .theme-index.json was found in this Reading directory");

        state.put("initialized", true);
        state.put("locationName", root.getName() == null ? "Reading" : root.getName());
        JSObject runtime = new JSObject();
        runtime.put("workspaceRoot", root.getName() == null ? "Reading" : root.getName());
        runtime.put("platform", "android");
        state.put("runtime", runtime);
        return state;
    }

    private void readTheme(DocumentFile themeRoot, DocumentFile indexFile, JSObject episodeOutput, JSArray warnings, JSArray themes) throws Exception {
        JSONObject index = new JSONObject(readText(indexFile));
        if (index.optInt("version", 1) != 1 || index.optJSONArray("episodes") == null) {
            throw new IllegalStateException("Unsupported or invalid Reading index");
        }
        String title = index.optString("theme", themeRoot.getName() == null ? "Reading" : themeRoot.getName());
        JSONArray sourceEpisodes = index.optJSONArray("episodes");
        JSArray themeEpisodes = new JSArray();
        if (sourceEpisodes != null) {
            for (int position = 0; position < sourceEpisodes.length(); position++) {
                JSONObject sourceEpisode = sourceEpisodes.optJSONObject(position);
                if (sourceEpisode == null) continue;
                String episodeId = sourceEpisode.optString("date", sourceEpisode.optString("episode", ""));
                if (episodeId.isEmpty()) continue;
                themeEpisodes.put(episodeId);
                if (episodeOutput.has(episodeId)) continue;
                episodeOutput.put(episodeId, buildEpisode(themeRoot, sourceEpisode, episodeId, warnings));
            }
        }
        JSObject theme = new JSObject();
        theme.put("title", title);
        theme.put("episodes", themeEpisodes);
        theme.put("tags", new JSObject());
        themes.put(theme);
    }

    private JSObject buildEpisode(DocumentFile themeRoot, JSONObject source, String episodeId, JSArray warnings) throws Exception {
        JSObject episode = new JSObject();
        episode.put("title", source.optString("title", episodeId));
        episode.put("date", source.has("readingDate") ? source.get("readingDate") : episodeId.matches("\\d{8}") ? episodeId : JSONObject.NULL);
        episode.put("layout", "android-reading");
        episode.put("warnings", new JSArray());
        episode.put("errors", new JSArray());
        episode.put("peekRelations", source.optJSONObject("peekRelations") == null ? new JSObject() : source.optJSONObject("peekRelations"));

        Map<String, JSObject> filesByUri = new LinkedHashMap<>();
        JSONObject variants = source.optJSONObject("variants");
        if (variants != null) {
            Iterator<String> variantNames = variants.keys();
            while (variantNames.hasNext()) {
                String variant = variantNames.next();
                JSONArray pages = variants.optJSONArray(variant);
                if (pages == null) continue;
                for (int pageIndex = 0; pageIndex < pages.length(); pageIndex++) {
                    JSONObject page = pages.optJSONObject(pageIndex);
                    if (page == null) continue;
                    String relativePath = page.optString("file", "");
                    DocumentFile image = findRelative(themeRoot, relativePath);
                    boolean missing = image == null || !image.isFile();
                    if (missing) {
                        JSObject warning = new JSObject();
                        warning.put("type", "missing-reading-image");
                        warning.put("severity", "warning");
                        warning.put("episodeId", episodeId);
                        warning.put("path", relativePath);
                        warning.put("message", "Reading image is missing: " + relativePath);
                        warnings.put(warning);
                    }
                    String uri = missing ? "missing:" + relativePath : image.getUri().toString();
                    JSObject file = filesByUri.get(uri);
                    if (file == null) {
                        file = new JSObject();
                        file.put("name", missing || image.getName() == null ? relativePath : image.getName());
                        file.put("relativePath", relativePath);
                        if (!missing) file.put("androidUri", uri);
                        file.put("missing", missing);
                        file.put("assignments", new JSArray());
                        filesByUri.put(uri, file);
                    }
                    JSObject assignment = new JSObject();
                    assignment.put("variant", variant);
                    assignment.put("pageNumber", page.optInt("page", pageIndex + 1));
                    file.getJSONArray("assignments").put(assignment);
                }
            }
        }
        JSArray files = new JSArray();
        for (JSObject file : filesByUri.values()) files.put(file);
        episode.put("files", files);
        episode.put("variants", variants == null ? new JSObject() : variants);
        return episode;
    }

    private DocumentFile findRelative(DocumentFile root, String relativePath) {
        DocumentFile current = root;
        for (String segment : relativePath.replace('\\', '/').split("/")) {
            if (segment.isEmpty() || segment.equals(".")) continue;
            if (segment.equals("..")) return null;
            if (current == null) return null;
            String key = current.getUri().toString();
            Map<String, DocumentFile> children = directoryCache.get(key);
            if (children == null) {
                children = new LinkedHashMap<>();
                for (DocumentFile child : current.listFiles()) children.put(child.getName(), child);
                directoryCache.put(key, children);
            }
            current = children.get(segment);
            if (current == null) return null;
        }
        return current;
    }

    private String readText(DocumentFile file) throws Exception {
        StringBuilder output = new StringBuilder();
        try (InputStream stream = getContext().getContentResolver().openInputStream(file.getUri());
             BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) output.append(line).append('\n');
        }
        return output.toString();
    }
}
