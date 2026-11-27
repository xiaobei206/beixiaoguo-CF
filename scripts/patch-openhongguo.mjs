import { readFile, writeFile } from "node:fs/promises";

const path = "node_modules/openhongguo/index.js";
let source = await readFile(path, "utf8");
const requireLine = "require(join(here, 'dist', 'wasm_exec.js')); // 定义 globalThis.Go";
const patchedRequire = "if (!globalThis.Go) require(join(here, 'dist', 'wasm_exec.js')); // Pages imports wasm_exec.js statically; Node keeps the fallback";
const wasmLine = "const bytes = await readFile(join(here, 'dist', 'openhongguo.wasm'));";
const patchedWasm = "const bytes = globalThis.__BXG_OPENHONGGUO_WASM ?? await readFile(join(here, 'dist', 'openhongguo.wasm'));";

let changed = false;
if (source.includes(requireLine)) {
  source = source.replace(requireLine, patchedRequire);
  changed = true;
} else if (!source.includes(patchedRequire)) {
  throw new Error("openhongguo WASM loader changed; refusing to patch an unknown SDK version.");
}
if (source.includes(wasmLine)) {
  source = source.replace(wasmLine, patchedWasm);
  changed = true;
} else if (!source.includes(patchedWasm)) {
  throw new Error("openhongguo WASM byte loader changed; refusing to patch an unknown SDK version.");
}
if (changed) await writeFile(path, source, "utf8");
console.log(changed ? "Patched openhongguo WASM loader for Pages Functions." : "openhongguo WASM loader already patched.");
