<img src="design/atp-comic/icon.png" width="96" height="96" alt="ATP Comic icon">

# ATP Comic

English | [简体中文](README.zh_CN.md) | [日本語](README.jp.md)

**A**rrange · **T**ag · **P**eek. ATP Comic is designed for artists’ variant sets. Organize sets, manage tags, and arrange variants for reading. Switch between full variants, or use Peek to reveal another variant within a local area of the current image and compare details on the same page.

A variant set is a group of artworks with a degree of continuity, in which individual scenes have multiple variant versions.

## Download for Windows

[Download the latest release](https://github.com/ATPComic/ATPComicManager/releases/latest) · [All releases](https://github.com/ATPComic/ATPComicManager/releases)

Choose a file under **Assets**:

| Edition | File |
| --- | --- |
| Installer | `*-setup.exe` |
| Portable | `*-portable.exe` |

## Library layout

Choose the directory containing your artwork sets as the library location. Date-based sets can use this layout:

```text
Library/
└─ Archive/
   └─ 20250101/
      ├─ 20250101_title_a1.png
      ├─ 20250101_title_a2.png
      ├─ 20250101_title_b1.png
      └─ 20250101_title_b2.png
```

An eight-digit date folder represents one set. Six-digit month folders are also supported and can contain images from several dates. Filenames begin with an eight-digit date; the suffix `a1` identifies page 1 of variant `a`, while `b1` is another variant of that page. Artwork titles or other text can appear between the date and suffix.

Supported formats are JPEG, PNG, WebP, GIF, BMP, TIFF and AVIF. For undated sets, configure folder prefix/suffix rules in **Library location**. Images can have numeric names such as `001.png` and `002.png`, with pages assigned through **Variant assignment**. You can also assign a date to the set.

`Archive` is the recommended source directory; the app can also discover date folders under the library location automatically. Collections, tags and assignments are stored in `library.sqlite`. Reading exports go into `Reading/`, separate from the sources.

## Contributing

Contributions to ATP Comic are welcome! Help improve variant arrangement, refine the reading experience, translate the interface, report bugs, or review security. The Node.js workflow below runs the interface directly in a browser so you can make and test changes quickly.

### Setup

Start with Node.js 24+, npm, Git and Chrome/Edge, then fetch the source and start the local server:

```powershell
git clone https://github.com/ATPComic/ATPComicManager.git
cd ATPComicManager
npm ci
npm test
npm run serve -- --workspace "D:\ComicWorkspace"
```

Open the address printed in the terminal, normally `http://127.0.0.1:3000`. The workspace path is an example. Use a separate test library rather than your only copy of production data.

### Fast iteration

For day-to-day development, keep the frontend rebuilding and the backend restarting automatically. Run `npm run build` once, then use two terminals:

```powershell
# Terminal 1: rebuild when frontend sources change
npm run build:watch

# Terminal 2: restart when backend sources change
node --watch src/cli.js serve --workspace "D:\ComicWorkspace" --port 3000
```

Refresh the browser after a frontend rebuild; this is not hot module replacement. Alternatively, use `npm run serve:api -- --workspace "D:\ComicWorkspace"` and restart manually. Run `npm run icons` after editing SVG sources.

### CLI tools

```powershell
# Scan into SQLite
npm run scan -- --workspace "D:\ComicWorkspace"

# Export hard links for other readers
npm run apply -- --workspace "D:\ComicWorkspace"
```

Options: `--workspace` selects the data root, `--archive` the source directory, `--reading` the export directory, and `--port` the server port. Reading exports default to `Reading/` inside the workspace. Hard links require source and destination on the same supporting filesystem.

The server has no authentication and binds to `127.0.0.1` by default. Do not expose its local-file APIs publicly.

### Tests and security review

Before submitting a change, run the tests and build. Regression tests for bug fixes are especially welcome:

```powershell
npm test
npm run build
```

If you would like to contribute a security review, these components and trust boundaries are useful starting points:

- **Local HTTP API**: [routes and file access](src/server.js). The server binds to `127.0.0.1` by default and has no authentication. It is not intended for public deployment.
- **Filesystem writes**: [output path validation](src/utils/path.js), [hard-link export](src/apply/apply.js), and [regression tests](test/apply.test.js). Check path traversal, symbolic links and replacement of existing files.
- **External input**: [JSON import](src/shared-import-store.js), [import/export routes](src/server.js), and [tests](test/server-export.test.js). Review validation, resource consumption and file-access scope for untrusted input.
- **Desktop privileges**: [Electron main process](electron/main.js) and [preload interface](electron/app-preload.cjs). Review renderer isolation, IPC, navigation and external links.
- **Supply chain and builds**: inspect dependencies, installation scripts and permissions in `package-lock.json`, `package.json` and `.github/workflows/`.

### Icon sources

Icon sources live in `design/atp-comic/`. The [generator](scripts/prepare-icons.mjs) builds Windows and Android icons; `npm run icons -- --readme` refreshes the PNG used in this README.
