# Contributing

Open an issue before you start a large change. Every change needs tests that cover the new behavior.

## Requirements

- Bun 1.4.2
- Node 20.19 or newer, because Vite runs on Node. CI uses Node 24.18.0.
- Rust 1.98.1. If you use rustup, it installs this version and the WebAssembly target automatically from `rust-toolchain.toml`.
- wasm-bindgen CLI 0.2.128. The build fails with any other version.
- Python 3, used to check the icons.

Install wasm-bindgen with this command:

```sh
cargo install wasm-bindgen-cli --version 0.2.128 --locked
```

## Setup

```sh
bun ci
bunx playwright install chromium
bun run build
```

`bun ci` installs the exact versions in `bun.lock`. The second command downloads the Chromium build that the browser tests use. To use another browser, set `CHROME_BIN` to a Chromium or Chrome for Testing executable. Google Chrome ignores `--load-extension`, so the tests cannot load the extension there. CI clears `CHROME_BIN` because GitHub's Ubuntu runners set it to Google Chrome.

## Load the extension in Chrome

1. Run `bun run build`, or `bun run dev` to rebuild when files change.
2. Open `chrome://extensions` and turn on Developer mode.
3. Click Load unpacked and select `extension/dist`.

After a rebuild, click the reload button on the extension card.

## Commands

| Command                 | What it does                                                       |
| ----------------------- | ------------------------------------------------------------------ |
| `bun run build`         | Builds the extension into `extension/dist`.                        |
| `bun run dev`           | Builds the extension and rebuilds it when files change.            |
| `bun run lint`          | Checks formatting and lint rules for TypeScript and Rust.          |
| `bun run typecheck`     | Type-checks the extension and the tests.                           |
| `bun run test`          | Runs the Rust tests, the unit tests, and the WebAssembly test.     |
| `bun run test:browser`  | Runs the extension in headless Chromium against test scenarios.    |
| `bun run verify`        | Runs the checks above plus icon and notice checks. CI runs it too. |
| `bun run package`       | Writes a release ZIP and its checksum to `dist/`.                  |
| `bun run test:package`  | Builds the ZIP, unpacks it, and runs the browser tests against it. |
| `bun run bench:archive` | Measures archive processing speed on large generated archives.     |
| `bun run screenshots`   | Captures the popup, settings, and page row in light and dark mode. |
| `bun run icons:build`   | Regenerates the PNG icons from `assets/original/`.                 |
| `bun run notices:build` | Regenerates `extension/public/THIRD_PARTY_NOTICES.txt`.            |

## Before you open a pull request

Run `bun run verify` and make sure it passes. It takes about three minutes.

If you changed a dependency, run `bun run notices:build` and commit the updated notices file. If you changed the icon artwork, run `bun run icons:build` and commit the new PNGs. `bun run verify` fails when either one is out of date.

## Release package

`bun run package` fails if the build contains anything unexpected. That includes a changed permission or content security policy, a source map, a local path, or a URL outside the allowed origins. The same source always produces the same ZIP checksum.

`bun run test:package` skips the check against live GitHub by default. Set `CULVERIN_LIVE_PUBLIC=1` to include it.

## More documentation

- [Architecture](docs/architecture.md)
- [Result semantics](docs/result-semantics.md)
- [Browser tests](docs/browser-tests.md)
- [Archive performance](docs/archive-performance.md)
- [Privacy](docs/privacy.md)
