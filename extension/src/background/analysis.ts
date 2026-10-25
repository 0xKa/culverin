import type { createAuthService } from "./auth";
import type { BackgroundResources } from "./resources";
export type PublicClient = {
  repository: { owner: string; name: string };
  target?: RefTarget;
  owner: string;
  prefix: string;
  page: boolean;
  force?: boolean;
  isAlive: () => boolean;
  reply: (request: PublicRequest, payload: PublicPayload) => void;
  progress: (
    request: PublicRequest,
    phase:
      "resolving" | "queued" | "downloading" | "decompressing" | "counting",
    processedBytes?: number,
    startedAt?: number,
    processedFiles?: number,
  ) => void;
};

import { ARCHIVE_TIMEOUTS, DOWNLOAD_LIMITS } from "../archive/limits";
import { readDownloadLimit } from "../counting/download-limit";
import { readCountTrigger } from "../counting/trigger";
import {
  countTiming,
  resolutionIdentity,
  resultIdentity,
  type ResultCache,
} from "../github/cache";
import { AcquisitionError, safeFailure } from "../github/client";
import {
  publicFailure,
  refLabel,
  withRef,
  type PublicPayload,
  type PublicRequest,
} from "../github/public-protocol";
import { refPrefixes, type RefTarget } from "../github/repository";

