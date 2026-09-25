# Privacy

Culverin analyzes GitHub repositories inside the user's browser. Repository metadata and archives travel from GitHub to the extension; Culverin has no backend, telemetry, or native companion. GitHub still receives the requests needed to resolve a repository and fetch its archive.

## When data is fetched

The current interface is the extension's options page. Lookup requests repository metadata and its default branch commit from the GitHub API. Only the separate, explicit Analyze action requests a tar.gz archive for that commit. Opening a GitHub repository page does not download an archive. The content script currently sends a bootstrap ping and does not read repository source.

GitHub requests use `cache: "no-store"` and `credentials: "omit"`. When a token is connected, the service worker sends it in the Authorization header on requests to the GitHub API. The archive request starts at the GitHub API and follows its redirect to `codeload.github.com`; the extension checks that the final response came from codeload. The extension does not expose a token or a signed archive URL to the content script or analysis worker.

## Data held in the browser

A token entered on the packaged options page is validated and kept in `chrome.storage.session`, limited to trusted extension contexts. Disconnect removes it. Session storage is cleared when the browser session ends; the extension does not put tokens in persistent extension storage. Clearing private session state removes pending credentials and aborts active work while retaining a connected token for that browser session.

The service worker streams bounded archive chunks to a packaged analysis worker through an offscreen document. The worker retains at most one eligible source file body at a time for counting. Archives and source files are not written to extension storage. The aggregate count result and transport diagnostics are returned to the options page, but results are not yet cached. Session storage holds only job interruption state and credential state. A failed or interrupted analysis does not produce a completed result.

The extension cannot control how GitHub handles requests or how long the browser retains data in network and process memory. Its `no-store` request setting asks the browser not to use its HTTP cache; it is not a claim that all in-memory copies are immediately erased.
