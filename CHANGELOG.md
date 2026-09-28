# Changelog

User-facing changes for each Culverin release. Newest first.

## 0.0.1 - 2026-09-28

First release.

- Adds a lines-of-code row to the About sidebar of public GitHub repositories. Click it to count the default branch; click a finished total to open the details.
- Adds a toolbar popup with totals, a per-language breakdown, coverage, and the counted commit.
- Counts code in your browser with Tokei 15 compiled to WebAssembly. Source is downloaded from GitHub only when you choose to count, and nothing is sent anywhere else.
- Keeps complete results locally (up to 200 results or 5 MiB) and shows a saved result only while the repository is still public at the same commit.
- Supports public repositories only.
- Limits each count to a 50 MiB download, 250 MiB of expanded source, 50,000 archive entries, and 40,000 files. Files over 8 MiB are skipped and the result is marked partial.
- Requires Chrome 120 or later; opening the popup from the row requires Chrome 127 or later.
