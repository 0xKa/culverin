import type { AnalysisResultV2 } from "../../../extension/src/counter/result";
import type { PublicPayload } from "../../../extension/src/github/public-protocol";
import {
  defaultIgnore,
  effectiveRulesHash,
} from "../../../extension/src/counter/rules";
export async function result(
  id = "42",
  sha = "a".repeat(40),
): Promise<AnalysisResultV2> {
  return {
    schemaVersion: 2,
    repository: { id },
    revision: { commitSha: sha },
    engine: {
      name: "tokei",
      version: "15.0.0",
      wrapperVersion: "3",
      rulesProfile: "source-v1",
      rulesVersion: "2",
      rulesHash: await effectiveRulesHash(defaultIgnore),
      coveragePolicyVersion: "2",
    },
    totals: { files: 0, lines: 0, code: 0, comments: 0, blanks: 0 },
    languages: [],
    otherFiles: { files: 0, lines: 0, extensions: [], moreExtensions: 0 },
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
        unsupported_notebook: 0,
      },
      complete: true,
      incompleteReasons: [],
    },
  };
}

export async function completedResult(): Promise<
  Extract<PublicPayload, { type: "analysis.completed" }>
> {
  return {
    type: "analysis.completed",
    fromCache: false,
    result: await result(),
    resolution: {
      repositoryId: "42",
      owner: "culverin",
      name: "sample",
      defaultBranch: "main",
      visibility: "public",
      sha: "a".repeat(40),
      sizeKb: 1,
      resolvedAt: Date.now(),
    },
  };
}
