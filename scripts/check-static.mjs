import { readFile, access } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const required = [
  "public/index.html", "public/assets/app.js", "public/assets/app.css",
  "public/assets/icon-192.png", "public/assets/icon-512.png",
  "public/manifest.webmanifest", "public/_routes.json", "functions/api/v1/[[path]].js", "functions/openhongguo-runtime.js", "scripts/patch-openhongguo.mjs", "scripts/build-openhongguo.mjs", "wrangler.jsonc", "wrangler.worker.jsonc", "worker.js", "scripts/smoke-worker-runtime.mjs", "scripts/test-media-session.mjs", "functions/cenc-runtime.js", "functions/media-session.js", "edge-cenc/go.mod", "edge-cenc/cenc/layout.go", "edge-cenc/cenc/layout_test.go", "edge-cenc/wasm/main.go", "docs/deploy-cloudflare-cn.md", "VERSION"
];
for (const file of required) await access(file);

const html = await readFile("public/index.html", "utf8");
const js = await readFile("public/assets/app.js", "utf8");
const styles = await readFile("public/assets/app.css", "utf8");
if (js.includes("按需 Range 解密尚未迁移到边缘函数") || js.includes("受保护的 CENC 流暂不可播放")) throw new Error("播放器仍包含过时的 CENC 未迁移／不可播放提示。");
if (!js.includes("当前后端返回了受保护标记，但没有返回边缘媒体地址")) throw new Error("播放器必须为缺少边缘媒体地址的旧后端提供明确部署诊断。");
if (!js.includes("player.media.error") || !js.includes("player.media.stalled") || !js.includes("mediaElementDiagnostics(video)")) throw new Error("Browser media-state diagnostics are missing.");
if (!js.includes("const EDGE_PREFETCH_COUNT = 6;") || !js.includes("const BROWSER_PRELOAD_COUNT = 3;")) throw new Error("Playback prefetch targets must remain six edge resolutions and three browser videos.");
if (!js.includes("const MAX_ROUTE_ENTRIES = 24;") || !js.includes("normalizeRouteIPAddress") || !js.includes('/api/v1/route?alt_ip=') || !js.includes("Alt-Svc") || !js.includes(".workers.dev") || !js.includes(".pages.dev")) throw new Error("Browser-local CF IP route selection and platform limitations are missing.");
if (!html.includes('id="route-dialog"') || !html.includes('id="route-button"') || !html.includes('http.request.uri.args["alt_ip"][0]') || !styles.includes(".route-option")) throw new Error("The browser route picker UI is missing.");
const worker = await readFile("functions/api/v1/[[path]].js", "utf8");
if (!worker.includes('parts[0] === "prefetch" && request.method === "POST"') || !worker.includes("episodeIds.length > 6") || !worker.includes("最多预解析 6 集")) throw new Error("Edge playback prefetch must be capped at six episodes.");
if (!styles.includes(".player-preload-container") || !styles.includes(".bxg-preload-video")) throw new Error("Offscreen browser preloading styles are missing.");
const manifest = JSON.parse(await readFile("public/manifest.webmanifest", "utf8"));
const routes = JSON.parse(await readFile("public/_routes.json", "utf8"));
if (routes.version !== 1 || !routes.include?.includes("/api/*")) throw new Error("Pages Functions must only handle /api/* requests");
const version = (await readFile("VERSION", "utf8")).trim();
if (!js.includes('const APP_VERSION = "' + version + '";')) throw new Error("DEBUG app version does not match VERSION.");
const packageInfo = JSON.parse(await readFile("package.json", "utf8"));
if (worker.includes("Cloudflare Worker Secrets 中配置 BXG_MEDIA_SECRET")) throw new Error("Secret error still uses the generic Worker-only wording.");
if (!worker.includes("mediaSecretSetupMessage(runtimeName)") || !worker.includes("Pages 和独立 Worker 的 Secrets 不会自动共享")) throw new Error("Secret error must explain runtime-specific setup and independent environments.");
if (!worker.includes('parts[0] === "route"') || !worker.includes('request.headers.get("Alt-Used")') || !worker.includes("network.alt-used")) throw new Error("Route diagnostic endpoint must report the browser Alt-Used request header.");
if (!worker.includes("media.secret.missing")) throw new Error("Missing media Secret must produce a safe runtime diagnostic event.");
if (!worker.includes("debugSession:session") || !worker.includes("media.cenc.stream.failed") || !worker.includes("media.cenc.stream.truncated")) throw new Error("Native video requests must retain correlated media-stream diagnostics.");
if (!worker.includes("async function prewarmProtectedMedia(") || !worker.includes("await cache.put(key,response)") || !worker.includes("media.edge-cache.hit") || !worker.includes("media.edge-cache.ready")) throw new Error("Cloudflare must prewarm and serve decrypted media from its edge cache.");
if (!worker.includes("MAX_EDGE_PREFETCH_MEDIA_BYTES = 32 << 20") || !worker.includes("mediaCacheControl=total<=MAX_EDGE_PREFETCH_MEDIA_BYTES") || !worker.includes("Math.min(2700,Math.floor((media.exp-Date.now())/1000))")) throw new Error("Edge media cache must enforce a size cap and token-lifetime TTL.");
const workerRuntime = await readFile("functions/openhongguo-runtime.js", "utf8");
const cencRuntime = await readFile("functions/cenc-runtime.js", "utf8");
const cencSource = await readFile("edge-cenc/cenc/layout.go", "utf8");
const cencWasmEntry = await readFile("edge-cenc/wasm/main.go", "utf8");
const cencBuildWasm = await readFile("node_modules/openhongguo/dist/cenc.wasm");
const mediaSession = await readFile("functions/media-session.js", "utf8");
const mediaSessionTests = await readFile("scripts/test-media-session.mjs", "utf8");
const patcher = await readFile("scripts/patch-openhongguo.mjs", "utf8");
const sdkSmoke = await readFile("scripts/smoke-sdk.mjs", "utf8");
const workerSmoke = await readFile("scripts/smoke-worker-runtime.mjs", "utf8");
const sdkBuildScript = await readFile("scripts/build-openhongguo.mjs", "utf8");
const sdkBuildInfo = await readFile("node_modules/openhongguo/bxg-build-info.js", "utf8");
const wrangler = JSON.parse(await readFile("wrangler.jsonc", "utf8"));
const workerWrangler = JSON.parse(await readFile("wrangler.worker.jsonc", "utf8"));
if (packageInfo.version !== version) throw new Error("package.json version does not match VERSION");
if (packageInfo.dependencies?.openhongguo) throw new Error("Do not install the stale npm openhongguo WASM package; build xiaobei206/openhongguo directly.");
if (!sdkBuildScript.includes("xiaobei206/openhongguo.git") || !sdkBuildScript.includes("GO_SHA256") || !sdkBuildScript.includes('["test", "./..."]')) throw new Error("Build must fetch, verify and test the self-owned openhongguo source.");
if (!sdkBuildInfo.includes('"repository":"xiaobei206/openhongguo"') || !sdkBuildInfo.includes('"playbackFallback":"video_tab"') || !sdkBuildInfo.includes('"deviceHeartbeat":true') || !sdkBuildInfo.includes('"cencRangeDecrypt":true')) throw new Error("Packaged WASM was not built from the self-owned playback SDK.");
if (!worker.includes(`const VERSION = "${version}";`)) throw new Error("Functions version does not match VERSION");
if (wrangler.rules !== undefined) throw new Error("Pages Wrangler config must not contain the Workers-only rules field; Pages imports WASM modules directly");
if (!wrangler.pages_build_output_dir || wrangler.main !== undefined) throw new Error("wrangler.jsonc must remain a Pages-only configuration");
if (workerWrangler.name !== "beixiaoguo-cf-worker" || workerWrangler.main !== "./worker.js") throw new Error("Worker target must use the dedicated worker entry point and name");
if (workerWrangler.cache?.enabled !== true) throw new Error("Workers Cache must be enabled for full MP4 Range caching.");
if (workerWrangler.assets?.directory !== "./public" || workerWrangler.assets?.binding !== "ASSETS" || !workerWrangler.assets?.run_worker_first?.includes("/api/*")) throw new Error("Workers target must serve public assets and route /api/* through the Worker");
if (!workerWrangler.rules?.some(rule => rule.type === "CompiledWasm" && rule.globs?.includes("**/*.wasm"))) throw new Error("Workers Wrangler config must compile the SDK WASM as a precompiled module");
if (!html.includes("/assets/app.js?v=" + version)) throw new Error("HTML JS version does not match VERSION");
if (!html.includes("/assets/app.css?v=" + version)) throw new Error("HTML CSS version does not match VERSION");
if (!html.includes("Cloudflare 边缘版") || html.includes("家庭局域网") || html.includes("只在你的家庭网络中提供服务")) throw new Error("Cloudflare homepage must not describe the public edge deployment as LAN-only");
if (!html.includes('aria-label="部署教程"') || !html.includes("Cloudflare 部署教程")) throw new Error("Homepage must expose the Cloudflare deployment guide");
if (!js.includes("docs/deploy-cloudflare-cn.md") || !js.includes("Connect to Git")) throw new Error("Homepage deployment guide must link to the full tutorial and explain Pages Git setup");
if (!html.includes('id="debug-log-button"') || !html.includes('id="debug-dialog"') || !html.includes('id="debug-copy"')) throw new Error("Homepage must expose the DEBUG log viewer and copy action");
if (!js.includes("DEBUG_STORAGE_KEY") || !js.includes("api.response.error") || !js.includes("window.unhandledrejection") || !js.includes("image.url.rejected")) throw new Error("Frontend DEBUG logging must capture API, runtime and image failures");
if (!worker.includes('parts[0] === "debug" && parts[1] === "logs"') || !worker.includes('debugRecord(session, "debug", "upstream.request"') || !worker.includes('runtimeDiagnostics()')) throw new Error("Edge DEBUG endpoint must expose session-scoped request and WASM diagnostics");
if (!worker.includes('response.headers.set("X-BXG-Trace-ID", traceId)') || !worker.includes('response.headers.set("X-BXG-Debug", value)')) throw new Error("Every API response must carry its own edge trace, independent of isolate memory");
if (!worker.includes('async function proxyCoverImage') || !worker.includes('host.endsWith(".fqnovelpic.com")') || !worker.includes('parts[0] === "images"')) throw new Error("FQ Novel poster images must use the restricted Cloudflare proxy");
if (!js.includes('proxy.searchParams.set("url", parsed.href)') || !js.includes('captureEdgeTrace(response)')) throw new Error("Frontend must proxy FQ Novel posters and collect per-request edge traces");
if (!worker.includes('url.searchParams.get("sdk") === "probe" && context.env?.BXG_SMOKE_TEST === "1"')) throw new Error("The network-free WASM probe must remain gated to local smoke tests");
if (!patcher.includes("__BXG_OPENHONGGUO_GO") || !patcher.includes("Go runtime recovery") || !patcher.includes("Go runtime exit monitor")) throw new Error("Go/WASM runtime recovery and exit monitoring patch is missing");
if (!worker.includes("sdkBuildDiagnostics()") || !workerRuntime.includes("bxg-build-info.js")) throw new Error("Cloudflare health diagnostics must identify the self-built SDK revision.");
if (cencBuildWasm.byteLength < 100000 || !cencRuntime.includes("cenc.wasm") || !cencRuntime.includes("ensureCencRuntime")) throw new Error("CENC Go/WASM helper is missing or too small.");
if (!cencRuntime.includes("__BXG_CENC_READY_CALLBACK") || !cencWasmEntry.includes("__BXG_CENC_READY_CALLBACK")) throw new Error("CENC runtime must wait for the Go/WASM API registration callback.");
if (!cencSource.includes("func Open(") || !cencSource.includes("func (l *Layout) Decrypt(") || !sdkBuildScript.includes('["test", "./cenc"]')) throw new Error("CENC layout tests/build checks are missing.");
if (!worker.includes('parts[0] === "media" && parts[1]') || !worker.includes("proxyProtectedMedia") || !worker.includes("sealMediaSession")) throw new Error("Protected playback must route through the edge Range proxy.");
if (!mediaSession.includes("AES-GCM") || !mediaSession.includes("safeMediaSource") || !mediaSessionTests.includes("sealMediaSession")) throw new Error("Encrypted media token/security tests are missing.");
if (!sdkSmoke.includes("client.discover") || !sdkSmoke.includes("twice") || !workerSmoke.includes("sdk=probe") || !workerSmoke.includes("goCallbacks")) throw new Error("CI must exercise repeated Go-to-JavaScript calls, not only SDK initialization");
if (!html.includes("贝小果 <b>" + version + "</b>")) throw new Error("HTML footer version does not match VERSION");
if (!manifest.name.includes("贝小果")) throw new Error("PWA manifest has an unexpected name");
if (!js.includes("X-BXG-Session")) throw new Error("API calls must include anonymous session ID");
if (!js.includes('parsed.protocol !== "https:"')) throw new Error("External cover images must be restricted to HTTPS URLs");
if (js.includes("视频仍由 N1 按需读取与解密") || js.includes("N1 正在按需解密") || js.includes("明文 MP4")) throw new Error("Cloudflare playback UI contains stale N1-only wording");
if (!js.includes("无需创建 KV")) throw new Error("Cloudflare runtime guide should state that KV is not required");

for (const file of ["scripts/build-openhongguo.mjs", "public/assets/app.js", "functions/api/v1/[[path]].js", "functions/openhongguo-runtime.js", "scripts/patch-openhongguo.mjs", "scripts/smoke-sdk.mjs", "scripts/smoke-pages-runtime.mjs", "worker.js", "scripts/smoke-worker-runtime.mjs", "functions/cenc-runtime.js", "functions/media-session.js", "scripts/test-media-session.mjs"]) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) throw new Error("Syntax check failed: " + file + "\n" + result.stderr);
}
console.log("贝小果 Cloudflare 静态检查通过。版本：" + version);
