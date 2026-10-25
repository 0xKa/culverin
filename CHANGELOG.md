# Changelog

User-facing changes for each Culverin release. Newest first.

## Unreleased

- Moves the full list of built-in ignore rules and the rule syntax guide in Settings into dialogs opened from buttons at the top right of each panel.
- Shows how many ignore rules and bytes you've used only when you get close to the limit.
- Numbers each line of Your rules in Settings, so you can find the line an error points to.
- Shows short count times more precisely in the popup, such as Counted in 412ms or Counted in 4.2s instead of Counted in 0s or 4s.
- Shows how many files have been read below the popup's timer while a count runs, and says when Culverin is waiting for GitHub to send the source snapshot.
- Shows in the popup's Analysis details how long a count waited for GitHub and for the counter, so you can tell whether GitHub or counting set the pace.

## 1.1.2 - 2026-10-25

- Adds reset buttons beside changed settings so you can restore their default values.
- Keeps Settings controls from shifting as you move between sections by reserving space for the scrollbar.
- Removes the “default” marker from Accent color and Large repositories choices.

## 1.1.1 - 2026-10-23

- Redraws the Culverin mark with three thick, evenly spaced lines and centers it in the icon. The new mark appears in the toolbar and extension icons, the popup and Settings headers, and the lines-of-code row on GitHub pages.

## 1.1.0 - 2026-10-23

- Updates the extension description shown in `chrome://extensions` and Settings → About to cover lines of code per language, file counts, repository size, and private repositories.

## 1.0.0 - 2026-10-23

- Counts much larger repositories. Adds Settings → Large repositories, which sets the maximum download for counts you start: 256 MiB, 512 MiB (the default), 1 GiB, 2 GiB, or 4 GiB. The unpacked limit is eight times the download limit.
- Raises the other limits to 2,000,000 archive entries, 1,000,000 files, and 128 MiB of file paths, and removes the separate limit on the amount of source counted. Files over 8 MiB are still skipped.
- Keeps counts that start when you open a repository page at 256 MiB. When one reaches that limit, the page row offers Too large to count automatically, and one click counts it with your limit.
- Lets a healthy count run for up to 60 minutes. A count now stops only when GitHub sends nothing for 30 seconds or counting makes no progress for 60 seconds. Queued counts wait up to 60 minutes, and counts you start run before ones that started when a page opened.
- Shows a live timer under the popup's loader while a count runs, and Waiting for another count while it is queued. After a count, the popup shows how long it took, also for saved results counted from this version on, or how long it ran before it stopped.
- Moves archive data to the counter about 15 times faster.
- Names the actual limit in size-limit messages, with a pointer to Settings → Large repositories.
- Counts extensionless scripts whose first line uses `env` options, a full interpreter path, or a versioned interpreter name, such as `#!/usr/bin/env -S python3 -u`, `#!/usr/bin/python3`, or `#!/usr/bin/env ruby3.2`. These were previously other files.
- Counts the longest branch or tag a page names, so a tag `release` and a branch `release/v2` are told apart.
- Stops treating other files as skipped in the popup's coverage sentence, and links files that matched an ignore rule to Settings → Ignored files.
- Resumes a running count when the popup reopens on a saved result.
- Stops private lookups and counts already in progress when you disconnect GitHub.
- Keeps your other saved results when deleting one fails.
- Opens the first Settings section when you click the Culverin wordmark, and describes the selected Repo About section visibility choice.
- Requires Chrome 127 or later.
- Results saved by 0.1.7 are not reused because the counting rules changed. Count each repository again once.

## 0.1.7 - 2026-10-14

- Shows progress in GitHub's About row when you start a first count from the popup. Clicking the running row opens that count in the popup.
- Reduces popup startup flicker while a saved result or an existing count loads.
- Groups the Settings sidebar by Display, Counting, and Account & data, with icons and corner ticks. Renames Counting to When to count, Culverin ignore to Ignored files, and History to Saved results.
- Shows Appearance and Repository page choices in compact rows with corner ticks around the selected value. When to count shows both options with their full descriptions.
- Uses checkboxes with corner ticks for built-in ignore rules, About-list items, and the popup API meter option, with a bolder checkmark and clear keyboard focus.
- Adds corner ticks and a light sweep to the popup's Analyze repository and Reanalyze buttons. The sweep pauses while disabled and stops with reduced motion.
- Adds icons to the About links and Copy details button.
- Marks Disconnect in the GitHub settings in red.
- Keeps the Culverin mark's strokes even across display scales.
- Gives the Settings wordmark's opening sweep a steadier pace on slower displays.
- Keeps using results saved by 0.1.6.

