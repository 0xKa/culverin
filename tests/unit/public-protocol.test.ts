import { expect, test } from "bun:test";
import {
  pageContext,
  pageRepository,
} from "../../extension/src/content/repository";
import {
  publicFailure,
  validEnvelope,
  validPopupPublicRequest,
  validPublicReply,
  validPublicRequest,
  validSummaryUpdate,
} from "../../extension/src/github/public-protocol";

const requestId = "123e4567-e89b-42d3-a456-426614174000";
const navigationId = "123e4567-e89b-42d3-a456-426614174001";
const sha = "a".repeat(40);
const envelope = {
  repositoryId: "42",
  owner: "owner",
  name: "repo",
  defaultBranch: "main",
  visibility: "public",
  sha,
  sizeKb: 2048,
  resolvedAt: Date.now(),
};

test("accepts only GitHub repository overview routes", () => {
  expect(pageRepository("https://github.com/owner/repo")).toEqual({
    owner: "owner",
    name: "repo",
  });
  expect(pageRepository("https://github.com/owner/repo/")).toEqual({
    owner: "owner",
    name: "repo",
  });
  for (const url of [
    "https://github.com/owner/repo#readme",
    "https://github.com/owner/repo/#usage",
    "https://github.com/owner/repo#",
  ])
    expect(pageRepository(url)).toEqual({ owner: "owner", name: "repo" });
  for (const url of [
    "https://github.com/owner/repo/issues",
    "https://github.com/owner/repo/issues#readme",
    "https://github.com/owner/repo/tree/main",
    "https://github.com/owner/repo/pulls",
    "https://github.com/owner/repo?tab=code",
    "https://github.com/owner//repo",
    "https://evil.example/owner/repo",
    "https://github.com/owner/..",
    "https://github.com/owner",
  ])
    expect(pageRepository(url)).toBeUndefined();
});

test("anchors the summary after the visible About forks row", () => {
  const row = (visible: boolean, app: Element | null = null) =>
    ({
      checkVisibility: () => visible,
      closest: () => app,
    }) as unknown as Element;
  const link = (href: string, parent: Element) =>
    ({ parentElement: parent, getAttribute: () => href }) as unknown as Element;
  const app = (loaded: boolean) =>
    ({
      classList: { contains: (name: string) => loaded && name === "loaded" },
    }) as unknown as Element;
  const page = (links: Element[], nwo?: string) =>
    ({
      querySelectorAll(selector: string) {
        return selector === ".mt-2 > a[href]" ? links : [];
      },
      querySelector(selector: string) {
        return nwo !== undefined &&
          selector === 'meta[name="octolytics-dimension-repository_nwo"]'
          ? ({ getAttribute: () => nwo } as unknown as Element)
          : null;
      },
    }) as unknown as Document;
  const hidden = row(false);
  const forks = row(true);
  const document = page([
    link("/owner/repo/stargazers", row(true)),
    link("/Owner/Repo/forks", hidden),
    link("/other/repo/forks", row(true)),
    link("/owner/repo/forks", forks),
  ]);
  expect(pageContext("https://github.com/owner/repo", document)).toEqual({
    repository: { owner: "owner", name: "repo" },
    anchor: forks,
  });
  expect(
    pageContext("https://github.com/owner/repo/issues", document),
  ).toBeUndefined();
  expect(
    pageContext("https://github.com/OWNER/REPO#readme", document)?.anchor,
  ).toBe(forks);
  expect(
    pageContext(
      "https://github.com/owner/repo",
      page([link("/owner/repo/forks", hidden)]),
    ),
  ).toBeUndefined();
  expect(
    pageContext("https://github.com/owner/repo", page([])),
  ).toBeUndefined();
  const loaded = row(true, app(true));
  expect(
    pageContext(
      "https://github.com/owner/repo",
      page([link("/owner/repo/forks", loaded)]),
    )?.anchor,
  ).toBe(loaded);
});

