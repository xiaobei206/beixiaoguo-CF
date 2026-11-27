(function () {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const INITIAL_PRELOAD_TARGET = 100;
  const playbackClientId = (function () {
    const key = "beixiaoguo.cf.anonymous-session";
    try {
      let value = window.localStorage.getItem(key);
      if (!value) {
        value = (window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
        window.localStorage.setItem(key, value);
      }
      return "bxg-web-" + value;
    } catch (_) {
      return "bxg-web-" + (window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : Math.random().toString(36).slice(2));
    }
  })();
  let playbackHeartbeatTimer = 0;
  let playerControlsTimer = 0;
  let settingsRefreshTimer = 0;
  let deferredInstallPrompt = null;
  const DEBUG_STORAGE_KEY = "beixiaoguo.cf.debug-log";
  const APP_VERSION = "0.1.13";
  const EDGE_PREFETCH_COUNT = 6;
  const BROWSER_PRELOAD_COUNT = 3;
  const MAX_DEBUG_ENTRIES = 180;
  const ROUTE_LIST_STORAGE_KEY = "beixiaoguo.cf.alt-routes";
  const ROUTE_ACTIVE_STORAGE_KEY = "beixiaoguo.cf.alt-route-selected";
  const MAX_ROUTE_ENTRIES = 24;
  let routeEntries = loadRouteEntries();
  let activeRouteId = loadActiveRouteId();
  let debugEntries = loadDebugEntries();
  let serverDebugEntries = [];
  let serverDebugRuntime = null;
  let imageProbeStarted = false;
  function todayDateKey() {
    const now = new Date();
    return String(now.getFullYear()) + String(now.getMonth() + 1).padStart(2, "0") + String(now.getDate()).padStart(2, "0");
  }

  const state = {
    view: "discover",
    cursor: "",
    hasMore: false,
    busy: false,
    items: [],
    pageCount: 0,
    discoverChannel: "推荐",
    searchType: "all",
    rankContent: "all",
    rankBoard: "",
    rankContents: [],
    newDate: todayDateKey(),
    newDates: [],
    favorites: loadFavorites(),
    toastTimer: 0,
    listController: null,
    viewCache: Object.create(null),
    activeViewKey: "",
    loadSequence: 0,
    autoLoadScheduled: false,
    detailRequestId: 0,
    playback: {seriesId:"",seriesTitle:"",seriesCover:"",seriesArtworkDataURL:"",episodes:[],index:-1,quality:"best",speed:1,requestId:0,temporaryBoost:false,prefetched:Object.create(null),prefetchPending:new Set(),prefetchFailed:Object.create(null),prefetchInFlight:false,preloadVideos:[]}
  };

  const navLabels = {
    discover: ["为你精选", "发现好剧", "从这里开始，找到下一部喜欢的故事。"],
    rank: ["人气风向", "排行榜", "看看大家最近都在追什么。"],
    new: ["每日上新", "新剧上线", "最近更新的短剧与新鲜故事。"],
    hot: ["正在热议", "热搜榜", "看看当下大家都在搜什么。"],
    mine: ["留住喜欢", "我的收藏", "收藏的故事都在这里。"],
    search: ["搜索结果", "找到这些", "换个关键词，发现更多好故事。"]
  };

  function escapeHTML(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch];
    });
  }

  function safeImage(value) {
    const raw = String(value || "").trim();
    if (/^\/api\/v1\/images(?:\?|\/)/i.test(raw)) return raw;
    if (!raw) return "";
    try {
      const parsed = new URL(raw, window.location.origin);
      if (parsed.protocol !== "https:") {
        debugWrite("warn", "image.url.rejected", {reason:"non-https",protocol:parsed.protocol});
        return "";
      }
      if (parsed.username || parsed.password) {
        debugWrite("warn", "image.url.rejected", {reason:"url-credentials",host:parsed.hostname});
        return "";
      }
      if (parsed.origin === window.location.origin) {
        debugWrite("warn", "image.url.rejected", {reason:"same-origin-absolute",host:parsed.hostname});
        return "";
      }
      const host = parsed.hostname.toLowerCase();
      if (host === "fqnovelpic.com" || host.endsWith(".fqnovelpic.com")) {
        const proxy = new URL("/api/v1/images", window.location.origin);
        proxy.searchParams.set("url", parsed.href);
        return proxy.pathname + proxy.search;
      }
      return parsed.href;
    } catch (_) {
      debugWrite("warn", "image.url.rejected", {reason:"invalid-url"});
      return "";
    }
  }


  function normalizeRouteIPAddress(raw) {
    let value = String(raw || "").trim();
    if (value.startsWith("[") && value.endsWith("]")) value = value.slice(1, -1);
    if (!value || /[\s/?#@]/.test(value)) return "";
    if (value.includes(":")) {
      try {
        const parsed = new URL("https://[" + value + "]/");
        const hostname = parsed.hostname;
        if (!hostname.startsWith("[") || !hostname.endsWith("]")) return "";
        const normalized = hostname.slice(1, -1).toLowerCase();
        return normalized.includes("%") ? "" : normalized;
      } catch (_) { return ""; }
    }
    const parts = value.split(".");
    if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return "";
    return parts.map((part) => String(Number(part))).join(".");
  }

  function loadRouteEntries() {
    try {
      const parsed = JSON.parse(localStorage.getItem(ROUTE_LIST_STORAGE_KEY) || "[]");
      if (!Array.isArray(parsed)) return [];
      const seen = new Set();
      return parsed.slice(0, MAX_ROUTE_ENTRIES).map((item, index) => {
        const ip = normalizeRouteIPAddress(item && item.ip);
        if (!ip || seen.has(ip)) return null;
        seen.add(ip);
        return {
          id:String(item.id || ("route-" + index)),
          name:String(item.name || ("自选线路 " + (index + 1))).trim().slice(0, 32) || ("自选线路 " + (index + 1)),
          ip
        };
      }).filter(Boolean);
    } catch (_) { return []; }
  }

  function loadActiveRouteId() {
    try { return localStorage.getItem(ROUTE_ACTIVE_STORAGE_KEY) || "auto"; }
    catch (_) { return "auto"; }
  }

  function saveRoutePreferences() {
    try {
      localStorage.setItem(ROUTE_LIST_STORAGE_KEY, JSON.stringify(routeEntries));
      localStorage.setItem(ROUTE_ACTIVE_STORAGE_KEY, activeRouteId);
    } catch (_) {
      showToast("浏览器本地存储不可用，线路设置未能保存");
    }
  }

  function getActiveRoute() {
    if (activeRouteId === "auto") return null;
    return routeEntries.find((item) => item.id === activeRouteId) || null;
  }

  function routeAuthority(ip) {
    return String(ip).includes(":") ? "[" + ip + "]" : String(ip);
  }

  function usesCloudflareManagedHostname() {
    const host = String(window.location.hostname || "").toLowerCase();
    return host.endsWith(".workers.dev") || host.endsWith(".pages.dev");
  }

  function renderRouteStatus(message, kind) {
    const node = $("#route-status");
    if (!node) return;
    node.textContent = message;
    node.className = "route-status" + (kind ? " " + kind : "");
  }

  function renderRouteDialog() {
    const list = $("#route-list");
    const current = $("#route-current-label");
    const note = $("#route-domain-note");
    if (!list || !current || !note) return;
    const active = getActiveRoute();
    current.textContent = active ? active.name + " · " + active.ip + ":443" : "默认线路（Cloudflare 自动）";
    if (usesCloudflareManagedHostname()) {
      note.textContent = "当前域名是 " + window.location.hostname + "。Cloudflare 的 workers.dev／pages.dev 默认域名不能使用 Zone Response Header Transform Rules；自选 IP 目前只能保存在本机，不能改变浏览器实际接入线路。需要绑定自己控制的橙云域名并配置下方规则。";
      note.className = "route-domain-note warn";
    } else {
      note.textContent = "当前使用自定义域名 " + window.location.hostname + "。还需要在该域名所在 Cloudflare Zone 配置下方两条响应头规则；确认响应包含你选的 Alt-Svc 后，浏览器才会尝试使用备用 IP。";
      note.className = "route-domain-note";
    }
    const autoChecked = activeRouteId === "auto" || !active;
    let html = '<div class="route-option' + (autoChecked ? " active" : "") + '">' +
      '<label><input type="radio" name="active-route" value="auto"' + (autoChecked ? " checked" : "") + '>' +
      '<span class="route-option-copy"><strong>默认线路</strong><small>Cloudflare 自动接入</small></span></label></div>';
    for (const item of routeEntries) {
      const selected = !!active && item.id === active.id;
      html += '<div class="route-option' + (selected ? " active" : "") + '">' +
        '<label><input type="radio" name="active-route" value="' + escapeHTML(item.id) + '"' + (selected ? " checked" : "") + '>' +
        '<span class="route-option-copy"><strong>' + escapeHTML(item.name) + '</strong><small>' + escapeHTML(item.ip) + ':443</small></span></label>' +
        '<button class="route-remove" type="button" data-remove-route="' + escapeHTML(item.id) + '">删除</button></div>';
    }
    list.innerHTML = html;
  }

  async function announceActiveRoute(ip, quiet) {
    if (!window.isSecureContext) {
      renderRouteStatus("自选线路需要 HTTPS 安全上下文；当前页面不能公告备用 HTTPS 服务。", "warn");
      return false;
    }
    if (usesCloudflareManagedHostname()) {
      const message = ip
        ? "已保存 " + ip + "，但当前 workers.dev／pages.dev 域名无法配置动态 Alt-Svc 响应规则，因此网络入口没有切换。绑定自有橙云域名后才能启用。"
        : "已选择默认线路；当前使用 Cloudflare 默认域名解析和自动接入。";
      renderRouteStatus(message, ip ? "warn" : "");
      debugWrite(ip ? "warn" : "info", "network.route.default-domain", {host:window.location.hostname,ip:ip || ""});
      return false;
    }
    try {
      const routeValue = ip || "auto";
      const response = await fetch("/api/v1/route?alt_ip=" + routeValue + "&refresh=" + Date.now(), {
        method:"GET", cache:"no-store",
        headers:{"Accept":"application/json","X-BXG-Session":playbackClientId}
      });
      captureEdgeTrace(response);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error?.message || ("HTTP " + response.status));
      if (payload.selectedAltIp !== routeValue) throw new Error("Cloudflare Worker 返回的线路地址与选择不一致");
      const altSvc = response.headers.get("Alt-Svc") || "";
      const altUsed = String(payload.altUsed || "");
      const authority = ip ? routeAuthority(ip) + ":443" : "";
      const advertised = !!ip && altSvc.includes(authority);
      const usedNow = !!ip && altUsed.includes(authority);
      if (ip && advertised) {
        const message = usedNow
          ? "已下发 " + authority + "，本次诊断请求也报告了 Alt-Used，浏览器已通过该备用入口建立连接。"
          : "Cloudflare 已向浏览器下发 " + authority + "。浏览器会在新连接上尝试使用；当前已建立的连接不会被强制迁移。";
        renderRouteStatus(message, "ok");
        debugWrite("info", "network.route.alt-svc.advertised", {ip,authority,altSvc,altUsed});
      } else if (ip) {
        renderRouteStatus("IP 已保存在本机，但本次响应没有公告对应的 Alt-Svc。请检查自定义域名是否已配置动态响应头规则；没有该规则时不会真正切换。", "warn");
        debugWrite("warn", "network.route.alt-svc.missing", {ip,host:window.location.hostname,altSvc,altUsed});
      } else {
        renderRouteStatus(altSvc.trim().toLowerCase() === "clear"
          ? "已清除自选入口，浏览器将回到默认 Cloudflare 线路。"
          : "已选择默认线路。若此前使用过自选 IP，请确认默认线路规则已返回 Alt-Svc: clear。", "");
        debugWrite("info", "network.route.default", {altSvc,altUsed});
      }
      return advertised || (!ip && altSvc.trim().toLowerCase() === "clear");
    } catch (error) {
      const message = "线路选择已保存在本机，但请求 Cloudflare 刷新线路信息失败：" + (error.message || String(error));
      renderRouteStatus(message, "warn");
      debugWrite("warn", "network.route.refresh.failed", {ip:ip || "",message:error.message || String(error)});
      if (!quiet) showToast("线路信息刷新失败，已保留本机设置");
      return false;
    }
  }

  async function selectRoute(id) {
    if (id !== "auto" && !routeEntries.some((item) => item.id === id)) return;
    activeRouteId = id;
    saveRoutePreferences();
    const active = getActiveRoute();
    renderRouteDialog();
    await announceActiveRoute(active ? active.ip : "", false);
  }

  async function addRouteFromForm(event) {
    event.preventDefault();
    const ip = normalizeRouteIPAddress($("#route-ip").value);
    if (!ip) {
      showToast("请输入有效的 IPv4 或 IPv6 地址，不要填写端口");
      $("#route-ip").focus();
      return;
    }
    if (routeEntries.some((item) => item.ip === ip)) {
      showToast("这条 IP 已经添加过了");
      return;
    }
    if (routeEntries.length >= MAX_ROUTE_ENTRIES) {
      showToast("最多保存 " + MAX_ROUTE_ENTRIES + " 条自选线路");
      return;
    }
    const name = String($("#route-name").value || "").trim().slice(0, 32) || ("自选线路 " + (routeEntries.length + 1));
    const id = "route-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
    routeEntries.push({id,name,ip});
    activeRouteId = id;
    saveRoutePreferences();
    $("#route-name").value = "";
    $("#route-ip").value = "";
    renderRouteDialog();
    await announceActiveRoute(ip, false);
  }

  async function removeRoute(id) {
    routeEntries = routeEntries.filter((item) => item.id !== id);
    const wasActive = activeRouteId === id;
    if (wasActive) activeRouteId = "auto";
    saveRoutePreferences();
    renderRouteDialog();
    if (wasActive) {
      await announceActiveRoute("", false);
    }
  }

  async function copyRouteRuleGuide() {
    const guide = [
      "Cloudflare → Rules → Transform Rules → Response Header Transform Rules",
      "规则 1（IPv4）",
      '(http.host eq "YOUR_HOSTNAME" and http.request.uri.path eq "/api/v1/route" and len(http.response.headers["x-bxg-alt-ip"][0]) gt 0 and http.response.headers["x-bxg-alt-ip"][0] ne "auto" and not (http.response.headers["x-bxg-alt-ip"][0] contains ":"))',
      "响应头：Alt-Svc；操作：Set dynamic",
      '值：concat("h2=\\\"", http.response.headers["x-bxg-alt-ip"][0], ":443\\\"; ma=300")',
      "",
      "规则 2（IPv6）",
      '(http.host eq "YOUR_HOSTNAME" and http.request.uri.path eq "/api/v1/route" and http.response.headers["x-bxg-alt-ip"][0] contains ":")',
      "响应头：Alt-Svc；操作：Set dynamic",
      '值：concat("h2=\\\"[", http.response.headers["x-bxg-alt-ip"][0], "]:443\\\"; ma=300")',
      "",
      "规则 3（恢复默认线路）",
      '(http.host eq "YOUR_HOSTNAME" and http.request.uri.path eq "/api/v1/route" and http.response.headers["x-bxg-alt-ip"][0] eq "auto")',
      "响应头：Alt-Svc；操作：Set static；值：clear",
      "",
      "规则 4（清理内部响应头）",
      '(http.host eq "YOUR_HOSTNAME" and http.request.uri.path eq "/api/v1/route")',
      "响应头：X-BXG-Alt-IP；操作：Remove",
      "",
      "将 YOUR_HOSTNAME 替换为自定义橙云域名。规则从 Worker 已验证的响应头取值，不直接反射未经验证的 URL 参数；workers.dev/pages.dev 不能使用 Zone Transform Rules。"
    ].join("\n");
    try {
      await navigator.clipboard.writeText(guide);
      showToast("四条 Cloudflare 规则说明已复制");
    } catch (_) {
      const field = document.createElement("textarea");
      field.value = guide;
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.appendChild(field);
      field.select();
      try { document.execCommand("copy"); showToast("四条 Cloudflare 规则说明已复制"); }
      catch (_) { showToast("复制失败，请展开规则说明手动复制"); }
      field.remove();
    }
  }

  function loadFavorites() {
    try {
      const parsed = JSON.parse(localStorage.getItem("beixiaoguo.favorites") || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function saveFavorites() {
    try {
      localStorage.setItem("beixiaoguo.favorites", JSON.stringify(state.favorites));
    } catch (_) {
      showToast("浏览器存储空间不可用，收藏未能保存");
    }
  }

  function setPlaybackActivity(playing) {
    const payload = JSON.stringify({client_id:playbackClientId,playing:!!playing});
    try {
      fetch("/api/v1/playback/activity", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:payload,
        keepalive:!playing
      }).catch(() => {});
    } catch (_) {}
    window.clearInterval(playbackHeartbeatTimer);
    playbackHeartbeatTimer = 0;
    if (playing) {
      playbackHeartbeatTimer = window.setInterval(() => {
        fetch("/api/v1/playback/activity", {
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body:payload
        }).catch(() => {});
      }, 15000);
    }
  }

  function showToast(message) {
    const el = $("#toast");
    el.textContent = message;
    el.classList.add("show");
    window.clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(() => el.classList.remove("show"), 2400);
  }

  function loadDebugEntries() {
    try {
      const value = JSON.parse(window.localStorage.getItem(DEBUG_STORAGE_KEY) || "[]");
      return Array.isArray(value) ? value.slice(-MAX_DEBUG_ENTRIES) : [];
    } catch (_) { return []; }
  }

  function safeDebugMessage(value) {
    return String(value == null ? "" : value)
      .replace(/https?:\/\/[^\s"'<>]+/gi, (raw) => {
        try { const u = new URL(raw); return u.origin + u.pathname; } catch (_) { return "[URL]"; }
      })
      .replace(/(authorization|cookie|set-cookie|token|secret|password|session)(\s*[:=]\s*)[^\s,;]+/gi, "$1$2[REDACTED]")
      .replace(/([?&](?:token|sign|signature|device_id|session_id|auth)=)[^&\s]+/gi, "$1[REDACTED]")
      .replace(/[A-Za-z0-9_-]{48,}/g, "[LONG_TOKEN]")
      .slice(0, 600);
  }

  function safeEndpoint(path) {
    try {
      return new URL(path, window.location.origin).pathname
        .replace(/\/series\/[^/]+/g, "/series/:id")
        .replace(/\/play\/[^/]+/g, "/play/:episodeId");
    } catch (_) { return "[unknown endpoint]"; }
  }

  function debugWrite(level, event, detail) {
    const entry = {time:new Date().toISOString(),level,event};
    if (detail && typeof detail === "object") {
      Object.keys(detail).forEach((key) => {
        const value = detail[key];
        if (value === null || ["string","number","boolean"].includes(typeof value)) {
          entry[key] = typeof value === "string" ? safeDebugMessage(value) : value;
        }
      });
    }
    debugEntries.push(entry);
    if (debugEntries.length > MAX_DEBUG_ENTRIES) debugEntries.splice(0, debugEntries.length - MAX_DEBUG_ENTRIES);
    try { window.localStorage.setItem(DEBUG_STORAGE_KEY, JSON.stringify(debugEntries)); } catch (_) {}
    const count = $("#debug-log-count");
    if (count) count.textContent = String(debugEntries.length + serverDebugEntries.length);
    if ($("#debug-dialog") && $("#debug-dialog").open) renderDebugPanel();
  }

  function captureEdgeTrace(response) {
    const raw = response && response.headers ? response.headers.get("X-BXG-Debug") : "";
    const traceId = response && response.headers ? (response.headers.get("X-BXG-Trace-ID") || "") : "";
    if (!raw) {
      if (traceId) debugWrite("debug", "edge.trace.missing", {traceId,status:response.status});
      return;
    }
    try {
      const payload = JSON.parse(decodeURIComponent(raw));
      for (const event of payload.events || []) {
        if (event.event === "sdk.client.ready" || event.event === "wasm.runtime.exited" || event.event === "wasm.call.after-exit") {
          const runtime = event.runtime && typeof event.runtime === "object" ? event.runtime : event;
          serverDebugRuntime = {
            initialized:!!runtime.initialized,
            exited:!!runtime.exited,
            generation:Number(runtime.generation) || 0,
            startedAt:runtime.startedAt || null,
            exitedAt:runtime.exitedAt || null,
            error:runtime.error || ""
          };
        }
        const detail = Object.assign({}, event);
        delete detail.time;
        delete detail.level;
        delete detail.event;
        debugWrite(event.level || "debug", "edge." + (event.event || "event"), {
          traceId:payload.traceId || traceId,
          edgeTime:event.time || "",
          detail:JSON.stringify(detail).slice(0, 520)
        });
      }
      debugWrite("debug", "edge.trace.received", {
        traceId:payload.traceId || traceId,
        events:(payload.events || []).length,
        status:response.status
      });
    } catch (error) {
      debugWrite("warn", "edge.trace.parse-failed", {traceId,status:response.status,message:error.message || error});
    }
  }

  function summarizePayload(path, payload) {
    const summary = {keys:payload && typeof payload === "object" ? Object.keys(payload).slice(0, 24) : []};
    if (payload && Array.isArray(payload.items)) {
      const items = payload.items;
      let https = 0, http = 0, empty = 0, other = 0;
      for (const item of items) {
        const value = String(item && (item.cover_url || item.coverUrl) || "");
        if (!value) empty++;
        else if (/^https:\/\//i.test(value)) https++;
        else if (/^http:\/\//i.test(value)) http++;
        else other++;
      }
      summary.items = items.length;
      summary.coverUrls = {https,http,empty,other};
      summary.firstItemKeys = items[0] && typeof items[0] === "object" ? Object.keys(items[0]).slice(0, 30) : [];
    }
    if (payload && (payload.series || payload.episodes)) {
      summary.seriesKeys = payload.series && typeof payload.series === "object" ? Object.keys(payload.series).slice(0, 32) : [];
      summary.episodes = Array.isArray(payload.episodes) ? payload.episodes.length : 0;
      summary.seriesCoverPresent = !!(payload.series && (payload.series.cover_url || payload.series.coverUrl));
    }
    return summary;
  }

  function renderDebugPanel() {
    const count = $("#debug-log-count");
    if (count) count.textContent = String(debugEntries.length + serverDebugEntries.length);
    const runtime = serverDebugRuntime || {};
    const badge = $("#debug-runtime-badge");
    if (badge) {
      badge.textContent = runtime.exited ? "WASM 已退出" : (runtime.initialized ? "WASM 已初始化" : "等待 SDK 初始化");
      badge.classList.toggle("error", !!runtime.exited);
    }
    const summary = $("#debug-summary");
    if (summary) {
      const parts = [
        "版本 " + APP_VERSION,
        "浏览器 " + (navigator.onLine ? "在线" : "离线"),
        "当前页面 " + state.view,
        "WASM " + (runtime.initialized ? (runtime.exited ? "exited" : "running") : "not-loaded"),
        "Runtime generation " + (runtime.generation || 0),
        "前端 " + debugEntries.length + " 条",
        "服务端 " + serverDebugEntries.length + " 条"
      ];
      summary.textContent = parts.join("  ·  ");
    }
    const output = $("#debug-output");
    if (!output) return;
    const all = debugEntries.concat(serverDebugEntries).sort((a,b) => String(a.time).localeCompare(String(b.time))).slice(-320);
    output.textContent = all.map((entry) => {
      const detail = Object.assign({}, entry);
      delete detail.time; delete detail.level; delete detail.event;
      return "[" + (entry.time || "") + "] [" + String(entry.level || "info").toUpperCase() + "] " +
        (entry.event || "event") + (Object.keys(detail).length ? " " + JSON.stringify(detail) : "");
    }).join("\\n") || "暂无日志。点击刷新日志后可读取边缘端记录。";
    output.scrollTop = output.scrollHeight;
  }

  async function refreshDebugPanel() {
    try {
      const data = await request("/api/v1/debug/logs?limit=240");
      serverDebugEntries = Array.isArray(data.events) ? data.events : [];
      if (!serverDebugRuntime || data.runtime?.initialized || data.runtime?.exited) {
        serverDebugRuntime = data.runtime || serverDebugRuntime;
      }
      debugWrite("info", "debug.server.refresh", {serverEntries:serverDebugEntries.length});
    } catch (error) {
      debugWrite("error", "debug.server.refresh.failed", {message:error.message || error});
      renderDebugPanel();
    }
  }

  function debugBundle() {
    return {
      app: "贝小果 Cloudflare Lite",
      version: APP_VERSION,
      generatedAt: new Date().toISOString(),
      page: {view:state.view, url:window.location.origin + window.location.pathname},
      browser: {
        userAgent:navigator.userAgent,
        language:navigator.language,
        online:navigator.onLine,
        viewport:window.innerWidth + "x" + window.innerHeight,
        timezone:Intl.DateTimeFormat().resolvedOptions().timeZone
      },
      runtime:serverDebugRuntime,
      frontend:debugEntries,
      edge:serverDebugEntries
    };
  }

  function openDebugPanel() {
    const dialog = $("#debug-dialog");
    if (!dialog.open) dialog.showModal();
    renderDebugPanel();
    refreshDebugPanel();
  }

  async function request(path, options) {
    options = options || {};
    const headers = Object.assign({"Accept":"application/json","X-BXG-Session":playbackClientId}, options.headers || {});
    const endpoint = safeEndpoint(path);
    const method = String(options.method || "GET").toUpperCase();
    for (let attempt = 0; attempt < 2; attempt++) {
      if (options.signal && options.signal.aborted) {
        const aborted = new Error("request aborted");
        aborted.name = "AbortError";
        throw aborted;
      }
      const startedAt = Date.now();
      debugWrite("debug", "api.request", {method,endpoint,attempt:attempt + 1});
      let response;
      try {
        response = await fetch(path, Object.assign({}, options, {headers}));
        captureEdgeTrace(response);
      } catch (error) {
        debugWrite("error", "api.network.error", {method,endpoint,durationMs:Date.now() - startedAt,message:error.message || error});
        throw error;
      }
      let payload;
      try {
        payload = await response.json();
      } catch (error) {
        debugWrite("error", "api.invalid-json", {method,endpoint,status:response.status,durationMs:Date.now() - startedAt,message:error.message || error});
        throw new Error("API 返回了无法解析的 JSON（HTTP " + response.status + "）");
      }
      if (response.ok) {
        debugWrite("info", "api.response", {
          method,endpoint,status:response.status,durationMs:Date.now() - startedAt,
          summary:JSON.stringify(summarizePayload(path,payload)).slice(0, 420)
        });
        return payload;
      }

      const err = payload && payload.error ? payload.error : {};
      debugWrite("error", "api.response.error", {
        method,endpoint,status:response.status,code:err.code || "",durationMs:Date.now() - startedAt,
        message:err.message || ("HTTP " + response.status)
      });
      if (err.code === "REQUEST_QUEUE_FULL" && attempt === 0) {
        const retryAfter = Number(response.headers.get("Retry-After")) || 2;
        debugWrite("warn", "api.retry", {endpoint,retryAfter});
        await new Promise((resolve) => window.setTimeout(resolve, Math.min(5, retryAfter) * 1000));
        continue;
      }
      throw new Error(err.message || ("HTTP " + response.status));
    }
    throw new Error("片库请求繁忙，请稍后重试");
  }

  function normalize(item) {
    return {
      id: item.id || item.series_id || item.seriesId || item.actor_id || item.actorId || "",
      title: item.title || item.name || "未命名短剧",
      cover_url: item.cover_url || item.coverUrl || "",
      description: item.description || "",
      episode_count: item.episode_count || item.episodeCount || 0,
      heat: item.heat || item.search_score || item.score || "",
      tag: item.tag || "",
      raw: item
    };
  }

  function setHeading(view) {
    const labels = navLabels[view] || navLabels.discover;
    $("#section-kicker").textContent = labels[0];
    $("#section-title").textContent = labels[1];
    $("#section-subtitle").textContent = labels[2];
    document.querySelectorAll(".nav-item").forEach((button) => {
      button.classList.toggle("active", button.dataset.view === view);
    });
    $("#welcome").hidden = view !== "discover";
  }

  function formatBytes(value) {
    const bytes = Number(value) || 0;
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KiB";
    if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + " MiB";
    return (bytes / 1024 / 1024 / 1024).toFixed(2) + " GiB";
  }

  function fillSettingsForm(settings) {
    const fields = {
      "preheat-enabled":"preheat_enabled",
      "preheat-startup":"preheat_on_startup",
      "preheat-hourly":"preheat_hourly",
      "preheat-items":"preheat_items",
      "idle-seconds":"idle_seconds",
      "image-ram-mib":"image_ram_mib",
      "image-disk-gib":"image_disk_gib",
      "image-ram-idle-hours":"image_ram_idle_hours",
      "image-disk-retention-days":"image_disk_retention_days",
      "api-ram-mib":"api_ram_mib",
      "api-max-entries":"api_max_entries"
    };
    Object.keys(fields).forEach((id) => {
      const input = $("#" + id);
      if (!input) return;
      const key = fields[id];
      if (input.type === "checkbox") input.checked = !!settings[key];
      else input.value = settings[key];
    });
  }

  function readSettingsForm() {
    return {
      preheat_enabled:$("#preheat-enabled").checked,
      preheat_on_startup:$("#preheat-startup").checked,
      preheat_hourly:$("#preheat-hourly").checked,
      preheat_items:Number($("#preheat-items").value),
      idle_seconds:Number($("#idle-seconds").value),
      image_ram_mib:Number($("#image-ram-mib").value),
      image_disk_gib:Number($("#image-disk-gib").value),
      image_ram_idle_hours:Number($("#image-ram-idle-hours").value),
      image_disk_retention_days:Number($("#image-disk-retention-days").value),
      api_ram_mib:Number($("#api-ram-mib").value),
      api_max_entries:Number($("#api-max-entries").value)
    };
  }

  function renderSettingsLive(data) {
    const status = data.preheat || {};
    const cache = data.cache || {};
    const started = status.started_at ? new Date(status.started_at).toLocaleString() : "尚未运行";
    const next = status.next_run_at ? new Date(status.next_run_at).toLocaleString() : "等待调度";
    const preheatText = [
      "预热状态：" + (status.running ? "运行中 · " + (status.phase || "") + (status.current ? " · " + status.current : "") : (status.phase || "空闲")),
      "目录 API：" + (status.api_pages || 0) + " 页 · 作品条目 " + (status.items_ready || 0),
      "封面：" + (status.images_done || 0) + " / " + (status.images_total || 0) + " · 失败 " + (status.images_failed || 0),
      "API 失败/超时：" + (status.api_failed || 0) + " · 跳过轮次：" + (status.skipped || 0),
      "上次开始：" + started,
      "下次计划：" + next,
      "结果：" + (status.last_result || "等待首次预热"),
      "",
      "图片 RAM：" + formatBytes(cache.image_ram_bytes) + " / " + formatBytes(cache.image_ram_limit_bytes) + " · " + (cache.image_ram_entries || 0) + " 张",
      "图片闪存：" + formatBytes(cache.image_disk_bytes) + " / " + formatBytes(cache.image_disk_limit_bytes) + " · " + (cache.image_disk_entries || 0) + " 张",
      "API RAM：" + formatBytes(cache.api_bytes) + " · " + (cache.api_entries || 0) + " 条"
    ];
    $("#settings-live").textContent = preheatText.join("\n");
  }

  async function refreshSettings(fillForm) {
    const data = await request("/api/v1/settings");
    if (fillForm) fillSettingsForm(data.settings || {});
    renderSettingsLive(data);
  }

  async function openSettings() {
    const dialog = $("#settings-dialog");
    if (!dialog.open) dialog.showModal();
    window.clearInterval(settingsRefreshTimer);
    $("#settings-live").innerHTML =
      '<div class="deployment-guide">' +
        '<p class="guide-intro">推荐选择 Pages + GitHub 授权：首次设置一次，之后每次更新代码都会自动部署。无需创建 KV、D1 或 R2。</p>' +
        '<section class="guide-section"><h3>方案 A · GitHub 授权连接 Pages（推荐）</h3>' +
          '<ol class="guide-steps">' +
            '<li>打开 <a href="https://dash.cloudflare.com/" target="_blank" rel="noopener noreferrer">Cloudflare 控制台</a>，进入 <strong>Workers & Pages → Create application → Pages → Connect to Git</strong>。</li>' +
            '<li>跳转到 GitHub 后，安装并授权 <strong>Cloudflare Workers & Pages</strong> 应用；选择仓库 <code>xiaobei206/beixiaoguo-CF</code>。</li>' +
            '<li>生产分支选 <code>main</code>；Framework preset 选 <code>None</code>；Build command 填 <code>npm run build</code>；Build output directory 填 <code>public</code>；Root directory 留空。</li>' +
            '<li>点击部署。完成后访问 Cloudflare 分配的 <code>*.pages.dev</code> 地址；以后推送到 <code>main</code> 会自动更新。</li>' +
          '</ol></section>' +
        '<section class="guide-section"><h3>ZIP／文件夹能不能直接拖放？</h3>' +
          '<p>不建议，也不能作为完整安装方式。控制台的 Direct Upload 拖放不会编译本项目的 <code>functions/</code>；只上传网页文件可能导致主页能打开，但 <code>/api/v1/*</code> 不能运行。想手动发布，请按完整教程从仓库根目录使用 Wrangler。</p></section>' +
        '<section class="guide-section"><h3>方案 B · Workers（备用）</h3>' +
          '<p>仓库已经提供独立的 <code>worker.js</code>。从仓库根目录运行 <code>npx wrangler login</code>，再运行 <code>npx wrangler deploy --config wrangler.worker.jsonc</code>；若要 Git 自动部署，在 Workers Builds 中使用 <code>npm run build</code> 作为构建命令，使用 <code>npx --yes wrangler@latest deploy --config wrangler.worker.jsonc</code> 作为部署命令。</p></section>' +
        '<p class="guide-links"><a href="https://github.com/xiaobei206/beixiaoguo-CF/blob/main/docs/deploy-cloudflare-cn.md" target="_blank" rel="noopener noreferrer">打开完整中文部署教程 ↗</a>' +
          ' · <a href="https://developers.cloudflare.com/pages/get-started/git-integration/" target="_blank" rel="noopener noreferrer">Pages 官方文档 ↗</a></p>' +
        '<p class="guide-note">部署验收：<code>/api/v1/health</code> 应返回 <code>status: ok</code>；<code>/api/v1/health?sdk=1</code> 应返回 <code>sdk: ready</code>。这些检查只验证 API/WASM 启动，不代表上游片库和所有视频均已通过测试。</p>' +
      '</div>';
    const form = $("#settings-form");
    if (form) form.hidden = true;
  }

  function handleGridImageError(event) {
    const image = event.target;
    if (!image || image.tagName !== "IMG") return;
    let imageHost = "";
    try { imageHost = new URL(image.currentSrc || image.src).hostname; } catch (_) {}
    const originalHost = (() => {
      try {
        const displayed = new URL(image.dataset.originalSrc || image.currentSrc || image.src, window.location.origin);
        const source = displayed.searchParams.get("url");
        return source ? new URL(source).hostname : displayed.hostname;
      } catch (_) { return ""; }
    })();
    debugWrite("warn", "image.load.error", {
      proxyHost:imageHost, sourceHost:originalHost, retryCount:Number(image.dataset.retryCount) || 0
    });
    let imagePath = "";
    try { imagePath = new URL(image.currentSrc || image.src, window.location.origin).pathname; } catch (_) {}
    if (!imageProbeStarted && imagePath === "/api/v1/images") {
      imageProbeStarted = true;
      const probeUrl = image.currentSrc || image.src;
      fetch(probeUrl, {method:"HEAD",headers:{"X-BXG-Session":playbackClientId}})
        .then((response) => {
          captureEdgeTrace(response);
          debugWrite(response.ok ? "info" : "error", "image.proxy.head-probe", {
            status:response.status,
            code:response.headers.get("X-BXG-Error-Code") || "",
            contentType:response.headers.get("Content-Type") || ""
          });
        })
        .catch((error) => debugWrite("error", "image.proxy.head-probe.failed", {message:error.message || error}));
    }
    const attempts = Number(image.dataset.retryCount) || 0;
    if (attempts < 1) {
      image.dataset.retryCount = String(attempts + 1);
      const source = image.dataset.originalSrc || image.src;
      const separator = source.includes("?") ? "&" : "?";
      window.setTimeout(() => {
        if (!image.isConnected) return;
        image.src = source + separator + "_bxg_retry=" + Date.now();
      }, 350);
      return;
    }
    const placeholder = document.createElement("div");
    placeholder.className = "poster-placeholder";
    placeholder.textContent = "贝";
    image.replaceWith(placeholder);
  }

  function renderCards(items, append) {
    const grid = $("#series-grid");
    if (!items.length) {
      if (append && grid.querySelector(".series-card")) return;
      grid.innerHTML = '<div class="empty-state">这里暂时没有内容，试试刷新或换个关键词。</div>';
      return;
    }
    const markup = items.map((item) => {
      const data = normalize(item);
      const cover = safeImage(data.cover_url);
      const fav = state.favorites.some((entry) => entry.id === data.id);
      const tag = data.tag ? '<span class="poster-tag">' + escapeHTML(data.tag) + '</span>' : "";
      return '<article class="series-card" tabindex="0" role="button" data-id="' + escapeHTML(data.id) + '" aria-label="查看 ' + escapeHTML(data.title) + '">' +
        '<div class="poster-wrap">' +
        (cover ? '<img loading="lazy" decoding="async" src="' + escapeHTML(cover) + '" data-original-src="' + escapeHTML(cover) + '" alt="' + escapeHTML(data.title) + '">' : '<div class="poster-placeholder">贝</div>') +
        tag + (fav ? '<span class="poster-tag favorite-tag">♥</span>' : "") +
        '</div><h3 class="card-title">' + escapeHTML(data.title) + '</h3>' +
        '<div class="card-meta">' + escapeHTML(data.episode_count ? data.episode_count + " 集" : data.heat || "短剧") + '</div>' +
        '</article>';
    }).join("");
    if (append) {
      const empty = grid.querySelector(".empty-state");
      if (empty) empty.remove();
      grid.insertAdjacentHTML("beforeend", markup);
    } else {
      grid.innerHTML = markup;
    }
  }

  function renderHero(items) {
    const el = $("#hero");
    const first = items.length ? normalize(items[0]) : null;
    if (!first || !safeImage(first.cover_url)) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.innerHTML = '<div class="feature-inner"><img loading="lazy" src="' + escapeHTML(safeImage(first.cover_url)) + '" alt="">' +
      '<div class="feature-text"><div class="feature-label">TODAY’S PICK</div><h3>' + escapeHTML(first.title) + '</h3>' +
      '<p>' + escapeHTML(first.description || (first.episode_count ? first.episode_count + " 集 · 点开查看详情" : "点开查看剧集详情")) + '</p></div></div>';
  }

  function setStatus(message, isError) {
    const el = $("#status");
    el.textContent = message || "";
    el.classList.toggle("error", !!isError);
  }

  function setBusy(busy) {
    state.busy = busy;
    $("#refresh-button").disabled = busy;
    $("#load-more").disabled = busy;
    $("#load-more").textContent = busy ? "正在加载…" : "加载更多";
    renderPagination();
  }

  const discoverChannels = [
    ["推荐", "推荐"], ["真人剧", "真人剧"], ["漫剧", "漫剧"],
    ["找剧", "找剧"], ["电影", "电影"], ["小说", "小说"]
  ];
  const searchTypes = [
    ["all", "全部"], ["short", "真人剧"], ["comic", "漫剧"],
    ["ai", "AI漫剧"], ["film", "影视剧"], ["unwatched", "未看过"]
  ];

  function tagRow(label, kind, options) {
    if (!options || !options.length) return "";
    return '<div class="filter-row"><span class="filter-label">' + escapeHTML(label) + '</span><div class="filter-list">' +
      options.map((option) => '<button type="button" class="filter-tag' + (option.active ? " active" : "") +
        '" data-filter-kind="' + escapeHTML(kind) + '" data-filter-value="' + escapeHTML(option.value) +
        '" aria-pressed="' + (option.active ? "true" : "false") + '">' + escapeHTML(option.label) + '</button>').join("") +
      '</div></div>';
  }

  function formatDateTag(value) {
    const raw = String(value || "");
    const match = raw.match(/^(\d{4})-?(\d{2})-?(\d{2})$/);
    if (!match) return raw;
    const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
    const dayValue = Date.UTC(year, month - 1, day);
    const now = new Date();
    const todayValue = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    const delta = Math.round((dayValue - todayValue) / 86400000);
    if (delta === 0) return "今天";
    if (delta === -1) return "昨天";
    if (delta === 1) return "明天";
    return month + "/" + day;
  }

  function renderFilterTags() {
    const container = $("#filter-tags");
    if (!container) return;
    const rows = [];
    if (state.view === "discover") {
      rows.push(tagRow("频道", "channel", discoverChannels.map(([value, label]) => ({
        value, label, active: state.discoverChannel === value
      }))));
    } else if (state.view === "search") {
      rows.push(tagRow("类型", "search-type", searchTypes.map(([value, label]) => ({
        value, label, active: state.searchType === value
      }))));
    } else if (state.view === "rank" && state.rankContents.length) {
      rows.push(tagRow("类型", "rank-content", state.rankContents.map((content) => ({
        value: content.id, label: content.name, active: content.id === state.rankContent
      }))));
      const selectedContent = state.rankContents.find((item) => item.id === state.rankContent) ||
        state.rankContents.find((item) => item.selected) || state.rankContents[0];
      if (selectedContent && Array.isArray(selectedContent.boards) && selectedContent.boards.length) {
        rows.push(tagRow("榜单", "rank-board", selectedContent.boards.map((board) => ({
          value: board.id, label: board.name, active: board.id === state.rankBoard
        }))));
      }
    } else if (state.view === "new" && state.newDates.length) {
      rows.push(tagRow("日期", "new-date", state.newDates.map((value) => ({
        value, label: formatDateTag(value), active: String(value) === String(state.newDate)
      }))));
    }
    container.innerHTML = rows.join("");
    container.hidden = rows.length === 0;
  }

  function renderPagination() {
    const info = $("#pagination-tag");
    const more = $("#load-more");
    if (!info || !more) return;
    const paged = ["discover", "search", "rank", "new"].includes(state.view);
    if (!paged || !state.items.length) {
      info.hidden = true;
      more.hidden = true;
      return;
    }
    let label = "已载入 " + state.items.length + " 部";
    if (state.pageCount > 0) label += " · 第 " + state.pageCount + " 页";
    if (state.hasMore && state.items.length < INITIAL_PRELOAD_TARGET) label += " · 首批预载 " + state.items.length + "/" + INITIAL_PRELOAD_TARGET;
    if (state.busy) label += " · 加载中";
    else if (state.hasMore) label += " · 向下滚动自动加载";
    else label += " · 已加载完毕";
    info.textContent = label;
    info.hidden = false;
    more.hidden = !state.hasMore;
  }

  function viewCacheKey(view) {
    if (view === "search") return "search:" + $("#search-input").value.trim() + ":" + state.searchType;
    if (view === "discover") return "discover:" + state.discoverChannel;
    if (view === "rank") return "rank:" + (state.rankContent || "all") + ":" + (state.rankBoard || "default");
    if (view === "new") return "new:" + (state.newDate || todayDateKey());
    return view;
  }

  function saveActiveView() {
    if (!state.activeViewKey || state.view === "mine" || !state.items.length) return;
    state.viewCache[state.activeViewKey] = {
      items: state.items.slice(),
      cursor: state.cursor,
      hasMore: state.hasMore,
      pageCount: state.pageCount,
      discoverChannel: state.discoverChannel,
      searchType: state.searchType,
      rankContent: state.rankContent,
      rankBoard: state.rankBoard,
      rankContents: state.rankContents.slice(),
      newDate: state.newDate,
      newDates: state.newDates.slice(),
      scrollY: window.scrollY,
      savedAt: Date.now()
    };
    const keys = Object.keys(state.viewCache);
    if (keys.length > 12) {
      keys.sort((a, b) => state.viewCache[a].savedAt - state.viewCache[b].savedAt);
      delete state.viewCache[keys[0]];
    }
  }

  function scheduleAutoLoad(view, key, delay) {
    window.setTimeout(() => {
      if (state.view === view && state.activeViewKey === key && !state.busy && state.hasMore &&
          (state.items.length < INITIAL_PRELOAD_TARGET || isNearPageEnd())) {
        loadView(view, true);
      }
    }, delay == null ? 40 : delay);
  }

  function restoreView(view, key, cached) {
    state.view = view;
    state.activeViewKey = key;
    state.items = cached.items.slice();
    state.cursor = cached.cursor;
    state.hasMore = cached.hasMore;
    state.pageCount = cached.pageCount || (cached.items.length ? 1 : 0);
    state.discoverChannel = cached.discoverChannel || state.discoverChannel;
    state.searchType = cached.searchType || "all";
    state.rankContent = cached.rankContent || "all";
    state.rankBoard = cached.rankBoard || "";
    state.rankContents = Array.isArray(cached.rankContents) ? cached.rankContents.slice() : [];
    state.newDate = cached.newDate || state.newDate || todayDateKey();
    state.newDates = Array.isArray(cached.newDates) ? cached.newDates.slice() : [];
    setHeading(view);
    renderFilterTags();
    renderCards(state.items);
    if (view === "discover") renderHero(state.items);
    else $("#hero").hidden = true;
    renderPagination();
    setStatus("已从页面缓存恢复 · " + state.items.length + " 部");
    window.requestAnimationFrame(() => window.scrollTo({top:cached.scrollY || 0,behavior:"auto"}));
    if (state.hasMore && state.items.length < INITIAL_PRELOAD_TARGET) scheduleAutoLoad(view, key, 40);
  }

  async function loadView(view, append, force) {
    if (append && state.busy) return;
    let listController = state.listController;
    if (!append) {
      if (listController) listController.abort();
      listController = new AbortController();
      state.listController = listController;
    } else if (!listController) {
      listController = new AbortController();
      state.listController = listController;
    }
    if (!append) {
      const key = viewCacheKey(view);
      if (state.activeViewKey && state.activeViewKey !== key && state.view !== view) saveActiveView();
      state.loadSequence++;
      state.busy = false;
      setBusy(false);
      state.view = view;
      state.activeViewKey = key;
      setHeading(view);
      renderFilterTags();

      if (view === "mine") {
        state.cursor = "";
        state.hasMore = false;
        state.pageCount = 0;
        state.items = [];
        renderCards(state.favorites);
        $("#hero").hidden = true;
        renderFilterTags();
        renderPagination();
        setStatus(state.favorites.length ? "收藏保存在当前浏览器，不会上传到服务器。" : "还没有收藏的短剧。打开剧集详情即可收藏。");
        return;
      }

      const cached = state.viewCache[key];
      if (!force && cached) {
        restoreView(view, key, cached);
        return;
      }
      state.cursor = "";
      state.hasMore = false;
      state.pageCount = 0;
      state.items = [];
      $("#hero").hidden = true;
      $("#series-grid").innerHTML = "";
      renderPagination();
    }

    const loadID = ++state.loadSequence;
    const activeKey = state.activeViewKey;
    setBusy(true);
    setStatus(append ? "正在加载下一页…" : "正在连接片库…");
    let loadSucceeded = false;
    try {
      let data;
      let items = [];
      let endpoint = "";
      if (view === "discover") {
        const params = new URLSearchParams();
        params.set("channel", state.discoverChannel || "推荐");
        if (append && state.cursor) params.set("cursor", state.cursor);
        endpoint = "/api/v1/discover?" + params.toString();
        data = await request(endpoint, {signal:listController.signal});
        items = data.items || [];
      } else if (view === "search") {
        const params = new URLSearchParams();
        params.set("q", $("#search-input").value.trim());
        if (append && state.cursor) params.set("cursor", state.cursor);
        if (state.searchType && state.searchType !== "all") params.set("type", state.searchType);
        endpoint = "/api/v1/search?" + params.toString();
        data = await request(endpoint, {signal:listController.signal});
        items = data.items || [];
      } else if (view === "new") {
        const params = new URLSearchParams();
        params.set("date", state.newDate || todayDateKey());
        if (append && state.cursor) params.set("cursor", state.cursor);
        endpoint = "/api/v1/new-releases?" + params.toString();
        data = await request(endpoint, {signal:listController.signal});
        items = data.items || [];
      } else if (view === "rank") {
        const params = new URLSearchParams();
        if (state.rankContent && state.rankContent !== "all") params.set("content", state.rankContent);
        if (state.rankBoard) params.set("board", state.rankBoard);
        if (append && state.cursor) params.set("cursor", state.cursor);
        endpoint = "/api/v1/rank" + (params.toString() ? "?" + params.toString() : "");
        data = await request(endpoint, {signal:listController.signal});
        items = data.items || [];
      } else if (view === "hot") {
        data = await request("/api/v1/hot-search", {signal:listController.signal});
        const boards = (data.boards || []).flatMap((board) => board.items || []);
        items = (data.guesses || []).concat(boards);
      }
      if (loadID !== state.loadSequence || activeKey !== state.activeViewKey) return;

      const mapped = items.map(normalize).filter((item) => item.id);
      const previousCount = append ? state.items.length : 0;
      const combined = append ? state.items.concat(mapped) : mapped;
      const seen = new Set();
      state.items = combined.filter((item) => {
        if (!item.id || seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      });
      const addedCount = state.items.length - previousCount;
      state.pageCount = append ? state.pageCount + 1 : 1;
      state.cursor = data.cursor || data.next_cursor || "";
      state.hasMore = !!data.has_more && !!state.cursor;
      if (append && addedCount === 0) state.hasMore = false;

      if (view === "rank") {
        if (Array.isArray(data.contents)) {
          state.rankContents = data.contents.filter((content) => content && content.id && content.name !== "演员");
        }
        if (data.content) state.rankContent = data.content;
        if (data.board) state.rankBoard = data.board;
        state.activeViewKey = viewCacheKey(view);
      } else if (view === "new") {
        if (Array.isArray(data.dates)) state.newDates = data.dates.map((value) => String(value).replace(/-/g, ""));
        if (data.date) state.newDate = String(data.date).replace(/-/g, "");
        state.activeViewKey = viewCacheKey(view);
      }

      renderFilterTags();
      renderCards(append ? state.items.slice(previousCount) : state.items, append);
      if (!append && view === "discover") renderHero(state.items);
      renderPagination();
      let statusMessage = state.items.length
        ? ("已载入 " + state.items.length + " 部" + (state.pageCount > 1 ? " · 第 " + state.pageCount + " 页" : ""))
        : "暂无内容";
      if (state.items.length < INITIAL_PRELOAD_TARGET && state.hasMore) statusMessage += " · 正在准备首批 " + INITIAL_PRELOAD_TARGET + " 部";
      setStatus(statusMessage);
      saveActiveView();
      loadSucceeded = true;
    } catch (error) {
      if (loadID !== state.loadSequence || activeKey !== state.activeViewKey) return;
      if (error && error.name === "AbortError") return;
      setStatus(error.message || "加载失败", true);
      if (!append) $("#series-grid").innerHTML = '<div class="empty-state">片库暂时没有响应。<br>请稍后重试；若持续失败，请查看 Cloudflare Functions 运行日志。</div>';
    } finally {
      if (loadID === state.loadSequence) {
        setBusy(false);
        renderPagination();
        // Build a useful random-pick pool before waiting for the viewer to scroll.
        // Each page renders immediately; at 100 items, resume near-bottom loading.
        const scheduledView = state.view;
        const scheduledKey = state.activeViewKey;
        if (loadSucceeded && state.hasMore &&
            (state.items.length < INITIAL_PRELOAD_TARGET || isNearPageEnd())) {
          scheduleAutoLoad(scheduledView, scheduledKey, 40);
        }
      }
    }
  }

  function isNearPageEnd() {
    const remaining = document.documentElement.scrollHeight - (window.scrollY + window.innerHeight);
    return remaining <= Math.max(750, window.innerHeight * 0.85);
  }

  function maybeAutoLoadMore() {
    if (!state.hasMore || state.busy || !["discover", "search", "rank", "new"].includes(state.view)) return;
    if (isNearPageEnd()) loadView(state.view, true);
  }
  function beginTemporaryBoost() {
    const video = $("#web-player");
    if (!video || video.paused || video.ended || state.playback.index < 0) return false;
    if (state.playback.temporaryBoost) return true;
    state.playback.temporaryBoost = true;
    video.playbackRate = 2;
    syncPlaybackStatus();
    ["#player-hold-speed", "#pip-hold-speed"].forEach((selector) => {
      const button = $(selector);
      if (button) button.classList.add("holding");
    });
    const indicator = $("#player-speed-indicator");
    if (indicator) indicator.hidden = false;
    return true;
  }

  function endTemporaryBoost() {
    if (!state.playback.temporaryBoost) return;
    state.playback.temporaryBoost = false;
    const video = $("#web-player");
    if (video) video.playbackRate = Number(state.playback.speed) || 1;
    syncPlaybackStatus();
    ["#player-hold-speed", "#pip-hold-speed"].forEach((selector) => {
      const button = $(selector);
      if (button) button.classList.remove("holding");
    });
    const indicator = $("#player-speed-indicator");
    if (indicator) indicator.hidden = true;
  }

  function bindHoldToAccelerate(button) {
    if (!button || button.dataset.holdBound === "true") return;
    button.dataset.holdBound = "true";
    let pressed = false;
    const start = (event) => {
      if (event && event.type === "pointerdown" && event.button !== undefined && event.button !== 0) return;
      if (pressed) return;
      pressed = true;
      beginTemporaryBoost();
      if (event && event.pointerId !== undefined && button.setPointerCapture) {
        try { button.setPointerCapture(event.pointerId); } catch (_) {}
      }
      if (event && event.type === "keydown" && event.preventDefault) event.preventDefault();
    };
    const stop = () => {
      if (!pressed) return;
      pressed = false;
      endTemporaryBoost();
    };
    button.addEventListener("pointerdown", start);
    ["pointerup", "pointercancel", "lostpointercapture", "pointerleave", "blur"].forEach((type) => button.addEventListener(type, stop));
    button.addEventListener("keydown", (event) => {
      if ((event.code === "Space" || event.code === "Enter") && !event.repeat) start(event);
    });
    button.addEventListener("keyup", (event) => {
      if (event.code === "Space" || event.code === "Enter") stop();
    });
    button.addEventListener("contextmenu", (event) => event.preventDefault());
  }

  function mediaElementDiagnostics(video) {
    let bufferedEnd = 0;
    try {
      if (video.buffered && video.buffered.length) bufferedEnd = video.buffered.end(video.buffered.length - 1);
    } catch (_) {}
    const n = (value) => Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
    return {
      currentTime: n(video.currentTime),
      duration: n(video.duration),
      bufferedEnd: n(bufferedEnd),
      readyState: video.readyState,
      networkState: video.networkState,
      paused: !!video.paused,
      ended: !!video.ended,
      errorCode: video.error ? video.error.code : 0,
      errorMessage: video.error && video.error.message ? String(video.error.message).slice(0, 180) : ""
    };
  }

  function syncPlaybackStatus(phase) {
    const video = $("#web-player");
    const status = $("#playback-status");
    if (!video || !status || state.playback.index < 0) return;
    const previous = String(status.textContent || "");
    if (!phase && !/^(正在播放|已暂停)/.test(previous)) return;
    const currentPhase = phase || (video.paused ? "已暂停" : "正在播放");
    const rate = Number.isFinite(Number(video.playbackRate)) ? Number(video.playbackRate) : 1;
    const rateLabel = String(Number(rate.toFixed(2)));
    status.textContent = currentPhase + " · " + (state.playback.quality || "自动") + " · " + rateLabel + "×";
  }

  function getMediaSession() {
    const nav = window.navigator || {};
    return nav.mediaSession || null;
  }

  function buildMediaSessionArtwork(artworkURL) {
    const playback = state.playback;
    const artwork = [];
    const coverImage = $("#detail-content .detail-hero img");
    const width = coverImage ? Number(coverImage.naturalWidth) || 0 : 0;
    const height = coverImage ? Number(coverImage.naturalHeight) || 0 : 0;

    // Re-encode the already displayed same-origin cover as a small, square JPEG.
    // iOS lock-screen artwork decoders are more reliable with a concrete image
    // payload, explicit dimensions and a widely supported MIME type.
    if (!playback.seriesArtworkDataURL && coverImage && coverImage.complete && width > 0 && height > 0) {
      try {
        const canvasSize = 512;
        const canvas = document.createElement("canvas");
        canvas.width = canvasSize;
        canvas.height = canvasSize;
        const context = canvas.getContext("2d");
        if (context) {
          context.fillStyle = "#10131a";
          context.fillRect(0, 0, canvasSize, canvasSize);
          const scale = Math.min(canvasSize / width, canvasSize / height);
          const drawWidth = width * scale;
          const drawHeight = height * scale;
          context.drawImage(
            coverImage,
            (canvasSize - drawWidth) / 2,
            (canvasSize - drawHeight) / 2,
            drawWidth,
            drawHeight
          );
          const dataURL = canvas.toDataURL("image/jpeg", 0.9);
          if (typeof dataURL === "string" && dataURL.indexOf("data:image/jpeg;base64,") === 0) {
            playback.seriesArtworkDataURL = dataURL;
          }
        }
      } catch (_) {}
    }

    if (playback.seriesArtworkDataURL) {
      artwork.push({
        src: playback.seriesArtworkDataURL,
        sizes: "512x512",
        type: "image/jpeg"
      });
    }

    // Keep an absolute cover URL fallback for browsers which prefer
    // fetching artwork themselves, with the actual dimensions when available.
    if (artworkURL) {
      const origin = String(window.location && window.location.origin || "");
      const absoluteURL = origin && artworkURL.charAt(0) === "/"
        ? origin + artworkURL
        : artworkURL;
      const fallback = {src:absoluteURL};
      if (width > 0 && height > 0) fallback.sizes = width + "x" + height;
      artwork.push(fallback);
    }
    return artwork;
  }

  function updateMediaSessionMetadata() {
    const session = getMediaSession();
    if (!session || typeof window.MediaMetadata !== "function" || state.playback.index < 0) return;
    const playback = state.playback;
    const episode = playback.episodes[playback.index] || {};
    const episodeNumber = episode.number || playback.index + 1;
    const artworkURL = safeImage(playback.seriesCover);
    const metadata = {
      title: playback.seriesTitle || "贝小果短剧",
      artist: "第 " + episodeNumber + " 集 · 贝小果",
      album: "贝小果短剧",
      artwork: buildMediaSessionArtwork(artworkURL)
    };
    try {
      session.metadata = new window.MediaMetadata(metadata);
      if (typeof session.setPositionState === "function") session.setPositionState();
    } catch (_) {}
  }

  function updateMediaSessionPositionState() {
    const session = getMediaSession();
    const video = $("#web-player");
    if (!session || typeof session.setPositionState !== "function" || !video) return;
    const duration = Number(video.duration);
    const position = Number(video.currentTime);
    const playbackRate = Number(video.playbackRate) || 1;
    if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(position)) return;
    try {
      session.setPositionState({
        duration,
        position: Math.max(0, Math.min(position, duration)),
        playbackRate
      });
    } catch (_) {}
  }

  function setMediaSessionPlaybackState(value) {
    const session = getMediaSession();
    if (!session || !["none", "paused", "playing"].includes(value)) return;
    try { session.playbackState = value; } catch (_) {}
    if (value === "playing") updateMediaSessionPositionState();
  }

  function clearMediaSession() {
    const session = getMediaSession();
    if (!session) return;
    try { session.metadata = null; } catch (_) {}
    try { session.playbackState = "none"; } catch (_) {}
    try {
      if (typeof session.setPositionState === "function") session.setPositionState();
    } catch (_) {}
  }

  function installMediaSessionActionHandlers() {
    const session = getMediaSession();
    if (!session || typeof session.setActionHandler !== "function") return;
    const handlers = {
      play: () => {
        const video = $("#web-player");
        if (!video) return;
        const result = video.play();
        if (result && typeof result.catch === "function") result.catch(() => {});
      },
      pause: () => {
        const video = $("#web-player");
        if (video) video.pause();
      },
      stop: () => stopPlayback(),
      previoustrack: () => changeEpisode(-1),
      nexttrack: () => changeEpisode(1),
      seekto: (details) => {
        const video = $("#web-player");
        const seekTime = Number(details && details.seekTime);
        if (!video || !Number.isFinite(seekTime)) return;
        try {
          if (details.fastSeek && typeof video.fastSeek === "function") video.fastSeek(seekTime);
          else video.currentTime = seekTime;
          updateMediaSessionPositionState();
        } catch (_) {}
      },
      seekbackward: (details) => {
        const video = $("#web-player");
        if (!video) return;
        const offset = Number(details && details.seekOffset) || 10;
        try {
          video.currentTime = Math.max(0, (Number(video.currentTime) || 0) - Math.max(0, offset));
          updateMediaSessionPositionState();
        } catch (_) {}
      },
      seekforward: (details) => {
        const video = $("#web-player");
        if (!video) return;
        const offset = Number(details && details.seekOffset) || 10;
        try {
          const duration = Number(video.duration);
          const target = (Number(video.currentTime) || 0) + Math.max(0, offset);
          video.currentTime = Number.isFinite(duration) && duration > 0 ? Math.min(duration, target) : target;
          updateMediaSessionPositionState();
        } catch (_) {}
      }
    };
    Object.entries(handlers).forEach(([action, handler]) => {
      try { session.setActionHandler(action, handler); } catch (_) {}
    });
  }

  function isIOSDevice() {
    const nav = window.navigator || {};
    return /iPhone|iPad|iPod/i.test(nav.userAgent || "") ||
      (nav.platform === "MacIntel" && nav.maxTouchPoints > 1);
  }

  function isPictureInPictureActive(video) {
    return !!video && (
      document.pictureInPictureElement === video ||
      video.webkitPresentationMode === "picture-in-picture"
    );
  }

  function supportsPictureInPicture(video) {
    if (!video) return false;
    // WebKit's capability probe is more reliable than the standard flag in iOS Home Screen apps.
    if (typeof video.webkitSupportsPresentationMode === "function") {
      try { return video.webkitSupportsPresentationMode("picture-in-picture"); }
      catch (_) { return false; }
    }
    return !!(document.pictureInPictureEnabled && typeof video.requestPictureInPicture === "function");
  }

  function syncPictureInPictureButton() {
    const button = $("#player-pip");
    const video = $("#web-player");
    if (!button || !video) return;
    const supported = supportsPictureInPicture(video);
    const active = isPictureInPictureActive(video);
    const standaloneIOSBlocked = isIOSDevice() && isStandaloneApp() &&
      typeof video.webkitSupportsPresentationMode === "function" && !supported;
    button.hidden = !supported && !standaloneIOSBlocked;
    button.textContent = active ? "退出画中画" : (supported ? "画中画" : "画中画不可用");
    button.classList.toggle("unavailable", !supported);
    button.setAttribute("aria-disabled", String(!supported));
    button.title = supported
      ? (active ? "退出画中画" : "将当前视频缩放为系统悬浮小窗")
      : "iOS 主屏幕网页 App 当前不支持画中画，请从 Safari 标签页打开贝小果";
  }

  async function togglePictureInPicture() {
    const video = $("#web-player");
    if (!video) return;
    if (!supportsPictureInPicture(video)) {
      showToast("iOS 主屏幕网页 App 当前不支持画中画；请在 Safari 标签页打开贝小果后播放。");
      return;
    }
    try {
      if (video.webkitPresentationMode === "picture-in-picture" &&
          typeof video.webkitSetPresentationMode === "function") {
        video.webkitSetPresentationMode("inline");
      } else if (document.pictureInPictureElement === video && typeof document.exitPictureInPicture === "function") {
        await document.exitPictureInPicture();
      } else if (typeof video.webkitSetPresentationMode === "function") {
        video.webkitSetPresentationMode("picture-in-picture");
      } else if (typeof video.requestPictureInPicture === "function") {
        await video.requestPictureInPicture();
      } else {
        showToast("当前浏览器不支持画中画");
      }
    } catch (error) {
      const message = error && error.name === "NotSupportedError"
        ? "当前运行模式不支持画中画，请从 Safari 标签页打开贝小果。"
        : "无法进入画中画：" + (error && error.message ? error.message : "浏览器拒绝了请求");
      showToast(message);
    }
    syncPictureInPictureButton();
    syncPictureInPictureHoldButton();
  }

  function syncPictureInPictureHoldButton() {
    const video = $("#web-player");
    const button = $("#pip-hold-speed");
    if (!button) return;
    button.hidden = !isPictureInPictureActive(video);
  }

  function isStandaloneApp() {
    const nav = window.navigator || {};
    return !!((window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || nav.standalone === true);
  }

  function openInstallGuide() {
    const dialog = $("#install-dialog");
    const content = $("#install-dialog-content");
    if (!dialog || !content) return;
    const nav = window.navigator || {};
    const userAgent = nav.userAgent || "";
    const isIOS = /iPhone|iPad|iPod/i.test(userAgent) || (nav.platform === "MacIntel" && nav.maxTouchPoints > 1);
    if (isStandaloneApp()) {
      content.innerHTML = '<h2>贝小果已独立运行</h2><p>你正在使用独立窗口打开贝小果。之后直接点主屏幕上的贝小果图标即可，无需回到浏览器输入地址。</p>';
    } else if (isIOS) {
      content.innerHTML = '<h2>把贝小果添加到主屏幕</h2><ol class="install-steps"><li>用 <strong>Safari</strong> 打开当前贝小果页面。</li><li>点击分享按钮（方框向上箭头）。</li><li>选择<strong>“添加到主屏幕”</strong>。</li><li>若看到<strong>“作为网页 App 打开”</strong>，请开启后再点“添加”。</li></ol><p class="install-note">以后从主屏幕图标启动，贝小果会以独立窗口打开，不再显示 Safari 地址栏和底部工具栏。iOS 系统状态栏仍可能显示。</p>';
    } else {
      content.innerHTML = '<h2>把贝小果添加到桌面</h2><ol class="install-steps"><li>打开浏览器右上角菜单。</li><li>选择<strong>“安装应用”</strong>或<strong>“添加到主屏幕”</strong>。</li><li>确认后，从桌面上的贝小果图标启动。</li></ol><p class="install-note">若浏览器没有“安装应用”选项，当前连接可能使用 HTTP。部分浏览器要求 HTTPS 才能安装为独立应用；仍可尝试添加网页快捷方式。</p>';
    }
    if (!dialog.open) dialog.showModal();
  }

  function setupInstallPrompt() {
    const button = $("#install-app-button");
    if (!button) return;
    if (isStandaloneApp()) button.textContent = "已添加到桌面";
    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      deferredInstallPrompt = event;
      button.textContent = "安装应用";
    });
    window.addEventListener("appinstalled", () => {
      deferredInstallPrompt = null;
      button.textContent = "已添加到桌面";
      showToast("贝小果已安装到桌面");
    });
    button.addEventListener("click", async () => {
      if (deferredInstallPrompt) {
        const promptEvent = deferredInstallPrompt;
        deferredInstallPrompt = null;
        try {
          await promptEvent.prompt();
          const choice = await promptEvent.userChoice;
          if (choice && choice.outcome === "accepted") {
            button.textContent = "等待安装";
            showToast("请按浏览器提示完成安装");
            return;
          }
        } catch (_) {}
      }
      openInstallGuide();
    });
  }

  function stopPlayback() {
    endTemporaryBoost();
    setPlaybackActivity(false);
    clearBrowserPreloads();
    const video = $("#web-player");
    const pipButton = $("#pip-hold-speed");
    if (pipButton) pipButton.hidden = true;
    if (!video) { clearMediaSession(); return; }
    video.pause();
    video.removeAttribute("src");
    video.load();
    clearMediaSession();
  }

  function clearFullscreenPlayerControlsTimer() {
    if (playerControlsTimer) window.clearTimeout(playerControlsTimer);
    playerControlsTimer = 0;
  }

  function showFullscreenPlayerControls(delay) {
    const panel = $("#playback-panel");
    if (!panel || !panel.classList.contains("web-fullscreen")) return;
    panel.classList.add("player-controls-visible");
    clearFullscreenPlayerControlsTimer();
    playerControlsTimer = window.setTimeout(() => {
      playerControlsTimer = 0;
      if (panel.classList.contains("web-fullscreen")) {
        panel.classList.remove("player-controls-visible");
      }
    }, delay == null ? 3500 : delay);
  }

  function getPlayerFullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement ||
      document.mozFullScreenElement || document.msFullscreenElement || null;
  }

  function isNativeVideoFullscreen(video) {
    return !!(video && (video.webkitDisplayingFullscreen || video.webkitIsFullScreen));
  }

  function isPlayerSystemFullscreen(panel, video) {
    const element = getPlayerFullscreenElement();
    return element === panel || element === video || isNativeVideoFullscreen(video);
  }

  function syncSystemFullscreenButton() {
    const panel = $("#playback-panel");
    const video = $("#web-player");
    const button = $("#player-fullscreen");
    const closeButton = $("#player-close");
    if (!panel || !button) return;
    const active = isPlayerSystemFullscreen(panel, video);
    if (!getPlayerFullscreenElement() && !isNativeVideoFullscreen(video)) panel.classList.remove("manual-fullscreen");
    button.textContent = active ? "退出系统全屏" : "系统全屏";
    button.setAttribute("aria-pressed", active ? "true" : "false");
    if (closeButton) closeButton.textContent = active || panel.classList.contains("web-fullscreen") ? "退出全屏" : "收起";
  }

  async function exitPlayerSystemFullscreen(video) {
    if (isNativeVideoFullscreen(video) && typeof video.webkitExitFullscreen === "function") {
      video.webkitExitFullscreen();
      return;
    }
    const exit = document.exitFullscreen || document.webkitExitFullscreen ||
      document.mozCancelFullScreen || document.msExitFullscreen;
    if (typeof exit === "function") {
      await exit.call(document);
      return;
    }
    if (video && typeof video.webkitExitFullscreen === "function") {
      video.webkitExitFullscreen();
      return;
    }
    throw new Error("当前浏览器没有可用的系统全屏退出接口");
  }

  async function requestPlayerFullscreen(element) {
    const request = element && (element.requestFullscreen || element.webkitRequestFullscreen ||
      element.mozRequestFullScreen || element.msRequestFullscreen);
    if (typeof request !== "function") throw new Error("Fullscreen API unavailable");
    const result = request.call(element);
    if (result && typeof result.then === "function") await result;
  }

  async function togglePlayerSystemFullscreen() {
    const panel = $("#playback-panel");
    const video = $("#web-player");
    if (!panel || !video) return;
    if (isPlayerSystemFullscreen(panel, video)) {
      try {
        await exitPlayerSystemFullscreen(video);
      } catch (_) {
        showToast("退出系统全屏失败，请使用浏览器的退出手势或 Esc");
      }
      syncSystemFullscreenButton();
      return;
    }

    const userAgent = window.navigator && window.navigator.userAgent || "";
    if (/iPhone|iPod/i.test(userAgent) && typeof video.webkitEnterFullscreen === "function") {
      try {
        if (video.webkitSupportsFullscreen === false) throw new Error("视频暂不支持原生全屏");
        video.webkitEnterFullscreen();
        syncSystemFullscreenButton();
      } catch (_) {
        showToast("当前视频暂不支持系统全屏，请使用网页全屏");
      }
      return;
    }

    try {
      await requestPlayerFullscreen(panel);
      syncSystemFullscreenButton();
      return;
    } catch (_) {}

    // Some browsers reject fullscreen on an element inside a modal dialog.
    // Fall back to the video element so the browser can still provide native fullscreen.
    try {
      await requestPlayerFullscreen(video);
      syncSystemFullscreenButton();
      return;
    } catch (_) {}

    // Older iOS/WebKit builds expose only the video-specific fullscreen API.
    if (typeof video.webkitEnterFullscreen === "function") {
      try {
        if (video.webkitSupportsFullscreen === false) throw new Error("视频暂不支持原生全屏");
        video.webkitEnterFullscreen();
        syncSystemFullscreenButton();
        return;
      } catch (_) {}
    }
    showToast("当前浏览器无法进入系统全屏，请使用网页全屏");
  }

  function setPlayerWebFullscreen(enabled) {
    const panel = $("#playback-panel");
    const dialog = $("#detail-dialog");
    const button = $("#player-web-fullscreen");
    const closeButton = $("#player-close");
    const episodeNav = panel ? panel.querySelector(".player-nav") : null;
    if (!panel || !dialog || !button) return;

    clearFullscreenPlayerControlsTimer();
    panel.classList.remove("player-controls-visible");

    // Set the DOM hidden flag too: stale/overridden CSS must not keep the
    // episode buttons visible or reserve space in web fullscreen.
    if (episodeNav) episodeNav.hidden = Boolean(enabled);

    if (enabled) {
      if (document.fullscreenElement === panel && document.exitFullscreen) {
        const exitResult = document.exitFullscreen();
        if (exitResult && typeof exitResult.catch === "function") exitResult.catch(() => {});
      }
      panel.classList.add("web-fullscreen");
      dialog.classList.add("player-web-fullscreen");
    } else {
      panel.classList.remove("web-fullscreen");
      dialog.classList.remove("player-web-fullscreen");
    }
    button.textContent = enabled ? "退出网页全屏" : "网页全屏";
    button.setAttribute("aria-pressed", enabled ? "true" : "false");
    if (closeButton) closeButton.textContent = enabled ? "退出全屏" : "收起";
  }

  function parseSeasonNumber(raw) {
    const value = String(raw || "");
    if (/^\d+$/.test(value)) return Number(value);
    const digits = {"零":0,"〇":0,"一":1,"二":2,"两":2,"三":3,"四":4,"五":5,"六":6,"七":7,"八":8,"九":9};
    let total = 0, current = 0;
    for (const ch of value) {
      if (ch === "十") { total += Math.max(current, 1) * 10; current = 0; }
      else if (ch === "百") { total += Math.max(current, 1) * 100; current = 0; }
      else current = digits[ch] || 0;
    }
    return total + current;
  }

  function normalizeSeasons(input) {
    const seasons = (Array.isArray(input) ? input : []).filter((season) => season && (season.series_id || season.seriesId)).map((season) => {
      let index = Number(season.index) || 0;
      if (index <= 0) {
        const re = /第\s*([0-9一二两三四五六七八九十百零〇]+)\s*[季部]/g;
        let match;
        let last = "";
        while ((match = re.exec(String(season.title || ""))) !== null) last = match[1];
        if (last) index = parseSeasonNumber(last);
      }
      return Object.assign({}, season, {series_id:String(season.series_id || season.seriesId), index});
    });
    const used = new Set();
    let missing = -1;
    let distinct = true;
    seasons.forEach((season, i) => {
      if (season.index <= 0 && missing === -1) missing = i;
      else if (season.index <= 0) distinct = false;
      else if (used.has(season.index)) distinct = false;
      used.add(season.index);
    });
    if (missing >= 0 && distinct && !used.has(1)) seasons[missing].index = 1;
    const seen = new Set();
    const sequential = seasons.every((season) => season.index > 0 && !seen.has(season.index) && (seen.add(season.index), true));
    if (sequential) seasons.sort((a, b) => a.index - b.index);
    else seasons.forEach((season, i) => { season.index = i + 1; });
    return seasons;
  }

  async function loadSeasonChoices(id, detailRequestID) {
    try {
      const album = await request("/api/v1/series/" + encodeURIComponent(id) + "/seasons");
      if (detailRequestID !== state.detailRequestId || state.playback.seriesId !== id) return;
      const seasons = normalizeSeasons(album.seasons || []);
      const section = $("#season-section");
      const list = $("#season-list");
      if (!section || !list) return;
      if (seasons.length <= 1) { section.hidden = true; return; }
      $("#season-count").textContent = seasons.length + " 季";
      list.innerHTML = seasons.map((season) => {
        const active = season.series_id === id;
        const episodeCount = Number(season.episode_count) || 0;
        const disabled = episodeCount <= 0;
        return '<button type="button" class="season-chip' + (active ? ' active' : '') +
          '" data-series-id="' + escapeHTML(season.series_id) + '" aria-pressed="' + (active ? "true" : "false") + '"' +
          (disabled ? ' disabled title="该季暂未上线或没有可用剧集"' : '') + '>第 ' + season.index + ' 季' +
          (episodeCount > 0 ? '<small>' + episodeCount + ' 集</small>' : '') + '</button>';
      }).join("");
      list.addEventListener("click", (event) => {
        const button = event.target.closest(".season-chip");
        if (!button || button.disabled || button.dataset.seriesId === id) return;
        openDetail(button.dataset.seriesId);
      });
    } catch (error) {
      if (detailRequestID !== state.detailRequestId || state.playback.seriesId !== id) return;
      const section = $("#season-section");
      const list = $("#season-list");
      if (!section || !list) return;
      $("#season-count").textContent = "载入失败";
      list.innerHTML = '<span class="season-load-error">季列表暂时载入失败</span><button id="season-retry" class="season-retry" type="button">重试</button>';
      $("#season-retry").addEventListener("click", () => loadSeasonChoices(id, detailRequestID));
      console.warn("[seasons] load failed", error);
    }
  }

  async function openDetail(id) {
    if (!id) return;
    const detailRequestID = ++state.detailRequestId;
    stopPlayback();
    const dialog = $("#detail-dialog");
    const body = $("#detail-content");
    body.innerHTML = '<div class="empty-state">正在载入剧集详情…</div>';
    if (!dialog.open) dialog.showModal();
    try {
      const detail = await request("/api/v1/series/" + encodeURIComponent(id) + "/detail");
      if (detailRequestID !== state.detailRequestId) return;
      const series = detail.series || {};
      const episodes = detail.episodes || [];
      const hasMultiSeason = !!(series.is_multi_season || series.related_album_id);
      const title = series.title || "贝小果短剧";
      const cover = safeImage(series.cover_url || series.coverUrl);
      const fav = state.favorites.some((entry) => entry.id === id);
      state.playback = {seriesId:id,seriesTitle:title,seriesCover:cover,seriesArtworkDataURL:"",episodes:episodes,index:-1,quality:"best",speed:1,requestId:0,temporaryBoost:false,prefetched:Object.create(null),prefetchPending:new Set(),prefetchFailed:Object.create(null),prefetchInFlight:false,preloadVideos:[]};
      body.innerHTML =
        '<div class="detail-hero">' +
        (cover ? '<img src="' + escapeHTML(cover) + '" alt="">' : '<div class="poster-placeholder detail-placeholder">贝</div>') +
        '<div class="detail-copy"><div class="detail-meta">' + escapeHTML(series.right_text || series.subtitles || "贝小果片库") + '</div>' +
        '<h2>' + escapeHTML(title) + '</h2>' +
        '<div class="detail-meta">' + escapeHTML(episodes.length + " 集") + '</div>' +
        '<p>' + escapeHTML(series.description || "暂无简介") + '</p>' +
        '<button id="favorite-toggle" class="load-more" type="button">' + (fav ? "♥ 已收藏" : "♡ 收藏这部剧") + '</button></div></div>' +
        '<section id="season-section" class="season-section"' + (hasMultiSeason ? "" : " hidden") + '><div class="season-header"><h3 class="season-heading">选择季数</h3><span id="season-count" class="detail-meta">' + (hasMultiSeason ? "正在载入…" : "") + '</span></div><div id="season-list" class="season-list">' + (hasMultiSeason ? '<span class="season-loading">正在载入全部季…</span>' : "") + '</div></section>' +
        '<section id="playback-panel" class="playback-panel" hidden>' +
        '<div class="player-toolbar"><span id="player-caption">正在准备播放…</span>' +
        '<label class="quality-control">画质 <select id="player-quality" aria-label="播放画质"><option value="best">自动</option></select></label>' +
        '<label class="quality-control">倍速 <select id="player-speed" aria-label="播放速度">' +
        '<option value="0.5">0.5×</option><option value="0.75">0.75×</option><option value="1" selected>1×</option>' +
        '<option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option>' +
        '<option value="2.5">2.5×</option><option value="3">3×</option></select></label>' +
        '' +
        '<button id="player-cast" class="player-action" type="button" title="投屏到 hongguoTV">投屏</button>' +
        '<button id="player-pip" class="player-action" type="button" hidden>画中画</button>' +
        '<button id="player-web-fullscreen" class="player-action" type="button" aria-pressed="false">网页全屏</button>' +
        '<button id="player-fullscreen" class="player-action" type="button">系统全屏</button>' +
        '<button id="player-close" class="player-close" type="button">收起</button></div>' +
        '<div id="player-stage" class="player-stage"><video id="web-player" controls playsinline webkit-playsinline disableRemotePlayback x-webkit-airplay="deny" preload="auto"></video><div id="player-preload-container" class="player-preload-container" aria-hidden="true"></div>' +
        '' +
        '</div>' +
        '<div class="player-nav"><button id="player-prev" type="button">上一集</button><button id="player-next" type="button">下一集</button></div>' +
        '<div id="playback-status" class="playback-status" role="status">选择集数开始播放</div></section>' +
        '<h3 class="episode-heading">选集</h3><div class="episode-grid">' +
        episodes.map((ep) => '<button class="episode-chip" type="button" data-episode-id="' + escapeHTML(ep.id) + '" data-episode-number="' + escapeHTML(ep.number || "") + '"' + (ep.playable === false ? ' disabled title="当前分集不可播放"' : '') + '>' + escapeHTML("第 " + (ep.number || "") + " 集") + '</button>').join("") +
        '</div><div class="player-note">支持 0.5–3 倍速、按住临时 2×、上下滑切集和自动连播。可直接播放的非受保护流由浏览器尝试播放；渐进式 MP4 CENC 受保护流由 Cloudflare 边缘函数按需 Range 解密。若播放失败，可打开 DEBUG 面板复制诊断包。电视接力需要家庭局域网内的 N1 或本地助手。</div>';

      const detailCoverImage = body.querySelector(".detail-hero img");
      if (detailCoverImage) {
        detailCoverImage.addEventListener("load", () => {
          if (state.playback.seriesId === id && state.playback.index >= 0) updateMediaSessionMetadata();
        }, {once:true});
      }
      if (hasMultiSeason) loadSeasonChoices(id, detailRequestID);
      $("#favorite-toggle").addEventListener("click", () => toggleFavorite(normalize(series)));
      body.querySelector(".episode-grid").addEventListener("click", (event) => {
        const button = event.target.closest(".episode-chip");
        if (!button || button.disabled) return;
        const index = episodes.findIndex((ep) => String(ep.id) === button.dataset.episodeId);
        if (index >= 0) playEpisodeAt(index);
      });
      $("#player-close").addEventListener("click", async () => {
        const panel = $("#playback-panel");
        const video = $("#web-player");
        if (isPlayerSystemFullscreen(panel, video)) {
          await exitPlayerSystemFullscreen(video).catch(() => {});
          syncSystemFullscreenButton();
          return;
        }
        if (panel.classList.contains("web-fullscreen")) {
          setPlayerWebFullscreen(false);
          return;
        }
        stopPlayback();
        panel.hidden = true;
      });
      $("#player-prev").addEventListener("click", () => changeEpisode(-1));
      $("#player-next").addEventListener("click", () => changeEpisode(1));
      $("#player-cast").addEventListener("click", openCastPicker);
      bindHoldToAccelerate($("#player-hold-speed"));
      bindHoldToAccelerate($("#pip-hold-speed"));
      $("#player-pip").addEventListener("click", togglePictureInPicture);
      syncPictureInPictureButton();
      $("#player-web-fullscreen").addEventListener("click", () => {
        const panel = $("#playback-panel");
        setPlayerWebFullscreen(!panel.classList.contains("web-fullscreen"));
      });
      $("#player-speed").addEventListener("change", (event) => {
        state.playback.speed = Number(event.target.value) || 1;
        $("#web-player").playbackRate = state.playback.temporaryBoost ? 2 : state.playback.speed;
        syncPlaybackStatus();
      });
      $("#player-quality").addEventListener("change", () => {
        const video = $("#web-player");
        const position = Number.isFinite(video.currentTime) ? video.currentTime : 0;
        startPlayback(state.playback.index, $("#player-quality").value, position);
      });
      const video = $("#web-player");
      video.addEventListener("loadedmetadata", () => debugWrite("info","player.media.metadata",mediaElementDiagnostics(video)));
      video.addEventListener("waiting", () => debugWrite("warn","player.media.waiting",mediaElementDiagnostics(video)));
      video.addEventListener("stalled", () => debugWrite("warn","player.media.stalled",mediaElementDiagnostics(video)));
      video.addEventListener("playing", () => {
        debugWrite("info","player.media.playing",mediaElementDiagnostics(video));
        setPlaybackActivity(true);
        syncPlaybackStatus("正在播放");
        setMediaSessionPlaybackState("playing");
      });
      video.addEventListener("pause", () => {
        if (!video.ended && String(video.currentSrc || "").includes("/api/v1/media/")) debugWrite("info","player.media.pause",mediaElementDiagnostics(video));
        endTemporaryBoost();
        setPlaybackActivity(false);
        syncPlaybackStatus();
        setMediaSessionPlaybackState("paused");
      });
      video.addEventListener("ratechange", () => {
        syncPlaybackStatus();
        updateMediaSessionPositionState();
      });
      video.addEventListener("timeupdate", updateMediaSessionPositionState);
      video.addEventListener("durationchange", updateMediaSessionPositionState);
      video.addEventListener("seeked", updateMediaSessionPositionState);
      video.addEventListener("ended", () => {
        endTemporaryBoost();
        setPlaybackActivity(false);
        setMediaSessionPlaybackState("paused");
      });
      video.addEventListener("error", () => {
        endTemporaryBoost();
        setPlaybackActivity(false);
        setMediaSessionPlaybackState("paused");
      });
      video.addEventListener("loadedmetadata", () => {
        syncPictureInPictureButton();
        updateMediaSessionPositionState();
      });
      video.addEventListener("enterpictureinpicture", () => { syncPictureInPictureButton(); syncPictureInPictureHoldButton(); });
      video.addEventListener("leavepictureinpicture", () => { endTemporaryBoost(); syncPictureInPictureButton(); syncPictureInPictureHoldButton(); });
      video.addEventListener("webkitpresentationmodechanged", () => { syncPictureInPictureButton(); syncPictureInPictureHoldButton(); });
      video.addEventListener("ended", () => {
        if (state.playback.index >= 0) {
          const next = findPlayableEpisode(state.playback.index, 1);
          if (next >= 0) {
            showToast("本集播放完毕，自动播放下一集");
            playEpisodeAt(next);
          } else {
            $("#playback-status").textContent = "本剧已播放完毕";
          }
        }
      });
      let touchStart = null;
      let touchMoved = false;
      let touchBoosted = false;
      let holdTimer = 0;
      const stage = $("#player-stage");
      const toolbar = $("#playback-panel .player-toolbar");
      stage.addEventListener("click", () => showFullscreenPlayerControls());
      toolbar.addEventListener("pointerdown", () => showFullscreenPlayerControls(5000));
      toolbar.addEventListener("focusin", () => showFullscreenPlayerControls(8000));
      stage.addEventListener("touchstart", (event) => {
        if (event.touches.length !== 1) return;
        const touch = event.touches[0];
        touchStart = {x:touch.clientX,y:touch.clientY};
        touchMoved = false;
        touchBoosted = false;
        window.clearTimeout(holdTimer);
        holdTimer = window.setTimeout(() => {
          if (touchStart && !touchMoved) touchBoosted = beginTemporaryBoost();
        }, 230);
      }, {passive:true});
      stage.addEventListener("touchmove", (event) => {
        if (!touchStart || !event.touches.length) return;
        const dx = event.touches[0].clientX - touchStart.x;
        const dy = event.touches[0].clientY - touchStart.y;
        if (Math.abs(dx) > 14 || Math.abs(dy) > 14) {
          touchMoved = true;
          window.clearTimeout(holdTimer);
          if (touchBoosted) endTemporaryBoost();
          touchBoosted = false;
        }
      }, {passive:true});
      stage.addEventListener("touchend", (event) => {
        window.clearTimeout(holdTimer);
        if (!touchStart || !event.changedTouches.length) return;
        const dx = event.changedTouches[0].clientX - touchStart.x;
        const dy = event.changedTouches[0].clientY - touchStart.y;
        const wasBoosted = touchBoosted;
        touchStart = null;
        touchBoosted = false;
        if (wasBoosted) {
          endTemporaryBoost();
          return;
        }
        if (!touchMoved) {
          showFullscreenPlayerControls();
          return;
        }
        if (Math.abs(dy) < 55 || Math.abs(dy) < Math.abs(dx) * 1.25) return;
        changeEpisode(dy < 0 ? 1 : -1);
      }, {passive:true});
      stage.addEventListener("touchcancel", () => {
        window.clearTimeout(holdTimer);
        touchStart = null;
        touchMoved = false;
        if (touchBoosted) endTemporaryBoost();
        touchBoosted = false;
      }, {passive:true});
      stage.addEventListener("contextmenu", (event) => event.preventDefault());
      const fullscreenVideo = $("#web-player");
      fullscreenVideo.addEventListener("webkitbeginfullscreen", syncSystemFullscreenButton);
      fullscreenVideo.addEventListener("webkitendfullscreen", syncSystemFullscreenButton);
      $("#player-fullscreen").addEventListener("click", togglePlayerSystemFullscreen);
      syncSystemFullscreenButton();
    } catch (error) {
      if (detailRequestID !== state.detailRequestId) return;
      body.innerHTML = '<div class="empty-state">' + escapeHTML(error.message || "详情载入失败") +
        '<div class="detail-retry-wrap"><button id="detail-retry" class="load-more" type="button">重试加载</button></div></div>';
      $("#detail-retry").addEventListener("click", () => openDetail(id));
    }
  }

  function findPlayableEpisode(from, direction) {
    const episodes = state.playback.episodes || [];
    for (let index = from + direction; index >= 0 && index < episodes.length; index += direction) {
      if (episodes[index] && episodes[index].playable !== false && episodes[index].id) return index;
    }
    return -1;
  }

  function changeEpisode(direction) {
    const index = findPlayableEpisode(state.playback.index, direction);
    if (index < 0) {
      showToast(direction > 0 ? "已经是最后一集" : "已经是第一集");
      return;
    }
    playEpisodeAt(index);
  }

  function validPrefetchedPlayback(playback, episodeId) {
    const entry = playback.prefetched && playback.prefetched[String(episodeId)];
    if (!entry || !entry.info || !entry.info.src) return null;
    const explicitExpiry = Number(entry.info.expires_at) * 1000;
    const expiry = explicitExpiry > 0 ? explicitExpiry : (Number(entry.fetchedAt) || 0) + 5 * 60 * 1000;
    if (expiry <= Date.now() + 30000) {
      delete playback.prefetched[String(episodeId)];
      debugWrite("warn", "playback.edge.prefetch.expired", {episodeId:String(episodeId)});
      return null;
    }
    return entry;
  }

  function removeBrowserPreload(episodeId) {
    const playback = state.playback;
    const entries = playback.preloadVideos || [];
    const index = entries.findIndex((entry) => String(entry.episodeId) === String(episodeId));
    if (index < 0) return;
    const entry = entries[index];
    entries.splice(index, 1);
    try {
      entry.video.pause();
      entry.video.removeAttribute("src");
      entry.video.load();
      entry.video.remove();
    } catch (_) {}
  }

  function clearBrowserPreloads() {
    const playback = state.playback;
    const entries = playback.preloadVideos || [];
    playback.preloadVideos = [];
    for (const entry of entries) {
      try {
        entry.video.pause();
        entry.video.removeAttribute("src");
        entry.video.load();
        entry.video.remove();
      } catch (_) {}
    }
  }

  function syncBrowserPreloads(currentIndex) {
    const playback = state.playback;
    const container = $("#player-preload-container");
    if (!container || currentIndex < 0) return;
    const wanted = [];
    let cursor = currentIndex;
    for (let count = 0; count < BROWSER_PRELOAD_COUNT; count++) {
      const index = findPlayableEpisode(cursor, 1);
      if (index < 0) break;
      cursor = index;
      const episode = playback.episodes[index];
      const entry = validPrefetchedPlayback(playback, episode.id);
      if (entry) wanted.push({index, episode, info:entry.info});
    }

    const keep = [];
    for (const target of wanted) {
      const old = (playback.preloadVideos || []).find((entry) =>
        entry.index === target.index && entry.src === target.info.src
      );
      if (old) {
        keep.push(old);
        continue;
      }
      const video = document.createElement("video");
      video.className = "bxg-preload-video";
      video.preload = "auto";
      video.muted = true;
      video.playsInline = true;
      video.disableRemotePlayback = true;
      video.setAttribute("aria-hidden", "true");
      video.setAttribute("tabindex", "-1");
      const episodeNumber = target.episode.number || target.index + 1;
      const entry = {
        index: target.index,
        episodeId: String(target.episode.id),
        src: target.info.src,
        video
      };
      video.addEventListener("loadeddata", () => {
        const bufferedEnd = video.buffered && video.buffered.length
          ? video.buffered.end(video.buffered.length - 1) : 0;
        debugWrite("info", "playback.browser.preload.ready", {
          episodeNumber, readyState:video.readyState, bufferedEndSeconds:Math.round(bufferedEnd * 10) / 10
        });
      }, {once:true});
      video.addEventListener("error", () => {
        debugWrite("warn", "playback.browser.preload.error", {
          episodeNumber, errorCode:video.error ? video.error.code : 0
        });
      }, {once:true});
      video.src = target.info.src;
      container.appendChild(video);
      video.load();
      debugWrite("info", "playback.browser.preload.start", {
        episodeNumber, protected:!!target.info.protected
      });
      keep.push(entry);
    }

    for (const old of playback.preloadVideos || []) {
      if (!keep.includes(old)) {
        try {
          old.video.pause();
          old.video.removeAttribute("src");
          old.video.load();
          old.video.remove();
        } catch (_) {}
      }
    }
    playback.preloadVideos = keep;
  }

  async function ensureEdgePlaybackPrefetch(currentIndex) {
    const playback = state.playback;
    if (!playback.seriesId || currentIndex < 0) return;
    if (playback.prefetchInFlight) return;
    const pending = playback.prefetchPending || (playback.prefetchPending = new Set());
    const failed = playback.prefetchFailed || (playback.prefetchFailed = Object.create(null));
    let readyAhead = 0;
    let pendingAhead = 0;
    const missing = [];
    for (let index = currentIndex + 1; index < playback.episodes.length; index++) {
      const episode = playback.episodes[index];
      if (!episode || episode.playable === false || !episode.id) continue;
      const id = String(episode.id);
      if (validPrefetchedPlayback(playback, id)) readyAhead++;
      else if (pending.has(id)) pendingAhead++;
      else if (!(Number(failed[id]) > Date.now())) missing.push(id);
    }
    const capacity = Math.max(0, EDGE_PREFETCH_COUNT - readyAhead - pendingAhead);
    const episodeIds = missing.slice(0, capacity);
    if (!episodeIds.length) {
      syncBrowserPreloads(currentIndex);
      return;
    }

    playback.prefetchInFlight = true;
    episodeIds.forEach((id) => pending.add(id));
    const seriesId = playback.seriesId;
    const startIndex = currentIndex;
    debugWrite("info", "playback.edge.prefetch.start", {
      episodeCount:episodeIds.length, browserPreloadCount:BROWSER_PRELOAD_COUNT, fromEpisode:currentIndex + 1
    });
    try {
      const result = await request("/api/v1/prefetch", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({episodeIds,quality:playback.quality || "best"})
      });
      if (state.playback !== playback || playback.seriesId !== seriesId) return;
      const returned = new Set();
      for (const item of Array.isArray(result.items) ? result.items : []) {
        const id = String(item && item.episodeId || "");
        if (!id) continue;
        returned.add(id);
        if (item.info && item.info.src) {
          playback.prefetched[id] = {info:item.info,fetchedAt:Date.now()};
        } else {
          failed[id] = Date.now() + (item.errorCode === "MEDIA_SECRET_REQUIRED" ? 5 * 60 * 1000 : 60 * 1000);
          debugWrite("warn", "playback.edge.prefetch.item-failed", {
            episodeId:id, code:item.errorCode || "", message:item.error || ""
          });
        }
      }
      for (const id of episodeIds) {
        pending.delete(id);
        if (!returned.has(id)) failed[id] = Date.now() + 60 * 1000;
      }
      debugWrite("info", "playback.edge.prefetch.ready", {
        requested:result.requested || episodeIds.length, ready:result.ready || 0
      });
      syncBrowserPreloads(playback.index);
    } catch (error) {
      if (state.playback === playback) {
        episodeIds.forEach((id) => {
          pending.delete(id);
          failed[id] = Date.now() + 30000;
        });
        debugWrite("warn", "playback.edge.prefetch.failed", {message:error.message || String(error)});
      }
    } finally {
      playback.prefetchInFlight = false;
      if (state.playback === playback && playback.index !== startIndex) {
        Promise.resolve().then(() => ensureEdgePlaybackPrefetch(playback.index));
      }
    }
  }

  function playEpisodeAt(index) {
    const episode = state.playback.episodes[index];
    if (!episode || episode.playable === false) return;
    state.playback.index = index;
    startPlayback(index, state.playback.quality, 0);
  }

  async function startPlayback(index, quality, resumeAt) {
    const playback = state.playback;
    const episode = playback.episodes[index];
    if (!episode || !episode.id) return;
    playback.index = index;
    updateMediaSessionMetadata();
    setMediaSessionPlaybackState("paused");
    const requestID = ++playback.requestId;
    const episodeNumber = episode.number || index + 1;
    const cachedPlayback = validPrefetchedPlayback(playback, episode.id);
    const panel = $("#playback-panel");
    const video = $("#web-player");
    const status = $("#playback-status");
    const caption = $("#player-caption");
    const qualitySelect = $("#player-quality");
    const speedSelect = $("#player-speed");
    panel.hidden = false;
    caption.textContent = playback.seriesTitle + " · 第 " + episodeNumber + " 集";
    status.textContent = "正在解析播放地址…";
    endTemporaryBoost();
    video.pause();
    video.removeAttribute("src");
    video.load();

    try {
      const chosen = quality || playback.quality || "best";
      const info = cachedPlayback ? cachedPlayback.info : await request("/api/v1/play/" + encodeURIComponent(episode.id) + "?quality=" + encodeURIComponent(chosen));
      if (cachedPlayback) debugWrite("info", "playback.edge.prefetch.used", {episodeNumber});
      if (requestID !== playback.requestId) return;
      if (info.protected && !info.src) {
        status.textContent = "当前后端返回了受保护标记，但没有返回边缘媒体地址。请将 Cloudflare 部署更新到仓库 main 的最新版本；若后端提示 MEDIA_SECRET_REQUIRED，再配置 BXG_MEDIA_SECRET（至少 32 个字符）。";
        return;
      }
      playback.quality = info.quality || chosen;
      qualitySelect.innerHTML = (info.available_qualities || []).map((item) =>
        '<option value="' + escapeHTML(item.label) + '">' + escapeHTML(item.label) + (item.codec ? " · " + escapeHTML(item.codec) : "") + '</option>'
      ).join("");
      if (!qualitySelect.options.length) qualitySelect.innerHTML = '<option value="best">自动</option>';
      qualitySelect.value = playback.quality;
      speedSelect.value = String(playback.speed || 1);

      status.textContent = "已取得 " + (info.quality || "自动") + " 播放流" +
        (info.protected ? " · 受保护流" : " · 直接视频流") + "。正在连接视频…";
      const target = Math.max(0, Number(resumeAt) || 0);
      if (target > 0) {
        video.addEventListener("loadedmetadata", () => {
          try { video.currentTime = Math.min(target, Math.max(0, video.duration - 1)); } catch (_) {}
        }, {once:true});
      }
      video.onerror = () => {
        const code = video.error ? video.error.code : 0;
        debugWrite("error","player.media.error",mediaElementDiagnostics(video));
        status.textContent = "浏览器无法播放此视频（媒体错误 " + code + "）。可尝试切换画质或使用其他浏览器。";
      };
      video.preload = "auto";
      video.src = info.src;
      video.load();
      video.addEventListener("loadedmetadata", () => {
        removeBrowserPreload(episode.id);
        syncBrowserPreloads(index);
      }, {once:true});
      video.playbackRate = playback.speed || 1;
      try {
        await video.play();
        if (requestID === playback.requestId) {
          syncPlaybackStatus("正在播放");
        }
      } catch (_) {
        if (requestID === playback.requestId) {
          status.textContent = "播放地址已就绪，点击视频播放键开始。";
          setMediaSessionPlaybackState("paused");
        }
      }
      updateEpisodeButtons();
      ensureEdgePlaybackPrefetch(index);
      syncBrowserPreloads(index);
    } catch (error) {
      if (requestID !== playback.requestId) return;
      status.textContent = error.message || "播放初始化失败";
      showToast(error.message || "播放初始化失败");
    }
  }

  function updateEpisodeButtons() {
    const playback = state.playback;
    const previous = $("#player-prev");
    const next = $("#player-next");
    if (previous) previous.disabled = findPlayableEpisode(playback.index, -1) < 0;
    if (next) next.disabled = findPlayableEpisode(playback.index, 1) < 0;
    document.querySelectorAll(".episode-chip").forEach((button) => {
      button.classList.toggle("playing", button.dataset.episodeId === String(playback.episodes[playback.index]?.id || ""));
    });
  }

  async function openCastPicker() {
    const playback = state.playback;
    const episode = playback.episodes[playback.index];
    if (!episode || !playback.seriesId) {
      showToast("请先播放一集，再投屏到电视");
      return;
    }
    const dialog = $("#cast-dialog");
    const content = $("#cast-dialog-content");
    content.innerHTML = '<div class="empty-state">正在检查投屏支持…</div>';
    if (!dialog.open) dialog.showModal();
    try {
      const result = await request("/api/v1/tv/devices");
      const devices = result.devices || [];
      if (!devices.length) {
        content.innerHTML = '<div class="cast-empty">Cloudflare 轻量版无法从公共边缘节点发现家庭局域网电视。此功能需要原版 N1 或本地局域网助手。</div>';
        return;
      }
      content.innerHTML = devices.map((device) =>
        '<button type="button" class="cast-device" data-device-id="' + escapeHTML(device.device_id) + '">' +
        '<span class="cast-tv-icon">▣</span><span><strong>' + escapeHTML(device.name || "hongguoTV") + '</strong>' +
        '<small>' + escapeHTML([device.manufacturer,device.model,device.code ? "编号 " + device.code : ""].filter(Boolean).join(" · ")) + '</small></span><span class="cast-chevron">›</span></button>'
      ).join("");
      content.querySelectorAll(".cast-device").forEach((button) => {
        button.addEventListener("click", async () => {
          content.querySelectorAll("button").forEach((item) => { item.disabled = true; });
          button.classList.add("sending");
          const position = Math.max(0, Number($("#web-player").currentTime) || 0);
          try {
            const reply = await request("/api/v1/tv/handoff", {
              method:"POST",
              headers:{"Content-Type":"application/json"},
              body:JSON.stringify({
                device_id:button.dataset.deviceId,
                series_id:playback.seriesId,
                episode:Number(episode.number) || playback.index + 1,
                position_ms:Math.round(position * 1000)
              })
            });
            if (reply.accepted) {
              $("#web-player").pause();
              showToast("已交给 " + (reply.device_name || "电视") + " 播放");
              dialog.close();
            } else {
              button.disabled = false;
              showToast(reply.message || "电视没有接受播放任务");
            }
          } catch (error) {
            button.disabled = false;
            showToast(error.message || "投屏失败");
          }
        });
      });
    } catch (error) {
      content.innerHTML = '<div class="cast-empty">' + escapeHTML(error.message || "电视搜索失败") + '</div>';
    }
  }

  function toggleFavorite(item) {
    const index = state.favorites.findIndex((entry) => entry.id === item.id);
    if (index >= 0) {
      state.favorites.splice(index, 1);
      showToast("已从收藏移除");
    } else {
      state.favorites.unshift(item);
      showToast("已加入收藏");
    }
    saveFavorites();
    if ($("#detail-dialog").open) {
      const button = $("#favorite-toggle");
      if (button) button.textContent = state.favorites.some((entry) => entry.id === item.id) ? "♥ 已收藏" : "♡ 收藏这部剧";
    }
    if (state.view === "mine") renderCards(state.favorites);
  }

  document.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => loadView(button.dataset.view, false));
  });
  $("#search-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!$("#search-input").value.trim()) return;
    saveActiveView();
    state.searchType = "all";
    loadView("search", false, true);
  });
  $("#refresh-button").addEventListener("click", () => loadView(state.view, false, true));
  $("#load-more").addEventListener("click", () => loadView(state.view, true));
  $("#filter-tags").addEventListener("click", (event) => {
    const button = event.target.closest(".filter-tag");
    if (!button) return;
    const kind = button.dataset.filterKind;
    const value = button.dataset.filterValue;
    if (!kind || value == null) return;
    const changing =
      (kind === "channel" && value !== state.discoverChannel) ||
      (kind === "search-type" && value !== state.searchType) ||
      (kind === "rank-content" && value !== state.rankContent) ||
      (kind === "rank-board" && value !== state.rankBoard) ||
      (kind === "new-date" && value !== state.newDate);
    if (changing) saveActiveView();
    if (kind === "channel" && value !== state.discoverChannel) {
      state.discoverChannel = value;
      loadView("discover", false, true);
    } else if (kind === "search-type" && value !== state.searchType) {
      state.searchType = value;
      loadView("search", false, true);
    } else if (kind === "rank-content" && value !== state.rankContent) {
      state.rankContent = value;
      state.rankBoard = "";
      loadView("rank", false, true);
    } else if (kind === "rank-board" && value !== state.rankBoard) {
      state.rankBoard = value;
      loadView("rank", false, true);
    } else if (kind === "new-date" && value !== state.newDate) {
      state.newDate = value;
      loadView("new", false, true);
    }
  });
  window.addEventListener("scroll", () => {
    if (state.autoLoadScheduled) return;
    state.autoLoadScheduled = true;
    window.requestAnimationFrame(() => {
      state.autoLoadScheduled = false;
      maybeAutoLoadMore();
    });
  }, {passive:true});
  window.addEventListener("resize", maybeAutoLoadMore, {passive:true});
  $("#series-grid").addEventListener("error", handleGridImageError, true);
  $("#series-grid").addEventListener("click", (event) => {
    const card = event.target.closest(".series-card");
    if (card) openDetail(card.dataset.id);
  });
  $("#series-grid").addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const card = event.target.closest(".series-card");
    if (card) {
      event.preventDefault();
      openDetail(card.dataset.id);
    }
  });
  $("#dialog-close").addEventListener("click", () => $("#detail-dialog").close());
  $("#detail-dialog").addEventListener("close", () => {
    stopPlayback();
    setPlayerWebFullscreen(false);
  });
  $("#detail-dialog").addEventListener("cancel", (event) => {
    const dialog = $("#detail-dialog");
    if (!dialog.classList.contains("player-web-fullscreen")) return;
    event.preventDefault();
    setPlayerWebFullscreen(false);
  });
  document.addEventListener("fullscreenchange", syncSystemFullscreenButton);
  document.addEventListener("webkitfullscreenchange", syncSystemFullscreenButton);
  $("#detail-dialog").addEventListener("click", (event) => {
    if (event.target === $("#detail-dialog")) $("#detail-dialog").close();
  });
  $("#install-dialog-close").addEventListener("click", () => $("#install-dialog").close());
  $("#install-dialog").addEventListener("click", (event) => {
    if (event.target === $("#install-dialog")) $("#install-dialog").close();
  });
  setupInstallPrompt();
  installMediaSessionActionHandlers();
  bindHoldToAccelerate($("#pip-hold-speed"));
  document.addEventListener("visibilitychange", syncPictureInPictureHoldButton);
  window.addEventListener("focus", syncPictureInPictureHoldButton);
  window.addEventListener("blur", endTemporaryBoost);
  document.addEventListener("fullscreenchange", () => {
    if (document.fullscreenElement) endTemporaryBoost();
  });
  $("#cast-dialog-close").addEventListener("click", () => $("#cast-dialog").close());
  $("#route-button").addEventListener("click", () => {
    renderRouteDialog();
    if (!$("#route-dialog").open) $("#route-dialog").showModal();
  });
  $("#route-dialog-close").addEventListener("click", () => $("#route-dialog").close());
  $("#route-dialog").addEventListener("click", (event) => {
    if (event.target === $("#route-dialog")) $("#route-dialog").close();
  });
  $("#route-list").addEventListener("change", (event) => {
    const input = event.target;
    if (input && input.name === "active-route") selectRoute(input.value);
  });
  $("#route-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-route]");
    if (button) removeRoute(button.dataset.removeRoute);
  });
  $("#route-add-form").addEventListener("submit", addRouteFromForm);
  $("#route-copy-guide").addEventListener("click", copyRouteRuleGuide);
  $("#settings-button").addEventListener("click", openSettings);
  $("#debug-log-button").addEventListener("click", openDebugPanel);
  $("#debug-dialog-close").addEventListener("click", () => $("#debug-dialog").close());
  $("#debug-dialog").addEventListener("click", (event) => {
    if (event.target === $("#debug-dialog")) $("#debug-dialog").close();
  });
  $("#debug-refresh").addEventListener("click", refreshDebugPanel);
  $("#debug-copy").addEventListener("click", async () => {
    const payload = JSON.stringify(debugBundle(), null, 2);
    try {
      await navigator.clipboard.writeText(payload);
      showToast("完整诊断包已复制");
    } catch (_) {
      const field = document.createElement("textarea");
      field.value = payload;
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.appendChild(field);
      field.select();
      try { document.execCommand("copy"); showToast("完整诊断包已复制"); }
      catch (error) { showToast("复制失败，请手动选中日志"); }
      field.remove();
    }
  });
  $("#debug-clear").addEventListener("click", async () => {
    try { await request("/api/v1/debug/logs", {method:"DELETE"}); } catch (_) {}
    debugEntries = [];
    serverDebugEntries = [];
    serverDebugRuntime = null;
    try { localStorage.removeItem(DEBUG_STORAGE_KEY); } catch (_) {}
    debugWrite("info", "debug.logs.cleared");
    renderDebugPanel();
  });
  window.addEventListener("error", (event) => {
    const target = event.target;
    if (target && target.tagName === "IMG") {
      let host = "";
      try { host = new URL(target.currentSrc || target.src).hostname; } catch (_) {}
      debugWrite("warn", "image.resource.error", {host});
      return;
    }
    debugWrite("error", "window.error", {
      message:event.message || "未知脚本错误",
      source:event.filename || "",
      line:event.lineno || 0,
      column:event.colno || 0
    });
  }, true);
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    debugWrite("error", "window.unhandledrejection", {
      message:reason && reason.message ? reason.message : String(reason),
      stack:reason && reason.stack ? String(reason.stack).split("\\n").slice(0, 5).join(" | ") : ""
    });
  });
  $("#settings-close").addEventListener("click", () => {
    $("#settings-dialog").close();
    window.clearInterval(settingsRefreshTimer);
  });
  $("#settings-dialog").addEventListener("close", () => window.clearInterval(settingsRefreshTimer));
  $("#settings-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = $("#settings-form button[type='submit']");
    submit.disabled = true;
    try {
      await request("/api/v1/settings", {
        method:"PUT",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify(readSettingsForm())
      });
      await refreshSettings(true);
      showToast("设置已保存并立即生效");
    } catch (error) {
      showToast(error.message || "保存设置失败");
    } finally {
      submit.disabled = false;
    }
  });
  $("#preheat-now").addEventListener("click", async () => {
    const button = $("#preheat-now");
    button.disabled = true;
    try {
      await request("/api/v1/preheat/run", {method:"POST"});
      showToast("已提交立即预热任务");
      await refreshSettings();
    } catch (error) {
      showToast(error.message || "启动预热失败");
    } finally {
      button.disabled = false;
    }
  });
  window.addEventListener("pagehide", () => setPlaybackActivity(false));

  const savedRoute = getActiveRoute();
  if (savedRoute && !usesCloudflareManagedHostname()) {
    announceActiveRoute(savedRoute.ip, true).finally(() => loadView("discover", false));
  } else {
    if (savedRoute && usesCloudflareManagedHostname()) {
      renderRouteStatus("自选 IP 已保存在本机；当前默认域名不支持动态 Alt-Svc 规则。", "warn");
    }
    loadView("discover", false);
  }
})();
