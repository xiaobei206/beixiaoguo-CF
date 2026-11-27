# 贝小果 Cloudflare 版：架构与部署

## 目标

- 保留原版原生 HTML / CSS / JavaScript UI。
- 静态资源可部署在 Cloudflare Pages 或 Workers Static Assets。
- 不运行常驻服务器；请求逻辑由 Pages Functions 按需执行。
- 保持匿名，不增加账号系统或用户资料库。
- 不把占位功能写成已完成。

## 部署结构

浏览器
  ├─ HTML / CSS / JavaScript / PWA
  └─ /api/v1/*
       ├─ Cloudflare Pages Functions（wrangler.jsonc）
       └─ Cloudflare Worker（worker.js + wrangler.worker.jsonc）
            └─ openhongguo Node.js/WASM SDK
                 └─ 红果上游接口

Pages Function 中使用 openhongguo 的 Node.js/WASM SDK，注入基于 Fetch 的 Transport。由于 SDK 默认通过 Node 的动态 `require()` / 文件路径读取 WASM，Cloudflare 构建阶段用 `scripts/patch-openhongguo.mjs` 做一个受版本校验的兼容补丁；`functions/openhongguo-runtime.js` 静态导入 `wasm_exec.js` 和预编译的 `WebAssembly.Module`（Wrangler `CompiledWasm` 规则），避免边缘运行时动态查找模块或动态编译 WASM。匿名设备 profile 在边缘 isolate 的内存中按浏览器会话标识分开保存，不写入数据库。边缘 isolate 冷启动后内存会重置，必要时 SDK 会重新注册匿名设备。构建补丁暴露 Go runtime 生命周期；若底层 WASM 退出，API 层会清理旧客户端并尝试重建 runtime。每个 API 响应还会附带独立 trace ID 和本次请求事件，不依赖后续请求命中同一个 isolate。

## API 迁移

已建立：health、discover、search、suggest、hot-search、new-releases、rank、series detail/episodes/seasons、playback resolve。

播放解析为受保护的渐进式 MP4 建立 AES-GCM 加密的短时媒体会话令牌；媒体请求由同源 /api/v1/media/:token 代理校验 HTTP Range，Go/WASM CENC 布局解析器按需把相交的 MP4 元数据与 AES-CTR 样本块还原为可播放字节。明文内容密钥不会返回到浏览器 JSON 或 URL；生产 Worker 必须配置 BXG_MEDIA_SECRET。

## 浏览器自选 Cloudflare 入口 IP（0.1.13）

前端提供本机线路列表，支持自填 IPv4／IPv6、固定端口 443；线路内容与选择保存在浏览器 localStorage。选择后只发起一次同源 `/api/v1/route?alt_ip=...` 请求，将 IP 放在 URL 查询参数中，不设置线路 Cookie。Worker 读取请求的 `Alt-Used` 并将其放进边缘诊断；前端检查最终响应是否带有目标 `Alt-Svc`。

Cloudflare 会过滤 Worker 源站直接添加的 `Alt-Svc`，所以要在 Cloudflare Zone 的 Response Header Transform Rules 阶段动态补充。规则使用 `http.request.uri.args["alt_ip"][0]` 读取本次公告请求中的 IP，并公告 `h2="IP:443"; ma=300`；选择默认线路时设置 `Alt-Svc: clear`。`http.request.uri.args` 可用于查询参数，避免依赖 Pro 版才提供的 `http.request.cookies` 字段。这要求绑定用户自己的橙云自定义域名；`workers.dev`／`pages.dev` 默认域名不在用户 Zone 内，无法配置该规则。Alt-Svc 是备用服务提示，只用于后续新连接，不会强制中断现有连接；备用 IP 必须支持原始站点域名的 TLS SNI、证书验证与 HTTP/2。仅能跑 VLESS 不足以证明浏览器接入可用。

## 运行诊断

首页右上角的 DEBUG 入口可复制前端和边缘服务端诊断包。前端记录 API 状态／耗时、响应字段摘要、封面 URL 协议分布和资源加载错误；每个 API 响应通过响应头返回该次请求的 trace ID、Go/WASM 状态和上游请求事件，因此 Cloudflare 将后续请求分配给不同 isolate 时，仍能保留本次调用的诊断信息。边缘端按 `X-BXG-Session` 隔离的内存日志仍作为辅助记录，最多保留一小时、每会话 240 条；前端本地保留最近 180 条。敏感查询参数、Cookie、Token 和完整 URL 会脱敏。日志不包含请求正文。

## 已知限制

1. CENC 支持范围：已迁移渐进式 MP4 CENC AES-CTR、senc/saiz/saio 辅助信息与任意 Range 解密；HLS/DASH、独立音轨及其他 DRM 封装不在本实现范围内。真实上游分集仍需端到端验收。
2. 电视接力：公共边缘函数无法直接对用户家庭 LAN 执行 mDNS 或原始 TCP；需要原版 N1 或可访问 LAN 的配套助手。
3. 图片代理与磁盘缓存：轻量版直接使用上游封面地址，暂不提供 N1 的 RAM + 磁盘两级缓存及预热调度。
4. 播放兼容性：取决于浏览器对 MP4/HLS、CDN Range/CORS 和编码的支持，应在 iOS Safari、Android Chrome 和桌面浏览器分别验收。
5. SDK 环境兼容性：Pages Functions 运行时烟雾测试验证 WASM 可初始化；Workers 入口使用独立的 Wrangler 配置及运行时烟雾测试。真实上游接口仍需单独验收。

## Cloudflare Pages 配置

- Framework preset：None
- Build command：npm run build
- Build output directory：public
- Production branch：main

仓库根目录 functions/ 自动被 Pages 识别。wrangler.jsonc 用于本地 Functions 开发和兼容性设置。

## Workers 部署目标

`worker.js` 包装并复用同一份 `functions/api/v1/[[path]].js` API 实现；非 API 请求通过 `ASSETS` 绑定交给 Workers Static Assets。通过 `wrangler.worker.jsonc` 独立部署，不修改 Pages 的 `wrangler.jsonc`。在 Workers Builds 中应使用 `npm run build` 作为 Build command，并用 `npx --yes wrangler@latest deploy --config wrangler.worker.jsonc` 作为 Deploy command。

## Cloudflare 边缘媒体预热（0.1.12）

CF 侧的 6 集预读现在不止解析播放地址：对后续 6 集受保护 MP4，后台先用 HEAD 确认媒体长度；不超过 32 MiB 的分集再通过现有 CENC 解密管线读取完整媒体，并以 200 响应写入 Cloudflare Cache API。前 3 集在预读 API 返回前完成边缘缓存，后 3 集通过 `waitUntil` 填充。浏览器随后启动 3 个隐藏 video 预载，Range 请求优先命中完整媒体缓存并由 Cache API 切片为 206。缓存键是本次播放的加密媒体 URL，TTL 不超过会话到期时间，不把内容密钥暴露给缓存键以外的客户端数据。超过 32 MiB 的分集不做整集预热，仍走原有按需 Range 回源与 CENC 解密。

Workers 入口同时启用 Workers Cache，使完整 200 媒体响应还能进入 Worker 自身缓存；Pages Functions 使用 `caches.default`。Cache API 是数据中心本地缓存，未命中时自动回源，因此跨数据中心不保证复用同一份预热对象。

## 双层播放预读（0.1.11）

播放当前集后，前端调用 `/api/v1/prefetch`，让 Cloudflare Worker/Pages Functions 顺序预解析后续最多 6 集的播放地址；受保护 CENC 分集同时生成短时加密媒体会话。切集时优先消费已预解析会话，预读窗口随播放进度向前补齐。浏览器端只为当前集之后最多 3 集创建隐藏的 `video preload=auto` 元素，利用同源媒体地址和短时 `private` Range 缓存尽量复用已获取的数据。浏览器可能忽略 preload 提示，因此它不等价于保证三集完整下载。Cloudflare 端的 6 集是播放地址／会话预解析，不是把六集完整媒体文件预存到边缘缓存。

## 后续优先级

1. CI 验证 Pages Function 打包、WASM 加载与 Worker 运行时。
2. 用真实上游响应确认推荐、搜索、详情、榜单、新剧和多季字段。
3. 用真实受保护分集端到端验收边缘媒体 Range 代理与 CENC 解密；对不支持的封装明确提示。
4. 优化封面图片格式回退和 HTTP 缓存。
5. 保留电视接力给原版 N1，或设计本地 LAN 助手。

## 部署教程

Pages 与 Workers 的完整配置、GitHub 授权、ZIP／目录上传限制、CLI 命令及验收步骤见 [docs/deploy-cloudflare-cn.md](deploy-cloudflare-cn.md)。


## CENC 边缘媒体链路

edge-cenc/cenc 保留 N1 的 MP4 CENC 布局解析与任意 Range 解密实现，并在构建时运行原生 Go 测试、生成独立 Go/WASM 模块。播放解析得到的内容密钥只用于生成 AES-GCM 加密会话令牌；Worker 用 Secret BXG_MEDIA_SECRET 跨 isolate 解封令牌，按字节范围读取 CDN 数据，再通过 WASM 解密当前媒体块。明文源地址和密钥不会以可直接读取的形式写入播放 URL。
