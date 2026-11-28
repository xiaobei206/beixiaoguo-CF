import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";

const [api, app, html, packageText, copyScript, license] = await Promise.all([
  readFile("functions/api/v1/[[path]].js", "utf8"),
  readFile("public/assets/app.js", "utf8"),
  readFile("public/index.html", "utf8"),
  readFile("package.json", "utf8"),
  readFile("scripts/copy-heic-to.mjs", "utf8"),
  readFile("public/assets/vendor/heic-to-LICENSE.txt", "utf8"),
]);
const packageInfo = JSON.parse(packageText);
const bundleInfo = await stat("public/assets/vendor/heic-to.js");

assert.equal(packageInfo.version, "0.1.20");
assert.equal(packageInfo.devDependencies?.["heic-to"], "1.6.7");
assert.ok(bundleInfo.size > 100_000, "the self-hosted decoder bundle must not be empty");
assert.match(license, /GNU LESSER GENERAL PUBLIC LICENSE[\s\S]*Version 3/i);
assert.match(copyScript, /dist\/iife\/heic-to\.js/);
assert.match(copyScript, /heic-to-LICENSE\.txt/);
assert.match(api, /url\.searchParams\.get\("mode"\) === "source"/);
assert.match(api, /sourceOnly && \(method !== "GET" \|\| !isHeicImageUrl\(target\)\)/);
assert.match(api, /IMAGE_SOURCE_MODE_METHOD_NOT_ALLOWED/);
assert.match(app, /function loadHeicConverter\(\)/);
assert.match(app, /window\.HeicTo/);
assert.match(app, /mode", "source"/);
assert.match(app, /type:"image\/jpeg"/);
assert.match(app, /activeHeicConversions >= 2/);
assert.match(app, /image\.heic\.client-convert\.success/);
assert.match(app, /image\.heic\.client-convert\.failed/);
assert.match(app, /function enableClientHeicFallback\(failedImage, failedSourceUrl\) \{\s*clientHeicFallbackMode = true;\s*\/\/ Convert only the image that failed\. Other visible or lazy-loaded covers\s*\/\/ fall back independently on their own error event; new ones use mode=source\.\s*startHeicGridConversion\(failedImage, failedSourceUrl\);\s*\}/);
assert.doesNotMatch(app, /querySelectorAll\("#series-grid img\[data-original-src\], #hero img, #detail-content img"\)/, "one failed cover must not force-convert the whole page");
assert.match(html, /app\.js\?v=0\.1\.20/);
assert.match(html, /app\.css\?v=0\.1\.20/);
assert.ok(!app.includes("cdn.jsdelivr.net/npm/heic-to"), "the decoder must be served from this app, not a third-party CDN");
console.log("浏览器 HEIC 本地转换回退静态测试通过。");
