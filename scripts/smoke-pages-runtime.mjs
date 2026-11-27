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
let result = null;
try {
  for (let attempt = 0; attempt < 90; attempt++) {
    if (child.exitCode !== null) {
      throw new Error("Wrangler Pages dev exited early.\n" + output.slice(-12000));
    }
    await delay(500);
    try {
      const response = await fetch(base + "/api/v1/health?sdk=1");
      const body = await response.json();
      if (!response.ok) {
        throw new Error("Health endpoint returned HTTP " + response.status + ": " + JSON.stringify(body) + "\n" + output.slice(-12000));
      }
      result = body;
      break;
    } catch (error) {
      if (String(error.message || error).includes("Health endpoint returned")) throw error;
    }
  }
  if (!result) throw new Error("Pages Functions did not become ready.\n" + output.slice(-12000));
  assert.equal(result.status, "ok");
  assert.equal(result.runtime, "Cloudflare Pages Functions");
  assert.equal(result.sdk, "ready", "openhongguo WASM SDK did not initialize in the Pages runtime");
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
