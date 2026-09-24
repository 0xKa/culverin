#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
if ! command -v wasm-bindgen >/dev/null; then
  echo 'wasm-bindgen CLI 0.2.128 is required; see CONTRIBUTING.md' >&2
  exit 1
fi
if [[ "$(wasm-bindgen --version)" != 'wasm-bindgen 0.2.128' ]]; then
  echo 'wasm-bindgen CLI must be exactly 0.2.128' >&2
  exit 1
fi

cargo build --locked --release --target wasm32-unknown-unknown -p culverin-counter
mkdir -p extension/src/wasm/generated
wasm-bindgen --target web --out-dir extension/src/wasm/generated \
  target/wasm32-unknown-unknown/release/culverin_counter.wasm

mkdir -p extension/src/wasm/instance
python3 scripts/prepare-counter-glue.py
