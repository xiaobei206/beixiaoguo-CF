# 贝小果 Cloudflare 交接索引

### 0.1.18 线上状态复核（2026-11-28 16:30，Asia/Tokyo；未修改应用代码）

- **维护仓库** `xiaobei206/beixiaoguo-CF` 的 `main` 当前为 `d161be8540c25364c7453236c89827882d7be5ec`；该 SHA 只修正交接文档。对应 CI Run [#46116623484](https://github.com/xiaobei206/beixiaoguo-CF/actions/runs/46116623484) 已成功。应用版本仍是 `0.1.18`。
- **部署 fork** `qmancf206/beixiaoguo-CF` 的 `main` 为 `cc94107d0cd0fcd4805234804775f6e3859ff665`，包含 0.1.18 代码及测试。GitHub 的 Cloudflare Workers and Pages Check Suite [#124755836973](https://api.github.com/repos/qmancf206/beixiaoguo-CF/check-suites/124755836973) 对该 SHA 报告 `completed / success`，变化区间为 `bdf2a735f85ee82d81b88de8f50776b0b8f4541e → cc94107d0cd0fcd4805234804775f6e3859ff665`。这证明 Cloudflare 集成对该提交报告部署检查成功；但本轮仍未拿到生产域名的实时健康接口回包，故**尚不能用浏览器实际响应确认 `w.hiu.us.kg` 当前返回的运行时版本**。
- **封面故障没有新证据闭环。** 仍缺少 0.1.18 部署后的最新失败图片 `GET /api/v1/images?...` 的状态、响应体与诊断头；上一份 0.1.17 的 `9516` 只说明旧请求解码 HEIC 失败，不能代替本次 GET。没有因此修改任何代码、测试、配置或版本，也没有把问题标记为已修复。
- **接下来唯一有效动作：** 在生产网站打开 `/api/v1/health`，确认 JSON 的 `version` 是否为 `0.1.18`；然后在 DevTools → Network 中选最新失败的图片 **GET（不要用 HEAD）**，提供 HTTP 状态、响应 JSON/正文、`Content-Type`、`X-BXG-Error-Code`、`X-BXG-Transform-Error-Code`、`X-BXG-Image-Cache`、`X-BXG-Image-Transform`、`X-BXG-Trace-ID`，必要时附 `X-BXG-Debug`。不要粘贴完整签名 URL 或其中的 `x-expires`、`x-signature`。有了这份真实回包后再选择一个可证伪假设做最小修复。

## 当前排障交接（2026-11-28；新对话请先读）

> **当前主线：0.1.18 已进入维护仓库和部署 fork，CI 已通过，但封面故障仍未解决。** 用户最新明确反馈：更新后图片仍然无法显示。此前真实失败 GET 返回 503 `IMAGE_TRANSFORM_UNAVAILABLE`；Worker DEBUG 显示 Cloudflare 转换服务 HTTP 422、内部错误 **9516**，即 HEIC 解码失败，不是 9422 免费额度耗尽。iPhone 13 / iOS 16 Safari 与 Chromium 都需要 WebP，Safari 17+ 才走原生 HEIC。0.1.18 已把需要转换的请求发往源站时的 `Accept` 限定为 `image/webp`，并把响应体里的 `9516` 提取到诊断头。**但用户反馈仍不行，不能认定该改动有效；下一位 GPT 必须先检查 Cloudflare 实际运行版本，再取得 0.1.18 部署后的新失败 GET 响应，按真实错误继续排查。**
>
> **Cloudflare 来源白名单评审结论：** Images source allowlist 适用于 `/cdn-cgi/image/` URL 转换，不适用于 Worker `fetch()` 子请求中的 `cf.image`；当前方案不需要为 `p3-reading-sign.fqnovelpic.com` 增加来源白名单，更不要开启 Any origin。0.1.18 代码基线提交 `cc94107d0cd0fcd4805234804775f6e3859ff665` 已通过 CI Run [#46115643235](https://github.com/xiaobei206/beixiaoguo-CF/actions/runs/46115643235)，Windows 测试和 Pages/Workers 构建与 WASM smoke test 均成功。部署 fork `main` 已同步到该代码基线；部署 fork `main` 当前为 `cc94107d0cd0fcd4805234804775f6e3859ff665`；Cloudflare Workers and Pages Check Suite [#124755836973](https://api.github.com/repos/qmancf206/beixiaoguo-CF/check-suites/124755836973) 对该 SHA 报告 `completed / success`。维护仓库 `main` 目前为仅修改交接文档的 `d161be8540c25364c7453236c89827882d7be5ec`，对应 CI Run [#46116623484](https://github.com/xiaobei206/beixiaoguo-CF/actions/runs/46116623484) 已成功。Cloudflare 集成部署检查已成功，但生产域名的实时 `/api/v1/health` 回包与 0.1.18 后最新失败图片 GET 仍未取得，不能声称实际路由已验收或封面已修复。

### 1. 已证实的故障现象

- 生产地址：https://w.hiu.us.kg/。
- 生产 Worker：beixiaoguo-cf-worker；Cloudflare Wrangler 已登录账号 qmancf206@gmail.com，Account ID 为 1ae982074154b7e96337455ee8bacc36。
- BXG_MEDIA_SECRET 已通过本机生成的强随机值并用 Wrangler 写入生产 Worker。密钥值没有写入 Git；不要轮换或复制到日志中。
- 用户最新真实播放诊断已确认：GET /api/v1/play/:episodeId 返回 200，出现 edge.playback.cenc.session.ready、player.media.metadata（时长约 97.97 秒）和 player.media.playing。边缘预取 6/6 成功，3 集边缘缓存成功、0 失败，另外 3 集已排入后台缓存。
- 用户在 2026-11-28 提供了维护仓库/生产版本 0.1.17 的真实失败 GET：Worker 返回 503 IMAGE_TRANSFORM_UNAVAILABLE；DEBUG 内部 Cloudflare 转换请求为 HTTP 422、Content-Type text/plain、ERROR 9516，错误内容明确为“Error while decoding the HEIC file”。缓存为 MISS；不是 9422 额度错误。该请求实际解码到 HEIC，但当前日志不包含变换前源站 Content-Type，尚不能证明 HEIC 是由固定 URL 格式还是 veImageX Accept 自适应选择。
- 用户补充 iPhone 13 / iOS 16 Safari 也无法显示封面：Safari 16 不支持网页原生 HEIC，只有 Safari 17 起才加入该能力。因此 iOS 16 与 Chrome 都必须走 WebP 转换，不能把 iOS 16 放入原图直出分支。
- 0.1.18 变更：对于需要 WebP 的 HEIC/HEIF 请求，源站 Accept 限定为 `image/webp`；错误体中的 4 位 Cloudflare 错误码（如 9516）会写入 `X-BXG-Transform-Error-Code`。这只是协商方向的尝试，依赖源站对 `Accept: image/webp` 的实际支持，尚无证据证明 veImageX 对该模板会返回 WebP。用户报告修订后依然无法显示；必须取得最新线上响应才能判断该尝试是未部署、被源站忽略，还是 Cloudflare 解码器仍不兼容。
- 0.1.15 的初始方案仅按 .heic/.heif 后缀直接转换；0.1.16 加入 Safari 分流、稳定缓存、签名参数规范化及同 isolate 并发合并；0.1.17 修正转换失败语义，并在 proxyCoverImage() 函数级测试中覆盖重定向目标格式变化。测试直接提取生产函数并注入模拟 fetch/Cache API，不覆盖完整 onRequest 路由分发。
- Cloudflare Images Free 当前每月包含 5,000 个不同转换组合；超出后新转换返回错误而不会对 Free 用量继续收费；Paid 计划超过包含额度后，每 1,000 个额外唯一转换计费 0.50 美元。转换只用于 HEIC／HEIF 来源，需留意生产回包是否成功及账号实际计划。
- 0.1.17 历史验证：初始修复提交 5f16ffe 经测试隔离提交 19b27e3 后，CI Run #46111794538 已全部通过；重定向边界与失败路径测试提交 1983cdff 的 CI Run #46113661994 也全部通过。**这是 0.1.17 当时的发布状态，不代表当前 0.1.18 尚未同步；当前 fork 状态见第 2 节。**

### 2. 仓库与代码状态

- 维护仓库：`xiaobei206/beixiaoguo-CF`，以 `main` 为开发基线；0.1.18 协商代码提交 `a9340b6`，iOS 16 / Accept 断言与 9516 回归测试提交 `61e6dc2`。0.1.18 代码基线 CI Run [#46115643235](https://github.com/xiaobei206/beixiaoguo-CF/actions/runs/46115643235) 成功；当前维护仓库 `main` 为 `d161be8540c25364c7453236c89827882d7be5ec`，属于文档状态校正提交，其 CI Run [#46116623484](https://github.com/xiaobei206/beixiaoguo-CF/actions/runs/46116623484) 已成功。
- 部署 fork：`qmancf206/beixiaoguo-CF` 的 `main` 为 `cc94107d0cd0fcd4805234804775f6e3859ff665`，包含 0.1.18，与维护仓库当前 `main` 的 SHA 不同仅因为维护仓库有后续文档提交。Cloudflare Workers and Pages Check Suite [#124755836973](https://api.github.com/repos/qmancf206/beixiaoguo-CF/check-suites/124755836973) 对 fork 的该 SHA 报告 `completed / success`；这是 Cloudflare 集成层的部署成功记录。**仍需用生产 `GET /api/v1/health` 直接确认 `w.hiu.us.kg` 当前返回的运行时版本，并取得 0.1.18 部署后的失败图片 GET；封面问题仍未解决。** 当前连接对部署 fork 只有 pull=true、push=false。
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
- GitHub Actions 的 Windows／Linux CI #162 已通过；用户的 Windows VPS 在历史版本 67be601 时曾完整执行 `npm.cmd test` 并通过。随后生产 `BXG_MEDIA_SECRET` 已由 Wrangler 配置，真实受保护视频已开始播放；0.1.16、0.1.17 与 0.1.18 的 CI 均有成功记录。**本段中的 67be601 是历史测试基线，不是当前部署 fork SHA；当前代码基线为 cc94107。**

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

### 5. 当前未解决：0.1.18 部署后仍有封面破图

**用户最新反馈：还是不行。** 目前未收到这次反馈对应的最新 Network 请求详情，因此不能判定是 Cloudflare Worker 没部署、源站忽略 WebP Accept，还是 Cloudflare 仍无法转换该 HEIC。

下一位 GPT 必须按顺序完成：

1. 已核实部署 fork `main` 为 `cc94107d0cd0fcd4805234804775f6e3859ff665`，且 Cloudflare Workers and Pages Check Suite [#124755836973](https://api.github.com/repos/qmancf206/beixiaoguo-CF/check-suites/124755836973) 对该 SHA 报告成功。接下来仍要先访问生产 `GET /api/v1/health`，直接确认返回 JSON 中 `version` 为 `0.1.18`；部署检查不能取代对当前域名路由的实时取样。若返回版本不是 0.1.18，先排查 Worker Build/路由/缓存，不要改图片代码。
2. 在 Chrome F12 → Network → `images` 过滤器中选一条失败的 `/api/v1/images?...` **GET**（不是 HEAD），记录 HTTP Status、Response JSON、`Content-Type`、`X-BXG-Error-Code`、`X-BXG-Transform-Error-Code`、`X-BXG-Image-Cache`、`X-BXG-Image-Transform`、`X-BXG-Trace-ID`。不要分享完整签名 URL（含 `x-expires`、`x-signature`）。最好同时提供一条成功与一条失败请求用于对照。
3. 对照解释：
   - `200 image/webp` 且 `X-BXG-Image-Transform: webp`：后端已输出可显示格式；若页面仍破图，转查浏览器缓存、前端 `<img>` URL/解码与 CSP 等，不要继续折腾转换端。
   - `503` 且 `X-BXG-Transform-Error-Code: 9516`：Cloudflare 仍在解码 HEIC 时失败；`Accept: image/webp` 没让源站给出可转换格式，需独立验证源站原始 GET/HEAD 的真实 Content-Type，并检查该 `~tplv-...:400:0.heic` 路径/模板是否强制 HEIC。下一步优先探索上游允许的 WebP/JPEG 输出模板/参数或直接从另一个原始格式端点取图；不要继续重复设置相同 Accept 或不断调 Cloudflare 白名单/额度。
   - `503 HTTP_422` 但没有 `9516`：先解码 `X-BXG-Debug` 的 `responseDetail`，确认新的 Cloudflare 转换错误码，再决定方向。
   - `502 IMAGE_UPSTREAM_HTTP`、`IMAGE_UPSTREAM_FETCH`、`IMAGE_REDIRECT_HOST`、`IMAGE_CONTENT_TYPE` 或 `413 IMAGE_TOO_LARGE`：按对应上游状态、重定向和 MIME/尺寸限制排查，不要把它们统称为 HEIC 解码故障。
   - `X-BXG-Image-Cache: HIT`：确认缓存对象是否为 `image/webp`；PoP 间 Cache API 不共享，换 PoP 仍可能重新转换。
4. Safari 17+ 可原生显示 HEIC 的优化路径应继续保留；iOS 16 Safari 与 Chromium 必须得到 JPEG/WebP。普通 JPEG/PNG/WebP 封面必须做回归检查。
5. 不要在没有新响应证据时继续增加 fallback/重复请求/换 CDN；每次只验证一个假设，并把真实上游回包和结论记入开发日志。

BXG_MEDIA_SECRET 已配置成功，不要再次执行 `wrangler secret put`；本故障与播放 Secret 无关。

### 6. 操作安全

- 不要把 Cloudflare API Token 或 `BXG_MEDIA_SECRET` 放入 Git、截图、DEBUG JSON 或聊天。
- 不要让用户继续重建/Rotate Secret 多次；先通过 Wrangler 对指定 Worker 做一次明确的配置部署，再验收。
- Oracle 免费 AMD 主机：Ubuntu 20.04 x86_64、2 vCPU、约 1 GiB RAM、2 GiB Swap、根盘约剩 29 GiB，网络检查通过；未安装或修改。用户后来选用 Windows VPS，本次后续应继续在 Windows 上，不必再指导 Oracle 安装。


| 文件 | 用途 |
|---|---|
| [AGENTS.md](AGENTS.md) | 后续 GPT／开发者必须遵守的开发、验证与交接规矩 |
| [README.md](README.md) | 项目目标、功能状态与 Pages 部署 |
| [docs/architecture.md](docs/architecture.md) | Functions、匿名 SDK、API 映射与限制 |
| [DEVELOPMENT-LOG-CN.md](DEVELOPMENT-LOG-CN.md) | 单一累计开发日志 |
| [VERSION](VERSION) | 当前版本 |

## 当前版本

**0.1.18 — 2026-11-28**

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
- 0.1.17 明确 HEIC 转换失败时返回 503，不向 Chromium 返回原始 HEIC 假成功；前端停止重复重试；增加代理函数级测试。
- 0.1.18 对需要转换的 HEIC 请求只声明 `Accept: image/webp`，补上 iOS 16 Safari 转换分支和 `9516` 错误码回归测试；CI Run #46115643235 全部通过。但用户最新反馈仍无法显示图片，实际 Worker 部署状态和新响应错误码待确认。
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


## 新对话无缝接手指令（2026-11-28）

新 GPT 接手时，不要先重做已经完成的 0.1.17/0.1.18 工作。先读根目录 `AGENTS.md` 与本文件，再核对两个仓库 main SHA、最新 CI、网站 DEBUG 版本和最新失败 GET。当前任务不是“再设计一个图片方案”，而是查明 0.1.18 仍未解决的线上封面问题。第一条有效动作是核实线上真实版本并取得一条新的失败 GET 响应；有证据后再改代码。每次之后的代码修订，必须在同一轮更新本交接文档和开发日志，见 `AGENTS.md` 的强制规则。