## 0.1.6 - 2026-10-13

- Adds an Accent color choice under Appearance: Blue, Copper, Purple, Pink, Teal, or Slate, with square swatches and a live preview. The choice applies to the popup, settings, saved results, and single-color language bars, and follows the theme and High contrast setting.
- Adds Repo About section visibility under Settings → Repository page: show everywhere, hide on private repositories, or hide everywhere. The setting adds no GitHub requests. The toolbar popup stays available.
- Makes the Culverin mark in the popup and settings follow your accent color. The Chrome toolbar icon uses the same accent on its square background with a white symbol, and restores your choice after restarting Chrome.
- Shows a large monospace Culverin wordmark at the top of Settings. Pointing at a letter turns it into a dashed outline with a selection frame in your accent color, and the frame sweeps across the word once when Settings opens. Reduced motion skips the sweep.
- Turns Choose repositories in Settings → GitHub into a button beside Disconnect when you connect with the GitHub app.
- Slows the language bar fill animation in the popup and saved results.
- Renames the Storage section of Settings to History.

## 0.1.5 - 2026-10-12

- Counts the branch, tag, or commit a GitHub page names. Branch overviews such as `/tree/feature` get the About row, and the popup counts the ref shown on tree, blob, blame, commits, commit, and release tag pages. For a folder or file path, Culverin asks GitHub for each leading part of the path until one is a branch, at most five times.
- Labels each result with the branch, tag, or commit it counted, in the popup's analysis details and in Settings → Storage. Refs other than the default branch are highlighted, with a tooltip naming the default branch, and Storage links them to their page. Long names end in an ellipsis with the full name in the tooltip.
- Adds the About row on overview pages with a query string such as `?tab=readme-ov-file`, and on the default branch's `/tree` page. The popup recognizes a repository on any of its pages.
- Colors each language row in the popup, saved results, and the Appearance preview by language. Appearance has a By language or Single color choice, and a marker choice of Square, Circle, or None.
- Makes the API request meter in the popup optional and off by default. Turn on Show API requests in the popup in the GitHub requests panel to see it.
- Clarifies the label for a repository your GitHub connection can't read. The popup badge says Not shared, and the About row says Culverin can't access this repo.
- Keeps using results saved by 0.1.4.

## 0.1.4 - 2026-10-12

- Adds Appearance settings for System, Light, and Dark themes, with a live preview and a High contrast option.
- Adds full or abbreviated counts and binary or decimal size units for the popup and saved results. Repository pages have separate choices, and tooltips keep exact counts and bytes.
- Adds file-count and size rows to GitHub's About sidebar. Settings → Repository page, below Appearance, lets you choose which rows to show and their order, with a live preview.
- Shows every file at the counted commit in the popup's file total, including ignored, binary, and other files. Its tooltip gives the number counted as code or text.
- Shows one Size in the popup for the files at the counted commit, excluding Git history. Analysis details show an estimated clone size that includes the history GitHub reports.
- Confirms settings saves, clearing and deleting results, and copying details with animated indicators beside the control. Failed saves restore the stored choice and show a retry message.
- Uses the same hover and keyboard-focus tooltips throughout the popup and Settings, makes breakdown headings easier to spot, and shortens the analysis coverage text.
- States the 8 MiB file limit in the warning for source files too large to count, keeping their links to the counted commit.
- Keeps using results saved by 0.1.3.

## 0.1.3 - 2026-10-06

- Opens the popup when you click the About row while it counts, instead of canceling the count. The popup follows the same count, shows its progress and result, and has a Cancel button.
- Shows the number of counted files beside the code lines in the popup, and moves Text lines into the metrics below. Code lines now show in the accent color.
- Adds a view button and a delete button to each saved result in Settings → Storage. View opens the result in a popup-style dialog; delete removes only that result.
- Offers the GitHub app and a personal access token side by side in Settings → GitHub, so neither looks like the fallback.
- Copies the GitHub approval code with a small icon button and confirms "Code copied." beside it.
- Shows a loader while the approval code waits, and checks again as soon as you return to the Settings tab, so a connection appears within a few seconds of approving it on GitHub.
- Moves GitHub requests and Common questions from the Counting section to the GitHub section.
- Keeps the Storage tables inside their panels and lines up their columns between public and private results.
- Keeps using results saved by 0.1.2.

## 0.1.2 - 2026-10-06

