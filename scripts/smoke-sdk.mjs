import assert from "node:assert/strict";
import { createClient, memoryProfileStore } from "openhongguo";

const transport = async () => { throw new Error("smoke test must not call upstream network"); };
const client = await createClient({
  profile: memoryProfileStore(), transport, retryAttempts: 1, deviceResets: 0
});
assert.equal(typeof client.discover, "function");
assert.equal(typeof client.search, "function");
assert.equal(typeof client.resolvePlayback, "function");
console.log("openhongguo WASM SDK 初始化通过（未调用上游网络）。");
