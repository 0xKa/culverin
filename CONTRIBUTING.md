# Contributing

Culverin is in early development. Please discuss larger behavior changes in an issue before implementing them, and include checks that exercise new behavior.

## Toolchain

- Bun **1.4.2** (root `package.json`); use `bun ci` and commit `bun.lock`.
- Rust **1.98.1**, including `wasm32-unknown-unknown`, rustfmt, and Clippy (`rust-toolchain.toml`).
- `wasm-bindgen-cli` **0.2.128**, matching the exact Rust crate version. Install with `cargo install wasm-bindgen-cli --version 0.2.128 --locked`.
- Node **24.18.0** was used locally for Vite and Playwright. Vite 8 requires Node 20.19+ or 22.12+. The prepared CI workflow is currently disabled; local checks remain available through `bun run verify`.
- Playwright's Chromium: `bunx playwright install chromium`, or point `CHROME_BIN` at a compatible Chrome executable.

The icon artwork lives in `assets/`. The PNGs in `extension/public/icons/` are committed because Chrome needs them in the loadable extension.
