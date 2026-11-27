import "../../openhongguo-runtime.js";
import { createClient, SearchFilter } from "openhongguo";

const VERSION = "0.1.6";
const MAX_CLIENTS = 128;
const MAX_PROFILES = 256;
const clients = new Map();
const clientDebugContexts = new Map();
const sessionQueues = new Map();
const profiles = new Map();
const debugLogs = new Map();
const MAX_DEBUG_SESSIONS = 128;
const MAX_DEBUG_EVENTS = 240;
const DEBUG_LOG_TTL_MS = 60 * 60 * 1000;

function sanitizeDebugMessage(value) {
  return String(value == null ? "" : value)
    .replace(/https?:\/\/[^\s"'<>]+/gi, (raw) => {
      try { const u = new URL(raw); return u.origin + u.pathname; } catch (_) { return "[URL]"; }
    })
    .replace(/(authorization|cookie|set-cookie|token|secret|password|session)(\s*[:=]\s*)[^\s,;]+/gi, "$1$2[REDACTED]")
    .replace(/[A-Za-z0-9_-]{48,}/g, "[LONG_TOKEN]")
    .slice(0, 420);
}
function debugRecord(session, level, event, detail = {}, trace = null) {
  const now = Date.now();
  const cleanDetail = {};
  for (const [key, value] of Object.entries(detail || {})) {
    if (typeof value === "string") cleanDetail[key] = sanitizeDebugMessage(value);
    else if (value && typeof value === "object" && !Array.isArray(value)) {
      cleanDetail[key] = Object.fromEntries(Object.entries(value).slice(0, 12).map(([k, v]) =>
        [k, typeof v === "string" ? sanitizeDebugMessage(v) : (v == null || ["number","boolean"].includes(typeof v) ? v : "[object]")]
      ));
    } else if (value == null || ["number","boolean"].includes(typeof value)) cleanDetail[key] = value;
  }
  const entry = { time: new Date(now).toISOString(), level, event, ...cleanDetail };
  if (Array.isArray(trace)) {
    trace.push(entry);
    if (trace.length > 32) trace.shift();
  }
  if (!session) return;
  for (const [key, bucket] of debugLogs) {
    if (now - bucket.updatedAt > DEBUG_LOG_TTL_MS) debugLogs.delete(key);
  }
  let bucket = debugLogs.get(session);
  if (!bucket) bucket = { updatedAt: now, events: [] };
  bucket.updatedAt = now;
  bucket.events.push(entry);
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
  return json({ error: { code, message } }, status, { "X-BXG-Error-Code": code });
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
function fetchTransport(session, debugContext) {
  return async function sendTransport(req) {
    const startedAt = Date.now();
    let target = "upstream";
    try { const u = new URL(req.url); target = u.hostname + u.pathname; } catch (_) {}
    debugRecord(session, "debug", "upstream.request", { method: req.method || "GET", target }, debugContext?.trace);
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
  }, debugContext?.trace);
  return { status: response.status, headers: responseHeaders, cookies, body: bytes };
    } catch (error) {
      debugRecord(session, "error", "upstream.error", {
        target, durationMs: Date.now() - startedAt, message: sanitizeDebugMessage(error?.message || error)
      }, debugContext?.trace);
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
async function getClient(session, trace = null) {
  if (globalThis.__BXG_OPENHONGGUO_GO?.exited) {
    debugRecord(session, "warn", "wasm.runtime.exited", runtimeDiagnostics(), trace);
    clients.clear();
    clientDebugContexts.clear();
  }
  const cached = clients.get(session);
  if (cached) {
    const context = clientDebugContexts.get(session);
    if (context) context.trace = trace;
    clients.delete(session);
    clients.set(session, cached);
    return cached;
  }
  debugRecord(session, "info", "sdk.client.create", runtimeDiagnostics(), trace);
  const debugContext = { trace };
  const client = await createClient({
    profile: profileStore(session),
    transport: fetchTransport(session, debugContext),
    log: (line) => debugRecord(session, "debug", "sdk.log", { message: sanitizeDebugMessage(line) }, debugContext.trace),
    timeoutMs: 25000,
    retryAttempts: 2,
    deviceResets: 1,
  });
  debugRecord(session, "info", "sdk.client.ready", runtimeDiagnostics(), trace);
  clients.set(session, client);
  clientDebugContexts.set(session, debugContext);
  trimMap(clients, MAX_CLIENTS, (key) => clientDebugContexts.delete(key));
  return client;
}
async function callClient(session, method, trace, ...args) {
  // A cached SDK client carries one request-scoped trace context. Serialize
  // calls for the same browser session so concurrent UI requests cannot
  // overwrite each other's edge diagnostics.
  const previous = sessionQueues.get(session) || Promise.resolve();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const queued = previous.catch(() => {}).then(() => gate);
  sessionQueues.set(session, queued);
  await previous.catch(() => {});
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const client = await getClient(session, trace);
      try {
        return await client[method](...args);
      } catch (error) {
        const message = String(error?.message || error);
        if (attempt === 0 && /Go program has already exited/i.test(message)) {
          debugRecord(session, "error", "wasm.call.after-exit", {
            method, message, runtime: runtimeDiagnostics()
          }, trace);
          // Mark the module-level runtime so the next createClient() discards
          // its stale JS API and instantiates a fresh Go/WASM runtime.
          const go = globalThis.__BXG_OPENHONGGUO_GO;
          if (go) go.exited = true;
          const previousState = globalThis.__BXG_OPENHONGGUO_STATE || {};
          globalThis.__BXG_OPENHONGGUO_STATE = {
            ...previousState,
            generation: Number(previousState.generation || globalThis.__BXG_OPENHONGGUO_GENERATION) || 0,
            exited: true,
            exitedAt: Date.now(),
            error: sanitizeDebugMessage(message),
          };
          delete globalThis.__openhongguo;
          clients.clear();
          clientDebugContexts.clear();
          continue;
        }
        throw error;
      }
    }
    throw new Error("Go/WASM runtime 重启后仍无法完成调用");
  } finally {
    const context = clientDebugContexts.get(session);
    if (context) context.trace = null;
    release();
    if (sessionQueues.get(session) === queued) sessionQueues.delete(session);
  }
}
async function proxyCoverImage(rawUrl, method, session, trace) {
  const parseTarget = (value) => {
    const target = new URL(value);
    const host = target.hostname.toLowerCase();
    if (target.protocol !== "https:" || target.username || target.password || target.port ||
        !(host === "fqnovelpic.com" || host.endsWith(".fqnovelpic.com"))) {
      throw new Error("封面地址不属于允许的 HTTPS 图片域名");
    }
    return target;
  };
  let target;
  try { target = parseTarget(rawUrl); }
  catch (error) {
    debugRecord(session, "warn", "image.proxy.rejected", { message: error.message }, trace);
    return errorResponse(400, "IMAGE_URL_REJECTED", error.message);
  }
  const startedAt = Date.now();
  for (let redirectCount = 0; redirectCount <= 3; redirectCount++) {
    let response;
    try {
      response = await fetch(target.href, {
        method: method === "HEAD" ? "HEAD" : "GET",
        headers: { "Accept": "image/avif,image/webp,image/apng,image/jpeg,image/png,image/*;q=0.8" },
        redirect: "manual",
        signal: AbortSignal.timeout(15000),
      });
    } catch (error) {
      debugRecord(session, "error", "image.proxy.fetch.error", {
        host: target.hostname, durationMs: Date.now() - startedAt,
        message: sanitizeDebugMessage(error?.message || error)
      }, trace);
      return errorResponse(502, "IMAGE_UPSTREAM_FETCH", "Cloudflare 获取上游封面失败：" + sanitizeDebugMessage(error?.message || error));
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirectCount === 3) {
        debugRecord(session, "error", "image.proxy.redirect.rejected", {
          host: target.hostname, status: response.status, durationMs: Date.now() - startedAt
        }, trace);
        return errorResponse(502, "IMAGE_REDIRECT_LIMIT", "上游封面重定向次数过多或缺少 Location。");
      }
      try { target = parseTarget(new URL(location, target).href); }
      catch (error) {
        debugRecord(session, "error", "image.proxy.redirect.rejected", {
          host: target.hostname, status: response.status, message: error.message
        }, trace);
        return errorResponse(502, "IMAGE_REDIRECT_HOST", "上游封面重定向到了未允许的域名。");
      }
      continue;
    }
    const contentType = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    const length = Number(response.headers.get("content-length")) || 0;
    if (!response.ok) {
      debugRecord(session, "warn", "image.proxy.upstream.response", {
        host: target.hostname, status: response.status, contentType, durationMs: Date.now() - startedAt
      }, trace);
      return errorResponse(502, "IMAGE_UPSTREAM_HTTP", "上游图片服务器返回 HTTP " + response.status);
    }
    if (!/^image\/(avif|webp|jpeg|png|gif)$/.test(contentType)) {
      debugRecord(session, "warn", "image.proxy.invalid-content-type", {
        host: target.hostname, status: response.status, contentType
      }, trace);
      return errorResponse(502, "IMAGE_CONTENT_TYPE", "上游响应不是受支持的图片格式。");
    }
    if (length > (10 << 20)) return errorResponse(413, "IMAGE_TOO_LARGE", "上游封面超过 10 MiB 限制。");
    let body = null;
    if (method !== "HEAD") {
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > (10 << 20)) return errorResponse(413, "IMAGE_TOO_LARGE", "上游封面超过 10 MiB 限制。");
      body = bytes;
    }
    const headers = new Headers({
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
      "X-Content-Type-Options": "nosniff",
      "X-BXG-Image-Proxy": "1",
    });
    for (const name of ["etag", "last-modified"]) {
      const value = response.headers.get(name);
      if (value) headers.set(name, value);
    }
    debugRecord(session, "info", "image.proxy.success", {
      host: target.hostname, status: response.status, contentType,
      bytes: body ? body.byteLength : 0, durationMs: Date.now() - startedAt
    }, trace);
    return new Response(body, { status: 200, headers });
  }
  return errorResponse(502, "IMAGE_PROXY_FAILED", "无法取得封面。");
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
  let requestSession = "";
  const requestTrace = [];
  const traceId = crypto.randomUUID();
  const requestStartedAt = Date.now();
  function traced(response) {
    const events = requestTrace.slice(-10);
    let value = encodeURIComponent(JSON.stringify({ traceId, events }));
    while (value.length > 5200 && events.length > 1) {
      events.shift();
      value = encodeURIComponent(JSON.stringify({ traceId, events }));
    }
    if (value.length > 5200) {
      value = encodeURIComponent(JSON.stringify({ traceId, events: events.map(e => ({
        time:e.time, level:e.level, event:e.event
      })) }));
    }
    response.headers.set("X-BXG-Trace-ID", traceId);
    response.headers.set("X-BXG-Debug", value);
    response.headers.set("Server-Timing", "bxg;dur=" + (Date.now() - requestStartedAt));
    return response;
  }
  function sendJson(data, status = 200, headers = {}) {
    return traced(json(data, status, headers));
  }
  function sendError(status, code, message) {
    return traced(errorResponse(status, code, message));
  }
  function sendResponse(response) {
    return traced(response);
  }
  try {
    if (request.method === "OPTIONS") return sendResponse(new Response(null, { status: 204 }));
    if (request.method !== "GET" && request.method !== "HEAD" && request.method !== "POST" && request.method !== "PUT" && request.method !== "DELETE") {
      return sendError(405, "METHOD_NOT_ALLOWED", "不支持的请求方法");
    }
    if (parts[0] === "debug" && parts[1] === "logs") {
      const session = getSession(request);
      if (request.method === "DELETE") {
        debugLogs.delete(session);
        debugRecord(session, "info", "debug.logs.cleared", {}, requestTrace);
        return sendJson({ ok: true });
      }
      const bucket = debugLogs.get(session);
      if (bucket) {
        bucket.updatedAt = Date.now();
        debugLogs.delete(session);
        debugLogs.set(session, bucket);
      }
      const requestedLimit = Number(url.searchParams.get("limit")) || 160;
      const limit = Math.max(1, Math.min(240, requestedLimit));
      return sendJson({ events: bucket ? bucket.events.slice(-limit) : [], runtime: runtimeDiagnostics() });
    }
    if (parts[0] === "health") {
      let sdkState = "not-loaded";
      if (url.searchParams.get("sdk") === "1") {
        await getClient(getSession(request), requestTrace);
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
            if (/Go program has already exited/i.test(String(error?.message || error))) throw error;
          }
        }
        if (transportCalls < 2) throw new Error("WASM probe did not reach the JavaScript transport twice");
        sdkState = "ready";
        return sendJson({ status: "ok", version: VERSION, runtime: runtimeName, sdk: sdkState, goCallbacks: "ok", transportCalls, wasm: runtimeDiagnostics() });
      }
      return sendJson({ status: "ok", version: VERSION, runtime: runtimeName, sdk: sdkState });
    }
    if (parts[0] === "playback" && parts[1] === "activity") return sendJson({ ok: true });
    if (parts[0] === "settings") {
      if (request.method === "PUT") return sendJson({ ok: true, message: "Cloudflare 轻量版不使用 N1 服务端缓存设置。" });
      return sendJson({ settings: {}, preheat: { running: false, phase: "Cloudflare 轻量版按需处理请求，不运行常驻预热" }, cache: {} });
    }
    if (parts[0] === "preheat" && parts[1] === "run") {
      return sendError(501, "NOT_SUPPORTED", "Cloudflare 轻量版不运行常驻预热任务。");
    }
    if (parts[0] === "tv" && parts[1] === "devices") {
      return sendJson({ devices: [], message: "公共边缘函数不能直接执行家庭局域网 mDNS 发现。" });
    }
    if (parts[0] === "tv" && parts[1] === "handoff") {
      return sendError(501, "LOCAL_NETWORK_REQUIRED", "电视接力需要家庭局域网内的 N1 或配套助手。");
    }
    const session = getSession(request);
    requestSession = session;
    debugRecord(session, "info", "api.request", {
      method: request.method, endpoint: describeEndpoint(parts)
    }, requestTrace);
    if (parts[0] === "discover") {
      return sendJson(await callClient(session, "discover", requestTrace, {
        channel: url.searchParams.get("channel") || "推荐",
        cursor: url.searchParams.get("cursor") || "",
      }));
    }
    if (parts[0] === "search") {
      const q = url.searchParams.get("q") || "";
      if (!q.trim()) return sendJson({ items: [], has_more: false, cursor: "" });
      return sendJson(await callClient(session, "search", requestTrace, q, {
        cursor: url.searchParams.get("cursor") || "",
        pageSize: 40,
        filters: mapSearchType(url.searchParams.get("type") || "all"),
      }));
    }
    if (parts[0] === "suggest") {
      return sendJson({ items: await callClient(session, "suggest", requestTrace, url.searchParams.get("q") || "") });
    }
    if (parts[0] === "hot-search") return sendJson(await callClient(session, "hotSearch", requestTrace));
    if (parts[0] === "new-releases") {
      const date = url.searchParams.get("date") || new Date().toISOString().slice(0, 10).replace(/-/g, "");
      return sendJson(await callClient(session, "newReleases", requestTrace, { date, cursor: url.searchParams.get("cursor") || "" }));
    }
    if (parts[0] === "rank") {
      return sendJson(await callClient(session, "shortRank", requestTrace, {
        content: url.searchParams.get("content") || "all",
        board: url.searchParams.get("board") || "",
        cursor: url.searchParams.get("cursor") || "",
      }));
    }
    if (parts[0] === "series" && parts[1]) {
      const seriesId = parts[1];
      if (parts[2] === "detail") {
        const rows = await callClient(session, "getSeriesBatch", requestTrace, [seriesId]);
        if (!Array.isArray(rows) || !rows.length) return sendError(404, "SERIES_NOT_FOUND", "没有找到这部短剧。");
        return sendJson(rows[0]);
      }
      if (parts[2] === "episodes") {
        return sendJson(await callClient(session, "listEpisodes", requestTrace, seriesId, { cursor: url.searchParams.get("cursor") || "", pageSize: 100 }));
      }
      if (parts[2] === "seasons") return sendJson(await callClient(session, "seasons", requestTrace, seriesId));
      if (parts.length === 2) return sendJson(await callClient(session, "getSeries", requestTrace, seriesId));
    }
    if (parts[0] === "play" && parts[1]) {
      const result = await callClient(session, "resolvePlayback", requestTrace, parts[1]);
      const data = selectStream(result, url.searchParams.get("quality") || "best");
      if (!data) return sendError(502, "PLAYBACK_EMPTY", "上游没有返回可用的视频流。");
      return sendJson(data);
    }
    if (parts[0] === "images") {
      const imageUrl = url.searchParams.get("url") || "";
      if (!imageUrl) return sendError(400, "IMAGE_URL_REQUIRED", "缺少封面 URL。");
      const imageResponse = await proxyCoverImage(imageUrl, request.method, session, requestTrace);
      return sendResponse(imageResponse);
    }
    return sendError(404, "NOT_FOUND", "找不到这个 API 路径。");
  } catch (error) {
    const code = error && typeof error.code === "string" ? error.code : "UPSTREAM_ERROR";
    const raw = error && error.message ? String(error.message) : "未知错误";
    const message = raw.length > 240 ? raw.slice(0, 240) + "…" : raw;
    if (requestSession) {
      debugRecord(requestSession, "error", "api.error", {
        endpoint: describeEndpoint(parts), code, message: sanitizeDebugMessage(raw),
        runtime: runtimeDiagnostics()
      }, requestTrace);
    }
    return sendError(502, code, "片库请求失败：" + message);
  }
}
