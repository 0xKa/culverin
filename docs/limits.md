# Limits

Culverin counts a repository inside the browser, so every count is bounded in download size, unpacked size, file count, time, and concurrency. This page lists those limits, what happens when one is reached, and how real repositories compare with them. The values are defined in `extension/src/archive/limits.ts`, with a few in `extension/src/github/`. [Result semantics](result-semantics.md) describes how they apply to the archive parser and to coverage.

## How Culverin decides a repository is too large

Culverin does not decide before downloading. The repository size GitHub reports is shown in the popup but never used to accept or refuse a count, because it includes Git history and says little about the source snapshot. When a count starts, Culverin streams the GitHub tar.gz archive of the resolved commit and checks each limit as bytes arrive, as entries are read, and as source is counted. The first limit crossed stops the count, and no total is shown, so incomplete analysis is never presented as complete. A count that fails late may already have downloaded most of the archive.

The only check before the body is read is GitHub's `Content-Length` header: when GitHub sends one above the job's download limit, the download is refused at once. GitHub usually streams archives without it, so the running byte count is what normally enforces the download limit.

## Limits that stop a count

| Limit                                | Value                                                                                  | Message shown                                                                                                                              |
| ------------------------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Compressed download                  | 512 MiB by default, set in Settings → Large repositories; 256 MiB for automatic counts | The source snapshot exceeds the compressed-size limit. The limit is 512 MiB downloaded. You can raise it in Settings → Large repositories. |
| Unpacked archive                     | 8 × the download limit                                                                 | The source snapshot exceeds the expanded-size limit. The limit is 4,096 MiB unpacked.                                                      |
| Archive entries                      | 2,000,000                                                                              | The source snapshot has too many entries. The limit is 2,000,000 archive entries.                                                          |
| Regular files                        | 1,000,000                                                                              | The source snapshot exceeds the counting limit. The limit is 1,000,000 files.                                                              |
| Metadata for one archive entry (PAX) | 64 KiB                                                                                 | Repository metadata exceeds the safe limit. The limit is 64 KiB of metadata for one entry.                                                 |
| Archive metadata in total (PAX)      | 2 MiB                                                                                  | Repository metadata exceeds the safe limit. The limit is 2 MiB of archive metadata.                                                        |
| File paths in total                  | 128 MiB                                                                                | Repository metadata exceeds the safe limit. The limit is 128 MiB of file paths.                                                            |
| One GitHub API response              | 1 MiB                                                                                  | Repository metadata exceeds the safe limit.                                                                                                |
| One file path                        | 4,096 bytes or 100 parts                                                               | The source snapshot is malformed.                                                                                                          |
| Counter memory after counting        | 512 MiB of WASM memory                                                                 | Local counting failed.                                                                                                                     |

Entries include directories, links, and archive metadata headers as well as files. Files excluded by ignore rules, binary files, and files in unsupported languages still count toward the download, unpacked, entry, and file limits, so ignore rules cannot bring a repository under them. There is no separate limit on the amount of source passed to the counter: the counter keeps only per-language totals, so its memory does not grow with the source, and the unpacked limit bounds the work. The file-path limit is the one that sets memory: Culverin keeps every path it reads to reject duplicates, and a synthetic archive of a million files at the 128 MiB limit needed about 1.2 GiB in the extension's process while counting, against under 0.4 GiB for 100,000 files. [Archive scalability](archive-performance.md#path-memory) has the measurements.

## Automatic counts

When the When to count setting counts repositories as their pages open, those counts always stop at 256 MiB downloaded, or 2 GiB unpacked, whatever the Large repositories setting says, so opening a page never starts a larger download than that. When such a count reaches that limit and the setting is higher, the page row reads Too large to count automatically, and its tooltip says `Too large to count automatically. Click to count up to 512 MiB.` with the current setting. Clicking it, or Analyze in the popup, starts an ordinary count with the setting's limit. Culverin does not try the automatic count again for that commit in the same browser session. A click that joins an automatic count already running raises that count's limits without restarting it.

## Limit that skips a file

A source file over 8 MiB is not counted. The count continues, the result is marked partial, the page row ends the total with `+`, and the popup lists the skipped files with links to them on GitHub. The popup lists up to 256 such files.

## Time and concurrency