test("starts from the repository marker and waits for GitHub hydration", () => {
  const hydrating = {
    classList: { contains: () => false },
  } as unknown as Element;
  const row = {
    checkVisibility: () => true,
    closest: () => hydrating,
  } as unknown as Element;
  const page = (links: Element[], nwo?: string) =>
    ({
      querySelectorAll: () => links,
      querySelector: (selector: string) =>
        nwo !== undefined &&
        selector === 'meta[name="octolytics-dimension-repository_nwo"]'
          ? ({ getAttribute: () => nwo } as unknown as Element)
          : null,
    }) as unknown as Document;
  expect(
    pageContext("https://github.com/owner/repo", page([], "Owner/Repo")),
  ).toEqual({ repository: { owner: "owner", name: "repo" } });
  for (const nwo of [undefined, "other/repo", "owner/repo-fork"])
    expect(
      pageContext("https://github.com/owner/repo", page([], nwo)),
    ).toBeUndefined();
  expect(
    pageContext("https://github.com/orgs/people", page([], "owner/repo")),
  ).toBeUndefined();
  expect(
    pageContext(
      "https://github.com/owner/repo",
      page([
        {
          parentElement: row,
          getAttribute: () => "/owner/repo/forks",
        } as unknown as Element,
      ]),
    ),
  ).toEqual({
    repository: { owner: "owner", name: "repo" },
    anchor: row,
    hydrating,
  });
});

test("lets only the page ask to open the toolbar popup", () => {
  const request = {
    protocolVersion: 1,
    type: "popup.open",
    requestId,
    navigationId,
  };
  expect(validPublicRequest(request)).toBe(true);
  expect(
    validPublicRequest({
      ...request,
      repository: { owner: "owner", name: "repo" },
    }),
  ).toBe(false);
  expect(validPopupPublicRequest({ ...request, tabId: 7 })).toBe(false);
  const reply = {
    protocolVersion: 1,
    type: "popup.opened",
    requestId,
    navigationId,
    opened: true,
  };
  expect(validPublicReply(reply, requestId, navigationId)).toBe(true);
  expect(
    validPublicReply({ ...reply, opened: "yes" }, requestId, navigationId),
  ).toBe(false);
  expect(
    validPublicReply({ ...reply, extra: true }, requestId, navigationId),
  ).toBe(false);
});

test("validates popup requests and compact page summary updates", () => {
  const popupRequest = {
    protocolVersion: 1,
    type: "repository.lookup",
    requestId,
    navigationId,
    repository: { owner: "owner", name: "repo" },
    tabId: 7,
  };
  expect(validPopupPublicRequest(popupRequest)).toBe(true);
  expect(validPopupPublicRequest({ ...popupRequest, tabId: -1 })).toBe(false);
  expect(validPopupPublicRequest({ ...popupRequest, token: "secret" })).toBe(
    false,
  );
  expect(validPopupPublicRequest({ ...popupRequest, other: true })).toBe(false);
  const update = {
    protocolVersion: 1,
    type: "summary.update",
    repository: { owner: "owner", name: "repo" },
    totalCodeLines: 125,
  };
  expect(validSummaryUpdate(update)).toBe(true);
  expect(validSummaryUpdate({ ...update, totalCodeLines: -1 })).toBe(false);
  expect(validSummaryUpdate({ ...update, totalCodeLines: "125" })).toBe(false);
  expect(validSummaryUpdate({ ...update, token: "secret" })).toBe(false);
});

test("requires closed messages and repository identity", () => {
  const valid = {
    protocolVersion: 1,
    type: "analysis.request",
    requestId,
    navigationId,
    repository: { owner: "owner", name: "repo" },
  };
  expect(validPublicRequest(valid)).toBe(true);
  expect(validPublicRequest({ ...valid, token: "secret" })).toBe(false);
  expect(
    validPublicRequest({
      ...valid,
      repository: { owner: "other", name: "../repo" },
    }),
  ).toBe(false);
  expect(validPublicRequest({ ...valid, requestId: "guessable" })).toBe(false);
  expect(
    validPublicRequest({
      ...valid,
      type: "analysis.cancel",
      targetRequestId: requestId,
    }),
  ).toBe(false);
  expect(
    validPublicRequest({
      protocolVersion: 1,
      type: "analysis.cancel",
      requestId,
      navigationId,
      targetRequestId: requestId,
    }),
  ).toBe(true);
});

