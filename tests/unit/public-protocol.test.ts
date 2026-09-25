import { expect, test } from "bun:test";
import { pageRepository } from "../../extension/src/content/repository";
import {
  publicFailure,
  validEnvelope,
  validPublicReply,
  validPublicRequest,
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
    "https://github.com/owner/repo/issues",
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
    schemaVersion: 1,
    repository: { id: "42" },
    revision: { commitSha: sha },
    engine: {
      name: "tokei",
      version: "15.0.0",
      wrapperVersion: "1",
      rulesProfile: "source-v1",
      rulesVersion: "1",
      rulesHash: "b".repeat(64),
      coveragePolicyVersion: "1",
    },
    totals: { files: 0, lines: 0, code: 0, comments: 0, blanks: 0 },
    languages: [],
    coverage: {
      regularFiles: 0,
      countedFiles: 0,
      analyzedBytes: 0,
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
