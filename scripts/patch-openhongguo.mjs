import { readFile, writeFile } from "node:fs/promises";

const path = "node_modules/openhongguo/index.js";
let source = await readFile(path, "utf8");
const requireLine = "require(join(here, 'dist', 'wasm_exec.js')); // 定义 globalThis.Go";
const loadRuntimeLine = "function loadRuntime() {";
const patchedLoadRuntime = `function loadRuntime() {
  // Recreate the Go runtime if the edge isolate reports that its previous
  // WASM program exited between requests.
  if (globalThis.__BXG_OPENHONGGUO_GO?.exited) {
    runtime = undefined;
    delete globalThis.__openhongguo;
  }`;
const runtimeLine = "const go = new globalThis.Go();";
const patchedRuntime = `const go = new globalThis.Go();
    globalThis.__BXG_OPENHONGGUO_GO = go;
    globalThis.__BXG_OPENHONGGUO_GENERATION = (Number(globalThis.__BXG_OPENHONGGUO_GENERATION) || 0) + 1;
    globalThis.__BXG_OPENHONGGUO_STATE = { generation: globalThis.__BXG_OPENHONGGUO_GENERATION, startedAt: Date.now(), exited: false, error: "" };`;
const runLine = "go.run(instance); // Go 的 main 一直挂起，不会返回";
const patchedRun = `const runPromise = go.run(instance);
    Promise.resolve(runPromise).then(() => {
      if (globalThis.__BXG_OPENHONGGUO_GO === go) {
        globalThis.__BXG_OPENHONGGUO_STATE = { generation: globalThis.__BXG_OPENHONGGUO_GENERATION, startedAt: globalThis.__BXG_OPENHONGGUO_STATE?.startedAt || Date.now(), exited: true, exitedAt: Date.now(), error: "" };
      }
    }, (error) => {
      if (globalThis.__BXG_OPENHONGGUO_GO === go) {
        globalThis.__BXG_OPENHONGGUO_STATE = { generation: globalThis.__BXG_OPENHONGGUO_GENERATION, startedAt: globalThis.__BXG_OPENHONGGUO_STATE?.startedAt || Date.now(), exited: true, exitedAt: Date.now(), error: String(error?.message || error).slice(0, 240) };
      }
    });`;
const patchedRequire = "if (!globalThis.Go) require(join(here, 'dist', 'wasm_exec.js')); // Pages imports wasm_exec.js statically; Node keeps the fallback";
const wasmLine = "const bytes = await readFile(join(here, 'dist', 'openhongguo.wasm'));";
const patchedWasm = "const bytes = globalThis.__BXG_OPENHONGGUO_WASM ?? await readFile(join(here, 'dist', 'openhongguo.wasm'));";
const instantiateLine = "const { instance } = await WebAssembly.instantiate(bytes, go.importObject);";
const patchedInstantiate = "const instantiated = await WebAssembly.instantiate(bytes, go.importObject);\n    const instance = instantiated instanceof WebAssembly.Instance ? instantiated : instantiated.instance;";

let changed = false;
for (const [original, replacement, description] of [
  [requireLine, patchedRequire, "wasm_exec loader"],
  [loadRuntimeLine, patchedLoadRuntime, "Go runtime recovery"],
  [runtimeLine, patchedRuntime, "Go runtime diagnostics"],
  [runLine, patchedRun, "Go runtime exit monitor"],
  [wasmLine, patchedWasm, "WASM binary loader"],
  [instantiateLine, patchedInstantiate, "WASM instantiation result"]
]) {
  if (source.includes(original)) {
    source = source.replace(original, replacement);
    changed = true;
  } else if (!source.includes(replacement)) {
    throw new Error("openhongguo " + description + " changed; refusing to patch an unknown SDK version.");
  }
}
if (changed) await writeFile(path, source, "utf8");
console.log(changed ? "Patched openhongguo WASM loader for Pages Functions." : "openhongguo WASM loader already patched.");
