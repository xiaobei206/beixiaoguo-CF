import "../node_modules/openhongguo/dist/wasm_exec.js";
import cencModule from "../node_modules/openhongguo/dist/cenc.wasm";

let cencRuntimePromise;

export async function ensureCencRuntime(fetchRange) {
  if (typeof fetchRange !== "function") throw new Error("CENC range callback is required");
  if (typeof globalThis.__BXG_CENC_FETCH_RANGE !== "function") {
    globalThis.__BXG_CENC_FETCH_RANGE = fetchRange;
  }
  if (!cencRuntimePromise) {
    cencRuntimePromise = (async () => {
      if (typeof globalThis.Go !== "function") throw new Error("Go WebAssembly runtime is unavailable");
      if (!(cencModule instanceof WebAssembly.Module)) throw new Error("CENC Wasm was not loaded as a compiled module");
      const go = new globalThis.Go();
      let resolveReady;
      let rejectReady;
      let readyTimer;
      const ready = new Promise((resolve, reject) => {
        resolveReady = resolve;
        rejectReady = reject;
        readyTimer = setTimeout(() => reject(new Error("CENC WebAssembly API readiness timed out")), 5000);
      });
      globalThis.__BXG_CENC_READY_CALLBACK = () => {
        if (readyTimer) clearTimeout(readyTimer);
        resolveReady();
      };
      try {
        const result = await WebAssembly.instantiate(cencModule, go.importObject);
        const running = go.run(result.instance);
        running.catch((error) => {
          const message = String(error?.message || error);
          globalThis.__BXG_CENC_RUNTIME_ERROR = message;
          if (readyTimer) clearTimeout(readyTimer);
          rejectReady(new Error(message));
        });
        await ready;
        const api = globalThis.__BXG_CENC;
        if (!api || typeof api.open !== "function" || typeof api.decrypt !== "function" || typeof api.ping !== "function") {
          throw new Error("CENC WebAssembly did not expose its API after Go main reported ready");
        }
        globalThis.__BXG_CENC_GO = go;
        return api;
      } finally {
        if (readyTimer) clearTimeout(readyTimer);
        delete globalThis.__BXG_CENC_READY_CALLBACK;
      }
    })().catch((error) => {
      cencRuntimePromise = null;
      throw error;
    });
  }
  return cencRuntimePromise;
}
