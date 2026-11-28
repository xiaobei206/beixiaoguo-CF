# 贝小果 Cloudflare 交接索引

## 当前排障交接（2026-11-28；新对话请先读）

> **当前主线：0.1.17 的 HEIC 转换失败语义和重定向边界已修复，代码/测试提交 1983cdff0220fcda4d468bfcfe1cfb758d5512dd 已通过完整 CI。** Safari 17+ 仍可原生显示 HEIC；其他浏览器对 HEIC/HEIF 请求 WebP。转换网络异常、5xx、9422、非 WebP 输出均明确返回 503，不再把原始 HEIC 当作成功；现在还会在每次合法重定向后重新判断目标格式，HEIC 转到 JPG/其他普通图片格式时不再错误地强制要求 WebP。前端失败时显示占位图，不重复追加 _bxg_retry。WebP Cache API 成品保留 30 天 max-age。
>
> **Cloudflare 来源白名单评审结论：** 官方文档说明 Images source allowlist 只作用于 /cdn-cgi/image/ URL 转换，不作用于 Worker fetch() 子请求上的 cf.image。当前项目用的是后一种方式，因此不需要在 Dashboard 为 p3-reading-sign.fqnovelpic.com 增加 Images source allowlist；不要为此开启 Any origin。Cache API 只在单个 Cloudflare 数据中心本地生效，可能因 PoP 变化或缓存淘汰再次转换。最新代码/测试提交 1983cdff 的 CI Run #46113661994 已全部通过；生产 fork 尚未同步，不能声称线上修复已生效。

### 1. 已证实的故障现象

- 生产地址：https://w.hiu.us.kg/。
- 生产 Worker：beixiaoguo-cf-worker；Cloudflare Wrangler 已登录账号 qmancf206@gmail.com，Account ID 为 1ae982074154b7e96337455ee8bacc36。
- BXG_MEDIA_SECRET 已通过本机生成的强随机值并用 Wrangler 写入生产 Worker。密钥值没有写入 Git；不要轮换或复制到日志中。
- 用户最新真实播放诊断已确认：GET /api/v1/play/:episodeId 返回 200，出现 edge.playback.cenc.session.ready、player.media.metadata（时长约 97.97 秒）和 player.media.playing。边缘预取 6/6 成功，3 集边缘缓存成功、0 失败，另外 3 集已排入后台缓存。
- 当前剩余故障是封面图片。真实 Network 请求的源 URL 以 .heic 结尾；上游响应 HTTP 200，但 Content-Type 为 image/heic；当前代理用白名单拒绝它并返回 502 IMAGE_CONTENT_TYPE。Chrome 158 的普通 img 元素不支持直接显示 HEIC，因此单纯放宽 MIME 白名单并不能解决。
- 0.1.15 的初始方案仅按 .heic/.heif 后缀直接转换；0.1.16 加入 Safari 分流、稳定缓存、签名参数规范化及同 isolate 并发合并；0.1.17 修正转换失败语义，并在 proxyCoverImage() 函数级测试中覆盖重定向目标格式变化。测试直接提取生产函数并注入模拟 fetch/Cache API，不覆盖完整 onRequest 路由分发。
- Cloudflare Images Free 当前每月包含 5,000 个不同转换组合；超出后新转换返回错误而不会对 Free 用量继续收费；Paid 计划超过包含额度后，每 1,000 个额外唯一转换计费 0.50 美元。转换只用于 HEIC／HEIF 来源，需留意生产回包是否成功及账号实际计划。
- 0.1.17 初始修复提交 5f16ffe 经测试隔离提交 19b27e3 后，CI Run #46111794538 已全部通过；随后重定向边界与失败路径测试提交 1983cdff 的 CI Run #46113661994 也已全部通过（Windows npm test、Linux/静态检查、Pages/Workers 构建及 WASM 运行时 smoke test）。维护仓库修复尚未同步到生产部署 fork，不能声称线上修复已生效。

### 2. 仓库与代码状态

