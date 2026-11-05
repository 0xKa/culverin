# Chrome Web Store publishing

Publishing a GitHub release submits its ZIP to the Chrome Web Store for review. The [`Publish to Chrome Web Store`](../.github/workflows/publish-store.yml) workflow does this without storing a Google credential in GitHub.

## Release flow

1. The maintainer pushes `main` and the tag, then creates the GitHub release with the ZIP and its checksum.
2. The workflow downloads that ZIP and checks its checksum and manifest version. It does not rebuild the extension, so the store receives the file that was verified locally.
3. GitHub issues a short-lived identity token to the job, and Google exchanges it for a Chrome Web Store access token.
4. The workflow uploads the ZIP, waits for processing to finish, and submits it for review. The version goes live after it passes review.

The workflow skips prereleases. Listing changes, such as the description and screenshots, are not part of it. Make those in the Developer Dashboard before publishing the release.

## Google Cloud setup

This is a one-time setup in a Google Cloud project used only for publishing. It should not need a billing account.

| Resource               | Name or value                                                                                             |
| ---------------------- | --------------------------------------------------------------------------------------------------------- |
| Enabled APIs           | Chrome Web Store, Identity and Access Management, IAM Service Account Credentials, Security Token Service |
| Service account        | `culverin-store`, with no project roles                                                                   |
| Workload identity pool | `github`                                                                                                  |
| OIDC provider          | `culverin`, with issuer `https://token.actions.githubusercontent.com` and the default audience            |
| Attribute mapping      | `google.subject` = `assertion.sub`, `attribute.repository` = `assertion.repository`                       |
| Attribute condition    | `assertion.repository == '0xKa/culverin'`                                                                 |
| Service account key    | None. The workflow signs in through the workload identity provider                                        |

On the `culverin-store` service account, grant the **Workload Identity User** and **Service Account Token Creator** roles to this principal:

```text
principal://iam.googleapis.com/projects/<project-number>/locations/global/workloadIdentityPools/github/subject/repo:0xKa/culverin:environment:chrome-web-store
```

Only jobs in this repository's `chrome-web-store` environment match that principal.

## Developer Dashboard setup

Under **Account**, add the service account email. A publisher can link one service account, and the Google account that owns the listing needs 2-step verification.

The publisher ID is under **Publisher > Settings**.

## GitHub environment

The `chrome-web-store` environment allows deployments only from tags that match `v*`, and it has no required reviewers. It holds these variables:

| Variable              | Value                                                                                        |
| --------------------- | -------------------------------------------------------------------------------------------- |
| `GCP_WIF_PROVIDER`    | `projects/<project-number>/locations/global/workloadIdentityPools/github/providers/culverin` |
| `CWS_SERVICE_ACCOUNT` | `culverin-store@<project-id>.iam.gserviceaccount.com`                                        |
| `CWS_PUBLISHER_ID`    | The publisher ID from the Developer Dashboard                                                |

These values are identifiers rather than credentials, but this document keeps them as placeholders. Read the current values from the environment's settings page.

## When a run fails

| Failed step                  | What to do                                                                                                                  |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Authenticate to Google Cloud | Check the provider, attribute condition, service account roles, and environment variables, then re-run the job.             |
| Upload the ZIP               | Read the error, fix the cause, and re-run the job. If the workflow file is at fault, upload the same ZIP in the dashboard.  |
| Submit for review            | Check the dashboard. A re-run may fail at the upload because the version has not increased, so submit from there if needed. |

A re-run uses the workflow file from the tagged commit, so a fix to the workflow applies from the next release. The store upload must always be the ZIP attached to the GitHub release, never a rebuild.

## Limits

- The Chrome Web Store rejects an upload unless the manifest version has increased.
- If visibility was changed manually in the dashboard, publish manually once before using the API again.

## Revoking access

Remove the service account from the Developer Dashboard, or remove the two role grants from the service account. Either one stops the workflow from publishing, and there is no key to rotate.

## References

- [Use the Chrome Web Store API](https://developer.chrome.com/docs/webstore/using-api)
- [Service accounts for the Chrome Web Store API](https://developer.chrome.com/docs/webstore/service-accounts)
- [`google-github-actions/auth`](https://github.com/google-github-actions/auth)