test("validates envelope, correlation, and safe errors", () => {
  expect(validEnvelope(envelope)).toBe(true);
  expect(validEnvelope({ ...envelope, repositoryId: "0042" })).toBe(false);
  expect(validEnvelope({ ...envelope, resolvedAt: Infinity })).toBe(false);
  expect(validEnvelope({ ...envelope, sizeKb: null })).toBe(true);
  expect(validEnvelope({ ...envelope, sizeKb: 0 })).toBe(true);
  expect(validEnvelope({ ...envelope, sizeKb: -1 })).toBe(false);
  expect(validEnvelope({ ...envelope, sizeKb: 1.5 })).toBe(false);
  expect(validEnvelope({ ...envelope, sizeKb: "2048" })).toBe(false);
  const withoutSize: Partial<typeof envelope> = { ...envelope };
  delete withoutSize.sizeKb;
  expect(validEnvelope(withoutSize)).toBe(false);
  const reply = {
    protocolVersion: 1,
    type: "repository.cache_miss",
    requestId,
    navigationId,
    resolution: envelope,
  };
  expect(validPublicReply(reply, requestId, navigationId)).toBe(true);
  expect(validPublicReply(reply, requestId, crypto.randomUUID())).toBe(false);
  expect(
    validPublicReply(
      { ...reply, resolution: { ...envelope, visibility: "private" } },
      requestId,
      navigationId,
    ),
  ).toBe(false);
  expect(
    validPublicReply(
      { ...reply, archiveUrl: "secret" },
      requestId,
      navigationId,
    ),
  ).toBe(false);
  const result = {
    schemaVersion: 2,
    repository: { id: "42" },
    revision: { commitSha: sha },
    engine: {
      name: "tokei",
      version: "15.0.0",
      wrapperVersion: "2",
      rulesProfile: "source-v1",
      rulesVersion: "2",
      rulesHash: "b".repeat(64),
      coveragePolicyVersion: "1",
    },
    totals: { files: 0, lines: 0, code: 0, comments: 0, blanks: 0 },
    languages: [],
    coverage: {
      regularFiles: 0,
      countedFiles: 0,
      analyzedBytes: 0,
      totalBytes: 0,
      skippedFiles: 0,
      skippedByReason: {
        excluded_by_rule: 0,
        unsupported_language: 0,
        binary_content: 0,
        oversized_source: 0,
      },
      complete: true,
      incompleteReasons: [],
    },
  };
  const completed = {
    protocolVersion: 1,
    type: "analysis.completed",
    requestId,
    navigationId,
    resolution: envelope,
    result,
    fromCache: false,
  };
  expect(validPublicReply(completed, requestId, navigationId)).toBe(true);
  expect(
    validPublicReply(
      { ...completed, type: "repository.cache_hit", fromCache: undefined },
      requestId,
      navigationId,
    ),
  ).toBe(false);
  const hit = {
    protocolVersion: 1,
    type: "repository.cache_hit",
    requestId,
    navigationId,
    resolution: envelope,
    result,
  };
  expect(validPublicReply(hit, requestId, navigationId)).toBe(true);
  expect(
    validPublicReply(
      {
        ...hit,
        result: {
          ...result,
          coverage: {
            ...result.coverage,
            complete: false,
            incompleteReasons: ["counter_inaccurate"],
          },
        },
      },
      requestId,
      navigationId,
    ),
  ).toBe(false);
  expect(
    validPublicReply(
      { ...completed, fromCache: true },
      requestId,
      navigationId,
    ),
  ).toBe(true);
  expect(
    validPublicReply(
      { ...completed, fromCache: "yes" },
      requestId,
      navigationId,
    ),
  ).toBe(false);
  expect(
    validPublicReply(
      {
        ...completed,
        result: { ...result, revision: { commitSha: "c".repeat(40) } },
      },
      requestId,
      navigationId,
    ),
  ).toBe(false);
  expect(publicFailure("nonsense").code).toBe("internal_error");
  expect(
    publicFailure("rate_limited", Date.now() + 1000).retryAt,
  ).toBeDefined();
  expect(publicFailure("rate_limited", Infinity).retryAt).toBeUndefined();
});
