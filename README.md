# 贝小果 Cloudflare

贝小果的 Cloudflare 轻量化版本。静态网页部署在 Cloudflare Pages，匿名片库请求由 Pages Functions 按需处理，不需要自管 VPS 或数据库。

当前开发版本：0.1.1

## 开发原则

- 与原版 beixiaoguo-web 分开开发，不修改 N1 正式版。
- 保持匿名，不增加账号系统或用户资料收集。
- 复用原生 HTML、CSS、JavaScript，不引入大型前端框架。
- Pages 静态资源与 Functions 分离；不依赖自管 VPS。
- 不把尚未验证的功能标成已实现；CENC 解密和电视接力按实际兼容性迁移。

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
- [x] Pages Functions 已能完成编译与打包；正在验证 Workers 运行时的 WASM 初始化。
- [x] 建立推荐、搜索、热搜、新剧、榜单、详情、分集和多季 API 入口，待真实上游验收。
- [ ] 受保护 CENC 视频流的边缘解密与 Range 支持。
- [ ] 电视接力；公共边缘函数无法直接对家庭局域网做 mDNS 发现。

## 文档

- VERSION：当前版本
- DEVELOPMENT-LOG-CN.md：累计开发日志
- docs/architecture.md：架构与迁移计划
- HANDOFF-CN.md：交接索引

## 声明

本项目为个人学习与研究项目，与红果短剧及其运营方无关联。请遵守上游平台条款和适用法律。上游 SDK 的使用须遵守其单独的许可证和免责声明。
