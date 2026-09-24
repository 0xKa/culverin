# Architecture decisions

This document summarizes the current implementation and will be expanded before Culverin is released.

## Current bootstrap architecture

- Chrome Manifest V3 with a TypeScript service worker and content script.
- Rust builds to `wasm32-unknown-unknown`; the built extension contains the WASM asset.
- Vite bundles two fixed entry points. The manifest stays explicit in `extension/public/manifest.json`; no extension bundling plugin mutates permissions.
- Bun 1.4.2 manages dependencies and executes scripts. Bun's test runner handles TypeScript unit tests, Cargo handles native Rust tests, a direct WASM smoke checks the generated module, and Playwright runs the extension in Chromium.
- Icon artwork lives in `assets/`; the matching PNGs in `extension/public/icons/` are committed for Chrome. Final branding remains a later decision.
- Candidate minimum Chrome version is 120, pending testing at that exact version.
- The project license is Apache-2.0.
