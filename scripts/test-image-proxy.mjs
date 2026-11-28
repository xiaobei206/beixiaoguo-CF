import assert from "node:assert/strict";
import { imageProxyFetchOptions } from "../functions/image-proxy-options.js";

for (const extension of ["heic", "heif"]) {
  const target = new URL("https://p3-reading-sign.fqnovelpic.com/novel-pic/cover." + extension + "?signature=test");
  const options = imageProxyFetchOptions(target, "GET");
  assert.equal(options.method, "GET");
  assert.deepEqual(options.cf, { image: { format: "webp" } });
  assert.equal(options.redirect, "manual");
  assert.ok(options.signal);
}

const jpeg = imageProxyFetchOptions(new URL("https://p3-reading-sign.fqnovelpic.com/novel-pic/cover.jpg"), "GET");
assert.equal(jpeg.method, "GET");
assert.equal(jpeg.cf, undefined, "JPEG should keep the original pass-through path");

const head = imageProxyFetchOptions(new URL("https://p3-reading-sign.fqnovelpic.com/novel-pic/cover.heic"), "HEAD");
assert.equal(head.method, "HEAD");
assert.deepEqual(head.cf, { image: { format: "webp" } });

console.log("Image proxy HEIC/HEIF WebP transformation options and JPEG passthrough tests passed.");
