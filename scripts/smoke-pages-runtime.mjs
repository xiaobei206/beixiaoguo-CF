import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const port = 8799;
const base = `http://127.0.0.1:${port}`;
const child = spawn("npx", [
  "--yes", "wrangler@latest", "pages", "dev", "public",
  "--ip", "127.0.0.1", "--port", String(port)
], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });

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

async function requestJson(path, milliseconds, label) {
  return withTimeout(
    fetch(base + path).then(async response => ({ response, body: await response.json() })),
    milliseconds,
    label
  );
}

let basicHealth = null;
try {
  for (let attempt = 0; attempt < 30; attempt++) {
    if (child.exitCode !== null) {
      throw new Error("Wrangler Pages dev exited early.\n" + output.slice(-12000));
    }
    await delay(500);
    try {
      basicHealth = await requestJson("/api/v1/health", 1500, "Basic Pages health request timed out.\n" + output.slice(-12000));
      break;
    } catch (error) {
      if (String(error.message || error).includes("Basic Pages health request timed out")) throw error;
    }
  }
  if (!basicHealth) throw new Error("Pages Functions did not become ready.\n" + output.slice(-12000));
  assert.equal(basicHealth.response.status, 200);
  assert.equal(basicHealth.body.status, "ok");
  assert.equal(basicHealth.body.runtime, "Cloudflare Pages Functions");

  let sdkHealth;
  try {
    sdkHealth = await requestJson(
      "/api/v1/health?sdk=1",
      8000,
      "Pages Function did not return within 8 seconds while initializing the WASM SDK.\n" + output.slice(-12000)
    );
  } catch (error) {
    throw new Error(String(error.message || error) + "\nWrangler output:\n" + output.slice(-12000));
  }
  if (!sdkHealth.response.ok) {
    throw new Error("WASM SDK health endpoint returned HTTP " + sdkHealth.response.status + ": " +
      JSON.stringify(sdkHealth.body) + "\nWrangler output:\n" + output.slice(-12000));
  }
  assert.equal(sdkHealth.body.sdk, "ready", "openhongguo WASM SDK did not initialize in the Pages runtime");
  console.log("Pages Functions runtime smoke test passed.");
  console.log("WASM SDK initialized successfully without issuing upstream requests.");
} finally {
  if (child.exitCode === null) {
    child.kill("SIGTERM");
    await Promise.race([
      new Promise(resolve => child.once("exit", resolve)),
      delay(3000)
    ]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
}
