import "../node_modules/openhongguo/dist/wasm_exec.js";
import wasmModule from "../node_modules/openhongguo/dist/openhongguo.wasm";

// Cloudflare's CompiledWasm loader provides a precompiled WebAssembly.Module.
// The Node SDK's default file-based loader is patched during build to use this.
if (typeof globalThis.Go !== "function") {
  throw new Error("openhongguo: wasm_exec.js did not initialize globalThis.Go");
}
if (!(wasmModule instanceof WebAssembly.Module)) {
  throw new Error("openhongguo: Cloudflare did not load the Wasm as a precompiled module");
}
globalThis.__BXG_OPENHONGGUO_WASM = wasmModule;
