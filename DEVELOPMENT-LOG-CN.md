# 贝小果 Cloudflare 开发日志

## 0.1.12 — 2026-11-27

### CF 真正预载后续短剧媒体
- 复盘 0.1.11 后确认：CF 侧 6 集只解析了播放地址，没有下载媒体字节，因此它本身不能缩短切集等待。
- 新增 Cache API 媒体预热：对后续 6 集受保护媒体先 HEAD 取长度，最多 32 MiB 的分集由现有 CENC 管线完整拉取、解密并写入 CF 边缘缓存。
- 前 3 集在预读接口返回前完成缓存，浏览器再启动 3 个隐藏 video 预载；其余 3 集通过 waitUntil 后台缓存。
- 媒体缓存用本次加密播放会话 URL 作键，缓存 TTL 不超过令牌有效期；Range 命中后由 Cloudflare Cache API 从完整对象切片返回。
- Workers 配置启用 Workers Cache；Pages Functions 使用 caches.default。跨数据中心的 Cache API 对象不保证复制，未命中会回源。
- 超过 32 MiB 的单集跳过整集预热与公共缓存，不影响原有按需 Range 播放。
- 新增 DEBUG 事件：media.edge-cache.hit / ready / skipped-size / fill-failed，以及播放预热汇总。


## 0.1.11 — 2026-11-27

### 双层短剧预读
- Cloudflare 侧新增批量播放解析接口：播放当前集后，顺序预解析后续最多 6 集的播放地址与短时媒体会话，切集时优先复用，并随播放进度向前补齐。
- 浏览器端最多预载当前集之后 3 集，使用隐藏的 `video preload=auto` 元素；浏览器可按自身策略限制实际下载量。
- 媒体 Range 响应改为 `private` 且缓存时间不超过短时媒体会话有效期，允许浏览器尽量复用区间数据，不进入公共共享缓存。
- 明确区分 CF 侧播放地址预解析与浏览器侧媒体数据预载；CF 不会把 6 集完整视频文件全部下载到边缘内存。


## 0.1.10 — 2026-11-27

### 增强媒体停播诊断
- 用户的 Firefox 诊断包显示播放解析返回 200，服务端成功创建 CENC 加密媒体会话，但 DEBUG 中没有实际媒体 Range／解密事件。原因是浏览器原生 `<video>` 请求不能附带应用 API 的 `X-BXG-Session`；服务端因此把媒体代理错误记进临时会话，原 DEBUG 包无法看到。
- 在 AES-GCM 加密媒体令牌中附带经过校验的匿名诊断会话 ID；媒体请求解封令牌后恢复该 ID，使 Range、布局解析、首区块解密和流式中途失败日志进入同一 DEBUG 包。
- 增加 `media.cenc.stream.failed` 和 `media.cenc.stream.truncated` 事件，捕捉响应已经开始后才发生的解密异常／上游短读。
- 前端 DEBUG 增加浏览器视频 metadata、playing、waiting、stalled、pause、error 状态，记录当前时间、缓冲端点、readyState/networkState 与媒体错误码，不记录播放令牌。
- 修复 DEBUG 自报版本仍是 0.1.6 的问题，版本和静态缓存统一到 0.1.10。
- 当前提交补齐的是诊断链路；部署后仍需再播放一次，才能根据新的服务端错误确认实际停播根因。

## 0.1.9 — 2026-11-27

### Pages 构建中 SDK 播放测试竞态修复
- Cloudflare Pages 构建日志在运行自有 openhongguo 仓库的 `go test ./...` 时，偶发失败于 `internal/media/TestPlayPipesDecryptedStreamIntoVLC`，错误为 `playback stopped`；这不是 Pages Secret 或 WASM 打包失败。
- 在 `xiaobei206/openhongguo` 的提交 `ac32ff5f820203f459cee2f5e36387ea27c92ca8` 修正管道播放结束时的退出状态竞态：播放器已读到 EOF、ffmpeg 已退出，但等待协程尚未把退出结果写入通道时，不再立即误判为用户提前停止。
- 通过本仓库 CI 重新运行构建脚本，以验证它从 openhongguo main 拉取修复后的源码并完成全套 Go 测试、WASM 构建及 Pages／Workers 运行时烟雾测试。


