import assert from "node:assert/strict";
import {
  browserSupportsNativeHeic,
  imageCacheKeyUrl,
  imageProxyFetchOptions,
  isHeicImageUrl,
  stableImageIdentity,
} from "../functions/image-proxy-options.js";

const safari17Mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const safari17IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const safari16 = "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15";
const chrome = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Safari/537.36";
const chromeIOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.0.0 Mobile/15E148 Safari/604.1";

assert.equal(browserSupportsNativeHeic(safari17Mac), true);
assert.equal(browserSupportsNativeHeic(safari17IOS), true);
assert.equal(browserSupportsNativeHeic(safari16), false);
assert.equal(browserSupportsNativeHeic(chrome), false);
assert.equal(browserSupportsNativeHeic(chromeIOS), false);

for (const extension of ["heic", "heif"]) {
  const target = new URL("https://p3-reading-sign.fqnovelpic.com/novel-pic/cover." + extension + "?signature=test");
  assert.equal(isHeicImageUrl(target), true);
  const options = imageProxyFetchOptions(target, "GET", chrome);
  assert.equal(options.method, "GET");
  assert.deepEqual(options.cf, { image: { format: "webp" } });
  assert.equal(options.redirect, "manual");
  assert.ok(options.signal);
  assert.equal(imageProxyFetchOptions(target, "GET", safari17IOS).cf, undefined);
  const head = imageProxyFetchOptions(target, "HEAD", chrome);
  assert.equal(head.method, "HEAD");
  assert.equal(head.cf, undefined, "HEAD probes must never trigger image transformation");
}

const jpeg = imageProxyFetchOptions(new URL("https://p3-reading-sign.fqnovelpic.com/novel-pic/cover.jpg"), "GET", chrome);
assert.equal(jpeg.method, "GET");
assert.equal(jpeg.cf, undefined, "JPEG should keep the original pass-through path");

const first = new URL("https://p3-reading-sign.fqnovelpic.com/novel-pic/0810c58bff1059b552ed720f1cf0a9e5~tplv-81nmtwyey9-superreso-aifit:400:0.heic?lk3s=64477e16&x-expires=1801022960&x-signature=first");
const renewed = new URL("https://p3-reading-sign.fqnovelpic.com/novel-pic/0810c58bff1059b552ed720f1cf0a9e5~tplv-81nmtwyey9-superreso-aifit:400:0.heic?x-signature=renewed&lk3s=64477e16&x-expires=1802022960");
assert.equal(stableImageIdentity(first), stableImageIdentity(renewed), "signature expiry and signature rotation must not change image identity");

const requestUrlA = "https://w.hiu.us.kg/api/v1/images?url=first&_bxg_retry=111";
const requestUrlB = "https://w.hiu.us.kg/api/v1/images?url=renewed&_bxg_retry=999";
assert.equal(await imageCacheKeyUrl(requestUrlA, first), await imageCacheKeyUrl(requestUrlB, renewed),
  "renewed signed URLs and frontend retry timestamps must share one stable cache key");

const differentLk3s = new URL(renewed.href.replace("64477e16", "64477e17"));
assert.notEqual(stableImageIdentity(first), stableImageIdentity(differentLk3s), "unknown/content-related query parameters must be retained");
const differentImage = new URL(renewed.href.replace("0810c58bff1059b552ed720f1cf0a9e5", "75e6d0725b93a515b5fc3972dd7bd7cf"));
assert.notEqual(stableImageIdentity(first), stableImageIdentity(differentImage), "different source image IDs must not collide");

const cacheKey = await imageCacheKeyUrl(requestUrlA, first);
assert.match(new URL(cacheKey).pathname, /^\/__bxg-cache\/images\/v1\/webp\/[a-f0-9]{64}$/);
console.log("Image proxy browser detection, transform gating, stable cache identity, signature rotation, and retry-key tests passed.");
