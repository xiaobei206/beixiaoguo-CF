import "../../openhongguo-runtime.js";
import { createClient, SearchFilter } from "openhongguo";

const VERSION = "0.1.4";
const MAX_CLIENTS = 128;
const MAX_PROFILES = 256;
const clients = new Map();
const profiles = new Map();
const debugLogs = new Map();
const MAX_DEBUG_SESSIONS = 128;
const MAX_DEBUG_EVENTS = 240;
const DEBUG_LOG_TTL_MS = 60 * 60 * 1000;

function sanitizeDebugMessage(value) {
  return String(value == null ? "" : value)
    .replace(/https?:\\/\\/[^\\s"'<>]+/gi, (raw) => {
      try { const u = new URL(raw); return u.origin + u.pathname; } catch (_) { return "[URL]"; }
    })
    .replace(/(authorization|cookie|set-cookie|token|secret|password|session)(\\s*[:=]\\s*)[^\\s,;]+/gi, "$1$2[REDACTED]")
    .replace(/[A-Za-z0-9_-]{48,}/g, "[LONG_TOKEN]")
    .slice(0, 420);
}
function debugRecord(session, level, event, detail = {}) {
  if (!session) return;
  const now = Date.now();
  for (const [key, bucket] of debugLogs) {
    if (now - bucket.updatedAt > DEBUG_LOG_TTL_MS) debugLogs.delete(key);
  }
  let bucket = debugLogs.get(session);
  if (!bucket) bucket = { updatedAt: now, events: [] };
  bucket.updatedAt = now;
  bucket.events.push({ time: new Date(now).toISOString(), level, event, ...detail });
  if (bucket.events.length > MAX_DEBUG_EVENTS) bucket.events.splice(0, bucket.events.length - MAX_DEBUG_EVENTS);
  debugLogs.delete(session);
  debugLogs.set(session, bucket);
  while (debugLogs.size > MAX_DEBUG_SESSIONS) debugLogs.delete(debugLogs.keys().next().value);
}
function runtimeDiagnostics() {
  const go = globalThis.__BXG_OPENHONGGUO_GO;
  const state = globalThis.__BXG_OPENHONGGUO_STATE || {};
  return {
    initialized: !!globalThis.__openhongguo,
    exited: !!go?.exited || !!state.exited,
    generation: Number(state.generation || globalThis.__BXG_OPENHONGGUO_GENERATION) || 0,
    startedAt: state.startedAt || null,
    exitedAt: state.exitedAt || null,
    error: sanitizeDebugMessage(state.error || ""),
  };
}
function describeEndpoint(parts) {
  if (parts[0] === "series" && parts.length > 1) return "series/:id/" + (parts[2] || "detail");
  if (parts[0] === "play" && parts.length > 1) return "play/:episodeId";
  if (parts[0] === "debug") return "debug/logs";
  return parts.join("/") || "root";
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}
function errorResponse(status, code, message) {
  return json({ error: { code, message } }, status);
}
function trimMap(map, maxSize, onEvict) {
  while (map.size > maxSize) {
    const first = map.keys().next().value;
    if (first === undefined) break;
    map.delete(first);
    if (onEvict) onEvict(first);
  }
}
function getSession(request) {
  const value = request.headers.get("X-BXG-Session") || "";
  if (/^[a-zA-Z0-9._:-]{8,128}$/.test(value)) return value;
  return "bxg-edge-" + crypto.randomUUID();
}
function fetchTransport(session) {
  return async function sendTransport(req) {
    const startedAt = Date.now();
    let target = "upstream";
    try { const u = new URL(req.url); target = u.hostname + u.pathname; } catch (_) {}
    debugRecord(session, "debug", "upstream.request", { method: req.method || "GET", target });
    try {
  const headers = new Headers(req.headers || {});
  headers.delete("host");
  headers.delete("content-length");
  headers.delete("connection");
  const body = req.body && req.body.byteLength ? req.body : undefined;
  const response = await fetch(req.url, {
    method: req.method || "GET",
    headers,
    body,
    redirect: "manual",
    signal: AbortSignal.timeout(25000),
  });
  const length = Number(response.headers.get("content-length")) || 0;
  if (length > (8 << 20)) throw new Error("上游响应超过 8 MiB 限制");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > (8 << 20)) throw new Error("上游响应超过 8 MiB 限制");
  const responseHeaders = {};
  response.headers.forEach((value, key) => { responseHeaders[key.toLowerCase()] = value; });
  delete responseHeaders["content-encoding"];
  delete responseHeaders["content-length"];
  const cookies = {};
  const cookieLines = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : (response.headers.get("set-cookie") ? [response.headers.get("set-cookie")] : []);
  for (const line of cookieLines) {
    const pair = line.split(";", 1)[0];
    const index = pair.indexOf("=");
    if (index > 0) cookies[pair.slice(0, index).trim()] = pair.slice(index + 1).trim();
  }
  debugRecord(session, response.ok ? "info" : "warn", "upstream.response", {
    target, status: response.status, durationMs: Date.now() - startedAt, bytes: bytes.byteLength
  });
  return { status: response.status, headers: responseHeaders, cookies, body: bytes };
    } catch (error) {
      debugRecord(session, "error", "upstream.error", {
        target, durationMs: Date.now() - startedAt, message: sanitizeDebugMessage(error?.message || error)
      });
      throw error;
    }
  };
}
function profileStore(session) {
  return {
    async load() {
      const value = profiles.get(session) ?? null;
      if (value !== null) {
        profiles.delete(session);
        profiles.set(session, value);
      }
      return value;
    },
    async save(value) {
      profiles.delete(session);
      profiles.set(session, value);
      trimMap(profiles, MAX_PROFILES);
    },
    async reset() {
      profiles.delete(session);
    },
  };
}
async function getClient(session) {
  if (globalThis.__BXG_OPENHONGGUO_GO?.exited) {
    debugRecord(session, "warn", "wasm.runtime.exited", runtimeDiagnostics());
    clients.clear();
  }
  const cached = clients.get(session);
  if (cached) {
    clients.delete(session);
    clients.set(session, cached);
    return cached;
  }
  debugRecord(session, "info", "sdk.client.create", runtimeDiagnostics());
  const client = await createClient({
    profile: profileStore(session),
    transport: fetchTransport(session),
    log: (line) => debugRecord(session, "debug", "sdk.log", { message: sanitizeDebugMessage(line) }),
    timeoutMs: 25000,
    retryAttempts: 2,
    deviceResets: 1,
  });
  debugRecord(session, "info", "sdk.client.ready", runtimeDiagnostics());
  clients.set(session, client);
  trimMap(clients, MAX_CLIENTS);
  return client;
}
async function callClient(session, method, ...args) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const client = await getClient(session);
    try {
      return await client[method](...args);
    } catch (error) {
      const message = String(error?.message || error);
      if (attempt === 0 && /Go program has already exited/i.test(message)) {
        debugRecord(session, "error", "wasm.call.after-exit", {
          method, message, runtime: runtimeDiagnostics()
        });
        clients.clear();
        continue;
      }
      throw error;
    }
  }
  throw new Error("Go/WASM runtime 重启后仍无法完成调用");
}
function mapSearchType(value) {
  switch (value) {
    case "short": return [SearchFilter.ShortPlay];
    case "comic": return [SearchFilter.Comic];
    case "ai": return [SearchFilter.AIComic];
    case "film": return [SearchFilter.Film];
    case "unwatched": return [SearchFilter.Unwatched];
    default: return [];
  }
}
function selectStream(result, requestedQuality) {
  const playback = result && result.playback;
  const streams = playback && Array.isArray(playback.streams) ? playback.streams : [];
  const list = streams.map((stream) => {
    const label = stream.definition || stream.quality || (stream.height ? String(stream.height) + "p" : "自动");
    return { stream, label, codec: stream.codec || "" };
  });
  let selected = list.find((entry) => entry.label === requestedQuality || entry.stream.quality === requestedQuality);
  if (!selected) {
    selected = [...list].sort((a, b) =>
      (Number(b.stream.height) || 0) - (Number(a.stream.height) || 0) ||
      (Number(b.stream.bitrate) || 0) - (Number(a.stream.bitrate) || 0)
    )[0];
  }
  if (!selected) return null;
  const protectedStream = !!(playback.protected || selected.stream.protected);
  return {
    quality: selected.label,
    available_qualities: list.map((entry) => ({ label: entry.label, codec: entry.codec })),
    src: protectedStream ? "" : (selected.stream.url || selected.stream.backup_url || ""),
    protected: protectedStream,
    duration_seconds: playback.duration_seconds || 0,
    expires_at: playback.expires_at || 0,
    media_type: playback.media_type || "",
  };
}
export async function onRequest(context) {
  const { request } = context;
  const runtimeName = context.runtimeName || "Cloudflare Pages Functions";
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/v1\/?/, "");
  const parts = path.split("/").filter(Boolean).map((part) => {
    try { return decodeURIComponent(part); } catch (_) { return part; }
  });
  try {
    if (request.method === "OPTIONS") return new Response(null, { status: 204 });
    if (request.method !== "GET" && request.method !== "HEAD" && request.method !== "POST" && request.method !== "PUT" && request.method !== "DELETE") {
      return errorResponse(405, "METHOD_NOT_ALLOWED", "不支持的请求方法");
    }
    if (parts[0] === "debug" && parts[1] === "logs") {
      const session = getSession(request);
      if (request.method === "DELETE") {
        debugLogs.delete(session);
        debugRecord(session, "info", "debug.logs.cleared");
        return json({ ok: true });
      }
      const bucket = debugLogs.get(session);
      if (bucket) {
        bucket.updatedAt = Date.now();
        debugLogs.delete(session);
        debugLogs.set(session, bucket);
      }
      const requestedLimit = Number(url.searchParams.get("limit")) || 160;
      const limit = Math.max(1, Math.min(240, requestedLimit));
      return json({ events: bucket ? bucket.events.slice(-limit) : [], runtime: runtimeDiagnostics() });
    }
    if (parts[0] === "health") {
      let sdkState = "not-loaded";
      if (url.searchParams.get("sdk") === "1") {
        await getClient(getSession(request));
        sdkState = "ready";
      }
      if (url.searchParams.get("sdk") === "probe" && context.env?.BXG_SMOKE_TEST === "1") {
        let transportCalls = 0;
        const sentinel = "BXG_WORKER_WASM_PROBE";
        const probeClient = await createClient({
          profile: { async load() { return null; }, async save() {}, async reset() {} },
          transport: async () => { transportCalls++; throw new Error(sentinel); },
          retryAttempts: 1,
          deviceResets: 0,
        });
        for (let i = 0; i < 2; i++) {
          try {
            await probeClient.discover({ channel: "推荐" });
            throw new Error("WASM probe unexpectedly completed without using the mock transport");
          } catch (error) {
            if (!String(error?.message || error).includes(sentinel)) throw error;
          }
        }
        if (transportCalls < 2) throw new Error("WASM probe did not reach the JavaScript transport twice");
        sdkState = "ready";
        return json({ status: "ok", version: VERSION, runtime: runtimeName, sdk: sdkState, goCallbacks: "ok", transportCalls, wasm: runtimeDiagnostics() });
      }
      return json({ status: "ok", version: VERSION, runtime: runtimeName, sdk: sdkState });
    }
    if (parts[0] === "playback" && parts[1] === "activity") return json({ ok: true });
    if (parts[0] === "settings") {
      if (request.method === "PUT") return json({ ok: true, message: "Cloudflare 轻量版不使用 N1 服务端缓存设置。" });
      return json({ settings: {}, preheat: { running: false, phase: "Cloudflare 轻量版按需处理请求，不运行常驻预热" }, cache: {} });
    }
    if (parts[0] === "preheat" && parts[1] === "run") {
      return errorResponse(501, "NOT_SUPPORTED", "Cloudflare 轻量版不运行常驻预热任务。");
    }
    if (parts[0] === "tv" && parts[1] === "devices") {
      return json({ devices: [], message: "公共边缘函数不能直接执行家庭局域网 mDNS 发现。" });
    }
    if (parts[0] === "tv" && parts[1] === "handoff") {
      return errorResponse(501, "LOCAL_NETWORK_REQUIRED", "电视接力需要家庭局域网内的 N1 或配套助手。");
    }
    const session = getSession(request);
    debugRecord(session, "info", "api.request", {
      method: request.method, endpoint: describeEndpoint(parts)
    });
    if (parts[0] === "discover") {
      return json(await callClient(session, "discover", {
        channel: url.searchParams.get("channel") || "推荐",
        cursor: url.searchParams.get("cursor") || "",
      }));
    }
    if (parts[0] === "search") {
      const q = url.searchParams.get("q") || "";
      if (!q.trim()) return json({ items: [], has_more: false, cursor: "" });
      return json(await callClient(session, "search", q, {
        cursor: url.searchParams.get("cursor") || "",
        pageSize: 40,
        filters: mapSearchType(url.searchParams.get("type") || "all"),
      }));
    }
    if (parts[0] === "suggest") {
      return json({ items: await callClient(session, "suggest", url.searchParams.get("q") || "") });
    }
    if (parts[0] === "hot-search") return json(await callClient(session, "hotSearch"));
    if (parts[0] === "new-releases") {
      const date = url.searchParams.get("date") || new Date().toISOString().slice(0, 10).replace(/-/g, "");
      return json(await callClient(session, "newReleases", { date, cursor: url.searchParams.get("cursor") || "" }));
    }
    if (parts[0] === "rank") {
      return json(await callClient(session, "shortRank", {
        content: url.searchParams.get("content") || "all",
        board: url.searchParams.get("board") || "",
        cursor: url.searchParams.get("cursor") || "",
      }));
    }
    if (parts[0] === "series" && parts[1]) {
      const seriesId = parts[1];
      if (parts[2] === "detail") {
        const rows = await callClient(session, "getSeriesBatch", [seriesId]);
        if (!Array.isArray(rows) || !rows.length) return errorResponse(404, "SERIES_NOT_FOUND", "没有找到这部短剧。");
        return json(rows[0]);
      }
      if (parts[2] === "episodes") {
        return json(await callClient(session, "listEpisodes", seriesId, { cursor: url.searchParams.get("cursor") || "", pageSize: 100 }));
      }
      if (parts[2] === "seasons") return json(await callClient(session, "seasons", seriesId));
      if (parts.length === 2) return json(await callClient(session, "getSeries", seriesId));
    }
    if (parts[0] === "play" && parts[1]) {
      const result = await callClient(session, "resolvePlayback", parts[1]);
      const data = selectStream(result, url.searchParams.get("quality") || "best");
      if (!data) return errorResponse(502, "PLAYBACK_EMPTY", "上游没有返回可用的视频流。");
      return json(data);
    }
    if (parts[0] === "images" && parts[1]) {
      return errorResponse(501, "IMAGE_PROXY_NOT_NEEDED", "Cloudflare 轻量版直接加载上游封面地址。");
    }
    return errorResponse(404, "NOT_FOUND", "找不到这个 API 路径。");
  } catch (error) {
    const code = error && typeof error.code === "string" ? error.code : "UPSTREAM_ERROR";
    const raw = error && error.message ? String(error.message) : "未知错误";
    const message = raw.length > 240 ? raw.slice(0, 240) + "…" : raw;
    if (typeof session !== "undefined") {
      debugRecord(session, "error", "api.error", {
        endpoint: describeEndpoint(parts), code, message: sanitizeDebugMessage(raw),
        runtime: runtimeDiagnostics()
      });
    }
    return errorResponse(502, code, "片库请求失败：" + message);
  }
}
