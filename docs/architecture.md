# Architecture decisions

Culverin is a browser-local Chrome Manifest V3 extension. GitHub supplies repository metadata and source archives; the extension analyzes source in the browser. There is no Culverin server, native companion, or telemetry service.

## Extension boundaries

- The TypeScript service worker owns GitHub requests, credentials, job coordination, and cancellation. It accepts repository requests only from the packaged options page and checks the sender, protocol version, and request identity.
- The packaged options page is the current analysis interface. Its separate Lookup action resolves repository metadata and the default branch commit. Analyze is the explicit action that also downloads that commit's archive. The GitHub content script currently sends only a bootstrap ping; it does not analyze a page or receive credentials or source.
- An offscreen document hosts a dedicated, terminable analysis worker. The service worker transfers bounded archive chunks to it with acknowledgments. The worker decompresses gzip, validates tar entries, applies file limits, and calls a fresh Rust/WASM counter for each job. The service worker receives the aggregate result and transport diagnostics, not source files.
- The Rust counter uses Tokei and exposes the same counting boundary to native tests and browser WASM. The result contract is [`schemas/analysis-result-v1.schema.json`](../schemas/analysis-result-v1.schema.json). Counting rules, coverage, archive handling, and resource limits are specified in [result semantics](result-semantics.md). An interrupted, canceled, malformed, or resource-limited job returns a failure rather than a complete result.

## Storage and packaging

- A personal access token, when supplied, is held in trusted extension contexts through `chrome.storage.session`. The service worker keeps only short-lived job state and a session interruption marker. Analysis results and source archives are not persisted as a cache.
- The manifest is explicit in `extension/public/manifest.json`. It declares `storage` and `offscreen` permissions; GitHub, GitHub API, and codeload host access; and a packaged-code CSP that permits local WASM. Vite builds the service worker, content script, options page, offscreen document, analysis worker, and packaged WASM asset without changing the manifest's permissions.
- Chrome 120 is the minimum supported version. Bun 1.4.2 runs the TypeScript build and checks; Cargo runs native Rust tests; direct WASM tests exercise the generated module; and Playwright smoke tests load the packaged extension in Chromium.

The project is licensed under Apache-2.0. Icon artwork is in `assets/`, with committed PNGs in `extension/public/icons/`.
