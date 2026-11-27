export function normalizeRouteIPAddress(raw) {
  let value = String(raw || "").trim();
  if (value.startsWith("[") && value.endsWith("]")) value = value.slice(1, -1);
  if (!value || /[\\s/?#@]/.test(value)) return "";

  if (value.includes(":")) {
    try {
      const hostname = new URL("https://[" + value + "]/").hostname;
      if (!hostname.startsWith("[") || !hostname.endsWith("]")) return "";
      const normalized = hostname.slice(1, -1).toLowerCase();
      return normalized.includes("%") ? "" : normalized;
    } catch (_) {
      return "";
    }
  }

  const octets = value.split(".");
  if (octets.length !== 4 || octets.some((part) => !/^\\d{1,3}$/.test(part) || Number(part) > 255)) return "";
  return octets.map((part) => String(Number(part))).join(".");
}