### 修正媒体 Secret 缺失提示与部署文档
- 用户反馈 Pages 与 Workers 都显示“请先在 Cloudflare Worker Secrets 中配置 BXG_MEDIA_SECRET”。检查确认该提示是代码中的固定文字，且 Pages 与 Worker 本来就是独立部署环境，运行时分别读取各自的 `context.env.BXG_MEDIA_SECRET`。
- 新增运行时识别：Pages Functions 返回 Pages 项目配置指引；独立 Worker 返回 Worker 配置指引，并提醒 Production／Preview 环境选择及 Secret 不自动共享。
- 部署教程新增两种 Wrangler 命令和各自的 Dashboard 操作路径。
- 这项修复只改善诊断并说明配置步骤；不会替用户在 Cloudflare 账户中创建 Secret，也不代表生产 Secret 已设置。

## 0.1.8 — 2026-11-27

### 修复 CENC 前后端状态提示
- 修复播放器残留的旧硬编码提示：此前页面在收到“受保护流但没有 src”时仍声称边缘 Range 解密尚未迁移，与 0.1.7 已加入的媒体代理后端代码不一致。
- 新提示区分旧版／前后端不一致的 Cloudflare 部署，并指导更新 main；若真实后端返回 MEDIA_SECRET_REQUIRED，再设置 BXG_MEDIA_SECRET。
- 更新播放器功能说明，不再把受保护 CENC 流统一写成不可播放。
- 将 VERSION、package.json、API 诊断版本、HTML 页脚及静态资源缓存查询参数统一到 0.1.8。
- CI 静态检查增加旧提示禁入规则，防止后续修改再次引入误导文案。
- 这次修复不宣称真实上游视频已端到端验收；最新 CI 是构建与本地运行时测试，不等于生产 CDN 播放验证。

## 0.1.7 — 2026-11-27

### CENC 受保护分集的边缘媒体处理
- 复用独立 Go CENC MP4 布局解析器，在构建时运行原生测试并生成 Cloudflare 可加载的 Go/WASM 模块。
- 受保护播放解析返回同源短时媒体会话地址；内容密钥与 CDN 播放地址放入 AES-GCM 令牌，不以明文返回前端。
- 新增 `/api/v1/media/:token`，支持单个 HTTP Range、Content-Range 校验、按需从上游读取数据及 AES-CTR 样本解密。
- 增加 `BXG_MEDIA_SECRET` Secret 检查；媒体代理不要求 N1 参与视频传输。
- CI 验证令牌安全、Range 解析、CENC 布局测试与 Pages/Workers WASM 初始化；真实上游流的端到端播放仍待验收。

## 0.1.6 — 2026-11-27

### 线上诊断与海报代理
- 根据 0.1.5 的真实诊断包确认：发现页、详情（日志中分别返回 104／116 集）和多季 API 多次 HTTP 200；播放解析有一次返回 ANONYMOUS_LIMITED；当次诊断中的封面 URL 全指向 p3-reading-sign.fqnovelpic.com，浏览器图片加载反复失败。
- 修复 DEBUG 的 isolate 内存盲区：每一个 API 响应现在携带独立 trace ID 和该请求的 Go/WASM、上游请求事件；前端读取响应头并合并到本地诊断包，不再依赖后续请求命中相同 isolate。
- 增加封面图片 CF 代理：只接受 HTTPS 的 *.fqnovelpic.com 域名，限制重定向、图片 MIME 和 10 MiB 大小；前端把这一图片域名的封面改为同源 /api/v1/images 加载。
- 图片失败时自动进行一次 HEAD 诊断，回收边缘 trace、HTTP 状态和错误码。
- DEBUG 的服务端运行状态优先采用本次 API 响应附带的 runtime 状态，避免空白 isolate 将已运行状态覆盖成未初始化。

## 0.1.5 — 2026-11-27

### 运行诊断与 Go/WASM 稳定性
- 首页右上角新增 DEBUG 日志入口，可查看并复制前端与 Cloudflare 边缘诊断包。
- 前端记录 API 请求阶段、状态码、耗时、数据字段摘要、封面 URL 协议统计、浏览器脚本错误及图片加载失败原因。
- Workers/Pages API 增加按匿名浏览器会话隔离的服务端环形日志，记录 Go SDK 调用、上游请求状态／耗时、异常和 WASM runtime 生命周期；最近一小时保留，每会话最多 240 条。
- 日志自动隐藏请求查询参数、完整 URL、Cookie、Token 和长随机串；不记录请求正文或完整剧名／搜索词。
- SDK 构建补丁增加 Go runtime 退出监视与重启逻辑；旧实例退出后清理客户端并重新初始化，失败的初始化 Promise 不再永久缓存。
- CI 新增连续 Go→JavaScript transport 回调测试，并在本地 Workers runtime 内执行无外网模拟探针；不再只检查 SDK 是否能创建客户端。


