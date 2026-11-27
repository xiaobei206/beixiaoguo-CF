# 贝小果 Cloudflare 部署教程

本文对应仓库：[xiaobei206/beixiaoguo-CF](https://github.com/xiaobei206/beixiaoguo-CF)。

## 先选部署方式

| 方式 | 能否运行当前完整项目 | 推荐程度 | 说明 |
|---|---|---|---|
| **Pages + GitHub 授权** | 可以 | **首选** | Cloudflare 自动安装依赖、构建并发布 Pages Functions；后续推送代码自动更新 |
| Pages + Wrangler 命令行 | 可以 | 可用 | 从仓库根目录运行 Wrangler，它会一起部署根目录的 `functions/` |
| Pages 控制台拖 ZIP／文件夹 | **不可以直接部署完整项目** | 不推荐 | 控制台拖放不会编译 `functions/`；网页能打开，但 `/api/v1/*` 不会正常工作 |
| Workers + GitHub Builds | 可以，使用单独的 Worker 入口 | 可选 | 使用 `worker.js` 和 `wrangler.worker.jsonc`，不与 Pages 项目混用 |
| Workers 单独上传静态文件 | 不可以直接部署完整项目 | 不推荐 | 只上传前端资源不会自动包含 API 代码和 WASM 运行时 |

**注意：Pages 的 Git 集成项目与 Direct Upload 项目不能在控制台里互相切换。** 如果计划用 GitHub 自动部署，请一开始就选 Pages 的 Git 集成方式。若选 Direct Upload 后想转成 Git 自动部署，通常需要新建一个 Pages 项目。

## 方案 A：GitHub 授权连接 Pages（推荐）

### 1. 打开 Cloudflare

登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)，进入 **Workers & Pages**，选择创建应用，再选择 **Pages**，点击 **Connect to Git**（或“导入现有 Git 仓库”，不同界面文案可能略有差异）。

### 2. 授权 GitHub

首次连接时，Cloudflare 会跳转到 GitHub。安装并授权 **Cloudflare Workers & Pages** 应用，然后选择允许访问的仓库。建议只授权需要部署的仓库，而不是无必要地开放全部仓库。

选择：

- GitHub 仓库：`xiaobei206/beixiaoguo-CF`
- Production branch：`main`

### 3. 填写构建配置

请按下表配置：

| Cloudflare 选项 | 填写内容 |
|---|---|
| Framework preset | `None` |
| Build command | `npm run build` |
| Build output directory | `public` |
| Root directory | 留空，使用仓库根目录 |
| Production branch | `main` |

然后点击保存并部署。Cloudflare 会根据仓库的 `package.json` 安装依赖，再执行构建；根目录的 `functions/` 和 `wrangler.jsonc` 是本项目运行时的一部分，不要把根目录改成 `public`。

### 4. 检查部署是否完整

假设项目地址是 `https://你的项目名.pages.dev`，按顺序打开：

1. `/`：主页应能正常显示。
2. `/api/v1/health`：应返回 JSON，包含 `"status":"ok"` 和 `"runtime":"Cloudflare Pages Functions"`。
3. `/api/v1/health?sdk=1`：应返回 `"sdk":"ready"`。它只验证 SDK/WASM 能初始化，不会请求上游片库。
4. 最后再尝试推荐、搜索、详情和播放。真实上游请求是否成功，还取决于上游接口和媒体源；WASM 初始化通过不等于播放全功能已经验收。

部署成功后，后续提交到 `main` 会自动触发新的部署。打开主页右上角的 **DEBUG** 按钮，可查看并复制当前浏览器会话的前端与边缘日志；API 响应会直接携带本次请求的 trace ID 和边缘事件，即使 Cloudflare 请求落在不同 isolate 也可诊断。当前 `*.fqnovelpic.com` 封面通过受限的 Cloudflare 图片代理加载。出现片库请求、封面或 Go/WASM 错误时，请复制完整诊断包用于排查。边缘日志按匿名会话隔离，保留在当前 isolate 内存中，最多一小时；冷启动或 isolate 回收后旧服务端日志可能消失。