- 维护仓库：`xiaobei206/beixiaoguo-CF`，以 `main` 为开发基线；HEIC 转换失败语义修复为 `5f16ffe`，测试隔离为 `19b27e3`，本次重定向格式边界与补充回归测试为 `1983cdff0220fcda4d468bfcfe1cfb758d5512dd`；该代码/测试提交的 CI Run #46113661994 已通过。
- 部署 fork：`qmancf206/beixiaoguo-CF`，main 当前为 `67be60176b8cc706c85bc719a3668f3835712c1b`。比较确认，代码/测试提交 `1983cdff` 相对 fork 领先 6 个提交、落后 0 个；无 fork 独有提交，适合直接快进同步。维护仓库的后续文档提交也需一并同步。本轮未修改生产 fork。
- Wrangler Worker 配置：`wrangler.worker.jsonc`；Worker 名称 `beixiaoguo-cf-worker`，入口 `worker.js`。
- `worker.js` 会把 Worker 的 `env` 原样传给 `functions/api/v1/[[path]].js`。播放逻辑读取 `context.env?.BXG_MEDIA_SECRET`；名称与调用代码一致。现有配置文件未声明同名普通变量。
- 0.1.14 补上了直接播放分支的诊断事件 `media.secret.missing`，仅记录 bool 状态，不记录密钥值。部署提交链接：
  `https://github.com/qmancf206/beixiaoguo-CF/commit/67be60176b8cc706c85bc719a3668f3835712c1b`
- 当前 GitHub 连接对维护仓库有写权限，但对部署 fork 只有 pull=true、push=false，不能代为写入或合并生产分支。CI 通过后，需由有 fork 写权限的账号在 qmancf206/beixiaoguo-CF 的 GitHub 页面选择 Sync fork → Update branch；这是快进同步，不需要强推。

### 3. 用户 Windows VPS 环境（已实测）

- OS：Windows 10 IoT Enterprise LTSC，版本 10.0.19044，64-bit。
- CPU：4 个逻辑处理器，AMD EPYC-Rome Processor。
- RAM：8 GiB；当时可用约 4.44 GiB。
- 磁盘：C: 总 49.4 GiB / 剩余 9.2 GiB；D: 总 10.6 GiB / 剩余 9.7 GiB。
- 至 `github.com`、`api.github.com`、`nodejs.org`、`registry.npmjs.org`、`api.cloudflare.com` 的 DNS 和 TCP 443 检查均成功。
- 用户为了不污染 C 盘，把工具与项目放到 D 盘：
  - Node.js：`D:\tools\node\node-v22.23.5-win-x64`，版本 `v22.23.5`。
  - Go：`D:\tools\go\go`，版本 `go1.27.4 windows/amd64`。
  - 便携版 MinGit：`D:\tools\git`，版本 `2.56.1.windows.1`。
  - 项目克隆位置：`D:\beixiaoguo-CF`，远程为 `https://github.com/qmancf206/beixiaoguo-CF.git`，分支 main。
  - npm 版本 `10.9.9`；`npm.cmd install --no-audit --no-fund` 已完成，输出 `added 79 packages in 1m`，只有 `node-domexception` deprecated 警告。
  - 因 MinGit 缺少 `less`，普通 `git log` 会报 pager 错误；使用 `git --no-pager log ...` 或设置 `$env:GIT_PAGER='cat'`。
  - 环境变量曾在当前 PowerShell 会话中设置，包含 D 盘 TEMP/npm/Go cache 路径；新开终端时须重新设置。
