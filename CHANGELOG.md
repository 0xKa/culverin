# Changelog

User-facing changes for each Culverin release. Newest first.

## 0.0.4 - 2026-09-30

- Adds private repository counting. Connect with GitHub in the new GitHub settings section and choose which repositories Culverin may read, or paste a personal access token with read-only access to repository contents. Public repositories still work without connecting.
- Uses your connected account's GitHub API limit of 5,000 requests per hour instead of the shared anonymous limit of 60. The popup and Counting settings show the requests remaining for the connection in use.
- Keeps private results separately, up to 100 results or 2 MiB, and lists them in Storage. Disconnecting GitHub deletes the saved token and private results; Clear private results keeps you connected.
- Shows links to GitHub settings when a repository needs a connection, the connection has expired, or access has not been granted.
- Fixes counts failing on symbolic or hard links whose targets contain `..` or an absolute path. Links are skipped and never followed.
- Keeps using results saved by 0.0.3.

## 0.0.3 - 2026-09-29

- Sends fewer requests to GitHub. Opening the popup, or a repository page you haven't counted, sends nothing. A repository you counted is checked at most once every 20 minutes, even after Chrome restarts the extension in the background. The popup shows the branch, commit, and repository size once the repository has been checked.
- Adds Reanalyze to the popup. Once a result is shown, it checks GitHub for a newer commit and counts again only if the commit changed.
- Shows how many of the 60 hourly GitHub API requests are left, in the popup and in the Counting settings with the reset time. A small bar turns amber when half are used and red at 80%.
- Adds a Counting setting to count lines as soon as you open a repository page. It is off by default. Each commit is tried once per browser session, so a failed count isn't repeated on every visit.
- Explains GitHub's request limit in the Counting settings: why it exists, why a check uses 2 requests, what uses them, and what happens when they run out.
- Lists your saved results in the Storage settings, with each repository's commit, code lines, files, main language, and when it was counted and last viewed.
- Renames the options page to Settings and splits it into Storage, Culverin ignore, Counting, and About sections. The page reopens on the section you used last.
- Adds an About section with the version, the counting engine and rules, links to the source code, changelog, privacy policy, and issues, and a button that copies these details for bug reports.
- Results saved by 0.0.2 are still used.

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
