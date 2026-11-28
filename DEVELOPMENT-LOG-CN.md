## 0.1.21 — 2026-11-28：移除 Cloudflare 图片转码，修复 iOS 本地转码链路

### 用户反馈与依据
- 用户提供 iPhone 13 / iOS 16.1 Safari 的 0.1.20 DEBUG：片库 API 请求均为 HTTP 200，但 HEIC 封面资源报错；没有出现本地转码成功或失败事件。
- 代码复核发现疑似 IMG 生命周期竞争：转码启动前先将 IMG 的 src 切换成临时 data GIF，错误处理可能移除该 IMG，异步转码随后因节点脱离 DOM 而退出。该解释仍需部署后真机复核，不当作已证实的唯一根因。

### 实施内容
- 删除边缘图片代理的 `cf.image` WebP 转换、转换错误处理和转换成品缓存；Workers/Pages 只代理原图字节并保留图片域名、重定向、MIME 和 10 MiB 限制。
- HEIC/HEIF 图片从一开始就走原图代理；Safari 17+ 原生显示，iOS 16 Safari 和 Chromium 等由自托管 `heic-to@1.6.7` 本地转成 JPEG。最多两个并发解码。
- 不再在解码前将失败 IMG 替换成临时 data 像素；转换期间隐藏原 IMG，生成 JPEG Blob 后再设置 src 并恢复可见。新增开始、失败阶段、显示失败等诊断事件。
- 更新版本为 0.1.21，修改代理回归测试与静态检查，确保任何 UA/图片路径都不设置 `cf.image`。

