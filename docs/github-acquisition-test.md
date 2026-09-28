# GitHub acquisition test

This release analyzes public repositories only. It resolves the default branch to a commit SHA and streams that commit's tar archive through the local counter. Source bytes are discarded after analysis.

## Load the extension

1. Run `bun run build` from the repository root.
2. Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `extension/dist`.
3. Open `https://github.com/octocat/Hello-World` and open the Culverin toolbar popup. Opening the popup requests metadata only. Choose **Analyze repository** to start a fresh archive transfer.

A canceled, timed-out, or failed transfer must never show a complete result.

## Public check

In the service worker's Network panel from `chrome://extensions`, the archive request should redirect to `https://codeload.github.com`, and neither the `api.github.com` nor the `codeload.github.com` request should carry Authorization or Cookie headers. The automated public browser check can be run with `CULVERIN_LIVE_PUBLIC=1 bun run test:browser`; it needs live GitHub access and is excluded from the default smoke run.
