import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  browserSupportsNativeHeic,
  imageCacheKeyUrl,
  imageProxyFetchOptions,
  isHeicImageUrl,
  stableImageIdentity,
} from "../functions/image-proxy-options.js";

const safari17IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const safari16 = "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15";
const safari16IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1";
const chrome = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Safari/537.36";
const chromeIOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.0.0 Mobile/15E148 Safari/604.1";

assert.equal(browserSupportsNativeHeic(safari17IOS), true);
assert.equal(browserSupportsNativeHeic(safari16), false);
assert.equal(browserSupportsNativeHeic(safari16IOS), false);
assert.equal(browserSupportsNativeHeic(chrome), false);
assert.equal(browserSupportsNativeHeic(chromeIOS), false);

for (const extension of ["heic", "heif"]) {
  const target = new URL("https://p3-reading-sign.fqnovelpic.com/novel-pic/cover." + extension + "?signature=test");
  assert.equal(isHeicImageUrl(target), true);
  const chromeOptions = imageProxyFetchOptions(target, "GET", chrome);
  assert.deepEqual(chromeOptions.cf, { image: { format: "webp" } });
  assert.equal(chromeOptions.headers.Accept, "image/webp");
  assert.equal(chromeOptions.headers.Accept.includes("image/heic"), false);
  assert.equal(chromeOptions.headers.Accept.includes("image/avif"), false);
  const safari16Options = imageProxyFetchOptions(target, "GET", safari16IOS);
  assert.deepEqual(safari16Options.cf, { image: { format: "webp" } });
  assert.equal(safari16Options.headers.Accept, "image/webp");
  const safari17Options = imageProxyFetchOptions(target, "GET", safari17IOS);
  assert.equal(safari17Options.cf, undefined);
  assert.ok(safari17Options.headers.Accept.includes("image/heic"));
  assert.equal(imageProxyFetchOptions(target, "HEAD", chrome).cf, undefined);
}
assert.equal(imageProxyFetchOptions(new URL("https://p3-reading-sign.fqnovelpic.com/a.jpg"), "GET", chrome).cf, undefined);

const first = new URL("https://p3-reading-sign.fqnovelpic.com/novel-pic/0810c58bff1059b552ed720f1cf0a9e5~tplv-81nmtwyey9-superreso-aifit:400:0.heic?lk3s=64477e16&x-expires=1801022960&x-signature=first");
const renewed = new URL("https://p3-reading-sign.fqnovelpic.com/novel-pic/0810c58bff1059b552ed720f1cf0a9e5~tplv-81nmtwyey9-superreso-aifit:400:0.heic?x-signature=renewed&lk3s=64477e16&x-expires=1802022960");
assert.equal(stableImageIdentity(first), stableImageIdentity(renewed));
assert.equal(
  await imageCacheKeyUrl("https://w.hiu.us.kg/api/v1/images?url=first&_bxg_retry=111", first),
  await imageCacheKeyUrl("https://w.hiu.us.kg/api/v1/images?url=renewed&_bxg_retry=999", renewed)
);
assert.notEqual(stableImageIdentity(first), stableImageIdentity(new URL(renewed.href.replace("64477e16", "64477e17"))));
assert.match(new URL(await imageCacheKeyUrl("https://w.hiu.us.kg/api/v1/images", first)).pathname, /^\/__bxg-cache\/images\/v1\/webp\/[a-f0-9]{64}$/);