export function createPublicAnalysis(
  resources: BackgroundResources,
  authService: ReturnType<typeof createAuthService>,
) {
  const {
    ready,
    connection,
    coordinator,
    cache,
    privateResults,
    refs,
    currentRules,
    pending,
    detachPending,
    interrupted,
    clearInterrupted,
    claimAutoCount,
  } = resources;
  const { resolveFor, accessFailure } = authService;
  const { bucket, limitedUntil, markLimited } = resources.rates;
  function runPublicRequest(
    request: PublicRequest,
    client: PublicClient,
  ): void {
    const { repository, owner, target } = client;
    const reply = (payload: PublicPayload) => client.reply(request, payload);
    void (async () => {
      await ready;
      if (!client.isAlive()) {
        reply({ type: "analysis.failed", code: "analysis_interrupted" });
        return;
      }
      if (!resources.acceptRequest(request.requestId)) {
        reply({ type: "analysis.failed", code: "invalid_repository" });
        return;
      }
      const granted = resources.takeAutoGrant(owner);
      if (request.type === "analysis.status") {
        const state = coordinator.status(owner);
        const startedAt = coordinator.startedAt(owner);
        reply({
          type: "analysis.status",
          state:
            state !== "idle"
              ? state
              : (await interrupted(owner))
                ? "interrupted"
                : "idle",
          ...(state === "running" && startedAt !== undefined
            ? { startedAt }
            : {}),
        });
        return;
      }
      if (request.type === "analysis.cancel") {
        const target = request.targetRequestId!;
        if (resources.cancelRequest(owner, target))
          reply({ type: "analysis.canceled", targetRequestId: target });
        else reply({ type: "analysis.failed", code: "analysis_interrupted" });
        return;
      }
      if (
        !request.repository ||
        request.repository.owner.toLowerCase() !==
          repository.owner.toLowerCase() ||
        request.repository.name.toLowerCase() !== repository.name.toLowerCase()
      ) {
        reply({ type: "analysis.failed", code: "invalid_repository" });
        return;
      }
      if (request.type === "analysis.request") {
        const old = pending.get(owner);
        old?.controller.abort("navigation");
        pending.delete(owner);
        coordinator.detachDocument(client.prefix);
        detachPending(client.prefix);
        if (pending.size + coordinator.subscriptionCount() >= 32) {
          reply({ type: "analysis.failed", code: "analysis_busy" });
          return;
        }
      }
      const pageLookup = client.page && request.type === "repository.lookup";
      const trigger = pageLookup
        ? await readCountTrigger(resources.chrome.storage.sync)
        : "manual";
      const auth = await connection.auth();
      const limit = bucket(auth);
      const limited = (): PublicPayload | undefined =>
        Date.now() < limitedUntil(limit)
          ? {
              type: "analysis.failed",
              ...publicFailure("rate_limited", limitedUntil(limit)),
            }
          : undefined;
      if (pageLookup && trigger === "manual") {
        const hash = (await currentRules()).hash;
        const has = (results: ResultCache) =>
          (target
            ? results.hasRef(repository, target.path, hash)
            : results.hasRepository(repository, hash)
          ).catch(() => true);
        const known =
          (await has(cache)) ||
          (auth.token !== undefined && (await has(privateResults)));
        if (!known) {
          if (!client.isAlive()) return;
          reply(limited() ?? { type: "repository.not_cached" });
          return;
        }
      }
      const controller = new AbortController();
      if (request.type === "analysis.request")
        pending.set(owner, { requestId: request.requestId, controller });
      try {
        const base = `${auth.token ? auth.generation : "anonymous"}:${repository.owner.toLowerCase()}/${repository.name.toLowerCase()}`;
        const key = target ? `${base}@${target.path}` : base;
        const keys =
          target && !target.exact
            ? [
                key,
                ...refPrefixes(target.path)
                  .slice(0, -1)
                  .reverse()
                  .map((prefix) => `${base}@${prefix}/`),
              ]
            : [key];
        let nested: boolean | undefined;
        const kept = async () => {
          for (const each of keys) {
            const hit = await refs.peek(each);
            if (hit) return hit;
          }
          return undefined;
        };
        const resolved =
          !client.page && request.type === "repository.lookup"
            ? await kept()
            : (!client.force && keys.length > 1 && (await kept())) ||
              (await refs.resolveWithStatus(
                key,
                async () => {
                  if (Date.now() < limitedUntil(limit))
                    throw new Error("rate_limited");
                  const { nested: below, ...resolution } = await resolveFor(
                    repository,
                    auth,
                    target,
                  );
                  nested = below;
                  return { ...resolution, resolvedAt: Date.now() };
                },
                client.force,
                (envelope) => [
                  `${base}@${refLabel(envelope)}`,
                  ...(nested === false
                    ? [`${base}@${refLabel(envelope)}/`]
                    : []),
                  ...(envelope.ref === undefined ? [base] : []),
                ],
              ));
        if (!resolved) {
          if (client.isAlive())
            reply(limited() ?? { type: "repository.not_cached" });
          return;
        }
        const envelope = resolved.envelope;
        if (
          controller.signal.aborted ||
          !client.isAlive() ||
          (request.type === "analysis.request" &&
            pending.get(owner)?.requestId !== request.requestId)
        )
          return;
        const privateJob = envelope.visibility === "private";
        if (privateJob) {
          await resources.confirmPrivate(envelope);
          if (!auth.token) {
            reply({ type: "analysis.failed", code: "authentication_required" });
            return;
          }
        }
        const disconnected = async () =>
          privateJob && (await connection.generation()) !== auth.generation;
        const results: ResultCache = privateJob ? privateResults : cache;
        if (resolved.fresh && refs.isCurrent(resolved.epoch))
          results.allowRepository(envelope);
        const rules = await currentRules();
        const saved = await results
          .getWithTiming(envelope, rules.hash)
          .catch(() => undefined);
        const cached = saved?.result;
        const savedTiming = saved ? countTiming(saved) : {};
        if (controller.signal.aborted || !client.isAlive()) return;
        if (await disconnected()) {
          reply({ type: "analysis.failed", code: "analysis_interrupted" });
          return;
        }
        if (results.isRevoked(envelope.repositoryId)) {
          reply({ type: "analysis.failed", code: "repository_unavailable" });
          return;
        }
        if (
          cached &&
          !(
            request.type === "analysis.request" &&
            client.force &&
            cached.coverage.skippedByReason.oversized_source > 0 &&
            cached.coverage.oversizedFiles === undefined
          )
        ) {
          if (request.type === "repository.lookup")
            reply({
              type: "repository.cache_hit",
              resolution: envelope,
              result: cached,
              ...savedTiming,
            });
          else
            reply({
              type: "analysis.completed",
              resolution: envelope,
              result: cached,
              fromCache: true,
              ...savedTiming,
            });
          return;
        }
        if (request.type === "repository.lookup") {
          const rulesChanged = await results
            .hasOtherRules(envelope, rules.hash)
            .catch(() => false);
          const autoCount =
            trigger === "open" &&
            client.isAlive() &&
            (await claimAutoCount(resolutionIdentity(envelope, rules.hash)));
          if (controller.signal.aborted || !client.isAlive()) return;
          if (autoCount)
            resources.grantAutoCount(
              owner,
              resolutionIdentity(envelope, rules.hash),
            );
          reply({
            type: "repository.cache_miss",
            resolution: envelope,
            ...(rulesChanged ? { rulesChanged: true as const } : {}),
            ...(autoCount ? { autoCount: true as const } : {}),
          });
          return;
        }
        if (pending.get(owner)?.requestId !== request.requestId) return;
        pending.delete(owner);
        await clearInterrupted(owner);
        const semantic = resolutionIdentity(envelope, rules.hash);
        const automatic = granted === semantic;
        const downloadLimit = automatic
          ? DOWNLOAD_LIMITS.automatic
          : await readDownloadLimit(resources.chrome.storage.sync);
        const stale = await disconnected();
        if (controller.signal.aborted || !client.isAlive()) return;
        if (stale) {
          reply({ type: "analysis.failed", code: "analysis_interrupted" });
          return;
        }
        if (results.isRevoked(envelope.repositoryId)) {
          reply({ type: "analysis.failed", code: "repository_unavailable" });
          return;
        }
        const accepted = coordinator.subscribe(
          privateJob ? `private:${auth.generation}:${semantic}` : semantic,
          envelope,
          privateJob ? auth.token : undefined,
          privateJob ? auth.generation : "",
          {
            requestId: request.requestId,
            owner,
            public: true,
            automatic,
            limit: downloadLimit,
            onProgress: (phase, processedBytes, startedAt, processedFiles) =>
              client.progress(
                request,
                phase,
                processedBytes,
                startedAt,
                processedFiles,
              ),
            onComplete: async (output, current) => {
              if (
                !coordinator.isSubscribed(owner, request.requestId) ||
                !client.isAlive()
              )
                return;
              if (
                output.result.repository.id !== current.repositoryId ||
                output.result.revision.commitSha !== current.sha
              ) {
                reply({ type: "analysis.failed", code: "counter_failed" });
                return;
              }
              const replyInterrupted = () =>
                reply({
                  type: "analysis.failed",
                  code: "analysis_interrupted",
                });
              if (await disconnected()) {
                replyInterrupted();
                return;
              }
              const labelled = withRef(current, envelope.ref);
              await results
                .put(labelled, output.result, output)
                .catch(() => undefined);
              if (await disconnected()) {
                await results
                  .delete(resultIdentity(output.result))
                  .catch(() => undefined);
                replyInterrupted();
                return;
              }
              if (
                coordinator.isSubscribed(owner, request.requestId) &&
                client.isAlive()
              )
                reply({
                  type: "analysis.completed",
                  resolution: labelled,
                  result: output.result,
                  fromCache: false,
                  ...countTiming(output),
                });
            },
            onFailure: (error, signal) => {
              if (!client.isAlive()) return;
              const failure = resources.analysisFailure(error, signal, true);
              if (failure.code === "rate_limited")
                markLimited(
                  limit,
                  "retryAt" in failure ? failure.retryAt : undefined,
                );
              const limitBytes =
                "limitBytes" in failure ? failure.limitBytes : undefined;
              const capped =
                automatic &&
                ((failure.code === "compressed_limit_exceeded" &&
                  limitBytes === DOWNLOAD_LIMITS.automatic) ||
                  (failure.code === "decompressed_limit_exceeded" &&
                    limitBytes ===
                      DOWNLOAD_LIMITS.automatic *
                        DOWNLOAD_LIMITS.unpackedRatio));
              void (async () => {
                const manualLimit = capped
                  ? await readDownloadLimit(resources.chrome.storage.sync)
                  : 0;
                if (manualLimit > DOWNLOAD_LIMITS.automatic) {
                  reply({
                    type: "analysis.failed",
                    ...publicFailure(
                      "auto_download_limit",
                      undefined,
                      undefined,
                      manualLimit,
                    ),
                  });
                  return;
                }
                const code = await accessFailure(
                  failure.code,
                  auth,
                  repository,
                  false,
                );
                reply({
                  type: "analysis.failed",
                  ...publicFailure(
                    code,
                    "retryAt" in failure ? failure.retryAt : undefined,
                    "limit" in failure ? failure.limit : undefined,
                    limitBytes,
                  ),
                });
              })();
            },
          },
          ARCHIVE_TIMEOUTS.job,
          rules.ignore,
        );
        if (!accepted)
          reply({ type: "analysis.failed", code: "analysis_busy" });
      } catch (error) {
        if (!controller.signal.aborted && client.isAlive()) {
          const failure =
            error instanceof Error &&
            !(error instanceof AcquisitionError) &&
            (error.message === "rate_limited" ||
              error.message === "analysis_busy" ||
              error.message === "analysis_interrupted")
              ? {
                  code: error.message as
                    "rate_limited" | "analysis_busy" | "analysis_interrupted",
                  retryAt:
                    error.message === "rate_limited"
                      ? limitedUntil(limit)
                      : undefined,
                }
              : safeFailure(error, controller.signal);
          if (failure.code === "rate_limited")
            markLimited(limit, failure.retryAt);
          const code = await accessFailure(
            failure.code,
            auth,
            repository,
            true,
          );
          if (client.isAlive())
            reply({
              type: "analysis.failed",
              ...publicFailure(
                code,
                failure.retryAt,
                "limit" in failure ? failure.limit : undefined,
                "limitBytes" in failure ? failure.limitBytes : undefined,
              ),
            });
        }
      } finally {
        resources.finishPending(owner, request.requestId);
      }
    })().catch(() =>
      reply({ type: "analysis.failed", code: "internal_error" }),
    );
  }

  return { run: runPublicRequest };
}
