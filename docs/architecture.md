# 贝小果 Cloudflare 版：架构与迁移计划

## 目标

- 保留原版原生 HTML / CSS / JavaScript UI。
- 静态资源部署在 Cloudflare Pages。
- 不运行常驻服务器；请求逻辑由 Pages Functions 按需执行。
- 保持匿名，不增加账号系统或用户资料库。
- 不把占位功能写成已完成。

## 部署结构

浏览器
  ├─ HTML / CSS / JavaScript / PWA
  └─ /api/v1/*
       └─ Cloudflare Pages Functions
            └─ openhongguo Node.js/WASM SDK
                 └─ 红果上游接口

Pages Function 中使用 openhongguo 的 Node.js/WASM SDK，注入基于 Fetch 的 Transport。由于 SDK 默认通过 Node 的动态 `require()` / 文件路径读取 WASM，Cloudflare 构建阶段用 `scripts/patch-openhongguo.mjs` 做一个受版本校验的兼容补丁；`functions/openhongguo-runtime.js` 静态导入 `wasm_exec.js` 和预编译的 `WebAssembly.Module`（Wrangler `CompiledWasm` 规则），避免边缘运行时动态查找模块或动态编译 WASM。匿名设备 profile 在边缘 isolate 的内存中按浏览器会话标识分开保存，不写入数据库。边缘 isolate 冷启动后内存会重置，必要时 SDK 会重新注册匿名设备。

## API 迁移

已建立：health、discover、search、suggest、hot-search、new-releases、rank、series detail/episodes/seasons、playback resolve。

播放解析只会尝试返回可由浏览器直接播放的非受保护流。受保护 CENC 流不会把内容密钥交给浏览器，当前版本显示明确的暂不可播放提示。

## 已知限制

1. CENC 视频：原版的 MP4 样本表解析、Range 按需解密与媒体代理尚未迁移。
2. 电视接力：公共边缘函数无法直接对用户家庭 LAN 执行 mDNS 或原始 TCP；需要原版 N1 或可访问 LAN 的配套助手。
3. 图片代理与磁盘缓存：轻量版直接使用上游封面地址，暂不提供 N1 的 RAM + 磁盘两级缓存及预热调度。
4. 播放兼容性：取决于浏览器对 MP4/HLS、CDN Range/CORS 和编码的支持，应在 iOS Safari、Android Chrome 和桌面浏览器分别验收。
5. SDK 环境兼容性：必须通过 Wrangler Pages Functions 运行时烟雾测试，确认 WASM 能在 Worker 环境初始化；编译成功本身不算验收。

## Cloudflare Pages 配置

- Framework preset：None
- Build command：npm run build
- Build output directory：public
- Production branch：main

仓库根目录 functions/ 自动被 Pages 识别。wrangler.jsonc 用于本地 Functions 开发和兼容性设置。

## 后续优先级

1. CI 验证 Pages Function 打包、WASM 加载与 Worker 运行时。
2. 用真实上游响应确认推荐、搜索、详情、榜单、新剧和多季字段。
3. 实现边缘媒体 Range 代理并评估迁移 CENC box/sample 解密逻辑。
4. 优化封面图片格式回退和 HTTP 缓存。
5. 保留电视接力给原版 N1，或设计本地 LAN 助手。
