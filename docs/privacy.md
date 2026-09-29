# Privacy

Effective 2026-09-29.

Culverin counts lines of code in public GitHub repositories inside your browser. It has no backend, account, telemetry, analytics, or advertising. The developer does not collect, receive, sell, or share any data about you or the repositories you view.

## What goes to GitHub

To show a result, the extension requests repository metadata and the current default-branch commit from `api.github.com`. When you choose Analyze, it downloads that commit's source archive, which GitHub serves from `codeload.github.com`. These requests go directly from your browser to GitHub and are subject to [GitHub's privacy statement](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement).

Requests are sent without your GitHub cookies or any token, with `credentials: "omit"` and `cache: "no-store"`. Culverin does not read your GitHub session and cannot access private repositories.

By default, opening or reloading a repository page sends no request to GitHub unless Culverin already has a completed result for that repository; it then requests metadata to check that the result is still current. It never downloads source code. Only an explicit Analyze action in the toolbar popup or on the repository page's lines-of-code row starts an archive download. Opening the toolbar popup sends no request to GitHub; it shows only what Culverin already checked in the last 20 minutes.

If you choose to count when a repository page opens, in the Counting section of the settings page, opening a repository page always requests metadata and, when there is no current result, downloads that commit's source archive as if you had selected Analyze. Culverin tries this at most once per repository commit and settings in each browser session.

## What stays in your browser

Source code is streamed to a packaged analysis worker, counted in memory, and discarded. Archives and source files are never written to storage.

Complete aggregate results for public repositories are kept in the extension's local storage so they can be shown again without another download. Each result holds the repository name and ID, default branch, commit, the repository size reported by GitHub, the time it was stored, file and line counts per language, and the total size of the files at that commit. At most 200 results or 5 MiB are kept; the least recently used results are evicted first. Partial, failed, and canceled results are not stored. Session storage holds short-lived job state, GitHub's most recent API rate-limit counts, repository metadata from the last 20 minutes, and the list of automatic counts already tried, all cleared when the browser closes.

Your Culverin ignore settings, the built-in exclusion groups you turned off and the exclusion rules you wrote, are kept in the extension's sync storage. When Chrome sync is on, Chrome copies them to your other browsers through your Google account, as it does for other extension settings; otherwise they stay in this browser. They contain only what you type into the settings page. Your Counting choice is kept the same way when you change it from the default. The settings page also remembers which of its sections you last opened, in the extension's local page storage.

Extension storage is limited to trusted extension contexts. The script that runs on GitHub pages receives only aggregate counts for the repository you are viewing, never source files.

A cached result is shown only after GitHub confirms the repository is still public at the same commit. Metadata can be reused for up to 20 minutes, so a visibility change or a new commit within that window may not be noticed until the metadata expires or you select Reanalyze in the toolbar popup, which checks GitHub again. When Culverin sees that a repository has become private, it deletes that repository's stored results.

## Permissions

- `storage`: keep completed results, Culverin ignore settings, and short-lived job state.
- `offscreen`: run the packaged WebAssembly line counter outside the service worker.
- `github.com`, `api.github.com`, and `codeload.github.com`: show the lines-of-code row on repository pages, read repository metadata, and download source archives you ask to analyze.

All code, including the WebAssembly counter, is packaged with the extension. No remote code is loaded.

## Removing data

Use **Clear public cache** in the Storage section of the extension's settings page to delete stored results, and **Reset to defaults** under Culverin ignore to delete your ignore settings. Removing the extension deletes all of its stored data.

The extension cannot control how GitHub handles requests or how long the browser keeps data in network and process memory. The `no-store` setting asks the browser not to use its HTTP cache for these requests.

## Changes and contact

Changes to this policy are published in this file with a new effective date. Questions can be raised as an issue at https://github.com/0xKa/culverin/issues.
