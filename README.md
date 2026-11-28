# 贝小果 Cloudflare

贝小果的 Cloudflare 轻量化版本。静态网页可部署在 Cloudflare Pages 或 Workers Static Assets，匿名片库请求由边缘函数按需处理，不需要自管 VPS 或数据库。

当前开发版本：0.1.15

## 开发原则

- 与原版 beixiaoguo-web 分开开发，不修改 N1 正式版。
- 保持匿名，不增加账号系统或用户资料收集。
- 复用原生 HTML、CSS、JavaScript，不引入大型前端框架。
- Pages 静态资源与 Functions 分离；不依赖自管 VPS。
- 不把尚未验证的功能标成已实现；CENC 解密和电视接力按实际兼容性迁移。

## 快速部署（推荐 GitHub + Pages）

主页顶部的“部署教程”按钮会直接显示 Pages／Workers 安装步骤；完整的中文安装教程见 [docs/deploy-cloudflare-cn.md](docs/deploy-cloudflare-cn.md)。推荐在 Cloudflare 的 Workers & Pages 中选择 Pages → Connect to Git，授权 GitHub 后导入 `xiaobei206/beixiaoguo-CF`，配置 `main`、`npm run build` 和 `public`，即可自动部署。

**不要直接拖放 ZIP／文件夹作为完整安装**：本项目含 Pages Functions，控制台拖放部署不会编译 `functions/`，可能导致前端能开但 API 不工作。无 Git 自动部署时，请使用教程中的 Wrangler 命令行方案。

## Cloudflare Pages 设置

- Framework preset：None
- Build command：npm run build
- Build output directory：public
- Root directory：仓库根目录
- Production branch：main

连接 GitHub 仓库 xiaobei206/beixiaoguo-CF 后，Pages 会自动构建和部署。根目录 functions/ 会作为 Pages Functions 路由一起部署。

## 功能状态

- [x] 迁移现有响应式 UI、PWA 清单和应用图标。
- [x] 自动部署前静态资源检查；静态请求与 `/api/*` Functions 路由分开。
- [x] Pages Functions 本地运行时烟雾测试验证预编译 WASM SDK 可初始化（不请求上游片库）。
- [x] 增加可选的 Cloudflare Workers 入口与独立 Wrangler 配置，复用 Pages API 处理代码。
- [x] 修复封面 URL 过滤，允许 HTTPS 上游封面地址，并拒绝非 HTTPS／带凭据的外部 URL。
- [x] 主页加入可直接打开的 Pages／Workers 部署教程；页脚信息改为 Cloudflare 公网部署文案。
- [x] 建立推荐、搜索、热搜、新剧、榜单、详情、分集和多季 API 入口，待真实上游验收。
- [ ] 真实上游推荐、搜索、详情和播放逐项验收（本地 CI 只验证构建、媒体令牌／Range 解析及 WASM 初始化，不代表真实上游分集已端到端播放）。
- [x] 渐进式 MP4 CENC AES-CTR 的边缘 Range 解密、加密媒体会话与按需媒体代理（自 0.1.7 起；真实上游分集仍待端到端验收）。
- [ ] 电视接力；公共边缘函数无法直接对家庭局域网做 mDNS 发现。

## 0.1.8 修复

- 移除播放器中残留的“CENC 尚未迁移”硬编码提示，明确区分前后端部署版本不一致和真实媒体播放故障。
- HTML 静态资源缓存版本、API 诊断版本、`VERSION` 与 `package.json` 统一到 0.1.8。
- CI 静态检查阻止旧提示回归。

## 0.1.9：Secret 配置诊断

- `MEDIA_SECRET_REQUIRED` 根据实际处理请求的运行时，分别提示 Cloudflare Pages 项目或 Cloudflare Worker 的配置入口。
- 文档列出 Pages 与 Workers 各自的 Dashboard 和 Wrangler 设置方法，并强调各部署环境需要分别配置 Secret。

