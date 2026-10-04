# Security policy

## Supported versions

Only the latest release receives security fixes. Chrome updates installed extensions automatically, so fixes ship as a new release rather than as patches to older versions.

## Report a vulnerability

Report vulnerabilities privately through GitHub: open the [Security tab](https://github.com/0xKa/culverin/security), select **Report a vulnerability**, and describe the issue. Do not open a public issue, pull request, or discussion for a vulnerability.

Include the Culverin version, the Chrome version, the steps to reproduce the issue, and what an attacker could do with it. If the issue depends on a specific repository, describe how to build an archive that triggers it instead of linking to a private repository. Never include a real GitHub token in a report.

You'll get a reply once the report has been reviewed. If the issue is confirmed, it is fixed in a new release and the advisory is published after the release is available, with credit to you unless you prefer otherwise.

## Scope

These are in scope:

- Exposure of a GitHub token or refresh token to a content script, the toolbar popup, the analysis worker, a log, or any origin other than GitHub.
- A web page, a GitHub page, or another extension that can make Culverin start an archive download, change its settings, or read its stored results without the user's action.
- A repository archive that makes Culverin exceed its limits on download size, decompression, file count, file size, or memory, run code, follow links outside the archive, or report a partial count as complete.
- Code loaded from outside the packaged extension, or a permission or content security policy weaker than the one in `extension/manifest.json`.
- A cached result shown for a repository that is no longer readable with the current connection.

These are out of scope:

- Vulnerabilities in GitHub, Chrome, or the user's operating system.
- Attacks that require control of the user's browser profile or machine. Tokens are stored unencrypted in extension storage, as described in the [privacy policy](docs/privacy.md).
- A repository that is slow to count but stays within Culverin's limits.
- Reports from automated scanners without a demonstrated impact on Culverin.
