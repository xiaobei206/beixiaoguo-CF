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

/** Always forward original bytes; never enable Cloudflare cf.image. */
export function imageProxyFetchOptions(_target, method) {
  return {
    method: method === "HEAD" ? "HEAD" : "GET",
    headers: {
      "Accept": "image/avif,image/webp,image/apng,image/heic,image/heif,image/jpeg,image/png,image/*;q=0.8"
    },
    redirect: "manual",
    signal: AbortSignal.timeout(15000),
  };
}
