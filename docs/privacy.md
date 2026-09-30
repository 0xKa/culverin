# Privacy

Effective 2026-09-30.

Culverin counts lines of code in GitHub repositories inside your browser. Public repositories need no account; to count private repositories you can connect your GitHub account. Culverin has no backend, account of its own, telemetry, analytics, or advertising. The developer does not collect, receive, sell, or share any data about you or the repositories you view.

## What goes to GitHub

To show a result, the extension requests repository metadata and the current default-branch commit from `api.github.com`. When you choose Analyze, it downloads that commit's source archive, which GitHub serves from `codeload.github.com`. These requests go directly from your browser to GitHub and are subject to [GitHub's privacy statement](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement).

Requests are sent without your GitHub cookies, with `credentials: "omit"` and `cache: "no-store"`. Culverin does not read your GitHub session. Unless you connect GitHub, requests carry no token and Culverin cannot access private repositories.

By default, opening or reloading a repository page sends no request to GitHub unless Culverin already has a completed result for that repository; it then requests metadata to check that the result is still current. It never downloads source code. Only an explicit Analyze action in the toolbar popup or on the repository page's lines-of-code row starts an archive download. Opening the toolbar popup sends no request to GitHub; it shows only what Culverin already checked in the last 20 minutes.

If you choose to count when a repository page opens, in the Counting section of the settings page, opening a repository page always requests metadata and, when there is no current result, downloads that commit's source archive as if you had selected Analyze. Culverin tries this at most once per repository commit and settings in each browser session.

## Connecting GitHub

Connecting is optional and happens only when you choose it in the GitHub section of the settings page. You can connect in one of two ways:

- **Connect with GitHub** uses the Culverin GitHub App. Culverin asks GitHub for a short code, you enter it at `https://github.com/login/device`, and you approve the app on GitHub, where you also choose which repositories it may read. The app can only read repository contents and metadata. GitHub then gives the extension a token for your account that expires after 8 hours, and a refresh token that the extension uses to get a new one.
- **Personal access token** lets you paste a token you create on GitHub instead. A fine-grained token with read-only access to repository contents is enough.

Either way, the extension asks GitHub for your username to show which account is connected. While connected, the token is sent to `api.github.com` with repository metadata requests, so they count against your account's GitHub limit rather than the shared anonymous one, and with source archive requests for private repositories. Tokens are sent only to GitHub. They are never given to the script that runs on GitHub pages, to the toolbar popup, or to the analysis worker.

## What stays in your browser

Source code is streamed to a packaged analysis worker, counted in memory, and discarded. Archives and source files are never written to storage.

Complete aggregate results for public repositories are kept in the extension's local storage so they can be shown again without another download. Results for private repositories are kept the same way, separately, up to 100 results or 2 MiB, and contain the same fields. Each result holds the repository name and ID, default branch, commit, the repository size reported by GitHub, the time it was stored, file and line counts per language, and the total size of the files at that commit. At most 200 results or 5 MiB are kept; the least recently used results are evicted first. Partial, failed, and canceled results are not stored. Session storage holds short-lived job state, GitHub's most recent API rate-limit counts, repository metadata from the last 20 minutes, the list of automatic counts already tried, and, while you are connecting, the pending code or token, all cleared when the browser closes.

If you connect GitHub, the extension keeps your GitHub username and token, and for the GitHub App the refresh token and expiry times, in its local storage so you don't have to connect again after restarting the browser. This storage is not encrypted by Culverin, and anyone with access to your browser profile could read it. The GitHub App token can only read the repositories you chose; a personal access token can do whatever you allowed when you created it.

Your Culverin ignore settings, the built-in exclusion groups you turned off and the exclusion rules you wrote, are kept in the extension's sync storage. When Chrome sync is on, Chrome copies them to your other browsers through your Google account, as it does for other extension settings; otherwise they stay in this browser. They contain only what you type into the settings page. Your Counting choice is kept the same way when you change it from the default. The settings page also remembers which of its sections you last opened, in the extension's local page storage.

Extension storage is limited to trusted extension contexts. The script that runs on GitHub pages receives only aggregate counts for the repository you are viewing, never source files.

A cached result is shown only after GitHub confirms the repository is still public at the same commit, or, for a private result, that your connection can still read it at the same commit. Metadata can be reused for up to 20 minutes, so a visibility change or a new commit within that window may not be noticed until the metadata expires or you select Reanalyze in the toolbar popup, which checks GitHub again. When Culverin sees that a repository has become private, it deletes that repository's stored public results. When your connection can no longer find a private repository, its stored private results are deleted.

## Permissions

- `storage`: keep completed results, Culverin ignore settings, and short-lived job state.
- `offscreen`: run the packaged WebAssembly line counter outside the service worker.
- `github.com`, `api.github.com`, and `codeload.github.com`: show the lines-of-code row on repository pages, connect your GitHub account when you ask to, read repository metadata, and download source archives you ask to analyze.

All code, including the WebAssembly counter, is packaged with the extension. No remote code is loaded.

## Removing data

Use **Clear public cache** in the Storage section of the extension's settings page to delete stored public results, **Reset to defaults** under Culverin ignore to delete your ignore settings, and **Disconnect** in the GitHub section to delete your saved token and private results; **Clear private results** there deletes private results but keeps you connected. Disconnecting does not revoke the token on GitHub: to do that, remove the Culverin app's authorization in your GitHub settings under Applications, or delete the personal access token. Removing the extension deletes all of its stored data.

The extension cannot control how GitHub handles requests or how long the browser keeps data in network and process memory. The `no-store` setting asks the browser not to use its HTTP cache for these requests.

## Changes and contact

Changes to this policy are published in this file with a new effective date. Questions can be raised as an issue at https://github.com/0xKa/culverin/issues.