- Fixes the API count staying at 5000/5000 after Check now or Refresh. For a connected account, GitHub's free limit endpoint reports an unused window, which hid every later request. Check now and Refresh now spend one request when you are connected to read your real count, and stay free without a connection. A count from a real request replaces an outdated one. The privacy policy describes the one request.
- Shows the popup's status as a small badge beside the repository name instead of a line of text under it. Labels such as Not counted, Checking, Counting, Fresh, Up to date, Cached, Partial, Rate limited, and Failed come with a small animated mark, and hovering or focusing the badge shows the full message. A rate limit still shows when you can try again, below the analysis button.
- Explains Physical lines in the popup: hover it to see that it equals code, comments, and blanks together.
- Turns Refresh in the GitHub requests panel into an icon button, with the loader replacing the icon while it checks.
- Opens and closes expandable sections without animating their content. The chevron still turns.
- Gives the popup and Settings a thin square scrollbar.
- Keeps using results saved by 0.1.1.

## 0.1.1 - 2026-10-06

- Adds Check now and Refresh to the GitHub requests panel in Settings. They ask GitHub for your current API limit, which does not use any of your requests, so you no longer have to count a repository to see it. The panel now also appears in the GitHub section. The privacy policy lists the new request.
- Reports GitHub throttling a source download as "GitHub is busy preparing this repository's source snapshot. Try again in a minute." instead of a rate limit error, and no longer blocks other requests while you wait.
- Replaces the spinner in the popup and Settings with a dot-grid loader. While an analysis runs, Analyze repository and Reanalyze give way to the loader with a small Cancel analysis button below it. The About row on GitHub keeps its spinner.
- Restyles the popup and Settings with square corners, flat panels, monospace numbers, shorter animations, and a thin divider instead of a dot between details.
- Keeps using results saved by 0.1.0.

## 0.1.0 - 2026-10-06

- Redesigns the popup and the Settings page. Results show in cards with breakdown bars, and Settings sections have clearer headers and panels.
- Counts larger repositories. Culverin now accepts downloads up to 256 MiB, up to 2 GiB unpacked, and up to 200,000 files. A count that is still making progress runs for up to five minutes before it stops.
- Lists the source files too large to count in the popup's analysis details, largest first, with a link to each file at the counted commit. One file shows directly and several sit behind Show files. Results counted before 0.1.0 keep their count-only note until you press Reanalyze, which downloads the repository again to fill in the list.
- Keeps the count in the About row when Chrome stops Culverin's background worker while the tab sits idle. Before, the count disappeared after a longer absence and Retry did nothing until you reloaded the page.
- Keeps showing the current result while Reanalyze runs instead of clearing it.
- Shows a spinner while Culverin connects to GitHub or counts a repository.
- Groups the Storage controls: Clear public results and Clear private results sit beside their headings, with Clear all results below. Clearing results keeps your ignore and Counting settings and your GitHub connection.
- Shows 10 rows in each popup section, with the rest behind Show more.
- Shows when the GitHub API limit resets and explains that the anonymous limit is shared. The remaining requests stay visible while you sign in.
- Redraws the toolbar icon with three lines on a 16 pixel grid and shows a larger, theme-matched icon on the Settings page.
- Keeps using results saved by 0.0.5.

## 0.0.5 - 2026-10-01

- Adds an Other files section to the popup details. It lists files Culverin does not recognize as a language, such as test data, certificates, and `go.mod`, grouped by extension with their line counts. The first 10 show and Show more reveals the rest. Their lines are not added to code or text lines.
- Shows the total lines and files at the top of each popup section (Code, Text, and Other files), and lists Code and Text by lines instead of by name.
- Shows a total even when some source files are over 8 MiB. The page row ends the number with `+` and its tooltip says how many files were left out, and the popup shows the same note. These results are saved, so reopening the repository no longer offers to count again.
- Counts files with invalid text characters exactly instead of reporting a partial analysis whose counts "may be inaccurate". A file that starts like UTF-16 but does not decode is skipped as binary.
- Counts Jupyter notebooks that showed zero lines, such as ones with raw cells, code stored as one string, or no kernel information. Code in fenced blocks inside markdown cells is counted once. A notebook that cannot be read is skipped and listed as unsupported.
- Fixes counts on large repositories such as golang/go failing at random with "Repository metadata exceeds the safe limit".
- Fixes the progress label flickering between downloading and counting on large repositories.
- Names the limit that was reached when a repository is too large to count, for example "The limit is 40,000 files."
- Results saved by 0.0.4 are not reused because the counting rules changed. Count each repository again once.

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
