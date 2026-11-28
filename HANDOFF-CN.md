# 贝小果 Cloudflare 交接索引

## 当前排障交接（2026-11-28；0.1.20 开发中）

### 最新真实证据与结论
- 用户在生产 0.1.19 的“上游探测”报告（2026-11-28T09:23:56Z）证明：原始签名 HEIC URL 的 7 组 Accept-only GET 全部 HTTP 200、MIME 为 `image/heic`、长度 42,741 字节。源站不按 Accept 改输出格式。
- 将路径后缀改成 .webp/.avif/.jpeg 均 HTTP 403 Tengine 签名／权限拒绝；这只能证明改写后的签名不合法，不能证明格式不支持。追加 `x-tos-process` 与 `x-oss-process` 查询参数仍返回 HEIC，没有观察到这些参数生效。
- **排障结论：** 这条已签名模板 URL 在当前配置下固定返回 HEIC；请求头协商不起作用。无法仅靠 Worker 改写路径而保留有效签名。上游签发逻辑若能签发明确 WebP/JPEG 模板 URL，是更理想的源头修复，但当前客户端没有签发密钥/接口。
- 参考官方 VeImageX 文档：图片输出格式可在模板/签发 URL 中指定；格式自适应需要模板启用，并非任意 Accept 都自动转码。文档说明通用机制，不证明这条签名 URL 还能通过某个未测试参数变格式。
- **0.1.20 目标：** 保留常规 Cloudflare WebP 转换作为快路径；该路径失败时，从受限同源 API 取原始 HEIC/HEIF，浏览器用自托管 `heic-to` 解码为 JPEG。签名 URL 只在当前页面/请求内存流转，不改写签名、不上报到第三方；原生 JPEG/PNG/WebP 不变，Safari 17+ 原生 HEIC 路径不变。
- 维护仓库 0.1.20 代码提交：`6d4a5f695fd26fa6b3c72d5212fbb2934931f9d1`。初次 CI [#46131317865](https://github.com/xiaobei206/beixiaoguo-CF/actions/runs/46131317865) 的 Linux `npm test` 因静态检查仍要求旧错误动作字符串 `skip-duplicate-transform-and-show-placeholder` 而失败；运行日志已定位，实际新动作是 `client-heic-conversion-fallback`，本轮同步修正校验并重跑 CI。Windows 同一轮仍在运行时先读到该结果。此代码未经新 CI 通过之前不可部署；生产仍未升级到 0.1.20。真实验收尚未完成，必须在 iPhone 13 / iOS 16 Safari 与 Chromium 实测后才能标记问题已解决。维护主线 `xiaobei206/beixiaoguo-CF`；部署 fork `qmancf206/beixiaoguo-CF` 需要独立确认同步与 Worker Build 状态。


### 历史记录：0.1.19 上游图片探测 DEBUG 专版（2026-11-28)

- **生产真实证据：** 0.1.18 的封面 GET 返回 503 `IMAGE_TRANSFORM_UNAVAILABLE`，`X-BXG-Transform-Error-Code: 9516`，`X-BXG-Image-Cache: MISS`，`X-BXG-Image-Transform: unavailable`；trace `d8b61985-9bb0-4869-aed5-df8e2cac841b` 显示 Cloudflare 转换 HTTP 422，并明确为 HEIC 解码失败。
- **新版本代码：** 维护仓库提交 `31bf7de998402c1bede170e8aff0f55e8274b468`，版本 0.1.19；CI Run [#46127619086](https://github.com/xiaobei206/beixiaoguo-CF/actions/runs/46127619086) 已通过（Linux build-and-smoke、Windows npm test 均成功）。部署 fork 仍为 0.1.18 的 `cc94107d0cd0fcd4805234804775f6e3859ff665`；0.1.19 尚未部署。
- **诊断设计：** 主页增加“上游探测”按钮和独立弹窗，失败的原始 HEIC/HEIF URL 只暂存在页面内存中；后端用不带 `cf.image` 的普通 Worker GET 对同一 URL 测 7 组 Accept（WebP、AVIF、HEIC、JPEG/PNG、浏览器常见、全格式优先序、不显式设置），另测 .webp/.avif/.jpeg 路径变体和历史 `x-tos-process`/`x-oss-process` 参数。正常封面链路不变。
- **安全和判读：** 只允许 HTTPS `*.fqnovelpic.com`，手动跟随最多 2 次且重定向仍须在此域；最多 3 路并发、每项 5 秒、每会话 30 秒限一次；成功图片只读响应头后取消 body，错误文本限 512 字节；结果不会回显完整 URL、签名或 expiry。修改过 URL 的变体可能因签名校验返回 403，不能当作该格式不受支持。
- **接下来：** 等 CI Run #181 完成。通过后才同步部署 fork；验证生产健康接口为 0.1.19，点击“上游探测”并把结果报告带回。先以真实结果判断是否可直出 WebP/AVIF/JPEG，再决定后续是否改正式图片请求。当前不能说封面已经恢复。

## 历史排障交接：0.1.19 上游探测部署前状态

> **当前主线：0.1.19 上游图片探测诊断版已提交维护仓库且 CI 已通过，但尚未同步部署。** 用户最新真实生产 GET 确认应用运行 0.1.18，图片代理返回 503 `IMAGE_TRANSFORM_UNAVAILABLE`；诊断头 `X-BXG-Transform-Error-Code: 9516`，边缘 trace `d8b61985-9bb0-4869-aed5-df8e2cac841b` 的事件说明 Cloudflare 图片转换 HTTP 422，错误正文明确为 HEIC 解码失败。此问题未解决；0.1.19 不改正式图片代理，只添加独立探测工具。

> **Cloudflare 来源白名单结论保持不变：** Images source allowlist 针对 `/cdn-cgi/image/` URL 转换，不适用于 Worker `fetch()` 子请求上的 `cf.image`。不要为了这个故障新增来源白名单或开放 Any origin。VeImageX 格式自适应优先级为 HEIC > AVIF > WebP；官方文档也存在模板输出格式、旧式 `x-tos-process` / `x-oss-process` 图片处理参数。它们是待探测线索，并不证明当前签名模板支持改写。

### 1. 已证实的故障现象

- 生产地址：`https://w.hiu.us.kg/`；用户本次提供的 DEBUG 显示页面/应用版本 `0.1.18`，因此生产路由实际返回了 0.1.18。
- 用户最新失败 GET：HTTP 503；`X-BXG-Error-Code: IMAGE_TRANSFORM_UNAVAILABLE`；`X-BXG-Image-Cache: MISS`；`X-BXG-Image-Transform: unavailable`；`X-BXG-Transform-Error-Code: 9516`。trace 为 `d8b61985-9bb0-4869-aed5-df8e2cac841b`。
- `X-BXG-Debug` 事件顺序：`image.cache.miss`（format=`webp`）→ `image.transform.unavailable`（上游转换 HTTP 422、`text/plain`、错误码 `9516`）。错误文本明确为 `Error while decoding the HEIC file`，不是 9422 额度耗尽。
- 原始图片在 `p3-reading-sign.fqnovelpic.com`，路径使用 `~tplv-...:400:0.heic` 模板模式，签名/过期参数必须保密。只在浏览器内存中临时留存用于主动探测，不得写入日志、源码、交接文档或提交内容。
- 0.1.18 的源站 Accept 尝试未解决问题。下一步不再改正式代理；先运行 0.1.19 探针，比较同一 URL 的不同 Accept 返回格式，再把修改路径后缀和历史查询参数变体作为独立实验。改写后的 403/签名错误不能视为格式不支持。

### 2. 仓库与代码状态

- 维护仓库：`xiaobei206/beixiaoguo-CF`，`main` 代码提交 `31bf7de998402c1bede170e8aff0f55e8274b468`，版本 `0.1.19`；CI Run [#46127619086](https://github.com/xiaobei206/beixiaoguo-CF/actions/runs/46127619086) 已通过，包含 Linux build-and-smoke 与 Windows npm test。可以准备快进同步部署 fork，但生产验收必须等 Worker Build 完成。
- 部署 fork：`qmancf206/beixiaoguo-CF` 的 `main` 仍为 `cc94107d0cd0fcd4805234804775f6e3859ff665`，仅包含 0.1.18；Cloudflare 对该旧 SHA 的检查套件 [#124755836973](https://api.github.com/repos/qmancf206/beixiaoguo-CF/check-suites/124755836973) 曾报告成功，不能当成 0.1.19 已部署。
- 本次提交新增 `functions/image-probe.js`、`scripts/test-image-probe.mjs`、`POST /api/v1/debug/image-probe`、主页“上游探测”按钮和独立弹窗。正常的 `proxyCoverImage()` 正式图片请求流程没有改变。
- 探针限制：只接受 HTTPS `*.fqnovelpic.com`、无端口/凭据且 HEIC/HEIF 后缀的 URL；12 组 GET、最多 3 路并发、单项 5 秒、最多跟随 2 次同图片域重定向；每会话 30 秒一次；只读取响应头/Content-Length 和最多 512 字节错误文本；报告不含完整 URL、签名、过期值。改写路径/查询参数的实验可能被签名校验拒绝。
- 仓库连接没有部署 fork 的写权限。CI 通过之后由有权限的账号在部署 fork 执行 Sync fork → Update branch，再确认 Worker Build 成功及生产 `GET /api/v1/health` 返回 `0.1.19`；最后在生产主页运行探测、复制报告。未经这些步骤不得宣布已部署/已修复。

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

### 5. 历史待办：该项已由 0.1.19 上游探测报告更新

用户已提供最新 0.1.18 生产失败 GET；错误码 9516 与 HEIC 解码失败已经确认。0.1.19 是独立诊断工具版，CI 已通过但仍未同步部署，不能把 Mock 测试结果当成实际源站验证。

运行步骤：

1. 维护仓库 CI Run [#46127619086](https://github.com/xiaobei206/beixiaoguo-CF/actions/runs/46127619086) 已通过；接下来由有权限账号同步部署 fork，不能因 CI 通过而直接宣称生产已升级。
2. 将维护仓库的 0.1.19 快进同步到 `qmancf206/beixiaoguo-CF`；由 Cloudflare Worker Build 部署后访问 `GET /api/v1/health`，确认 `version=0.1.19`。
3. 打开主页“上游探测”。通常会自动带入本次失败的 HEIC 源 URL；如果为空，在页面上粘贴浏览器内的原始 URL。点击“开始 12 组 GET 探测”，复制探测报告即可，不要另行复制完整签名 URL。
4. 重点看未修改 URL 的 `accept-webp`、`accept-avif` 和 `accept-unset`：
   - 若 `accept-webp` 返回 `200 image/webp`，可证实普通 Worker fetch 能从源站直接获取 WebP，后续可评估绕开 `cf.image` 的正常路径改造。
   - 若只有 `image/avif` 成功，记录模板/Accept 对应结果，再决定客户端与正式返回格式。
   - 若所有 Accept-only 仍返回 HEIC，则查看模板/后缀与旧式参数试验；任何已改 URL 的 403/签名错误不能得出格式不支持结论。
   - 若原 URL 的 Accept-only 全部 403，先判断签名是否过期；那一轮无法判断格式协商行为。
5. 只有取得真实报告之后，才做正式封面链路的下一步修改；保持 Safari 17+ 原生 HEIC 兼容路径，所有非原生 HEIC 浏览器必须得到可显示格式。更新代码或测试后在同一轮再次同步本交接与开发日志。



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

**0.1.19 — 2026-11-28**

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
- 0.1.18 对需要转换的 HEIC 请求只声明 `Accept: image/webp`，补上 iOS 16 Safari 转换分支和 `9516` 错误码回归测试；CI Run #46115643235 全部通过。但用户提供的实际生产 GET 仍返回 503/9516，说明 0.1.18 未解决该问题。
- 0.1.19 新增独立的“上游图片探测”调试界面与受限诊断 API。只用普通 Worker GET 测 12 个 Accept/URL 变体，不使用 `cf.image`，也不更改正式封面代理；已加入 Mock 回归测试及版本一致性检查。提交 `31bf7de998402c1bede170e8aff0f55e8274b468` 的 CI Run #46127619086 当前需继续核对；必须部署后跑真实探测才能判断源站是否能直出 WebP/AVIF/JPEG。
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

新 GPT 接手时，先读根目录 `AGENTS.md`、本文件和开发日志顶部。最新源站探测已经证明 Accept 与 URL 变体不能让签名源输出 WebP；勿重跑那 12 组探测。0.1.20 的第一动作是确认并修复静态检查，然后核对 CI [#46131317865](https://github.com/xiaobei206/beixiaoguo-CF/actions/runs/46131317865) 的最终状态；首轮 Linux job 因旧文案断言失败，修正后必须重新跑完整 CI。未经 CI 全通过，不得同步部署 fork。部署后先确认生产 `/api/v1/health` 版本为 0.1.20，再在 iPhone 13 / iOS 16 Safari、Chromium 测首页封面、详情封面和普通 JPEG/PNG/WebP。每次修订后本轮同步更新本交接文件与开发日志；CI 或真实浏览器尚未验证时必须明确标记，不能宣称问题已修复。
