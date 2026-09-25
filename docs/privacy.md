# Privacy

Culverin analyzes GitHub repositories inside the user's browser. Repository metadata and archives travel from GitHub to the extension; Culverin has no backend, telemetry, or native companion. GitHub still receives the requests needed to resolve a repository and fetch its archive.

## When data is fetched

The GitHub repository-page control and packaged options page can request repository metadata and the current default-branch commit. A repository page can show a previously completed result after a compatible public resolution, but opening or reloading the page does not download an archive. Only the separate, explicit Analyze action can start a tar.gz archive download for that commit.

GitHub requests use `cache: "no-store"` and `credentials: "omit"`. When a token is connected, the service worker sends it in the Authorization header on requests to the GitHub API. The archive request starts at the GitHub API and follows its redirect to `codeload.github.com`; the extension checks that the final response came from codeload. The extension does not expose a token or a signed archive URL to the content script or analysis worker.

## Data held in the browser

A token entered on the packaged options page is validated and kept in `chrome.storage.session`, limited to trusted extension contexts. Disconnect removes it. Session storage is cleared when the browser session ends; the extension does not put tokens in persistent extension storage. Clearing private session state removes pending credentials and aborts active work while retaining a connected token for that browser session.

The service worker streams bounded archive chunks to a packaged analysis worker through an offscreen document. The worker retains at most one eligible source file body at a time for counting. Archives and source files are not written to extension storage. Complete public aggregate results can persist in `chrome.storage.local` until evicted or cleared, with a limit of 200 results or 5 MiB. Local storage is restricted to trusted extension contexts; the content script receives only the result selected for its current repository. Partial, failed, canceled, and private results are not written to persistent storage. Session storage holds credential state and bounded job interruption markers.

A cache hit requires a compatible repository resolution confirming public visibility, repository ID, and commit SHA. A resolution can be reused for up to 60 seconds, so a visibility change during that window may not be noticed immediately. When the extension observes that the same repository ID has become private, it removes its persistent public results. Clear public cache, Clear private session, and Disconnect GitHub are separate options-page actions. Multiple Analyze requests for the same result may share one in-browser download; canceling one subscriber leaves other subscribers running.

The extension cannot control how GitHub handles requests or how long the browser retains data in network and process memory. Its `no-store` request setting asks the browser not to use its HTTP cache; it is not a claim that all in-memory copies are immediately erased.
