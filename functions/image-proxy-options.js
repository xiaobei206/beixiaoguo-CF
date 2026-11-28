const EPHEMERAL_IMAGE_QUERY_PARAMETERS = new Set(["x-expires", "x-signature", "_bxg_retry"]);
const HEIC_EXTENSION = /\.(?:heic|heif)$/i;

export function isHeicImageUrl(target) {
  const url = target instanceof URL ? target : new URL(String(target));
  return HEIC_EXTENSION.test(url.pathname);
}

/** Safari 17 introduced native HEIC/HEIF image support. */
export function browserSupportsNativeHeic(userAgent) {
  const ua = String(userAgent || "");
  if (!/Safari\//i.test(ua)) return false;
  if (/(?:Chrome|CriOS|Chromium|Edg|EdgiOS|OPR|Opera|FxiOS|Firefox|DuckDuckGo|SamsungBrowser|UCBrowser|YaBrowser|Brave|GSA)\//i.test(ua)) return false;
  const version = ua.match(/Version\/(\d+)(?:\.\d+)?/i);
  return !!version && Number(version[1]) >= 17;
}

/** Ordinary formats pass through. HEAD probes never trigger image conversion. */
export function imageProxyFetchOptions(target, method, userAgent = "", enableTransform = true) {
  const fetchOptions = {
    method: method === "HEAD" ? "HEAD" : "GET",
    headers: { "Accept": "image/avif,image/webp,image/apng,image/heic,image/heif,image/jpeg,image/png,image/*;q=0.8" },
    redirect: "manual",
    signal: AbortSignal.timeout(15000),
  };
  const needsWebp = enableTransform && method !== "HEAD" &&
    isHeicImageUrl(target) && !browserSupportsNativeHeic(userAgent);
  if (needsWebp) fetchOptions.cf = { image: { format: "webp" } };
  return fetchOptions;
}

/**
 * Retain path, tplv processing spec, lk3s and unknown parameters. Only signed
 * authorization values (x-expires/x-signature) and _bxg_retry are ephemeral.
 */
export function stableImageIdentity(target) {
  const url = target instanceof URL ? new URL(target.href) : new URL(String(target));
  const stableEntries = [...url.searchParams.entries()]
    .filter(([name]) => !EPHEMERAL_IMAGE_QUERY_PARAMETERS.has(name.toLowerCase()))
    .sort(([nameA, valueA], [nameB, valueB]) => nameA.localeCompare(nameB) || valueA.localeCompare(valueB));
  url.search = "";
  for (const [name, value] of stableEntries) url.searchParams.append(name, value);
  url.hash = "";
  return url.origin + url.pathname + url.search;
}

/** Hash the stable identity into a synthetic same-origin Cache API URL. */
export async function imageCacheKeyUrl(requestUrl, target, format = "webp") {
  const identity = stableImageIdentity(target);
  const material = "beixiaoguo-image-cache-v1\n" + String(format).toLowerCase() + "\n" + identity;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  return new URL("/__bxg-cache/images/v1/" + String(format).toLowerCase() + "/" + hash, requestUrl).href;
}
