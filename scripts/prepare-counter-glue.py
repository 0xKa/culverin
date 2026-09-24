from pathlib import Path

source = Path("extension/src/wasm/generated/culverin_counter.js").read_text()
guard = "    if (wasm !== undefined) return wasm;\n"
if source.count(guard) != 2:
    raise SystemExit("Unexpected wasm-bindgen initialization layout")
Path("extension/src/wasm/instance/culverin_counter.js").write_text(source.replace(guard, ""))
Path("extension/src/wasm/instance/culverin_counter_bg.wasm").write_bytes(
    Path("extension/src/wasm/generated/culverin_counter_bg.wasm").read_bytes()
)
Path("extension/src/wasm/instance/culverin_counter.d.ts").write_bytes(
    Path("extension/src/wasm/generated/culverin_counter.d.ts").read_bytes()
)
