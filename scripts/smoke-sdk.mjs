import assert from "node:assert/strict";
import { createClient, memoryProfileStore } from "openhongguo";

let transportCalls = 0;
const sentinel = "BXG_NODE_WASM_PROBE";
const transport = async () => {
  transportCalls++;
  throw new Error(sentinel);
};
const client = await createClient({
  profile: memoryProfileStore(),
  transport,
  retryAttempts: 1,
  deviceResets: 0
});
assert.equal(typeof client.discover, "function");
assert.equal(typeof client.search, "function");
assert.equal(typeof client.resolvePlayback, "function");

// Exercise Go -> JavaScript Promise callbacks twice on the same Go runtime.
// Merely creating the client does not prove that the wasm event loop remains alive.
for (let i = 0; i < 2; i++) {
  await assert.rejects(
    client.discover({ channel: "推荐" }),
    (error) => {
      assert.match(String(error?.message || error), new RegExp(sentinel));
      assert.doesNotMatch(String(error?.message || error), /Go program has already exited/i);
      return true;
    }
  );
}
assert.ok(transportCalls >= 2, "SDK did not invoke the mock JavaScript transport twice");
console.log("openhongguo WASM 连续调用测试通过：同一 Go runtime 完成两次 JS transport 回调。");