- 用户已提供 Windows VPS 首次 `npm.cmd test` 失败日志。已定位并修复：Windows 文件权限测试错误地断言 POSIX `0600`；生成文件比较没有归一化 CRLF/LF；POSIX Shell 假播放器测试不能在 Windows 执行；`scripts/patch-openhongguo.mjs` 对 SDK 文件的精确字符串匹配未处理 CRLF。
- 修复已在用户自有 `xiaobei206/openhongguo` 的 main（SDK commit `dc453a4691f2d7e29b4c07c3385fab0bf00016e1`）与维护仓库 `xiaobei206/beixiaoguo-CF` 的 main（`6f9bfeed24aad316a4d78363d30b779685da3d46`）。Windows 上只跳过依赖 POSIX Shell 的模拟子进程测试；同一测试仍在 Linux CI 完整执行。其余 Go 单测、CENC 测试、WASM 构建和项目 smoke tests 均保留。
- GitHub Actions Run #162（`https://github.com/xiaobei206/beixiaoguo-CF/actions/runs/46043726448`）已成功：`windows-latest` 的 `npm test` 通过；Ubuntu 的 `npm test`、Pages Functions 构建与 WASM smoke test、Workers 构建与 WASM smoke test 全部通过。
- GitHub Actions 的 Windows／Linux CI #162 已通过；用户的 Windows VPS 在更新到维护仓库 67be601 后也已完整执行 npm.cmd test 并全部通过。随后生产 BXG_MEDIA_SECRET 已由 Wrangler 配置，真实受保护视频已开始播放；0.1.16 完整 CI Run #46108337627 已通过；0.1.17 初始修复 CI Run #46111794538 已通过；重定向边界和新增失败路径测试所在提交 1983cdff 的 Run #46113661994 已完整通过 Windows npm test、Linux npm test、Pages Functions 构建与 WASM smoke test、Workers 构建与 WASM smoke test。生产 fork 仍停留在 67be601，尚未同步。

### 4. Windows VPS 图片修复验证（需要在本机重跑时）

在 PowerShell 中进入 VPS 的本地工作副本。先确认没有未提交改动，再从维护仓库 `main` 快进更新本地目录。此操作**只更新 VPS 本地工作副本，不会推送或同步 `qmancf206` 部署 fork**：

```powershell
Set-Location D:\beixiaoguo-CF
if (git status --porcelain) { throw '工作区有未提交改动；先保存，不要覆盖' }
git fetch https://github.com/xiaobei206/beixiaoguo-CF.git main
if ($LASTEXITCODE -ne 0) { throw 'fetch 维护仓库 main 失败' }
git merge --ff-only FETCH_HEAD
if ($LASTEXITCODE -ne 0) { throw '本地快进失败；停止，不要强制合并或推送部署 fork' }

$env:Path='D:\tools\node\node-v22.23.5-win-x64;D:\tools\go\go\bin;D:\tools\git\cmd;D:\tools\git\ucrt64\bin;D:\tools\git\usr\bin;'+$env:Path
$env:TEMP='D:\bxg-temp'
$env:TMP='D:\bxg-temp'
$env:npm_config_cache='D:\npm-cache'
$env:GOCACHE='D:\go-cache\build'
$env:GOMODCACHE='D:\go-cache\pkg\mod'
$env:GOMAXPROCS='2'
$env:GOFLAGS='-p=1'
$env:GIT_PAGER='cat'
npm.cmd test
```

维护仓库 main 的 Windows 与 Linux CI 均已通过。VPS 本地快进到维护仓库 main 后，重新执行一次 `npm.cmd test`，确认用户机器也通过。不要升级 npm（10.9.9 足够）、重装 Node/Go/Git、重新克隆或把整份长日志复制出来；若失败，只需提供最后一个真实错误及其前后约 30 行。

### 5. 0.1.17 图片修复的生产发布计划

1. BXG_MEDIA_SECRET 已配置成功，不要再次执行 wrangler secret put，也不要重新部署仅为修复图片。
2. 维护仓库代码/测试提交 1983cdff 已通过完整 CI（Run #46113661994）；部署 fork qmancf206/beixiaoguo-CF 的 main 仍为 67be601，尚未同步 0.1.17 修复。
3. 当前代码/测试 CI 已全部通过。因本连接对 fork 没有 push 权限，请在 qmancf206/beixiaoguo-CF 仓库页面点击 Sync fork → Update branch，把维护仓库主线快进同步到部署 fork；不要强推，也不要从维护仓库本地执行 wrangler deploy。
4. 等部署 fork 的 Cloudflare Worker Builds 部署完成后，重新请求之前失败的 HEIC 图片 URL：Chrome 请求 HEIC 应返回 HTTP 200、Content-Type image/webp；Safari 17+ 应返回原始 image/heic。
5. 再检查普通 JPEG／WebP 封面仍正常。如果转换失败，收集新的 HTTP 状态、Content-Type、X-BXG-Error-Code、X-BXG-Trace-ID，不要包含完整签名 URL。

