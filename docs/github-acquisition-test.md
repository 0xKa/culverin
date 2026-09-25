# GitHub acquisition test

The extension currently provides a minimal acquisition test on its options page. It resolves the default branch to a commit SHA and can download that commit's tar archive. The archive bytes are counted and discarded; this test does not analyze source files.

## Load the extension

1. Run `bun run build` from the repository root.
2. Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `extension/dist`.
3. Open Culverin's **Details** page, then **Extension options**.
4. Enter a repository owner and name. Choose **Resolve repository**. This action requests metadata only. Choose **Download archive** to start a fresh archive transfer.

The status shows the visibility, default branch, commit SHA, downloaded byte count, and final origin. A canceled, timed-out, or failed transfer must never show **Downloaded and discarded**.

**Check job status** reports running, interrupted, or idle for the current options page. **Clear private session** invalidates private work while retaining the connected token; **Disconnect GitHub** removes it.

## Public check

With no token connected, enter `octocat` and `Hello-World`. Resolve it, then download it. The final origin should be `https://codeload.github.com`. The automated public browser check can be run with `CULVERIN_LIVE_PUBLIC=1 bun run test:browser`; it needs live GitHub access and is excluded from the default smoke run.

## Private check

Use disposable test repositories. Create a fine-grained personal access token selected for **one** private repository with **Contents: Read-only** access. Keep a second private repository outside the token's selection. Do not paste the token into chat, a test fixture, a terminal command, a screenshot, or an issue.

1. In the options page, enter the selected private repository owner and name. Paste the temporary token into the password field and choose **Connect token**. The field clears immediately. A successful validation shows **connected**.
2. Resolve and download the selected repository. Confirm the status shows **private**, a full commit SHA, a positive byte count, and the codeload final origin.
3. Enter the unselected private repository and choose **Resolve repository**. It must fail with an unavailable or forbidden state and must not download an archive. Do not record its identity in the handoff.
4. Open `chrome://extensions`, inspect Culverin's service worker, and use its Network panel while repeating the selected download. Check the initial `api.github.com` request has Authorization and no Cookie; the redirected `codeload.github.com` request has neither Authorization nor Cookie. Check the request's cache behavior and that the final origin remains codeload. Avoid copying request URLs because private archive links can be signed and temporary.
5. Choose **Disconnect GitHub**. A repeat private resolution must fail. Close the browser completely, reopen it, and confirm the options page says no token is connected. Session credentials should also disappear after extension reload or update.
6. Revoke the disposable token in GitHub after the test.

Report only pass/fail, HTTP status categories, final origins, and approximate byte counts. Do not include tokens, private repository names, source, signed URLs, or raw network exports.
