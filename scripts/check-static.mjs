import { readFile, access } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const required = [
  "public/index.html", "public/assets/app.js", "public/assets/app.css",
  "public/assets/icon-192.png", "public/assets/icon-512.png",
  "public/manifest.webmanifest", "public/_routes.json", "functions/api/v1/[[path]].js", "functions/openhongguo-runtime.js", "scripts/patch-openhongguo.mjs", "wrangler.jsonc", "VERSION"
];
for (const file of required) await access(file);

const html = await readFile("public/index.html", "utf8");
const js = await readFile("public/assets/app.js", "utf8");
const manifest = JSON.parse(await readFile("public/manifest.webmanifest", "utf8"));
const routes = JSON.parse(await readFile("public/_routes.json", "utf8"));
if (routes.version !== 1 || !routes.include?.includes("/api/*")) throw new Error("Pages Functions must only handle /api/* requests");
const version = (await readFile("VERSION", "utf8")).trim();
const packageInfo = JSON.parse(await readFile("package.json", "utf8"));
const worker = await readFile("functions/api/v1/[[path]].js", "utf8");
const wrangler = JSON.parse(await readFile("wrangler.jsonc", "utf8"));
if (packageInfo.version !== version) throw new Error("package.json version does not match VERSION");
if (!worker.includes(`const VERSION = "${version}";`)) throw new Error("Functions version does not match VERSION");
if (!wrangler.rules?.some(rule => rule.type === "CompiledWasm" && rule.globs?.includes("**/*.wasm"))) throw new Error("Wrangler must compile the SDK WASM as a precompiled module");
if (!html.includes("/assets/app.js?v=" + version)) throw new Error("HTML JS version does not match VERSION");
if (!html.includes("/assets/app.css?v=" + version)) throw new Error("HTML CSS version does not match VERSION");
if (!manifest.name.includes("贝小果")) throw new Error("PWA manifest has an unexpected name");
if (!js.includes("X-BXG-Session")) throw new Error("API calls must include anonymous session ID");

for (const file of ["public/assets/app.js", "functions/api/v1/[[path]].js", "functions/openhongguo-runtime.js", "scripts/patch-openhongguo.mjs", "scripts/smoke-sdk.mjs", "scripts/smoke-pages-runtime.mjs"]) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) throw new Error("Syntax check failed: " + file + "\n" + result.stderr);
}
console.log("贝小果 Cloudflare 静态检查通过。版本：" + version);
