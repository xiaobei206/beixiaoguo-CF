import "../../openhongguo-runtime.js";
import { createClient, SearchFilter } from "openhongguo";
import { ensureCencRuntime } from "../../cenc-runtime.js";
import { openMediaSession, parseByteRange, parseContentRange, safeMediaSource, sealMediaSession } from "../../media-session.js";

const VERSION = "0.1.12";
const MAX_CLIENTS = 128;
const MAX_PROFILES = 256;
const clients = new Map();
const clientDebugContexts = new Map();
const sessionQueues = new Map();
const profiles = new Map();
const debugLogs = new Map();
const cencFetchContexts = new Map();
const mediaMetadataCache = new Map();
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
function sdkBuildDiagnostics() {
  const build = globalThis.__BXG_OPENHONGGUO_BUILD || {};
  return {
    repository: build.repository || null,
    ref: build.ref || null,
    commit: build.commit || null,
    goVersion: build.goVersion || null,
    packageVersion: build.packageVersion || null,
    playbackFallback: build.playbackFallback || null,
    deviceActivation: build.deviceActivation === true,
    deviceHeartbeat: build.deviceHeartbeat === true,
    serverIssuedEGDI: build.serverIssuedEGDI === true,
    cencRangeDecrypt: build.cencRangeDecrypt === true,
    cencImplementation: build.cencImplementation || null,
    cencWasmBytes: Number(build.cencWasmBytes) || 0,
  };
}
function runtimeDiagnostics() {
  const go = globalThis.__BXG_OPENHONGGUO_GO;
  const state = globalThis.__BXG_OPENHONGGUO_STATE || {};
  return {
    sdkBuild: sdkBuildDiagnostics(),
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
function errorResponse(status, code, message, extraHeaders = {}) {
  return json({ error: { code, message } }, status, { "X-BXG-Error-Code": code, ...extraHeaders });
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

const MAX_MEDIA_RANGE_BYTES = 32 << 20;
const MAX_EDGE_PREFETCH_MEDIA_BYTES = 32 << 20;
const MEDIA_SESSION_LIFETIME_MS = 45 * 60 * 1000;
function edgeMediaCache(){try{return globalThis.caches?.default||null;}catch(_){return null;}}
async function matchEdgeMediaCache(request){
  const cache=edgeMediaCache();if(!cache)return null;
  const headers=new Headers();const range=request.headers.get("Range");if(range)headers.set("Range",range);
  return cache.match(new Request(request.url,{method:"GET",headers}));
}
async function prewarmProtectedMedia(token,mediaUrl,env,debugSession,trace,runtimeName){
  const cache=edgeMediaCache();if(!cache){debugRecord(debugSession,"warn","media.edge-cache.unavailable",{episodeId:""},trace);return "unavailable";}
  const key=new Request(mediaUrl,{method:"GET"});
  try{if(await cache.match(key)){debugRecord(debugSession,"debug","media.edge-cache.already-warm",{},trace);return "hit";}}
  catch(error){debugRecord(debugSession,"warn","media.edge-cache.lookup-failed",{message:sanitizeDebugMessage(error?.message||error)},trace);return "unavailable";}
  const head=await proxyProtectedMedia(token,new Request(mediaUrl,{method:"HEAD"}),env,debugSession,trace,runtimeName);
  if(!head.ok)return "head-failed";
  const size=Number(head.headers.get("Content-Length"))||0;
  if(!size||size>MAX_EDGE_PREFETCH_MEDIA_BYTES){debugRecord(debugSession,"info","media.edge-cache.skipped-size",{bytes:size,limitBytes:MAX_EDGE_PREFETCH_MEDIA_BYTES},trace);return "too-large";}
  const response=await proxyProtectedMedia(token,new Request(mediaUrl,{method:"GET"}),env,debugSession,trace,runtimeName);
  if(response.status!==200||!response.body){try{await response.body?.cancel();}catch(_){}debugRecord(debugSession,"warn","media.edge-cache.fill-rejected",{status:response.status},trace);return "fill-failed";}
  try{
    await cache.put(key,response);
    const verified=await cache.match(key);
    if(!verified){debugRecord(debugSession,"warn","media.edge-cache.fill-not-stored",{bytes:size},trace);return "not-stored";}
    debugRecord(debugSession,"info","media.edge-cache.ready",{bytes:size,ttlSeconds:Number((verified.headers.get("Cache-Control")||"").match(/max-age=(\d+)/)?.[1])||0},trace);
    return "stored";
  }catch(error){try{await response.body?.cancel();}catch(_){}debugRecord(debugSession,"warn","media.edge-cache.fill-failed",{bytes:size,message:sanitizeDebugMessage(error?.message||error)},trace);return "fill-failed";}
}
async function prewarmProtectedMediaBatch(items,request,env,debugSession,trace,runtimeName,concurrency=2){
  let cursor=0;let stored=0;let skipped=0;let failed=0;
  const worker=async()=>{while(cursor<items.length){const item=items[cursor++];const token=String(item.info.src).split("/api/v1/media/")[1]||"";if(!token){skipped++;continue;}
    const mediaUrl=new URL(item.info.src,request.url).href;
    const result=await prewarmProtectedMedia(token,mediaUrl,env,debugSession,trace,runtimeName);
    if(result==="stored"||result==="hit")stored++;else if(result==="too-large"||result==="unavailable")skipped++;else failed++;
  }};
  await Promise.all(Array.from({length:Math.min(concurrency,items.length)},worker));
  return {stored,skipped,failed};
}
function rememberMapValue(map,key,value,limit){map.delete(key);map.set(key,value);while(map.size>limit)map.delete(map.keys().next().value);}
function rememberCencContext(token,session,total){
  const now=Date.now();for(const [key,value] of cencFetchContexts)if(value.exp<=now)cencFetchContexts.delete(key);
  rememberMapValue(cencFetchContexts,token,{sources:session.sources,total,exp:session.exp},32);
}
async function openMediaRangeResponse(session,start,end,expectedTotal=null){
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start)throw new Error("invalid upstream media range");
  const expectedLength=end-start+1;let lastError=null;
  for(const raw of session.sources){
    let target;try{target=new URL(safeMediaSource(raw));}catch(error){lastError=error;continue;}
    for(let redirects=0;redirects<=3;redirects++){
      let response;
      try{response=await fetch(target.href,{method:"GET",headers:{"Range":"bytes="+start+"-"+end,"Accept":"video/mp4,application/octet-stream;q=0.9,*/*;q=0.1"},redirect:"manual",signal:AbortSignal.timeout(25000)});}
      catch(error){lastError=error;break;}
      if(response.status>=300&&response.status<400){
        const location=response.headers.get("location");try{await response.body?.cancel();}catch(_){}
        if(!location||redirects===3){lastError=new Error("upstream media redirect limit exceeded");break;}
        try{target=new URL(safeMediaSource(new URL(location,target).href));}catch(error){lastError=error;break;}continue;
      }
      if(response.status!==206){try{await response.body?.cancel();}catch(_){}lastError=new Error("upstream did not honor a byte range");break;}
      let cr;try{cr=parseContentRange(response.headers.get("content-range"));}catch(error){try{await response.body?.cancel();}catch(_){}lastError=error;break;}
      if(cr.start!==start||cr.end!==end||(expectedTotal!=null&&cr.total!==expectedTotal)){
        try{await response.body?.cancel();}catch(_){}lastError=new Error("upstream Content-Range mismatch");break;
      }
      const rawLength=response.headers.get("content-length");
      if(rawLength!=null&&rawLength!==""&&Number.isFinite(Number(rawLength))&&Number(rawLength)!==expectedLength){
        try{await response.body?.cancel();}catch(_){}lastError=new Error("upstream media Content-Length mismatch");break;
      }
      return {response,total:cr.total};
    }
  }
  throw lastError||new Error("no usable media source");
}
async function readMediaRange(session,start,count,expectedTotal=null){
  if(!Number.isSafeInteger(count)||count<0||count>MAX_MEDIA_RANGE_BYTES)throw new Error("media layout range exceeds 32 MiB");
  if(count===0)return {bytes:new Uint8Array(),total:expectedTotal||0};
  if(expectedTotal!=null&&(start>expectedTotal||count>expectedTotal-start))throw new Error("media layout range is outside the media file");
  const {response,total}=await openMediaRangeResponse(session,start,start+count-1,expectedTotal);
  if(!response.body)throw new Error("upstream media response has no body");
  const reader=response.body.getReader(),chunks=[];let length=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;if(!value?.byteLength)continue;length+=value.byteLength;if(length>count){await reader.cancel();throw new Error("upstream sent more bytes than requested");}chunks.push(value);}}
  finally{try{reader.releaseLock();}catch(_){}}
  if(length!==count)throw new Error("upstream returned a short media range");
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return {bytes,total};
}
async function fetchCencRangeById(token,offset,count){
  const session=cencFetchContexts.get(String(token));if(!session||session.exp<=Date.now())throw new Error("CENC fetch session expired");
  const start=Number(offset),length=Number(count);
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(length)||start<0||length<0||start>session.total||length>session.total-start)throw new Error("CENC requested an out-of-file Range");
  return (await readMediaRange(session,start,length,session.total)).bytes;
}
async function mediaFileSize(token,session){
  const now=Date.now();for(const [key,value] of mediaMetadataCache)if(value.exp<=now)mediaMetadataCache.delete(key);
  const cached=mediaMetadataCache.get(token);
  if(cached&&cached.exp>now){mediaMetadataCache.delete(token);mediaMetadataCache.set(token,cached);return cached.total;}
  const {bytes,total}=await readMediaRange(session,0,1,null);
  if(bytes.byteLength!==1||total<=0)throw new Error("unable to determine media file size");
  rememberMapValue(mediaMetadataCache,token,{total,exp:session.exp},64);return total;
}
function decryptedMediaStream(reader,token,start,expectedLength,cenc,firstChunk,debugSession,episodeId,trace){
  let position=start,remaining=expectedLength,initial=firstChunk;
  return new ReadableStream({
    async pull(controller){
      try{
        let chunk,alreadyDecrypted=false;
        if(initial!==null){chunk=initial;initial=null;alreadyDecrypted=true;}
        else{
          if(remaining===0){controller.close();return;}
          const result=await reader.read();
          if(result.done){if(remaining!==0){const error=new Error("upstream ended before Range completion");debugRecord(debugSession,"error","media.cenc.stream.truncated",{episodeId,offset:position,remainingBytes:remaining,message:error.message},trace);controller.error(error);}else controller.close();return;}
          if(!result.value?.byteLength)return;
          chunk=result.value instanceof Uint8Array?result.value:new Uint8Array(result.value);
        }
        if(chunk.byteLength>remaining){chunk=chunk.subarray(0,remaining);void reader.cancel().catch(()=>{});}
        if(chunk.byteLength===0){if(remaining===0)controller.close();return;}
        if(!alreadyDecrypted&&cenc.decrypt(token,position,chunk)!==true)throw new Error("CENC layout unavailable in this edge isolate");
        position+=chunk.byteLength;remaining-=chunk.byteLength;controller.enqueue(chunk);
        if(remaining===0){controller.close();void reader.cancel().catch(()=>{});}
      }catch(error){debugRecord(debugSession,"error","media.cenc.stream.failed",{episodeId,offset:position,remainingBytes:remaining,message:sanitizeDebugMessage(error?.message||error)},trace);controller.error(error);}
    },
    cancel(reason){return reader.cancel(reason);}
  });
}
function mediaSecretSetupMessage(runtimeName) {
  const isPages = runtimeName === "Cloudflare Pages Functions";
  const target = isPages ? "当前 Cloudflare Pages 项目" : "当前 Cloudflare Worker";
  const environment = isPages
    ? "请确认选择了正在访问的 Production 或 Preview 环境。"
    : "请确认配置的是正在访问的 Worker 环境。";
  return `请在${target}的 Settings → Variables and Secrets 中添加加密 Secret BXG_MEDIA_SECRET（至少 32 个字符）。${environment} Pages 和独立 Worker 的 Secrets 不会自动共享。`;
}

