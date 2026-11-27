import assert from "node:assert/strict";
import { createClient, memoryProfileStore } from "openhongguo";

let transportCalls = 0;
const transport = async () => {
  transportCalls++;
  throw new Error("BXG_NODE_WASM_PROBE");
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
// The SDK wraps transport errors, so assert callback count and the absence
// of the Go-exited error rather than expecting the original JS message.
for (let i = 0; i < 2; i++) {
  await assert.rejects(
    client.discover({ channel: "推荐" }),
    (error) => {
      assert.doesNotMatch(String(error?.message || error), /Go program has already exited/i);
      return true;
    }
  );
  assert.ok(transportCalls >= i + 1, "SDK did not invoke the mock JavaScript transport on call " + (i + 1));
}
assert.ok(transportCalls >= 2, "SDK did not invoke the mock JavaScript transport twice");
console.log("openhongguo WASM 连续调用测试通过：同一 Go runtime 完成两次 JS transport 回调。");