// Exercise the production proxyCoverImage function extracted from the API source.
// This is a function-level integration test with mocked origin fetch and Cache API;
// it deliberately does not import the full onRequest router or unrelated Go/WASM SDK.
const cacheStore = new Map();
let cacheMatchCalls = 0;
let failCacheMatch = false;
let failCachePut = false;
const fakeCache = {
  async match(request) {
    cacheMatchCalls++;
    if (failCacheMatch) throw new Error("simulated Cache API match failure");
    const value = cacheStore.get(new URL(request.url || request).href);
    return value ? value.clone() : undefined;
  },
  async put(request, response) {
    if (failCachePut) throw new Error("simulated Cache API put failure");
    cacheStore.set(new URL(request.url || request).href, response.clone());
  },
};
const originalFetch = globalThis.fetch;
const originalCaches = Object.getOwnPropertyDescriptor(globalThis, "caches");
Object.defineProperty(globalThis, "caches", { configurable: true, writable: true, value: { default: fakeCache } });
const apiSource = await readFile(new URL("../functions/api/v1/[[path]].js", import.meta.url), "utf8");
const proxyStart = apiSource.indexOf("const IMAGE_EDGE_CACHE_TTL_SECONDS =");
const proxyEnd = apiSource.indexOf("\nconst MAX_MEDIA_RANGE_BYTES", proxyStart);
assert.ok(proxyStart >= 0 && proxyEnd > proxyStart, "production image proxy block must exist");
const proxyCode = apiSource.slice(proxyStart, proxyEnd);
const testErrorResponse = (status, code, message, extraHeaders = {}) => new Response(
  JSON.stringify({ error: { code, message } }),
  { status, headers: { "Content-Type": "application/json; charset=utf-8", "X-BXG-Error-Code": code, ...extraHeaders } }
);
const debugRecord = () => {};
const sanitizeDebugMessage = value => String(value == null ? "" : value).slice(0, 420);
const proxyFactory = new Function(
  "browserSupportsNativeHeic", "imageCacheKeyUrl", "imageProxyFetchOptions", "isHeicImageUrl",
  "debugRecord", "sanitizeDebugMessage", "errorResponse",
  proxyCode + "\nreturn proxyCoverImage;"
);
const proxyCoverImage = proxyFactory(
  browserSupportsNativeHeic, imageCacheKeyUrl, imageProxyFetchOptions, isHeicImageUrl,
  debugRecord, sanitizeDebugMessage, testErrorResponse
);

const source = (id, expiry, signature) =>
  "https://p3-reading-sign.fqnovelpic.com/novel-pic/" + id +
  "~tplv-81nmtwyey9-superreso-aifit:400:0.heic?lk3s=64477e16&x-expires=" + expiry + "&x-signature=" + signature;
const requestURL = (imageURL, retry = "") => {
  const url = new URL("https://w.hiu.us.kg/api/v1/images");
  url.searchParams.set("url", imageURL);
  if (retry) url.searchParams.set("_bxg_retry", retry);
  return url.href;
};
async function callImage(imageURL, { ua = chrome, method = "GET", retry = "", sourceOnly = false } = {}) {
  const fullRequestURL = new URL(requestURL(imageURL, retry));
  if (sourceOnly) fullRequestURL.searchParams.set("mode", "source");
  const request = new Request(fullRequestURL.href, {
    method,
    headers: { "User-Agent": ua, "X-BXG-Session": "test-image-session-01" },
  });
  const sourceUrl = new URL(request.url).searchParams.get("url") || "";
  return proxyCoverImage(sourceUrl, method, "test-image-session-01", [], request, sourceOnly);
}
const webp = () => new Response("fake-webp", { status: 200, headers: { "Content-Type": "image/webp", "Content-Length": "9" } });

