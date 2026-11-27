import { readFile, access } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const required = [
  "public/index.html", "public/assets/app.js", "public/assets/app.css",
  "public/assets/icon-192.png", "public/assets/icon-512.png",
  "public/manifest.webmanifest", "functions/api/v1/[[path]].js", "wrangler.jsonc", "VERSION"
];
for (const file of required) await access(file);

const html = await readFile("public/index.html", "utf8");
const js = await readFile("public/assets/app.js", "utf8");
const manifest = JSON.parse(await readFile("public/manifest.webmanifest", "utf8"));
const version = (await readFile("VERSION", "utf8")).trim();
if (!html.includes("/assets/app.js?v=" + version)) throw new Error("HTML JS version does not match VERSION");
if (!html.includes("/assets/app.css?v=" + version)) throw new Error("HTML CSS version does not match VERSION");
if (!manifest.name.includes("贝小果")) throw new Error("PWA manifest has an unexpected name");
if (!js.includes("X-BXG-Session")) throw new Error("API calls must include anonymous session ID");

for (const file of ["public/assets/app.js", "functions/api/v1/[[path]].js", "scripts/smoke-sdk.mjs"]) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) throw new Error("Syntax check failed: " + file + "\n" + result.stderr);
}
console.log("贝小果 Cloudflare 静态检查通过。版本：" + version);