## 0.1.4 — 2026-11-27

### 首页部署指导
- 主页顶部新增“部署教程”入口，直接说明 GitHub 授权连接 Cloudflare Pages 的步骤和构建参数。
- 明确提示控制台 ZIP／文件夹拖放不会编译 `functions/`；提供 Wrangler 手动部署和 Workers 备用路线。
- 从应用内直接链接完整中文教程和 Cloudflare 官方 Pages Git 集成文档。
- 修正页脚仍残留的“只在你的家庭网络中提供服务”，改为 Cloudflare 边缘部署说明。
- 统一 `VERSION`、`package.json`、Functions 版本、HTML 缓存参数及页脚为 0.1.4；增加 CI 规则防止安装教程和公网部署文案退化。


## 0.1.3 — 2026-11-27

### 部署体验与封面显示
- 新增中文 Cloudflare 部署教程，比较 Pages + GitHub、Pages Wrangler Direct Upload、控制台拖放和 Workers Builds。
- 新增独立的 `worker.js` 与 `wrangler.worker.jsonc`，Worker 路线复用同一套 Pages API handler；静态资源通过 Workers Static Assets 提供。
- 增加 Workers runtime smoke test，并把构建入口检查纳入 CI。
- 修复封面 URL 过滤器：原逻辑只接受本地图片代理路径，导致 HTTPS 上游封面会被前端丢弃；现允许 HTTPS 外部封面并拒绝不安全协议及 URL 凭据。
- 修正 Cloudflare 轻量版 UI 中“家庭局域网”文案、旧错误版本号和误导性的设置按钮文案；一并修正播放器仍声称由 N1 读取／解密、把所有流称作 MP4 的过时说明。
- KV 仍非必需依赖；匿名 SDK 状态暂存在内存，是否持久化待真实请求及冷启动测试后决定。


## 0.1.2 — 2026-11-27

### 预编译 WASM 模块
- 运行时测试确认：Cloudflare Worker 不允许通过普通二进制字节执行 WASM 动态编译。
- 改用 Wrangler 的 `CompiledWasm` 模块规则，将 SDK 二进制在构建时处理为预编译的 `WebAssembly.Module`。
- 调整 SDK 兼容补丁，使同一套初始化逻辑同时支持 Node 的字节数组结果和 Workers 的预编译模块结果。
- 统一更新 VERSION、package.json、Functions 版本和 HTML 资源缓存查询参数。
- CI 运行时烟雾测试已通过：Wrangler Pages Functions 启动成功，`/api/v1/health?sdk=1` 返回 SDK ready；测试未请求上游片库。

## 0.1.1 — 2026-11-27

### Cloudflare WASM 加载适配
- 增加 Pages Functions 本地运行时烟雾测试，实际访问 `/api/v1/health?sdk=1` 并检查 SDK 初始化。
- 测试发现 Node SDK 使用动态 `require(.../dist/wasm_exec.js)` 时，Worker 运行时无法按原路径找到模块。
- 增加静态导入 Go 的 `wasm_exec.js`，并对固定的 `openhongguo@0.4.0` 加入版本校验后的构建时兼容补丁。
- 随后测试又发现 Worker 禁止用原始 WASM 字节动态编译，因此继续改为 0.1.2 的预编译模块方案。

## 0.1.0 — 2026-11-27

### 初始项目与 Cloudflare 迁移底座
- 新建独立的 Cloudflare 轻量版仓库，与 N1 正式项目保持隔离。
- 迁移原版原生 HTML、CSS、JavaScript、PWA manifest 和 192/512 图标，不引入大型前端框架。
- 增加 Pages Functions API 入口，接入 openhongguo Node.js/WASM 匿名 SDK，并注入 Fetch Transport。
- 增加浏览器匿名会话标识，同一 isolate 存续期间为每个会话分别复用 SDK profile；不增加用户账号或个人资料库。
- 建立推荐、搜索、联想、热搜、新剧、榜单、详情、分集、多季及播放源解析 API 适配。
- 明确标记尚未迁移的能力：CENC 受保护流、N1 磁盘缓存/常驻预热和家庭 LAN 电视接力。
- 增加静态资源检查、Node SDK 初始化测试及 Cloudflare Functions 打包检查。