- A count stops when it stalls, not after a fixed time: the download fails if GitHub sends nothing for 30 seconds, and the archive worker is stopped after 60 seconds without download or counting activity.
- No count runs for more than 60 minutes from when its job starts.
- A queued count may wait 60 minutes for its turn before failing as busy. The popup shows Waiting for another count while a count is queued, and a live timer once it runs.
- One count runs at a time. Up to eight more can wait in the queue, and at most 32 popups and pages can follow counts at once.
- Counts started by a click or from the popup run before queued counts that started when a repository page opened. When the queue is full, a click cancels the oldest queued automatic count, whose page row returns to Analyze with Culverin, instead of failing as busy.

## Inputs and storage

- Branch, tag, and commit names may be up to 255 characters.
- Ignore settings accept up to 64 custom rules, each up to 256 bytes and 4,096 bytes together.
- Saved results are kept up to 200 results or 5 MiB for public repositories and 100 results or 2 MiB for private ones. The least recently used results are removed first; storage never blocks a count.

## Real repositories

The following snapshots of default branches were measured on 2026-10-17 with `bun run measure:repos`, which streams each GitHub archive through Culverin's own archive parser and WASM counter with the default ignore rules and reports which limits a snapshot crosses. GitHub rate-limited the archives of torvalds/linux and microsoft/winget-pkgs that day, so their rows repeat the sizes measured on 2026-10-16, without file paths, and their outcomes are worked out from those sizes. Repositories change, so these are dated observations rather than guarantees.

| Repository                   | Download | Unpacked   | Entries  | Files    | File paths   | Outcome                                                                      |
| ---------------------------- | -------- | ---------- | -------- | -------- | ------------ | ---------------------------------------------------------------------------- |
| odoo/odoo                    | 195 MiB  | 1,076 MiB  | 59,300   | 50,491   | 2.5 MiB      | Counts, also automatically                                                   |
| gcc-mirror/gcc               | 159 MiB  | 939 MiB    | 169,717  | 163,562  | 7.5 MiB      | Counts, also automatically                                                   |
| nodejs/node                  | 141 MiB  | 739 MiB    | 61,299   | 56,462   | 3.0 MiB      | Counts, also automatically                                                   |
| tensorflow/tensorflow        | 109 MiB  | 508 MiB    | 39,613   | 37,236   | 2.2 MiB      | Counts, also automatically                                                   |
| microsoft/vscode             | 61 MiB   | 312 MiB    | 25,506   | 20,777   | 1.6 MiB      | Counts, also automatically                                                   |
| JetBrains/intellij-community | 253 MiB  | 1,246 MiB  | 357,289  | 285,525  | 29.6 MiB     | Counts, also automatically, just under 256 MiB                               |
| ClickHouse/ClickHouse        | 352 MiB  | 953 MiB    | 91,574   | 84,308   | 5.3 MiB      | Counts with the 512 MiB default; too large to count automatically            |
| llvm/llvm-project            | 306 MiB  | 2,432 MiB  | 204,714  | 187,697  | 10.0 MiB     | Counts with the 512 MiB default; too large to count automatically            |
| torvalds/linux               | 258 MiB  | 1,639 MiB  | 102,366  | 95,978   | Not measured | Should count with the 512 MiB default; just too large to count automatically |
| microsoft/winget-pkgs        | 123 MiB  | 1,423 MiB  | 937,627  | 727,792  | Not measured | Should count, also automatically, unless its paths exceed 128 MiB            |
| chromium/chromium            | >268 MiB | >1,032 MiB | >120,074 | >107,618 | Not reached  | Fails with Local counting failed on one HTML file, before any limit          |

Every measured repository that counts fits the 512 MiB default, and most fit the 256 MiB limit of automatic counts, so pages of large repositories usually count when they open. Repositories over 256 MiB, such as ClickHouse, llvm-project, and probably linux, show Too large to count automatically and count with one click. No measured repository comes close to the entry, file, or path limits: intellij-community, with 285,525 files, holds 29.6 MiB of paths. Each count took between 12 and 59 seconds in the script on a fast connection, far inside the 60-minute ceiling; in the extension a count also depends on the transfer speed recorded in [archive scalability](archive-performance.md).

chromium/chromium stops with a counter error in `chrome/test/data/ssl/google.html` after about 1 GiB unpacked. Tokei attributes more embedded lines to that 4-line HTML file than it has, and the counter rejects the result. The same error occurs before this version, where chromium failed on its size first. Its full size is unknown; on 2026-10-16 it was over 700 MiB downloaded, so it needs at least the 1 GiB setting.
