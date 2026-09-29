# Contributing

Culverin is in early development. Please discuss larger behavior changes in an issue before implementing them, and include checks that exercise new behavior.

## Toolchain

- Bun **1.4.2** (root `package.json`); use `bun ci` and commit `bun.lock`.
- Rust **1.98.1**, including `wasm32-unknown-unknown`, rustfmt, and Clippy (`rust-toolchain.toml`).
- `wasm-bindgen-cli` **0.2.128**, matching the exact Rust crate version. Install with `cargo install wasm-bindgen-cli --version 0.2.128 --locked`.
- Node **24.18.0** was used locally for Vite and Playwright. Vite 8 requires Node 20.19+ or 22.12+. The prepared CI workflow is currently disabled; local checks remain available through `bun run verify`.
- The popup and options page use Preact **10.29.8** and Tailwind CSS **4.3.3** through the Vite build. Install their pinned dependencies with `bun ci`.
- Playwright's Chromium: `bunx playwright install chromium`, or point `CHROME_BIN` at a compatible Chrome executable.

The icon artwork lives in `assets/`. The PNGs in `extension/public/icons/` are committed because Chrome needs them in the loadable extension.

## Release package

`bun run package` builds the extension, checks the build, and writes `dist/culverin-<version>.zip` with a SHA-256 checksum file. The check fails if the manifest keys, permissions, host permissions, or content security policy change, if an unexpected file or source map is present, or if bundled code contains a local path, a development host, or a URL outside the allowed origins. ZIP entries are sorted and use fixed timestamps and file modes, so the same build output always produces the same checksum. The command prints the source commit and notes uncommitted changes.

`bun run test:package` rebuilds the package, confirms the ZIP matches its checksum, extracts it, and runs the browser smoke test against the extracted files. Set `CULVERIN_LIVE_PUBLIC=1` to include the live public GitHub check.

`extension/public/THIRD_PARTY_NOTICES.txt` lists the licenses of the Rust crates linked into the WebAssembly counter and the bundled Preact and Tailwind CSS packages. It is shipped in the package. Regenerate it with `bun run notices:build` after dependency changes; `bun run verify` fails when it is out of date.