### 测试、提交、部署边界
- 维护仓库代码提交：[`b9075a85c504ebcd988c05f7d4ef27d56d9dcf50`](https://github.com/xiaobei206/beixiaoguo-CF/commit/b9075a85c504ebcd988c05f7d4ef27d56d9dcf50)。
- - 0.1.21 代码 CI [#46136309833](https://github.com/xiaobei206/beixiaoguo-CF/actions/runs/46136309833) 已全部通过：Linux `npm test`、静态检查、Pages Functions bundle/runtime smoke、Workers bundle/runtime smoke，以及 Windows `npm test` 均成功。此结果验证代码和 mock/构建路径，不替代真实 iPhone Safari 或线上部署验收。
- 部署 fork 最近核实仍为 `daac14ffd47919e04677889ec348be7db1a544b6`，未同步 0.1.21；Worker Build 状态未知。iPhone 13 / iOS 16 Safari 真机测试待做，不能将 CI 通过等同于图片已经修复。
- 下一步：CI 结束后按结果处理；同步 fork 并确认生产健康接口版本为 0.1.21；真机重新测试，若失败根据新日志 `stage` 字段定位。

---

## 0.1.20 — 2026-11-28：浏览器本地 HEIC 解码回退

### 根据 0.1.19 真实探测报告更改方案
- 用户报告证实：同一签名 URL 的全部 Accept-only GET 返回 HTTP 200 `image/heic`；改路径后缀得到 403；追加 `x-tos-process` / `x-oss-process` 参数仍返回 HEIC。请求头协商或随意改 URL 都不能解决当前签名模板输出问题。
- 保留现有 Cloudflare WebP 转换作为首选快路径；新增仅用于明确 `mode=source` 的受限源图 GET 分支。它只允许 HTTPS `*.fqnovelpic.com` 的 HEIC/HEIF GET，不能接收 HEAD/其他格式，不使用 `cf.image`，仍受原有重定向和 10 MiB 图片大小限制。
- 前端第一次遇到不支持 HEIC 的浏览器封面转换失败后，按需下载自托管 `heic-to@1.6.7` IIFE 解码器，把原始 HEIC 转成 JPEG Blob URL；解码器不从第三方 CDN 加载，签名 URL不进入日志/DEBUG/本地存储，不发送给第三方；同时最多运行 2 个封面转换。后续 HEIC 图片改走 source-only，以避免重复触发已证实失败的 Cloudflare HEIC 解码。
- `scripts/copy-heic-to.mjs` 在 build/test 前复制 vendor IIFE 和 LGPL-3.0 许可证到静态输出；生成文件被 gitignore，避免提交打包产物。新增客户端回退静态测试，并扩展生产代理函数测试验证 source-only 不调用 `cf.image`。
- 普通 JPEG/PNG/WebP 处理不变；Safari 17+ 原生 HEIC 路径不变。该方案需真实测试 iOS 16 Safari、Chromium、详情/主页图片和普通格式后才能视作已验收。

### 测试、提交与部署边界
- 0.1.20 初始实现提交：`6d4a5f695fd26fa6b3c72d5212fbb2934931f9d1`；静态检查修订提交：`84def623e35106a95bd0ae4c4ce36aed6ecd170a`；按需转换性能修订：`cbadf8ac008bb6ae0c9a331f3d73219f8f01c203`。CI [#46131676914](https://github.com/xiaobei206/beixiaoguo-CF/actions/runs/46131676914) 已通过：Linux 静态/npm 测试、Pages Function bundle、Pages runtime smoke、Workers bundle、Workers runtime smoke、Windows npm test 全部成功。仍需部署到独立 fork，并在 iPhone 13 / iOS 16 Safari 和 Chromium 进行实机验收；此 CI 仅证明源码测试和构建，不证明线上图片已恢复。
- `heic-to` 项目标明 LGPL-3.0；构建步骤随发布复制对应许可证。浏览器用法按上游公开 README 实现。
- 目前真实生产验收未完成；代码/CI 通过不代表 iPhone 13 iOS 16 Safari 和实际 Cloudflare Worker 已恢复。部署 fork 的更新与 Worker Build 必须另外确认。

## 0.1.19 — 2026-11-28：上游图片格式探测 DEBUG 专版

### 目的与实现
- 用户提供的 0.1.18 真实失败 GET 证明封面仍返回 503 `IMAGE_TRANSFORM_UNAVAILABLE`；`X-BXG-Transform-Error-Code: 9516`。本次不重复修改 HEIC 修复方向，而是新增独立探测工具来判断源站能否基于 `Accept` 或模板/路径参数直接输出 WebP、AVIF 或 JPEG。
- 新增 `functions/image-probe.js`、`POST /api/v1/debug/image-probe`、主页“上游探测”按钮和弹窗。正式的 `proxyCoverImage()` 流程未变。
- 普通 Worker GET（不加 `cf.image`）探测 12 种情况：原 URL 分别声明 WebP、AVIF、HEIC、JPEG/PNG、浏览器 Accept、全格式 Accept、不显式设置 Accept；再试 .webp/.avif/.jpeg 后缀，以及旧式 `x-tos-process=image/format,webp` / `x-oss-process=image/format,webp` 查询参数。
- 探测边界：HTTPS 的 `*.fqnovelpic.com`、无 URL 凭据/端口、HEIC/HEIF 路径；请求 URL 上限 4096 字符；最多 3 路并发、每项 5 秒、每会话 30 秒限一次；只跟随最多 2 次且仍在允许域内的重定向。成功图片只取响应头/Content-Length 后关闭响应体；非图片或失败响应最多读 512 字节文字。
- 输出只包括上游主机、模板/签名存在与否、状态码、Content-Type、Content-Length、耗时、重定向主机、有限错误摘要和建议；不返回原始 URL、签名值或 expiry 值。失败原始 URL只在浏览器当前页面内存中暂存，不写入 DEBUG/localStorage。
- 版本同步到 `VERSION`、`package.json`、Functions/API、前端 DEBUG、HTML 资源缓存参数/页脚均为 0.1.19；README、静态校验及 npm test 已纳入新诊断模块/回归测试。

### 测试与验证状态
- 新增 `scripts/test-image-probe.mjs`，以 Mock 覆盖 12 个 GET 变体、GET-only、不使用 `cf.image`、HTTPS/主机/端口/后缀限制、签名信息脱敏、拒绝跨域重定向和错误文本长度控制。
- Mock 证明的是代码分支与安全边界，不代表真实 VeImageX 会按某个 Accept 返回指定 MIME；真实源站结论必须等 0.1.19 部署后由主页探测工具实测。
- 维护仓库代码提交：`31bf7de998402c1bede170e8aff0f55e8274b468`。CI Run [#46127619086](https://github.com/xiaobei206/beixiaoguo-CF/actions/runs/46127619086) 已通过（Linux build-and-smoke、Windows npm test）。
- 部署 fork `qmancf206/beixiaoguo-CF` 仍为 0.1.18 的 `cc94107d0cd0fcd4805234804775f6e3859ff665`；生产当前仍显示 0.1.18。不得宣称诊断版已部署或封面已修复。
- 下一步：由有权限账号将 0.1.19 快进同步到部署 fork，等 Cloudflare Worker Build 完成后检查生产健康接口返回 0.1.19，再运行一次探测并解读真实结果；如果探测显示源站直接返回 WebP，才准备后续绕开 `cf.image` 的生产代码变更。文档同步提交 `2e6cdf54cf778dae5c3d1f6420bb6804d1da54b2` 触发的 CI Run [#46127721563](https://github.com/xiaobei206/beixiaoguo-CF/actions/runs/46127721563) 在本次复核时仍在执行。

## 2026-11-28：0.1.18 线上失败 GET 证据（补录）

- 用户提供的生产 GET 返回 HTTP 503；头部为 `X-BXG-Error-Code: IMAGE_TRANSFORM_UNAVAILABLE`、`X-BXG-Image-Cache: MISS`、`X-BXG-Image-Transform: unavailable`、`X-BXG-Transform-Error-Code: 9516`。
- `X-BXG-Debug` trace `d8b61985-9bb0-4869-aed5-df8e2cac841b` 的服务端事件顺序为 `image.cache.miss`（format=webp）→ `image.transform.unavailable`；内部转换 HTTP 422、`text/plain`，错误说明 HEIC 解码失败。此证据已替代之前“尚未取得 0.1.18 失败 GET”的旧交接描述。
- 源地址 host 为 `p3-reading-sign.fqnovelpic.com`，路径使用 `~tplv-...:400:0.heic` 模板模式。完整签名 URL 未写入日志/源码/文档。



## 0.1.18 — 2026-11-28

### 修正 HEIC 源站格式协商，并保留 Cloudflare 解码错误码
- 真实生产 GET 请求已证明：Cloudflare Images 返回 HTTP 422，响应体为 ERROR 9516，明确指出 HEIC 解码失败；这不是 9422 免费额度耗尽。iOS 16 Safari 与 Chrome 一样不支持网页原生 HEIC，必须拿到 WebP 才能显示。
- 发现图片代理发给 veImageX 的 Accept 同时声明 image/heic、image/avif、image/webp。veImageX 官方格式自适应优先级为 HEIC > AVIF > WebP；当多种自适应规则启用时，源站可能优先回 HEIC，导致 Cloudflare 随后解码失败。
- 对必须转换的 HEIC/HEIF 请求（Chrome、iOS 16 Safari 等）只向源站声明 Accept: image/webp，同时继续请求 Cloudflare 输出 WebP；Safari 17+ 原生 HEIC 直出仍保留。这样可避免把 HEIC/AVIF 再次协商到转换链路，但源站仍需启用 WebP 自适应，生产效果必须以部署后的真实回包确认。
- 代理现在从 Cloudflare 错误响应体提取 4 位错误码；例如 9516 会写入 X-BXG-Transform-Error-Code，不再只显示笼统的 HTTP_422。
- 回归测试覆盖 iOS 16 Safari 的 WebP 转换路径、转换请求只声明 WebP、Safari 17 原图路径继续保留 HEIC，以及 9516 错误码提取。
- 本版本修改维护仓库 main；部署 fork `qmancf206/beixiaoguo-CF` 已同步到同一 SHA `cc94107d0cd0fcd4805234804775f6e3859ff665`。CI Run #46115643235 的 Windows npm test 与 Pages/Workers 构建/WASM smoke test 全部通过。**用户最新反馈：图片仍无法显示。** 当前没有 0.1.18 部署后新的失败 GET 头信息，Cloudflare Worker Build 是否完成也未由连接独立核实；因此本版本尚不能标记为用户问题已修复。下一步必须先核对生产 DEBUG 版本和实际 Worker 部署 SHA，再拿最新失败 GET 的错误码继续定位。测试使用模拟源站，不等同于真实 veImageX 行为验证。

# 贝小果 Cloudflare 开发日志

> 维护规矩：每次改动代码、测试或版本后，必须在同一工作轮次更新 `HANDOFF-CN.md` 和本日志；完整流程见根目录 `AGENTS.md`。

## 0.1.17 — 2026-11-28

### 修正 HEIC 转换失败语义并增加真实代理集成测试
- 不再把 Cloudflare Images 转换失败后的原始 HEIC 当作成功结果返回给 Chrome 等不支持 HEIC 的浏览器。转换请求网络异常、服务端错误、额度耗尽（9422）或返回非 WebP MIME 时，统一返回 HTTP 503、IMAGE_TRANSFORM_UNAVAILABLE 和 X-BXG-Image-Transform: unavailable；DEBUG 记录转换错误码及有限长度的错误摘要。
- 前端识别需要 WebP 的 HEIC/HEIF 封面失败后立即显示原占位图，不再追加 _bxg_retry 重复执行同一转换；Safari 17+ 原生 HEIC 直出仍保留。
- 移除 WebP Cache API 响应上不生效的 stale-while-revalidate 指令，30 天 max-age 保留。
- 将图片测试扩展到生产 proxyCoverImage() 函数级集成测试：从 API 源文件提取该函数执行，注入模拟 Cache API 与 fetch，验证首次转换写入缓存、签名和重试参数变化仍命中、同 isolate 并发合并、9422/5xx/网络异常/HTTP 200 但返回原始 image/heic、Safari 原图、HEAD 不转换、HEIC→JPEG 重定向后取消 WebP 强制校验、重定向白名单验证，以及 Cache API match/put 失败时仍可正常返回图片。测试不导入完整 onRequest 路由，也不代表完整请求分发集成测试。
- Cloudflare 官方来源说明明确：来源 allowlist 适用于 /cdn-cgi/image/ URL 转换，不适用于 Worker fetch() 子请求的 cf.image；当前实现不需要为 p3-reading-sign.fqnovelpic.com 增加 allowlist，也不应为此开放 Any origin。
- 0.1.16 CI 已完整通过；0.1.17 初始修复 CI Run #46111794538 已通过；新增重定向及异常路径测试提交 1983cdff0220fcda4d468bfcfe1cfb758d5512dd 的 CI Run #46113661994 也已全部通过（Windows npm test、Linux 测试、静态检查、Pages/Workers 构建与 WASM smoke test）。部署 fork qmancf206/beixiaoguo-CF 的 main 仍为 67be60176b8cc706c85bc719a3668f3835712c1b，尚未同步生产。

## 0.1.16 — 2026-11-28

### HEIC 智能转换与稳定边缘缓存
- Safari 17+（包含 iOS Safari 17+）可直接显示 HEIC/HEIF，按 User-Agent 识别 Safari 版本后走原图代理，不消耗 WebP 转换额度；Chrome、Chromium 及其他未确认支持 HEIC 的浏览器仍转换为 WebP。
- 普通 JPEG、PNG、GIF、AVIF、WebP 不调用图片转换，继续走原有代理逻辑；HEAD 诊断请求也不触发转换。
- 增加稳定图片身份：保留源图片域名、完整路径、tplv 规格及 lk3s 等未知参数，只从缓存身份中排除 x-expires、x-signature 和外层重试参数；签名 URL 变化、查询参数顺序变化和 _bxg_retry 不再产生不同的 WebP 缓存键。
- 对 WebP 成品使用 Cloudflare Cache API 缓存 30 天；同一 Worker isolate 内对相同图片转换请求进行并发合并。缓存命中直接返回成品，不再请求上游或执行转换。
- Cloudflare 转换失败（包括 Images 免费额度用尽时的新转换错误）会再用完整签名 URL 请求原图代理；允许 image/heic 与 image/heif 原样返回，防止代理自身因 MIME 白名单再次制造 502。
- 增加浏览器识别、HEIC/HEIF 转换门控、HEAD 不转换、签名轮换、lk3s 保留、重试参数隔离和不同图片不碰撞等回归测试。
- Cloudflare Cache API 是数据中心本地缓存，可能因访问 PoP 变化或缓存淘汰而再次转换；当前不需要 KV/R2 绑定，也不承诺跨 PoP 的永久唯一转换。

## 0.1.15 — 2026-11-28

### 修复 HEIC／HEIF 封面图片在 Chromium 中破图
- 生产 Network 日志已定位根因：FQ Novel 图片源返回 HTTP 200、Content-Type 为 image/heic，但 Cloudflare 图片代理只接受 AVIF／WebP／JPEG／PNG／GIF，因此代理自己返回 HTTP 502 IMAGE_CONTENT_TYPE。
- 不能只把 image/heic 加入白名单，因为 Chrome／Chromium 的普通 img 元素当前不支持直接显示 HEIC／HEIF。代理现在仅在源路径后缀为 .heic 或 .heif 时请求 Cloudflare Image Transformations 输出 WebP；其他受支持格式保持原样转发。
- 新增 scripts/test-image-proxy.mjs 回归测试：HEIC／HEIF 必须请求 WebP 转换并返回 image/webp；JPEG 不应触发转换。CI 的静态检查和 npm test 都纳入该测试。
- 转换使用 Cloudflare Images 的远程图片转换能力。Images Free 每月含 5,000 个不同转换组合；Free 超额的新转换会失败且不收费，Paid 超过包含额度后每 1,000 个额外唯一转换为 0.50 美元。这里只对 HEIC／HEIF 调用转换，生产验收还需确认服务确实返回 WebP。
- 本次修复仅提交到维护仓库；需等待 CI 通过并同步到 qmancf206/beixiaoguo-CF 后，才能验证生产封面恢复。生产视频 Secret 已配置，视频播放不再是当前故障主线。

## 0.1.14 — 2026-11-27

### 修复受保护播放 Secret 诊断遗漏
- 用户真实请求命中 `/api/v1/play/:episodeId` 并返回 `MEDIA_SECRET_REQUIRED`；检查发现 0.1.13 只有预热和媒体流分支记录 `secretBound`／`secretLengthValid`，直接播放分支缺少事件。
- 为直接播放分支补上 `media.secret.missing`，仅记录当前 Worker 运行时、Host、Secret 是否为字符串、长度是否达到 32，不记录密钥内容。
- 需要依据 0.1.14 的新 DEBUG 结果判断是否重建 Secret，不要求用户先删除现有配置。


## 0.1.13 — 2026-11-27

### 浏览器自选 Cloudflare 入口 IP
- 新增播放线路管理器，允许用户在当前浏览器自行添加、命名和删除 IPv4／IPv6 地址；只填写 IP，端口固定为 443，最多保存 24 条。
- 自选列表与当前选择保存在 localStorage，不上传到服务器；选择时只通过一次 `/api/v1/route?alt_ip=...` 同源请求提交 IP；Worker 先校验 IPv4／IPv6，再通过内部响应头 `X-BXG-Alt-IP` 交给 Cloudflare 规则，不设置线路 Cookie。
- 新增 `/api/v1/route` 线路诊断接口，记录 Worker／Pages 运行时及浏览器请求中的 `Alt-Used`；前端检查响应的 `Alt-Svc` 是否确实包含所选 IP。
- Cloudflare 会过滤 Worker 源站直接返回的 `Alt-Svc`。真正切换需要自有橙云域名，并在 Cloudflare Zone 配置 Response Header Transform Rules；默认 `workers.dev`／`pages.dev` 域名无法配置该 Zone 规则，界面会明确提示当前仅保存、未切换。规则读取 Worker 已校验的 `http.response.headers["x-bxg-alt-ip"][0]`，再删除内部响应头；不依赖 Pro 版 Cookie 字段。
- Alt-Svc 是备用连接提示，只对后续新建连接生效，不强制迁移已建立的连接；备用 IP 还必须支持原域名 TLS/SNI 证书校验和 HTTP/2。VLESS 可用不等于浏览器 HTTP/2 已验证。
- 增加 `media.secret.missing` 安全诊断事件，只记录 Secret 是否绑定、长度是否达标及当前运行时，不记录 Secret 内容；缺失提示提醒用户核对当前实际访问的部署环境，不再笼统要求重复配置。


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