## 0.1.14：修复受保护播放 Secret 诊断
- 补齐直接播放 `/api/v1/play/:episodeId` 路径的 `media.secret.missing` 诊断事件；之前该分支返回 503 时没有输出 `secretBound`／`secretLengthValid`，无法判断是变量未绑定还是值长度不足。
- 新诊断只记录运行时、当前主机、是否读取到字符串以及长度是否达标，不记录 Secret 值。
- 不自动修改、删除或重建现有 Secret；根据实际诊断结果再处理部署环境或 Secret 绑定。

## 0.1.13：浏览器自选 CF 入口 IP（需自定义域名）
- 新增浏览器本地线路管理器：用户自行添加 IPv4／IPv6，端口固定 443；线路列表只保存在当前浏览器。
- 通过一次 `/api/v1/route?alt_ip=...` 同源请求提交所选 IP；Worker 先验证地址，再由 Cloudflare Response Header Transform Rules 读取内部 `X-BXG-Alt-IP` 响应头动态公告 Alt-Svc，随后删除内部头；不写 Cookie，也不依赖 Pro 专属字段。Worker 诊断接口读取 Alt-Used，帮助确认浏览器是否使用备用入口。
- Cloudflare 会过滤 Worker 直接返回的 Alt-Svc；workers.dev／pages.dev 默认域名无法配置 Zone Transform Rules。要启用自选入口，必须绑定自有橙云域名并按部署教程配置四条响应头规则。
- Alt-Svc 仅影响后续新建连接，不强制迁移已建立连接；IP 必须支持原始站点域名的 TLS/SNI 与 HTTP/2。VLESS 可用本身不等于浏览器 HTTPS/HTTP/2 一定可用。

## 0.1.12：真实 CF 边缘媒体预热

- 0.1.11 的 CF 侧仅提前解析播放地址；0.1.12 改为将后续最多 6 集的受保护 MP4 解密后完整写入 Cloudflare Cache API。
- 前 3 集先完成边缘缓存，再由浏览器启动 3 个隐藏视频预载；余下 3 集通过 waitUntil 后台填充。
- Range 请求优先由边缘缓存按字节区间返回，缓存键包含每次播放的加密会话 URL，TTL 不超过会话有效期。
- 单集超过 32 MiB 时跳过整集边缘预热和公共缓存，避免大文件占用过多缓存；播放仍可回源按需 Range 解密。
- Worker 部署启用 Workers Cache；Pages Functions 使用 Cache API。缓存未命中时仍回源，不影响正常播放。

## 0.1.11：双层短剧预读

- Cloudflare 先解析后续最多 6 集的播放信息与短时播放会话，切集时优先复用，减少逐集等待上游解析的时间。
- 浏览器在当前集之外，最多预载后续 3 集的视频；通过带有效期的私有 Range 缓存，尽量复用已下载片段。
- 浏览器的 preload 属于浏览器提示，实际预载量仍由浏览器和网络策略决定；Cloudflare 侧此处预解析播放地址，不把 6 集完整视频下载到边缘内存或缓存。

## 0.1.10：定位播放约一秒后停播

- 将加密媒体会话与发起播放的匿名诊断会话关联起来，让浏览器原生视频请求的 Range／解密日志出现在同一 DEBUG 诊断包里。
- 增加 CENC 流式输出中途截断、解密失败的服务端事件；前端新增浏览器的 metadata、playing、waiting、stalled、pause、error 状态记录。
- 将 DEBUG 显示版本统一到 0.1.10，避免继续显示 0.1.6 的旧诊断版本。
- 这些改动增强定位能力，不将尚未观测到的实际停播根因提前标记为已修复。

## 文档

- VERSION：当前版本
- DEVELOPMENT-LOG-CN.md：累计开发日志
- docs/architecture.md：架构与迁移计划
- HANDOFF-CN.md：交接索引

## 声明

本项目为个人学习与研究项目，与红果短剧及其运营方无关联。请遵守上游平台条款和适用法律。上游 SDK 的使用须遵守其单独的许可证和免责声明。
