# culverin

github code stats extension

> **Origins.** Culverin began as a server-based project: a Go backend that fetched GitHub repository archives, counted lines with a pinned `cloc` release, and served results over an HTTP API to a companion browser extension and web interface. That design required repository source code to pass through server infrastructure, along with the operational burden of hosting, credentials, and abuse control. This repository is a clean rewrite with a different architecture: everything now runs locally in your browser using Rust and WebAssembly, repository contents travel only from GitHub to you, and no Culverin server exists at all. The earlier implementation was retired as a learning vehicle; none of its code or history is carried over.