### 6. 操作安全

- 不要把 Cloudflare API Token 或 `BXG_MEDIA_SECRET` 放入 Git、截图、DEBUG JSON 或聊天。
- 不要让用户继续重建/Rotate Secret 多次；先通过 Wrangler 对指定 Worker 做一次明确的配置部署，再验收。
- Oracle 免费 AMD 主机：Ubuntu 20.04 x86_64、2 vCPU、约 1 GiB RAM、2 GiB Swap、根盘约剩 29 GiB，网络检查通过；未安装或修改。用户后来选用 Windows VPS，本次后续应继续在 Windows 上，不必再指导 Oracle 安装。


| 文件 | 用途 |
|---|---|
| [README.md](README.md) | 项目目标、功能状态与 Pages 部署 |
| [docs/architecture.md](docs/architecture.md) | Functions、匿名 SDK、API 映射与限制 |
| [DEVELOPMENT-LOG-CN.md](DEVELOPMENT-LOG-CN.md) | 单一累计开发日志 |
| [VERSION](VERSION) | 当前版本 |

## 当前版本

**0.1.17 — 2026-11-28**

- 已迁移原版 UI/PWA 资源。
- 已接入 openhongguo Node.js/WASM SDK；0.1.2 采用预编译 `WebAssembly.Module`。CI 可验证 Pages 和 Workers 本地运行时 SDK 初始化；运行时烟雾测试不代表真实上游接口、受保护视频流或电视接力已验收。
- 已建立推荐、搜索、详情、多季、榜单、新剧与播放解析接口适配层，仍需真实上游验收。
- 新增可选 Workers 部署入口：`worker.js` / `wrangler.worker.jsonc`，与 Pages 配置分开。
- 渐进式 MP4 CENC AES-CTR 的边缘 Range 解密已在 0.1.7 实现；CI 通过解析器测试、媒体令牌／Range 单测和 Pages/Workers WASM 初始化验证，但真实上游分集端到端播放仍未验收。图片预热/持久缓存与电视接力尚未迁移。
- 主页顶部有“部署教程”入口；Pages / Workers 安装步骤与拖放 ZIP 限制见 [docs/deploy-cloudflare-cn.md](docs/deploy-cloudflare-cn.md)。
- 0.1.6 在首页直接显示 GitHub → Pages 设置参数、ZIP/文件夹拖放限制、Wrangler 手动部署与 Workers 备用路线。
- 0.1.6 新增右上角 DEBUG 面板：可复制前后端诊断日志；每个 API 响应携带本次请求的边缘 trace，不依赖 Cloudflare isolate 内存连续性，并记录 Go/WASM runtime 与上游请求。
- 0.1.6 对 `*.fqnovelpic.com` 封面启用 HTTPS 白名单图片代理，浏览器同源加载；仍需真实 CDN 请求确认上游未拒绝 Cloudflare 出口。
- 0.1.11 增加双层短剧预读：CF 侧最多预解析后续 6 集的播放地址／加密会话，浏览器侧最多预载后续 3 集；浏览器实际下载量仍由浏览器策略决定，CF 不会一次性缓存六集完整视频。
- 0.1.12 增加真实 CF 媒体预热：最多 6 集受保护 MP4 在 CF 侧完整解密缓存（单集 ≤32 MiB）；前 3 集先缓存，后 3 集后台缓存；浏览器仍预载 3 集，Range 请求可命中缓存。
- 0.1.17 修正 HEIC 转换失败语义：额度 9422、5xx、转换网络异常或非 WebP 输出时返回明确 503，不向 Chrome 返回原始 HEIC 作为假成功；前端停止失败 HEIC 的自动重试并显示占位图；去掉 Cache API 不支持的 stale-while-revalidate。新增生产 proxyCoverImage() 函数级测试（并非完整 onRequest 路由测试），覆盖 HEIC→JPEG 重定向、Cache API 失败容错等边界。代码/测试提交 1983cdff 的 CI Run #46113661994 全部通过。
- 0.1.16 完善 HEIC/HEIF 图片流程：Safari 17+ 原图直出，其他浏览器请求 WebP 转换；签名 URL 规范化后使用 Cache API 30 天缓存，重试参数不影响缓存身份，并合并同 isolate 并发转换。
- 0.1.13 增加浏览器本地自选 CF 反代 IP 管理器，支持 IPv4／IPv6，只填写 IP、固定 443，列表和选择保存在本机。选择时通过一次 `/api/v1/route?alt_ip=...` 同源请求提交 IP，Worker 校验地址后经内部响应头交给 Cloudflare Zone 响应头规则，以动态 Alt-Svc 公告备用入口；随后删除内部头，不写 Cookie，也不依赖 Pro 专属规则字段；新增 Alt-Used 诊断。真正切换必须绑定自有橙云域名并配置四条 Response Header Transform Rules；workers.dev／pages.dev 默认域名上仅保存 IP，不会切换。
- 0.1.14 补充 MEDIA_SECRET_REQUIRED 的安全运行时诊断 media.secret.missing，记录 Secret 绑定和长度状态，不记录 Secret 值。
- 原版 beixiaoguo-web 不受本仓库修改影响。

