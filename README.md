# Culverin

Culverin is an early-stage Chrome extension project for GitHub code statistics. The intended product will download a repository snapshot directly from GitHub and analyze it locally in the browser with Rust, WebAssembly, and Tokei. It will not use a Culverin server. **Analysis is not implemented yet.** The current extension only loads a content script and an empty WASM bootstrap module.

The project replaces an earlier server-based experiment. No code or history from that experiment is included here.

## Current status

The extension can be loaded unpacked in Chrome, but it does not count files, access GitHub APIs, download archives, authenticate, or show results. The current content script marks GitHub pages with an internal bootstrap attribute for smoke testing. Tokei is not yet a dependency.

The planned flow is an explicit Analyze action on a GitHub repository page, an immutable source archive fetched from GitHub, and browser-local counting. Public repositories are planned first. Fine-grained, session-only access for private repositories is planned later. Submodules, Git LFS objects, and archives beyond bounded size limits will have documented limitations once those features exist. No current result should be compared with `cloc` or GitHub Linguist.

## Build and load

See [CONTRIBUTING.md](CONTRIBUTING.md) for pinned prerequisites. Then run:

```sh
bun ci
bun run build
```

Open `chrome://extensions`, enable Developer mode, and load `extension/dist` as an unpacked extension. The candidate minimum is Chrome 120; this has not yet been verified at that exact version. The browser smoke test uses the installed Playwright Chromium or `CHROME_BIN`.

## Checks

```sh
bun run lint
bun run typecheck
bun run test
bun run test:browser
bun run verify
```

`bun run dev` rebuilds the extension on file changes. Reload the unpacked extension in Chrome after each build. Store packaging is planned for the release phase.

## Privacy and security

The current extension makes no repository or analytics requests. The manifest reserves GitHub origins for upcoming work; its content script runs on `github.com`. See [privacy](docs/privacy.md) for current behavior and planned data flow.

This project is licensed under [Apache-2.0](LICENSE).
