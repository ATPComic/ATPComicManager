<img src="design/atp-comic/icon.png" width="96" height="96" alt="ATP Comic 图标">

# ATP Comic

[English](README.md) | 简体中文 | [日本語](README.jp.md)

**A**rrange · **T**ag · **P**eek。ATP Comic 专为画师的变体集（variant set）设计，支持整理图集、管理标签和编排变体。阅读时可以切换完整变体，也可以通过 Peek 在当前图片的局部透视另一变体，对比同页的细节差异。

变体集：单个场景具有多个变体版本的、具有一定连续性的一组作品。

## 下载 Windows 版

| 版本 | 下载 |
| --- | --- |
| 安装版 | 待发布 |
| 便携版 | 待发布 |

## 图库结构

选择包含画师图集的目录作为图库位置。按日期整理的图集可以采用以下结构：

```text
Library/
└─ Archive/
   └─ 20250101/
      ├─ 20250101_title_a1.png
      ├─ 20250101_title_a2.png
      ├─ 20250101_title_b1.png
      └─ 20250101_title_b2.png
```

八位日期目录代表一个图集；也支持六位年月目录，将多天的图片放在同一目录中。文件名以八位日期开头，末尾的 `a1` 表示变体 `a` 的第 1 页，`b1` 是同页的另一变体。日期与末尾编号之间可以保留作品名称等文字。

支持 JPEG、PNG、WebP、GIF、BMP、TIFF 和 AVIF。没有日期的图集可在 **图库位置** 中设置文件夹前缀／后缀识别规则，图片可使用 `001.png`、`002.png` 等数字名称，再通过 **变体编排** 分配页面；也可以给图集指定日期。

`Archive` 是推荐的源图目录，应用也能自动发现图库位置下的日期目录。合集、标签和编排保存在 `library.sqlite`；导出的阅读目录位于 `Reading/`，与源图分开。

## Contributing

欢迎参与 ATP Comic！无论是改进变体编排、打磨阅读体验、完善翻译，还是报告问题与进行安全审计，都很有帮助。下面的 Node.js 工作流可以直接在浏览器中运行界面，方便快速修改和验证。

### 准备环境

准备 Node.js 24+、npm、Git 和 Chrome／Edge，然后获取源码并启动本地服务：

```powershell
git clone https://github.com/ATPComic/ATPComicManager.git
cd ATPComicManager
npm ci
npm test
npm run serve -- --workspace "D:\ComicWorkspace"
```

打开终端打印的地址，默认是 `http://127.0.0.1:3000`。`D:\ComicWorkspace` 仅为示例；建议使用独立的测试图库，不要直接拿唯一的生产数据调试。

### 快速迭代

日常开发可以让前端持续构建、后端自动重启。首次执行 `npm run build` 后，分别在两个终端运行：

```powershell
# 终端 1：监视前端变更并增量构建
npm run build:watch

# 终端 2：Node 后端变更后自动重启
node --watch src/cli.js serve --workspace "D:\ComicWorkspace" --port 3000
```

前端构建完成后刷新浏览器；这不是热模块替换。后端也可用 `npm run serve:api -- --workspace "D:\ComicWorkspace"` 手动管理重启。更改 SVG 后运行 `npm run icons`。

### 命令行工具

```powershell
# 扫描并更新 SQLite
npm run scan -- --workspace "D:\ComicWorkspace"

# 导出供其他阅读器使用的硬链接目录
npm run apply -- --workspace "D:\ComicWorkspace"
```

可用参数：`--workspace` 指定数据根目录，`--archive` 指定源图目录，`--reading` 指定导出目录，`--port` 指定服务端口。默认导出至图库位置的 `Reading/`。硬链接要求源图和目标位于同一支持硬链接的文件系统。

服务没有身份认证，默认仅监听 `127.0.0.1`；不要将文件 API 暴露到公网。

### 测试与安全审计

提交改动前，请运行测试和构建，并尽量为修复的问题补充回归测试：

```powershell
npm test
npm run build
```

如果你希望参与安全审计，可以从以下代码和信任边界入手：

- **本地 HTTP API**：[路由与文件访问](src/server.js)。服务默认监听 `127.0.0.1`，没有身份认证，不适合作为公开服务部署。
- **文件系统写入**：[输出路径校验](src/utils/path.js)、[硬链接导出](src/apply/apply.js)及[回归测试](test/apply.test.js)。重点检查路径穿越、符号链接和已有文件的覆盖行为。
- **外部输入**：[JSON 导入](src/shared-import-store.js)、[导入导出路由](src/server.js)及[相关测试](test/server-export.test.js)。检查不可信输入的校验、资源消耗和文件访问范围。
- **桌面权限边界**：[Electron 主进程](electron/main.js)与[预加载接口](electron/app-preload.cjs)。检查渲染进程隔离、IPC、页面导航和外部链接处理。
- **供应链与构建**：检查 `package-lock.json`、`package.json` 和 `.github/workflows/` 中的依赖、安装脚本及权限配置。

### 图标源文件

图标源文件位于 `design/atp-comic/`。[生成脚本](scripts/prepare-icons.mjs)负责构建 Windows 和 Android 图标；`npm run icons -- --readme` 更新 README 中的 PNG。
