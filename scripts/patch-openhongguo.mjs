import { readFile, writeFile } from "node:fs/promises";

const path = "node_modules/openhongguo/index.js";
let source = await readFile(path, "utf8");
const requireLine = "require(join(here, 'dist', 'wasm_exec.js')); // 定义 globalThis.Go";
const patchedRequire = "if (!globalThis.Go) require(join(here, 'dist', 'wasm_exec.js')); // Pages imports wasm_exec.js statically; Node keeps the fallback";
const wasmLine = "const bytes = await readFile(join(here, 'dist', 'openhongguo.wasm'));";
const patchedWasm = "const bytes = globalThis.__BXG_OPENHONGGUO_WASM ?? await readFile(join(here, 'dist', 'openhongguo.wasm'));";
const instantiateLine = "const { instance } = await WebAssembly.instantiate(bytes, go.importObject);";
const patchedInstantiate = "const instantiated = await WebAssembly.instantiate(bytes, go.importObject);\n    const instance = instantiated instanceof WebAssembly.Instance ? instantiated : instantiated.instance;";

let changed = false;
for (const [original, replacement, description] of [
  [requireLine, patchedRequire, "wasm_exec loader"],
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
