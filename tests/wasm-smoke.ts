import { readFileSync } from "node:fs";

const wasm = readFileSync(
  "extension/src/wasm/generated/culverin_counter_bg.wasm",
);
const imports = WebAssembly.Module.imports(new WebAssembly.Module(wasm));
if (imports.some((item) => item.module.startsWith("wasi_"))) {
  throw new Error("Browser WASM unexpectedly imports WASI");
}

const { default: init, bootstrap_version } =
  await import("../extension/src/wasm/generated/culverin_counter.js");
await init({ module_or_path: wasm });
if (bootstrap_version() !== "0.1.0")
  throw new Error("WASM bootstrap version mismatch");
console.log(
  `WASM smoke passed: ${wasm.byteLength} bytes, ${imports.length} imports`,
);
