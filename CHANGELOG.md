# Changelog

User-facing changes for each Culverin release. Newest first.

## 0.0.2 - 2026-09-28

- Adds Culverin ignore to the options page. Turn built-in exclusion groups on or off (dependencies, build output, environments and caches, lockfiles, minified files and source maps), and add your own rules for folders, file endings, names, and paths. Settings sync through Chrome sync when it is on. The popup and the About row note when custom rules are active.
- Shows the repository size reported by GitHub in the popup as soon as it opens, without downloading anything. This size includes Git history.
- Shows the total size of the files at the counted commit, including files that are not counted.
- Shows text lines, the prose in Markdown, MDX, Djot, and plain text files, next to code lines. The popup details list code languages and text formats separately.
- Counts README, LICENSE, COPYING, NOTICE, AUTHORS, CONTRIBUTORS, CHANGELOG, CHANGES, HISTORY, NEWS, and VERSION files without an extension, and LICENSE-\* files, as plain text. Code-line totals are unchanged with the default settings.
- Results saved by 0.0.1 are not reused because the counting rules changed. Count each repository again once.

## 0.0.1 - 2026-09-28

First release.

- Adds a lines-of-code row to the About sidebar of public GitHub repositories. Click it to count the default branch; click a finished total to open the details.
- Adds a toolbar popup with totals, a per-language breakdown, coverage, and the counted commit.
- Counts code in your browser with Tokei 15 compiled to WebAssembly. Source is downloaded from GitHub only when you choose to count, and nothing is sent anywhere else.
- Keeps complete results locally (up to 200 results or 5 MiB) and shows a saved result only while the repository is still public at the same commit.
- Supports public repositories only.
- Limits each count to a 50 MiB download, 250 MiB of expanded source, 50,000 archive entries, and 40,000 files. Files over 8 MiB are skipped and the result is marked partial.
- Requires Chrome 120 or later; opening the popup from the row requires Chrome 127 or later.