## 方案 B：Pages 拖放 ZIP 或文件夹

Cloudflare Pages 控制台确实支持把**单个文件夹或 ZIP**拖到 Direct Upload 界面。但本仓库包含 Pages Functions，官方文档明确说明：控制台拖放部署不会编译 `functions/`。

因此，**不要直接把 GitHub 下载下来的 ZIP、仓库根目录或 `public/` 文件夹拖上去当作完整安装**。这样可能只部署网页静态资源，API 依然不可用。

## 方案 C：不用 Git 自动部署，通过 Wrangler 部署 Pages

这种方式适合手工发布，但需要在电脑安装 Node.js，并登录 Cloudflare。下载或克隆整个仓库，在**仓库根目录**打开终端，执行：

```bash
npm install
npm test
npx wrangler login
npx wrangler pages project create beixiaoguo-cf
npx wrangler pages deploy public --project-name=beixiaoguo-cf
```

首次执行 `pages project create` 时，按提示确认项目名和生产分支；若项目名已存在，选一个新的名字，并在最后一条命令使用同一名字。关键是从仓库根目录运行，确保 Wrangler 同时发现 `functions/`。不要只从 `public/` 目录启动命令。

Pages Direct Upload 的 Wrangler 命令行可以部署 Functions；浏览器控制台的 ZIP／文件夹拖放则不行。手动部署不会自动追踪 Git 提交，每次更新需要重新运行部署命令。

## 方案 D：改用 Cloudflare Workers

本仓库额外提供了 Worker 入口，复用同一套 API 处理代码：

- Worker 入口：`worker.js`
- Worker 配置：`wrangler.worker.jsonc`
- 静态资源：`public/`
- API：同样为 `/api/v1/*`

### 命令行部署

从仓库根目录运行：

```bash
npm install
npm test
npx wrangler login
npx wrangler deploy --config wrangler.worker.jsonc
```

Worker 会使用配置名 `beixiaoguo-cf-worker`，静态资源走 Workers Static Assets，`/api/*` 则交给 Worker 代码。

### Workers + GitHub 自动部署

在 Cloudflare 的 **Workers & Pages** 中创建／选择 Worker，并在 **Settings → Builds** 连接 GitHub 仓库。按以下方式配置：

- Git repository：`xiaobei206/beixiaoguo-CF`
- Branch：`main`
- Root directory：留空（仓库根目录）
- Build command：`npm run build`
- Deploy command：`npx --yes wrangler@latest deploy --config wrangler.worker.jsonc`
- Worker 名称与配置里的 `beixiaoguo-cf-worker` 保持一致

这条路线与 Pages 是两个独立部署目标，会得到不同的 Cloudflare 项目／域名；不要将 Pages 的构建设置和 Worker 的部署命令混在一起。

## KV 是否需要创建？

当前版本**不要求 KV、D1、R2、VPS 或自建数据库**。匿名 SDK 状态暂存在边缘运行时内存，边缘实例冷启动后可能需要重新初始化；后续只有在验证确实需要跨实例持久化时才考虑增加 KV 绑定。

## 运行限制

- 运行时烟雾测试验证 API 路由和 SDK/WASM 初始化，不代表真实片库 API、CENC 受保护视频和电视接力已经验收。
- CENC 受保护流的媒体解密／Range 代理尚未迁移。
- Cloudflare 公共边缘运行时不能直接发现你家里的电视或执行家庭 LAN mDNS；此功能仍需要 N1 或局域网助手。
- 媒体播放取决于浏览器、媒体 CDN、编码和来源授权情况。

## 官方文档

- [Pages Git 集成](https://developers.cloudflare.com/pages/configuration/git-integration/)
- [Pages 通过 GitHub 部署](https://developers.cloudflare.com/pages/get-started/git-integration/)
- [Pages Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/)
- [Pages Functions 入门](https://developers.cloudflare.com/pages/functions/get-started/)
- [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/)
- [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)
