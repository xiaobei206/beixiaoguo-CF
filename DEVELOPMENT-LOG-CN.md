# 贝小果 Cloudflare 开发日志

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
