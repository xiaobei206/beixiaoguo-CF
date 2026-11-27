# 贝小果 Cloudflare 交接索引

## 当前排障交接（2026-11-27；新对话请先读）

> **当前主线任务：修复独立 Cloudflare Worker 在受保护播放时读不到 `BXG_MEDIA_SECRET`，并以真实播放成功作为验收。** 不要重新从头排查，不要继续让用户反复 Rotate。

### 1. 已证实的故障现象

- 生产地址：`https://w.hiu.us.kg/`。
- Worker：`beixiaoguo-cf-worker`，生产环境 Production；Cloudflare Domains 页面显示自定义域 `w.hiu.us.kg` 绑定到了该 Worker。
- 用户在该 Worker 的 Settings → Variables and Secrets 中确认：类型为 `Secret`、名称为 `BXG_MEDIA_SECRET`、环境为 Production。
- 播放接口 `GET /api/v1/play/:episodeId` 仍返回 HTTP 503 / `MEDIA_SECRET_REQUIRED`。
- 最新用户 DEBUG 样本（2026-11-27 15:55 UTC 左右）包含：
  ```json
  {
    "runtime": "Cloudflare Workers",
    "host": "w.hiu.us.kg",
    "secretBound": false,
    "secretLengthValid": false
  }
  ```
  这说明当前请求执行时的 `env.BXG_MEDIA_SECRET` 不是字符串；`secretLengthValid:false` 是同一检查的结果，不应误判为仅仅密钥太短。
- 同一调试包中 SDK 初始化正常，推荐、详情、上游播放信息请求均返回 200；故障发生在本项目生成受保护媒体会话前，不是上游播放 API 或 CENC 解密阶段。
- 上一轮让用户尝试从 Dashboard Rotate 并保存 Secret；Dashboard 没显示 Deploy 按钮，随后又尝试按部署历史菜单 Retry build，但新构建后提供的 DEBUG 仍为 `secretBound:false`。最新 Active Deployment ID 在最近一次新测试之后尚未重新核实。
- 上次用户分享的 Deployment 页面显示 Active Deployment `3dce3a88`，commit 为 `fcea543d5762176ff52cfc4927b61c9289561643`，message 为 `fix(media): diagnose Worker media secret in direct playback (0.1.14)`，Source=Build / main / Ready，时间为 2026-11-27 14:59:23 UTC。不要假定 Retry build 一定让 secret 绑定生效。
- 之前在聊天中生成过一串 64 位密钥并建议用户输入 Dashboard。该值曾在聊天中明文出现；最终配置时请使用本机重新生成的强随机值，通过 Wrangler 的交互提示直接输入，绝不要再把密钥放入 Git、调试包或聊天中。

### 2. 仓库与代码状态

- 维护仓库：`xiaobei206/beixiaoguo-CF`，当前 main 为 `fcea543d5762176ff52cfc4927b61c9289561643`。
- 部署 fork：`qmancf206/beixiaoguo-CF`。最近检查时其 main 与维护仓库都在该 `fcea543d...` commit；用户的 Windows VPS 正是从这个 fork 克隆项目。
- Wrangler Worker 配置：`wrangler.worker.jsonc`；Worker 名称 `beixiaoguo-cf-worker`，入口 `worker.js`。
- `worker.js` 会把 Worker 的 `env` 原样传给 `functions/api/v1/[[path]].js`。播放逻辑读取 `context.env?.BXG_MEDIA_SECRET`；名称与调用代码一致。现有配置文件未声明同名普通变量。
- 0.1.14 补上了直接播放分支的诊断事件 `media.secret.missing`，仅记录 bool 状态，不记录密钥值。部署提交链接：
  `https://github.com/qmancf206/beixiaoguo-CF/commit/fcea543d5762176ff52cfc4927b61c9289561643`
- 维护仓库当前对部署 fork 没有写权限；若需同步文档/代码改动，先推送到维护仓库，再由用户 Sync fork。单纯写交接记录不应更改业务代码。

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
- **截至本交接时，用户尚未提供 `npm.cmd test` 的执行结果。** 下一步先跑测试，而不是继续装工具或重新克隆。

### 4. Windows VPS 下一条命令

在 PowerShell 中进入项目目录后（工具文件已安装，依赖已安装），执行：

```powershell
Set-Location D:\beixiaoguo-CF
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

如测试失败，先修复第一个真实 Error；不要升级 npm（当前 10.9.9 足够），不要重装 Node/Go/Git，不要重新克隆，不要把整份长日志都复制出来。

### 5. 测试通过后的部署计划

1. 先确认本地项目配置的 Worker 名为 `beixiaoguo-cf-worker`，并以 `npx.cmd wrangler whoami` 确认 Cloudflare 登录账号正确。
2. 可先尝试 `npx.cmd wrangler login` 使用浏览器授权；若不可用，再为正确账号创建最小权限 API Token，且不要在聊天里贴 Token。
3. 不要把 Secret 放在源码、`.env`、命令行参数、GitHub 或日志里。建议在本机 PowerShell 用 .NET 的 `RandomNumberGenerator` 生成 32 bytes / 64 hex 字符的新值，直接在 `npx.cmd wrangler secret put BXG_MEDIA_SECRET --config wrangler.worker.jsonc` 的交互提示中粘贴；该命令会触发 Worker 新版本部署。先确认账号、Worker 名称和当前部署 fork，然后再执行，避免误部署到其它 Worker。
4. 观察命令是否成功，并在 Cloudflare Deployments 确认新版本进入 Active Deployment。
5. 在 `https://w.hiu.us.kg/` 刷新并重新播放；DEBUG 必须显示 `secretBound:true` 与 `secretLengthValid:true`，并且实际视频可以播放。仅仅显示部署 Ready 不算验收。
6. 如果 Wrangler 更新后还是 `secretBound:false`，停止再次轮换 Secret。改查部署流水线是否覆盖 bindings、Cloudflare Build/Production service 关联以及实际生效版本；记录新的 Active deployment ID 和 `X-BXG-Trace-ID`，不要暴露密钥。

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

**0.1.14 — 2026-11-27**

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
- 0.1.14 修复 `/api/v1/play/:episodeId` 在 `MEDIA_SECRET_REQUIRED` 时未写入 `media.secret.missing` 诊断的遗漏；补充 `secretBound` 和 `secretLengthValid` 两个布尔值，不记录密钥本身。先看新诊断再决定是否重建 Secret。
- 0.1.13 增加浏览器本地自选 CF 反代 IP 管理器，支持 IPv4／IPv6，只填写 IP、固定 443，列表和选择保存在本机。选择时通过一次 `/api/v1/route?alt_ip=...` 同源请求提交 IP，Worker 校验地址后经内部响应头交给 Cloudflare Zone 响应头规则，以动态 Alt-Svc 公告备用入口；随后删除内部头，不写 Cookie，也不依赖 Pro 专属规则字段；新增 Alt-Used 诊断。真正切换必须绑定自有橙云域名并配置四条 Response Header Transform Rules；workers.dev／pages.dev 默认域名上仅保存 IP，不会切换。
- 0.1.13 对 MEDIA_SECRET_REQUIRED 增加安全运行时诊断 `media.secret.missing`，记录当前运行时以及 Secret 绑定／长度状态，不记录 Secret 值。仍需以实际 Worker 请求 DEBUG 为准，不能据此认定 Cloudflare 生产环境 Secret 已成功读取。
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