try {
  // Initial transform stores a WebP object; renewed signatures/retry IDs hit it.
  cacheStore.clear();
  let calls = [];
  globalThis.fetch = async (input, options) => { calls.push({ url: String(input), options }); return webp(); };
  const firstResponse = await callImage(source("0810c58bff1059b552ed720f1cf0a9e5", "1801022960", "sig-A"));
  assert.equal(firstResponse.status, 200);
  assert.equal(firstResponse.headers.get("Content-Type"), "image/webp");
  assert.equal(firstResponse.headers.get("X-BXG-Image-Cache"), "MISS");
  assert.equal(firstResponse.headers.get("X-BXG-Image-Transform"), "webp");
  assert.deepEqual(calls[0].options.cf, { image: { format: "webp" } });
  assert.equal(cacheStore.size, 1);
  assert.equal(await firstResponse.text(), "fake-webp");
  const hit = await callImage(source("0810c58bff1059b552ed720f1cf0a9e5", "1802022960", "sig-B"), { retry: "1795838961329" });
  assert.equal(hit.status, 200);
  assert.equal(hit.headers.get("X-BXG-Image-Cache"), "HIT");
  assert.equal(await hit.text(), "fake-webp");
  assert.equal(calls.length, 1, "cache hit must not call origin or transformation again");

  // Concurrent requests to the same not-yet-cached cover are coalesced.
  cacheStore.clear();
  cacheMatchCalls = 0;
  calls = [];
  let releaseFetch;
  const gate = new Promise(resolve => { releaseFetch = resolve; });
  globalThis.fetch = async (input, options) => { calls.push({ url: String(input), options }); await gate; return webp(); };
  const parallelA = callImage(source("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "1801022960", "parallel-A"));
  for (let i = 0; i < 50 && calls.length === 0; i++) await new Promise(resolve => setTimeout(resolve, 2));
  assert.equal(calls.length, 1, "first transform should have started");
  const parallelB = callImage(source("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "1802022960", "parallel-B"));
  for (let i = 0; i < 50 && cacheMatchCalls < 2; i++) await new Promise(resolve => setTimeout(resolve, 2));
  assert.ok(cacheMatchCalls >= 2, "second request must reach the edge-cache lookup while first transform is pending");
  releaseFetch();
  const parallelResponses = await Promise.all([parallelA, parallelB]);
  assert.equal(calls.length, 1);
  assert.ok(parallelResponses.every(response => response.status === 200));
  assert.ok(parallelResponses.some(response => response.headers.get("X-BXG-Image-Cache") === "COALESCED"));

  // A 9422 quota error must not fall back to original HEIC and pretend success.
  cacheStore.clear();
  calls = [];
  globalThis.fetch = async (input, options) => {
    calls.push({ url: String(input), options });
    return new Response("9422 transformation usage limit reached", {
      status: 503, headers: { "Content-Type": "text/plain", "cf-error-code": "9422" },
    });
  };
  const quota = await callImage(source("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "1801022960", "quota"));
  assert.equal(quota.status, 503);
  assert.equal(quota.headers.get("X-BXG-Error-Code"), "IMAGE_TRANSFORM_UNAVAILABLE");
  assert.equal(quota.headers.get("X-BXG-Image-Transform"), "unavailable");
  assert.equal(quota.headers.get("X-BXG-Transform-Error-Code"), "9422");
  assert.match((await quota.json()).error.message, /免费转换额度已用尽/);
  assert.equal(calls.length, 1, "9422 must not trigger a second raw-HEIC fetch");
  assert.equal(cacheStore.size, 0);

  // Opt-in source-only path returns HEIC without Cloudflare image decoding.
  cacheStore.clear();
  calls = [];
  globalThis.fetch = async (input, options) => {
    calls.push({ url: String(input), options });
    return new Response("raw-heic", { status: 200, headers: { "Content-Type": "image/heic", "Content-Length": "8" } });
  };
  const rawSourceResponse = await callImage(source("abababababababababababababababab", "1801022960", "source-only"), { sourceOnly: true });
  assert.equal(rawSourceResponse.status, 200);
  assert.equal(rawSourceResponse.headers.get("Content-Type"), "image/heic");
  assert.equal(rawSourceResponse.headers.get("X-BXG-Image-Transform"), "none");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.cf, undefined, "source-only mode must not invoke Cloudflare image decoding");
  const invalidSourceModeResponse = await callImage("https://p3-reading-sign.fqnovelpic.com/cover.jpg", { sourceOnly: true });
  assert.equal(invalidSourceModeResponse.status, 400, "source-only mode must reject ordinary image formats");
  assert.equal((await invalidSourceModeResponse.json()).error.code, "IMAGE_SOURCE_MODE_INVALID");

  // Generic transform 5xx and unexpected output MIME also return an explicit failure.
  calls = [];
  globalThis.fetch = async (input, options) => {
    calls.push({ url: String(input), options });
    return new Response("temporarily unavailable", { status: 503, headers: { "Content-Type": "text/plain" } });
  };
  const serviceError = await callImage(source("cccccccccccccccccccccccccccccccc", "1801022960", "5xx"));
  assert.equal(serviceError.status, 503);
  assert.equal(serviceError.headers.get("X-BXG-Error-Code"), "IMAGE_TRANSFORM_UNAVAILABLE");
  assert.equal(calls.length, 1);

  calls = [];
  globalThis.fetch = async (input, options) => {
    calls.push({ url: String(input), options });
    return new Response("ERROR 9516: Could not resize the image: error during decoding: Error while decoding the HEIC file.", {
      status: 422, headers: { "Content-Type": "text/plain" },
    });
  };
  const heicDecodeFailure = await callImage(source("c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1", "1801022960", "heic-9516"));
  assert.equal(heicDecodeFailure.status, 503);
  assert.equal(heicDecodeFailure.headers.get("X-BXG-Transform-Error-Code"), "9516");
  assert.equal(calls.length, 1);

  // A thrown transformation fetch and HTTP 200 with original HEIC are both failures.
  cacheStore.clear();
  calls = [];
  globalThis.fetch = async (input, options) => {
    calls.push({ url: String(input), options });
    throw new Error("simulated upstream network reset");
  };
  const networkFailure = await callImage(source("abababababababababababababababab", "1801022960", "network-failure"));
  assert.equal(networkFailure.status, 503);
  assert.equal(networkFailure.headers.get("X-BXG-Error-Code"), "IMAGE_TRANSFORM_UNAVAILABLE");
  assert.equal(networkFailure.headers.get("X-BXG-Transform-Error-Code"), "FETCH_FAILED");
  assert.equal(calls.length, 1, "a failed transform must not retry the original HEIC URL");

  calls = [];
  globalThis.fetch = async (input, options) => {
    calls.push({ url: String(input), options });
    return new Response("raw-heic", { status: 200, headers: { "Content-Type": "image/heic" } });
  };
  const rawHeicSuccess = await callImage(source("acacacacacacacacacacacacacacacac", "1801022960", "raw-heic-200"));
  assert.equal(rawHeicSuccess.status, 503);
  assert.equal(rawHeicSuccess.headers.get("X-BXG-Error-Code"), "IMAGE_TRANSFORM_UNAVAILABLE");
  assert.equal(rawHeicSuccess.headers.get("X-BXG-Transform-Error-Code"), "UNEXPECTED_CONTENT_TYPE");
  assert.equal(calls.length, 1);

  // Cache API lookup/write failures are non-fatal: the image still comes from origin.
  cacheStore.clear();
  calls = [];
  failCacheMatch = true;
  globalThis.fetch = async (input, options) => { calls.push({ url: String(input), options }); return webp(); };
  const cacheMatchFailure = await callImage(source("adadadadadadadadadadadadadadadad", "1801022960", "cache-match-failure"));
  assert.equal(cacheMatchFailure.status, 200);
  assert.equal(cacheMatchFailure.headers.get("Content-Type"), "image/webp");
  assert.equal(calls.length, 1);
  failCacheMatch = false;

  cacheStore.clear();
  calls = [];
  failCachePut = true;
  globalThis.fetch = async (input, options) => { calls.push({ url: String(input), options }); return webp(); };
  const cachePutFailure = await callImage(source("aeaeaeaeaeaeaeaeaeaeaeaeaeaeaeae", "1801022960", "cache-put-failure"));
  assert.equal(cachePutFailure.status, 200);
  assert.equal(cachePutFailure.headers.get("Content-Type"), "image/webp");
  assert.equal(calls.length, 1);
  assert.equal(cacheStore.size, 0, "a failed cache.put must not fail the image response");
  failCachePut = false;

  // Safari 17+ receives original HEIC, while Chrome HEAD probes never transform.
  calls = [];
  globalThis.fetch = async (input, options) => {
    calls.push({ url: String(input), options });
    return new Response("fake-heic", { status: 200, headers: { "Content-Type": "image/heic" } });
  };
  const safari = await callImage(source("dddddddddddddddddddddddddddddddd", "1801022960", "safari"), { ua: safari17IOS });
  assert.equal(safari.status, 200);
  assert.equal(safari.headers.get("Content-Type"), "image/heic");
  assert.equal(safari.headers.get("X-BXG-Image-Transform"), "native-heic");
  assert.equal(calls[0].options.cf, undefined);

  calls = [];
  globalThis.fetch = async (input, options) => {
    calls.push({ url: String(input), options });
    return new Response(null, { status: 200, headers: { "Content-Type": "image/heic" } });
  };
  const head = await callImage(source("eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", "1801022960", "head"), { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(calls[0].options.method, "HEAD");
  assert.equal(calls[0].options.cf, undefined);

  // An allowed HEIC redirect to another HEIC still requests WebP; redirects to
  // an ordinary image format must stop requiring WebP and pass the valid image through.
  calls = [];
  globalThis.fetch = async (input, options) => {
    calls.push({ url: String(input), options });
    if (calls.length === 1) return new Response(null, { status: 302, headers: {
      Location: "https://p3-reading-sign.fqnovelpic.com/novel-pic/redirected.heic?lk3s=64477e16",
    }});
    return webp();
  };
  const redirected = await callImage(source("ffffffffffffffffffffffffffffffff", "1801022960", "redirect"));
  assert.equal(redirected.status, 200);
  assert.equal(redirected.headers.get("Content-Type"), "image/webp");
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.options.cf?.image?.format === "webp"));

  calls = [];
  globalThis.fetch = async (input, options) => {
    calls.push({ url: String(input), options });
    if (calls.length === 1) return new Response(null, { status: 302, headers: {
      Location: "https://p3-reading-sign.fqnovelpic.com/novel-pic/redirected.jpg?lk3s=64477e16",
    }});
    return new Response("fake-jpeg", { status: 200, headers: {
      "Content-Type": "image/jpeg", "Content-Length": "9",
    }});
  };
  const redirectedJpeg = await callImage(source("ababcdcdababcdcdababcdcdababcdcd", "1801022960", "redirect-jpeg"));
  assert.equal(redirectedJpeg.status, 200);
  assert.equal(redirectedJpeg.headers.get("Content-Type"), "image/jpeg");
  assert.equal(redirectedJpeg.headers.get("X-BXG-Image-Transform"), "redirected-format");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.cf?.image?.format, "webp");
  assert.equal(calls[1].options.cf, undefined, "redirected JPEG must not request a WebP transform");

  calls = [];
  globalThis.fetch = async (input, options) => {
    calls.push({ url: String(input), options });
    return new Response(null, { status: 302, headers: { Location: "https://attacker.example/image.heic" } });
  };
  const rejected = await callImage(source("11111111111111111111111111111111", "1801022960", "bad-redirect"));
  assert.equal(rejected.status, 502);
  assert.equal(rejected.headers.get("X-BXG-Error-Code"), "IMAGE_REDIRECT_HOST");
  assert.equal(calls.length, 1);
} finally {
  globalThis.fetch = originalFetch;
  if (originalCaches) Object.defineProperty(globalThis, "caches", originalCaches);
  else delete globalThis.caches;
}

console.log("Image proxy function tests passed: cache hit/coalescing/failures, transform network/MIME/quota errors, Safari HEIC, HEAD, and HEIC/JPEG redirect handling.");