async function proxyProtectedMedia(token,request,env,debugSession,trace,runtimeName){
  if(request.method!=="GET"&&request.method!=="HEAD")return errorResponse(405,"MEDIA_METHOD_NOT_ALLOWED","媒体接口只支持 GET 和 HEAD。",{"Allow":"GET, HEAD"});
  try{const cached=await matchEdgeMediaCache(request);if(cached){debugRecord(debugSession,"info","media.edge-cache.hit",{range:request.headers.get("Range")||"full"},trace);return request.method==="HEAD"?new Response(null,{status:cached.status,headers:cached.headers}):new Response(cached.body,cached);}}catch(error){debugRecord(debugSession,"warn","media.edge-cache.lookup-failed",{message:sanitizeDebugMessage(error?.message||error)},trace);}
  const secret=env?.BXG_MEDIA_SECRET;
  if(typeof secret!=="string"||secret.length<32)return errorResponse(503,"MEDIA_SECRET_REQUIRED",mediaSecretSetupMessage(runtimeName));
  let media;
  try{media=await openMediaSession(token,secret);if(typeof media.debugSession==="string"&&/^[a-zA-Z0-9._:-]{8,128}$/.test(media.debugSession))debugSession=media.debugSession;if(media.exp<=Date.now())return errorResponse(410,"MEDIA_SESSION_EXPIRED","播放会话已过期，请重新打开本集。");media.sources=media.sources.map(safeMediaSource);}
  catch(error){debugRecord(debugSession,"warn","media.session.rejected",{message:sanitizeDebugMessage(error?.message||error)},trace);return errorResponse(404,"MEDIA_SESSION_INVALID","播放会话无效或无法解密，请重新取得播放地址。");}
  let total;
  try{total=await mediaFileSize(token,media);}
  catch(error){debugRecord(debugSession,"error","media.size.failed",{episodeId:media.episodeId,message:sanitizeDebugMessage(error?.message||error)},trace);return errorResponse(502,"MEDIA_RANGE_UPSTREAM","上游视频服务器未能提供有效的 Range 数据。");}
  let range;try{range=parseByteRange(request.headers.get("Range"),total);}
  catch(_){return errorResponse(416,"MEDIA_RANGE_INVALID","请求的视频 Range 无效。",{"Accept-Ranges":"bytes","Content-Range":"bytes */"+total});}
  const length=range.end-range.start+1;
  const browserCacheSeconds=Math.max(0,Math.min(2700,Math.floor((media.exp-Date.now())/1000)));
  const mediaCacheControl=total<=MAX_EDGE_PREFETCH_MEDIA_BYTES?"public, max-age="+browserCacheSeconds:"private, no-store";
  const headers=new Headers({"Content-Type":"video/mp4","Accept-Ranges":"bytes","Content-Length":String(length),"Cache-Control":mediaCacheControl,"X-Content-Type-Options":"nosniff"});
  if(range.partial)headers.set("Content-Range","bytes "+range.start+"-"+range.end+"/"+total);
  const status=range.partial?206:200;if(request.method==="HEAD")return new Response(null,{status,headers});
  let cenc;
  try{rememberCencContext(token,media,total);cenc=await ensureCencRuntime(fetchCencRangeById);const opened=await cenc.open(token,total,media.key,media.exp);const info=typeof opened==="string"?JSON.parse(opened):opened;if(!info?.protected)throw new Error("MP4 contains no protected CENC samples");}
  catch(error){debugRecord(debugSession,"error","media.cenc.layout.failed",{episodeId:media.episodeId,message:sanitizeDebugMessage(error?.message||error)},trace);return errorResponse(502,"CENC_LAYOUT_UNAVAILABLE","无法解析此分集的 CENC MP4 布局。");}
  let upstream;
  try{upstream=(await openMediaRangeResponse(media,range.start,range.end,total)).response;}
  catch(error){debugRecord(debugSession,"error","media.range.failed",{episodeId:media.episodeId,start:range.start,end:range.end,message:sanitizeDebugMessage(error?.message||error)},trace);return errorResponse(502,"MEDIA_RANGE_UPSTREAM","上游视频服务器未能提供请求的 Range。");}
  if(!upstream.body)return errorResponse(502,"MEDIA_RANGE_EMPTY","上游媒体响应没有数据体。");
  const reader=upstream.body.getReader();let firstChunk;
  try{const first=await reader.read();if(first.done||!first.value?.byteLength)throw new Error("upstream media range body is empty");firstChunk=first.value instanceof Uint8Array?first.value:new Uint8Array(first.value);if(firstChunk.byteLength>length)firstChunk=firstChunk.subarray(0,length);if(cenc.decrypt(token,range.start,firstChunk)!==true)throw new Error("CENC decrypt initialization failed");}
  catch(error){try{await reader.cancel();}catch(_){}debugRecord(debugSession,"error","media.cenc.first_chunk.failed",{episodeId:media.episodeId,message:sanitizeDebugMessage(error?.message||error)},trace);return errorResponse(502,"CENC_DECRYPT_FAILED","无法解密视频的首个媒体区块。");}
  debugRecord(debugSession,"debug","media.cenc.range",{episodeId:media.episodeId,start:range.start,end:range.end,totalBytes:total},trace);
  return new Response(decryptedMediaStream(reader,token,range.start,length,cenc,firstChunk,debugSession,media.episodeId,trace),{status,headers});
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
  const mediaSources = [selected.stream.url, selected.stream.backup_url]
    .filter((value, index, items) => typeof value === "string" && value.trim() && items.indexOf(value) === index);
  return {
    quality: selected.label,
    available_qualities: list.map((entry) => ({ label: entry.label, codec: entry.codec })),
    src: protectedStream ? "" : (mediaSources[0] || ""),
    protected: protectedStream,
    duration_seconds: playback.duration_seconds || 0,
    expires_at: playback.expires_at || 0,
    media_type: playback.media_type || "",
    _mediaSources: mediaSources,
    _encryption: selected.stream.encryption || "",
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
      if (url.searchParams.get("sdk") === "cenc-probe" && context.env?.BXG_SMOKE_TEST === "1") {
        const cenc = await ensureCencRuntime(fetchCencRangeById);
        if (cenc.ping() !== true) throw new Error("CENC WASM probe did not respond");
        return sendJson({ status: "ok", version: VERSION, runtime: runtimeName, cencWasm: "ready", sdkBuild: sdkBuildDiagnostics() });
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
        return sendJson({ status: "ok", version: VERSION, runtime: runtimeName, sdk: sdkState, sdkBuild: sdkBuildDiagnostics(), goCallbacks: "ok", transportCalls, wasm: runtimeDiagnostics() });
      }
      return sendJson({ status: "ok", version: VERSION, runtime: runtimeName, sdk: sdkState, sdkBuild: sdkBuildDiagnostics() });
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
    if (parts[0] === "prefetch" && request.method === "POST") {
      let payload;
      try { payload = await request.json(); }
      catch (_) { return sendError(400, "PREFETCH_BODY_INVALID", "预读请求正文不是有效 JSON。"); }
      const rawIds = Array.isArray(payload?.episodeIds) ? payload.episodeIds : [];
      const episodeIds = [...new Set(rawIds.map((value) => String(value || "").trim())
        .filter((value) => value && value.length <= 128))];
      if (!episodeIds.length) return sendJson({ items: [], requested: 0, ready: 0 });
      if (episodeIds.length > 6) return sendError(400, "PREFETCH_LIMIT", "单次最多预解析 6 集。");
      const quality = String(payload?.quality || "best").slice(0, 32);
      const secret = context.env?.BXG_MEDIA_SECRET;
      const items = [];
      for (const episodeId of episodeIds) {
        try {
          const result = await callClient(session, "resolvePlayback", requestTrace, episodeId);
          const data = selectStream(result, quality);
          if (!data) {
            items.push({ episodeId, errorCode: "PLAYBACK_EMPTY", error: "上游没有返回可用的视频流。" });
            continue;
          }
          const sources = data._mediaSources || [];
          const encryption = data._encryption || "";
          delete data._mediaSources;
          delete data._encryption;
          if (data.protected) {
            if (encryption && encryption.toLowerCase() !== "cenc-aes-ctr") {
              items.push({ episodeId, errorCode: "CENC_SCHEME_UNSUPPORTED", error: "此分集不是受支持的 CENC AES-CTR 渐进式 MP4。" });
              continue;
            }
            const key = result?.contentKey?.key;
            if (typeof key !== "string" || !/^[a-fA-F0-9]{32}$/.test(key)) {
              items.push({ episodeId, errorCode: "CENC_KEY_UNAVAILABLE", error: "SDK 未能为此受保护分集派生有效的 CENC 内容密钥。" });
              continue;
            }
            if (typeof secret !== "string" || secret.length < 32) {
              items.push({ episodeId, errorCode: "MEDIA_SECRET_REQUIRED", error: mediaSecretSetupMessage(runtimeName) });
              continue;
            }
            let safeSources;
            try { safeSources = [...new Set(sources.map((source) => safeMediaSource(source)))].slice(0, 2); }
            catch (_) {
              items.push({ episodeId, errorCode: "MEDIA_SOURCE_REJECTED", error: "上游返回的视频地址不符合安全要求。" });
              continue;
            }
            if (!safeSources.length) {
              items.push({ episodeId, errorCode: "PLAYBACK_EMPTY", error: "上游没有返回可用的受保护视频地址。" });
              continue;
            }
            const now = Date.now();
            const upstreamExpiry = Number(data.expires_at) > 0 ? Number(data.expires_at) * 1000 : now + MEDIA_SESSION_LIFETIME_MS;
            const expiresAt = Math.min(now + MEDIA_SESSION_LIFETIME_MS, upstreamExpiry);
            if (expiresAt <= now + 10000) {
              items.push({ episodeId, errorCode: "PLAYBACK_EXPIRED", error: "播放地址即将过期，请重新打开本集。" });
              continue;
            }
            const mediaToken = await sealMediaSession({
              v: 1, sources: safeSources, key, exp: expiresAt, episodeId, debugSession: session
            }, secret);
            data.src = "/api/v1/media/" + mediaToken;
            data.expires_at = Math.floor(expiresAt / 1000);
          }
          if (!data.src) {
            items.push({ episodeId, errorCode: "PLAYBACK_EMPTY", error: "没有可用的播放地址。" });
            continue;
          }
          items.push({ episodeId, info: data });
        } catch (error) {
          items.push({
            episodeId,
            errorCode: "PREFETCH_RESOLVE_FAILED",
            error: sanitizeDebugMessage(error?.message || error)
          });
        }
      }
      const ready = items.filter((item) => !!item.info).length;
      const warmable = items.filter((item) => item.info?.protected && typeof item.info.src === "string" && item.info.src.startsWith("/api/v1/media/"));
      let cacheWarm = { stored:0, skipped:0, failed:0, scheduled:0 };
      if (warmable.length) {
        const immediate = warmable.slice(0, 3);
        const immediateResult = await prewarmProtectedMediaBatch(immediate, request, context.env, session, requestTrace, runtimeName, 2);
        cacheWarm.stored += immediateResult.stored; cacheWarm.skipped += immediateResult.skipped; cacheWarm.failed += immediateResult.failed;
        const remaining = warmable.slice(3);
        if (remaining.length && typeof context.waitUntil === "function") {
          const background = prewarmProtectedMediaBatch(remaining, request, context.env, session, requestTrace, runtimeName, 2)
            .then((result) => debugRecord(session, "info", "playback.edge-cache.background-completed", result, requestTrace))
            .catch((error) => debugRecord(session, "warn", "playback.edge-cache.background-failed", {message:sanitizeDebugMessage(error?.message||error)}, requestTrace));
          context.waitUntil(background);
          cacheWarm.scheduled = remaining.length;
        } else if (remaining.length) {
          const restResult = await prewarmProtectedMediaBatch(remaining, request, context.env, session, requestTrace, runtimeName, 1);
          cacheWarm.stored += restResult.stored; cacheWarm.skipped += restResult.skipped; cacheWarm.failed += restResult.failed;
        }
      }
      debugRecord(session, "info", "playback.prefetch.completed", {
        requested: episodeIds.length, ready, edgeCache:cacheWarm
      }, requestTrace);
      return sendJson({ items, requested: episodeIds.length, ready, edgeCache:cacheWarm });
    }
    if (parts[0] === "play" && parts[1]) {
      const result = await callClient(session, "resolvePlayback", requestTrace, parts[1]);
      const data = selectStream(result, url.searchParams.get("quality") || "best");
      if (!data) return sendError(502, "PLAYBACK_EMPTY", "上游没有返回可用的视频流。");
      const sources = data._mediaSources || [];
      const encryption = data._encryption || "";
      delete data._mediaSources;
      delete data._encryption;
      if (data.protected) {
        if (encryption && encryption.toLowerCase() !== "cenc-aes-ctr") return sendError(415,"CENC_SCHEME_UNSUPPORTED","此分集不是受支持的 CENC AES-CTR 渐进式 MP4。");
        const key = result?.contentKey?.key;
        if (typeof key !== "string" || !/^[a-fA-F0-9]{32}$/.test(key)) return sendError(502,"CENC_KEY_UNAVAILABLE","SDK 未能为此受保护分集派生有效的 CENC 内容密钥。");
        const secret = context.env?.BXG_MEDIA_SECRET;
        if (typeof secret !== "string" || secret.length < 32) return sendError(503,"MEDIA_SECRET_REQUIRED",mediaSecretSetupMessage(runtimeName));
        let safeSources;
        try { safeSources=[...new Set(sources.map((source)=>safeMediaSource(source)))].slice(0,2); }
        catch (_) { return sendError(502,"MEDIA_SOURCE_REJECTED","上游返回的视频地址不符合安全要求。"); }
        if (!safeSources.length) return sendError(502,"PLAYBACK_EMPTY","上游没有返回可用的受保护视频地址。");
        const now=Date.now();
        const upstreamExpiry=Number(data.expires_at)>0?Number(data.expires_at)*1000:now+MEDIA_SESSION_LIFETIME_MS;
        const expiresAt=Math.min(now+MEDIA_SESSION_LIFETIME_MS,upstreamExpiry);
        if(expiresAt<=now+10000)return sendError(502,"PLAYBACK_EXPIRED","播放地址即将过期，请重新打开本集。");
        let mediaToken;
        try { mediaToken=await sealMediaSession({v:1,sources:safeSources,key,exp:expiresAt,episodeId:parts[1],debugSession:session},secret); }
        catch (_) { return sendError(503,"MEDIA_SESSION_SEAL_FAILED","无法创建安全的受保护播放会话。"); }
        data.src="/api/v1/media/"+mediaToken;
        data.expires_at=Math.floor(expiresAt/1000);
        debugRecord(session,"info","playback.cenc.session.ready",{episodeId:parts[1],sourceCount:safeSources.length,expiresAt},requestTrace);
      }
      return sendJson(data);
    }
    if (parts[0] === "media" && parts[1]) {
      return sendResponse(await proxyProtectedMedia(parts[1], request, context.env, session, requestTrace, runtimeName));
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
