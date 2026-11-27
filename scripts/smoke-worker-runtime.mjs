import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const port = 8798;
const base = `http://127.0.0.1:${port}`;
const child = spawn("npx", [
  "--yes", "wrangler@latest", "dev",
  "--config", "wrangler.worker.jsonc",
  "--var", "BXG_SMOKE_TEST:1",
  "--ip", "127.0.0.1", "--port", String(port)
], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, detached: process.platform !== "win32" });

let output = "";
child.stdout.on("data", chunk => { output += chunk.toString(); });
child.stderr.on("data", chunk => { output += chunk.toString(); });

function withTimeout(promise, milliseconds, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label)), milliseconds);
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); }
    );
  });
}

async function fetchResponse(path, milliseconds, label) {
  return withTimeout(fetch(base + path), milliseconds, label);
}

try {
  let homepage = null;
  for (let attempt = 0; attempt < 20; attempt++) {
    if (child.exitCode !== null) {
      throw new Error("Wrangler Workers dev exited early.\n" + output.slice(-12000));
    }
    await delay(500);
    try {
      homepage = await fetchResponse("/", 1500, "Worker homepage timed out.\n" + output.slice(-12000));
      break;
    } catch (error) {
      if (String(error.message || error).includes("Worker homepage timed out")) throw error;
    }
  }
  if (!homepage) throw new Error("Worker did not become ready.\n" + output.slice(-12000));
  assert.equal(homepage.status, 200);
  assert.match(await homepage.text(), /贝小果 Lite/);

  const basicHealth = await fetchResponse("/api/v1/health", 2500, "Worker health request timed out.\n" + output.slice(-12000));
  const basicBody = await basicHealth.json();
  assert.equal(basicHealth.status, 200);
  assert.equal(basicBody.status, "ok");
  assert.equal(basicBody.runtime, "Cloudflare Workers");
  const healthTraceId = basicHealth.headers.get("X-BXG-Trace-ID");
  const healthTrace = basicHealth.headers.get("X-BXG-Debug");
  assert.ok(healthTraceId, "API response did not expose a per-request trace ID");
  assert.ok(healthTrace, "API response did not expose a per-request edge trace");
  assert.equal(JSON.parse(decodeURIComponent(healthTrace)).traceId, healthTraceId);

  const unsafeImageUrl = encodeURIComponent("http://127.0.0.1/private");
  const imageReject = await fetchResponse(
    "/api/v1/images?url=" + unsafeImageUrl,
    2500,
    "Worker image-proxy validation timed out.\\n" + output.slice(-12000)
  );
  const imageRejectBody = await imageReject.json();
  assert.equal(imageReject.status, 400);
  assert.equal(imageRejectBody.error.code, "IMAGE_URL_REJECTED");
  assert.ok(imageReject.headers.get("X-BXG-Trace-ID"), "Image proxy rejection did not include a trace ID");

  const sdkResponse = await fetchResponse(
    "/api/v1/health?sdk=1",
    8000,
    "Worker SDK initialization timed out.\n" + output.slice(-12000)
  );
  const sdkBody = await sdkResponse.json();
  assert.equal(sdkResponse.status, 200);
  assert.equal(sdkBody.sdk, "ready", "openhongguo WASM SDK did not initialize in Workers runtime");
  assert.equal(sdkBody.sdkBuild.repository, "xiaobei206/openhongguo");
  assert.match(sdkBody.sdkBuild.commit, /^[a-f0-9]{40}$/);
  assert.equal(sdkBody.sdkBuild.playbackFallback, "video_tab");
  assert.equal(sdkBody.sdkBuild.deviceActivation, true);
  assert.equal(sdkBody.sdkBuild.deviceHeartbeat, true);
  assert.equal(sdkBody.sdkBuild.serverIssuedEGDI, true);

  const probeResponse = await fetchResponse(
    "/api/v1/health?sdk=probe",
    10000,
    "Worker Go/WASM callback probe timed out.\\n" + output.slice(-12000)
  );
  const probeBody = await probeResponse.json();
  assert.equal(probeResponse.status, 200, "Worker Go/WASM callback probe failed: " + JSON.stringify(probeBody));
  assert.equal(probeBody.goCallbacks, "ok", "Worker did not complete Go-to-JavaScript callbacks");
  assert.ok(probeBody.transportCalls >= 2, "Worker did not invoke the mock transport twice on one Go runtime");
  assert.equal(probeBody.wasm.exited, false, "Worker Go/WASM runtime exited during the probe");
  console.log("Cloudflare Workers runtime smoke test passed.");
  console.log("Static assets, WASM initialization, and repeated Go-to-JavaScript callbacks passed.");
} finally {
  const killProcessGroup = signal => {
    try {
      if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal);
      else child.kill(signal);
    } catch (_) {
      // The process or process group may already have exited.
    }
  };
  const exited = () => new Promise(resolve => {
    if (child.exitCode !== null || child.signalCode !== null) resolve();
    else child.once("exit", resolve);
  });
  killProcessGroup("SIGTERM");
  await Promise.race([exited(), delay(1500)]);
  killProcessGroup("SIGKILL");
  await Promise.race([exited(), delay(1000)]);
}