## Pages 部署参数

- Build command：npm run build
- Build output directory：public
- GitHub 仓库：xiaobei206/beixiaoguo-CF
- Production branch：main
- Workers Builds 命令见部署教程；不要把 Pages 和 Worker 的 Wrangler 配置混用。


## 0.1.7：受保护分集边缘媒体处理

- 复用 N1 的 MP4 CENC 布局解析器，并在 CI 原生测试后构建独立 Go/WASM 模块。
- 受保护播放地址变为同源加密会话 URL；服务端内容密钥不出现在前端 JSON 或明文 URL 中。
- 新增 /api/v1/media/:token，支持单个 Range、Content-Range 校验、按需流式解密和短时会话过期。
- 生产 Worker 需设置 Secret BXG_MEDIA_SECRET（至少 32 个字符）。
- CI 覆盖解析器测试、媒体令牌保护、Range 处理和 Workers/WASM 初始化；真实上游分集端到端播放仍需验证。


## 0.1.8：修正前后端版本提示

- 修复播放器遗留的旧硬编码提示；后端若返回受保护标记却没有同源媒体地址，会明确提示更新 Cloudflare 部署，而不会谎称边缘解密尚未开发。
- 统一 HTML 资源缓存、API 诊断、`VERSION` 和 `package.json` 版本号。
- 静态检查新增回归规则，避免旧提示再次进入发布构建。


## 0.1.9：Secret 配置诊断

- `MEDIA_SECRET_REQUIRED` 错误按 Pages Functions／Workers 运行时显示对应控制台路径，避免 Pages 环境仍被提示去找“Worker Secrets”。
- 补齐 Pages `wrangler pages secret put` 与 Workers `wrangler secret put` 两条命令。
- Pages Production／Preview 和独立 Worker 的 Secret 分别配置；代码不会自动同步账号中的 Secret。


## 0.1.10：媒体停播诊断

- 将加密媒体会话里的诊断会话 ID 随令牌保存，解封后把原生 `<video>` 的媒体代理请求日志并回发起播放的 DEBUG 会话。
- 对流式输出中途失败／上游短读新增服务端诊断事件；浏览器侧记录 metadata、playing、waiting、stalled、pause 和 media error 状态。
- `APP_VERSION` 与实际版本统一，避免诊断包错误显示 0.1.6。
- 仍需部署后重新播放一次取得实际 Range／解密失败原因；本次不宣称已经验证真实上游播放恢复。
