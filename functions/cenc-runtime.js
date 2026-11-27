import "../node_modules/openhongguo/dist/wasm_exec.js";
import cencModule from "../node_modules/openhongguo/dist/cenc.wasm";
let runtimePromise;
export async function ensureCencRuntime(fetchRange) {
  if(typeof fetchRange!=="function") throw new Error("CENC range callback is required");
  if(typeof globalThis.__BXG_CENC_FETCH_RANGE!=="function") globalThis.__BXG_CENC_FETCH_RANGE=fetchRange;
  if(!runtimePromise) {
    runtimePromise=(async()=>{
      if(typeof globalThis.Go!=="function") throw new Error("Go WebAssembly runtime is unavailable");
      if(!(cencModule instanceof WebAssembly.Module)) throw new Error("CENC Wasm was not loaded as a compiled module");
      const go=new globalThis.Go();
      const result=await WebAssembly.instantiate(cencModule,go.importObject);
      const running=go.run(result.instance);
      running.catch((error)=>{globalThis.__BXG_CENC_RUNTIME_ERROR=String(error?.message||error);});
      const api=globalThis.__BXG_CENC;
      if(!api||typeof api.open!=="function"||typeof api.decrypt!=="function"||typeof api.ping!=="function") throw new Error("CENC WebAssembly did not expose its API");
      globalThis.__BXG_CENC_GO=go;
      return api;
    })().catch((error)=>{runtimePromise=null;throw error;});
  }
  return runtimePromise;
}
