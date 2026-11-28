import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
const [api,app,html,packageText,copyScript,license,options]=await Promise.all([
 readFile("functions/api/v1/[[path]].js","utf8"),readFile("public/assets/app.js","utf8"),
 readFile("public/index.html","utf8"),readFile("package.json","utf8"),
 readFile("scripts/copy-heic-to.mjs","utf8"),readFile("public/assets/vendor/heic-to-LICENSE.txt","utf8"),
 readFile("functions/image-proxy-options.js","utf8")
]);
const pkg=JSON.parse(packageText),bundle=await stat("public/assets/vendor/heic-to.js");
assert.equal(pkg.version,"0.1.22");assert.equal(pkg.devDependencies?.["heic-to"],"1.6.7");assert.ok(bundle.size>100000);
assert.match(license,/GNU LESSER GENERAL PUBLIC LICENSE[\s\S]*Version 3/i);
assert.match(copyScript,/dist\/iife\/heic-to\.js/);assert.match(copyScript,/heic-to-LICENSE\.txt/);
assert.match(api,/url\.searchParams\.get\("mode"\) === "source"/);assert.match(api,/sourceOnly && \(method !== "GET" \|\| !isHeicImageUrl\(target\)\)/);
assert.match(api,/IMAGE_SOURCE_MODE_METHOD_NOT_ALLOWED/);
assert.match(app,/function loadHeicConverter\(\)/);assert.match(app,/window\.HeicTo/);assert.match(app,/proxy\.searchParams\.set\("mode", "source"\)/);
assert.match(app,/type:"image\/jpeg"/);assert.match(app,/activeHeicConversions >= 2/);
for(const event of ["started","success","failed","display-failed"])assert.ok(app.includes("image.heic.client-convert."+event));
assert.doesNotMatch(app,/HEIC_PENDING_PIXEL|image\.src\s*=\s*HEIC_PENDING_PIXEL/);
assert.doesNotMatch(app,/image\.heic\.transform\.display-failed|client-heic-conversion-fallback/);
assert.doesNotMatch(options,/cf\s*:\s*\{\s*image\s*:/);assert.match(options,/image\/heic/);
assert.match(html,/app\.js\?v=0\.1\.22/);assert.match(html,/app\.css\?v=0\.1\.22/);
assert.ok(!app.includes("cdn.jsdelivr.net/npm/heic-to"));
console.log("Browser-local HEIC conversion and IMG lifecycle regression checks passed.");
