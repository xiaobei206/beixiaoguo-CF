export function imageProxyFetchOptions(target, method) {
  const fetchOptions = {
    method: method === "HEAD" ? "HEAD" : "GET",
    headers: { "Accept": "image/avif,image/webp,image/apng,image/jpeg,image/png,image/*;q=0.8" },
    redirect: "manual",
    signal: AbortSignal.timeout(15000),
  };
  // Chromium does not render HEIC/HEIF in ordinary <img> elements.
  // Request Cloudflare's WebP transformation only for these source formats.
  if (/\.(?:heic|heif)$/i.test(target.pathname)) {
    fetchOptions.cf = { image: { format: "webp" } };
  }
  return fetchOptions;
}
