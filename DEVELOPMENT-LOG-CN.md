# 贝小果 Cloudflare 开发日志

## 0.1.1 — 2026-11-27

### Cloudflare WASM 加载适配
- 运行时烟雾测试发现：原版 Node SDK 的 `createRequire(.../dist/wasm_exec.js)` 在 Pages Functions 中会报 `Module not found`，单纯打包通过并不能证明边缘运行成功。
- 增加静态 `wasm_exec.js` / WASM 导入，并在构建时对固定版本 SDK 做小型兼容补丁，避免 Cloudflare isolate 依赖动态模块路径和文件系统读取。
- `wrangler.jsonc` 只保留 WASM Data 规则，确保 `wasm_exec.js` 按 JavaScript 执行。
- 版本号统一更新为 0.1.1，并继续由 CI 执行 Pages Functions runtime smoke test。

## 0.1.0 — 2026-11-27

## 0.1.0 — 2026-11-27

### 初始项目与 Cloudflare 迁移底座
- 新建独立的 Cloudflare 轻量版仓库，与 N1 正式项目保持隔离。
- 迁移原版原生 HTML、CSS、JavaScript、PWA manifest 和 192/512 图标，不引入大型前端框架。
- 增加 Pages Functions API 入口，接入 openhongguo Node.js/WASM 匿名 SDK，并注入 Fetch Transport。
- 增加浏览器匿名会话标识，同一 isolate 存续期间为每个会话分别复用 SDK profile；不增加用户账号或个人资料库。
- 建立推荐、搜索、联想、热搜、新剧、榜单、详情、分集、多季及播放源解析 API 适配。
- 对尚未迁移的能力明确提示：CENC 受保护流、N1 磁盘缓存/常驻预热和家庭 LAN 电视接力。
- 增加静态资源检查、SDK/WASM 初始化测试与 Cloudflare Functions 打包检查。

### 本版未宣称完成
- 等待 CI 验证 SDK/WASM 与 Pages Functions 运行时兼容性。
- 需要真实上游请求验收接口字段、签名与 CDN 行为。
- CENC 按需 Range 解密与电视接力尚未迁移。
