import "../node_modules/openhongguo/dist/wasm_exec.js";
import wasmBytes from "../node_modules/openhongguo/dist/openhongguo.wasm";

// The Node SDK expects to read these files via Node's filesystem and require().
// The Pages bundle statically imports them instead, avoiding dynamic module lookup
// and providing the binary directly without filesystem access in the edge runtime.
if (typeof globalThis.Go !== "function") {
  throw new Error("openhongguo: wasm_exec.js did not initialize globalThis.Go");
}
const wasm = wasmBytes instanceof ArrayBuffer
  ? new Uint8Array(wasmBytes)
  : ArrayBuffer.isView(wasmBytes)
    ? new Uint8Array(wasmBytes.buffer, wasmBytes.byteOffset, wasmBytes.byteLength)
    : new Uint8Array(wasmBytes);
globalThis.__BXG_OPENHONGGUO_WASM = wasm;
