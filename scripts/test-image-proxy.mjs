import assert from "node:assert/strict";
import { onRequest } from "../functions/api/v1/[[path]].js";

const originalFetch = globalThis.fetch;
const requests = [];
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(String(input));
  requests.push({ url: url.href, options });
  const transformed = !!options.cf?.image;
  return new Response(transformed ? "webp-test-bytes" : "jpeg-test-bytes", {
    status: 200,
    headers: { "Content-Type": transformed ? "image/webp" : "image/jpeg" }
  });
};

async function fetchImage(source) {
  const request = new Request(
    "https://w.hiu.us.kg/api/v1/images?url=" + encodeURIComponent(source)
  );
  return onRequest({ request, env: {}, runtimeName: "Cloudflare Workers" });
}

try {
  for (const extension of ["heic", "heif"]) {
    const response = await fetchImage(
      "https://p3-reading-sign.fqnovelpic.com/novel-pic/cover." + extension + "?signature=test"
    );
    assert.equal(response.status, 200, extension + " cover should be served");
    assert.equal(response.headers.get("Content-Type"), "image/webp");
    assert.equal(await response.text(), "webp-test-bytes");
    assert.deepEqual(requests.at(-1).options.cf, { image: { format: "webp" } });
  }

  const jpeg = await fetchImage("https://p3-reading-sign.fqnovelpic.com/novel-pic/cover.jpg");
  assert.equal(jpeg.status, 200, "JPEG cover should be served without transformation");
  assert.equal(jpeg.headers.get("Content-Type"), "image/jpeg");
  assert.equal(await jpeg.text(), "jpeg-test-bytes");
  assert.equal(requests.at(-1).options.cf, undefined);

  console.log("Image proxy HEIC/HEIF WebP transformation and normal JPEG passthrough tests passed.");
} finally {
  globalThis.fetch = originalFetch;
}
