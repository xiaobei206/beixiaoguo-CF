# 贝小果 Cloudflare

贝小果的 Cloudflare 轻量化版本。协作开发前请先阅读 [AGENTS.md](AGENTS.md) 和 [HANDOFF-CN.md](HANDOFF-CN.md)：前者是强制开发规矩，后者记录当前真实进度、CI、部署状态与下一步。

当前开发版本：0.1.22

0.1.22 清理了已失效的浏览器自选线路、已完成任务的上游图片格式探测、主页部署教程，以及 Cloudflare 版并不支持的常驻预热/服务端缓存设置入口。主页只保留看剧所需功能和 DEBUG 诊断面板。0.1.21 的 HEIC/HEIF 浏览器本地解码与受限原图代理继续保留；iPhone 13 / iOS 16 Safari 仍需真实验收。

## 开发原则

- 与原版 beixiaoguo-web 分开开发，不修改 N1 正式版。
- 保持匿名，不增加账号系统或用户资料收集。
- 复用原生 HTML、CSS、JavaScript，不引入大型前端框架。
- Pages 静态资源与 Functions 分离；不依赖自管 VPS 或数据库。
- 不把尚未验证的功能标成已实现；CENC 解密和电视接力按实际兼容性维护。

## 功能状态

- [x] 响应式 UI、PWA 清单和应用图标。
- [x] Pages Functions 与独立 Workers 入口。
- [x] 推荐、搜索、热搜、新剧、榜单、详情、分集和多季 API 适配。
- [x] 渐进式 MP4 CENC AES-CTR 边缘 Range 解密与加密媒体会话。
- [x] Cloudflare 图片受限代理；HEIC/HEIF 在不支持原生显示的浏览器中使用自托管解码器本地转 JPEG。
- [x] 主页保留前端/边缘 DEBUG 诊断包。
- [ ] 真实上游推荐、搜索、详情和播放仍需持续验收；CI 不代表真实上游分集端到端播放。
- [ ] 电视接力；公共边缘函数无法直接对家庭局域网做 mDNS 发现。

## 构建与验证

- Pages 静态资源输出目录：`public`；Functions 位于仓库根目录 `functions/`。
- Workers 入口：`worker.js`，配置：`wrangler.worker.jsonc`。
- `npm test` 执行静态检查、媒体会话、图片代理、HEIC 客户端回退和 SDK 测试。
- GitHub Actions 同时验证 Linux、Windows、Pages Functions 与 Workers 构建/运行时烟雾测试。

## 文档

- `VERSION`：当前版本。
- `DEVELOPMENT-LOG-CN.md`：累计开发日志。
- `docs/architecture.md`：架构与迁移说明。
- `HANDOFF-CN.md`：单一交接入口。

## 声明

本项目为个人学习与研究项目，与红果短剧及其运营方无关联。请遵守上游平台条款和适用法律。上游 SDK 的使用须遵守其单独的许可证和免责声明。
