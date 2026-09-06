<img src="design/atp-comic/icon.png" width="96" height="96" alt="ATP Comic アイコン">

# ATP Comic

[English](README.md) | [简体中文](README.zh_CN.md) | 日本語

**A**rrange · **T**ag · **P**eek。ATP Comic は、画師のバリアントセット（variant set）を整理・閲覧するためのツールです。作品セットの整理、タグ管理、バリアント編成に対応します。閲覧時はバリアント全体を切り替えるほか、Peek で画像の一部分に別のバリアントを透かして表示し、同じページの細部を比較できます。

バリアントセットとは、個々の場面に複数のバリアントがあり、一定の連続性を持つ一連の作品です。

## Windows 版のダウンロード

| 種類 | ダウンロード |
| --- | --- |
| インストーラー | 公開準備中 |
| ポータブル版 | 公開準備中 |

## ライブラリ構成

作品セットを含むディレクトリをライブラリの場所として選択します。日付で整理したセットには、次の構成を利用できます。

```text
Library/
└─ Archive/
   └─ 20250101/
      ├─ 20250101_title_a1.png
      ├─ 20250101_title_a2.png
      ├─ 20250101_title_b1.png
      └─ 20250101_title_b2.png
```

8 桁の日付フォルダーが 1 つのセットを表します。6 桁の年月フォルダーに複数の日付の画像をまとめることもできます。ファイル名は 8 桁の日付で始まり、末尾の `a1` はバリアント `a` の 1 ページ目、`b1` は同じページの別バリアントを表します。日付と末尾の番号の間には作品名などの文字列を残せます。

JPEG、PNG、WebP、GIF、BMP、TIFF、AVIF に対応します。日付のないセットには、**ライブラリの場所** でフォルダーの接頭辞・接尾辞ルールを設定してください。`001.png`、`002.png` などの数字名を使い、**Variant 編成** でページを割り当てられます。セットへの日付指定も可能です。

元画像は `Archive` に置く構成を推奨しますが、ライブラリ内の日付フォルダーを自動検出することもできます。コレクション、タグ、編成は `library.sqlite` に保存し、閲覧用の出力は元画像と分けて `Reading/` に作成します。

## Contributing

ATP Comic への貢献を歓迎します！バリアント編成の改善、閲覧体験の向上、翻訳、不具合報告、セキュリティ監査など、さまざまな形で参加できます。以下の Node.js ワークフローでは UI をブラウザーで直接動かし、変更と確認を素早く繰り返せます。

### 準備

Node.js 24+、npm、Git、Chrome/Edge を用意し、ソースを取得してローカルサーバーを起動してください。

```powershell
git clone https://github.com/ATPComic/ATPComicManager.git
cd ATPComicManager
npm ci
npm test
npm run serve -- --workspace "D:\ComicWorkspace"
```

端末に表示される URL（通常 `http://127.0.0.1:3000`）を開きます。パスは例です。本番データの唯一のコピーではなく、別のテスト用ライブラリを使用してください。

### 素早い反復開発

日常の開発ではフロントエンドの再ビルドとバックエンドの再起動を自動化できます。最初に `npm run build` を実行し、端末を 2 つ開いてください。

```powershell
# 端末 1：フロントエンドの変更を監視して再ビルド
npm run build:watch

# 端末 2：バックエンドの変更後に再起動
node --watch src/cli.js serve --workspace "D:\ComicWorkspace" --port 3000
```

フロントエンドのビルド後はブラウザーを更新してください。HMR ではありません。`npm run serve:api -- --workspace "D:\ComicWorkspace"` を使って手動で再起動することもできます。SVG の変更後は `npm run icons` を実行します。

### CLI ツール

```powershell
# スキャンして SQLite を更新
npm run scan -- --workspace "D:\ComicWorkspace"

# 他のリーダー向けにハードリンクを出力
npm run apply -- --workspace "D:\ComicWorkspace"
```

`--workspace` はデータルート、`--archive` は元画像、`--reading` は出力先、`--port` はポートを指定します。既定の出力先はワークスペース内の `Reading/` です。ハードリンクには対応ファイルシステムの同一ボリュームが必要です。

サーバーに認証機能はなく、既定では `127.0.0.1` のみで待ち受けます。ローカルファイル API を公開しないでください。

### テストとセキュリティ監査

変更を提出する前に、テストとビルドを実行してください。不具合修正の回帰テスト追加も歓迎します。

```powershell
npm test
npm run build
```

セキュリティ監査に参加する場合は、以下のコードと信頼境界を出発点にしてください。

- **ローカル HTTP API**：[ルーティングとファイルアクセス](src/server.js)。既定では `127.0.0.1` で待ち受け、認証機能はありません。公開サービスとしての運用は想定していません。
- **ファイル書き込み**：[出力パス検証](src/utils/path.js)、[ハードリンク出力](src/apply/apply.js)、[回帰テスト](test/apply.test.js)。パストラバーサル、シンボリックリンク、既存ファイルの置換を確認します。
- **外部入力**：[JSON インポート](src/shared-import-store.js)、[入出力ルート](src/server.js)、[関連テスト](test/server-export.test.js)。信頼できない入力の検証、リソース消費、ファイルアクセス範囲を確認します。
- **デスクトップ権限**：[Electron メインプロセス](electron/main.js)と[プリロード](electron/app-preload.cjs)。レンダラー分離、IPC、ページ遷移、外部リンク処理を確認します。
- **サプライチェーンとビルド**：`package-lock.json`、`package.json`、`.github/workflows/` の依存関係、インストールスクリプト、権限設定を確認します。

### アイコンのソース

アイコンのソースは `design/atp-comic/` にあります。[生成スクリプト](scripts/prepare-icons.mjs)で Windows・Android アイコンを構築し、`npm run icons -- --readme` で README 用の PNG を更新します。
