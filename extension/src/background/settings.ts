import { ARCHIVE_TIMEOUTS } from "../archive/limits";
import { resolutionIdentity } from "../github/cache";
import { resolveRepository, safeFailure } from "../github/client";
import { validRepository } from "../github/repository";
import {
  validSettingsRequest,
  type SettingsPayload,
} from "../protocol/settings";
import type { createAuthService } from "./auth";
import type { BackgroundResources } from "./resources";
import type { createSenderGates } from "./senders";
import { optionsOwner } from "./senders";

export function createSettingsHandler(
  resources: BackgroundResources,
  authService: ReturnType<typeof createAuthService>,
  gates: ReturnType<typeof createSenderGates>,
) {
  const {
    ready,
    connection,
    coordinator,
    optionRefs,
    cache,
    pending,
    currentRules,
    clearInterrupted,
    interrupted,
  } = resources;
  const { trackedFetch } = resources.rates;
  const VERSION = 1;
  function handleGithub(
    value: unknown,
    sender: chrome.runtime.MessageSender,
    respond: (value: unknown) => void,
  ): boolean {
    if (!gates.settings(sender) || !validSettingsRequest(value)) return false;
    const request = value;
    const documentId = sender.documentId!;
    const reply = (payload: SettingsPayload) =>
      respond({
        protocolVersion: VERSION,
        requestId: request.requestId,
        navigationId: request.navigationId,
        ...payload,
      });
    void (async () => {
      await ready;
      if (!resources.acceptRequest(request.requestId)) {
        reply({ state: "failed", code: "invalid_repository" });
        return;
      }
      if (await authService.handle(request, reply)) return;
      const owner = optionsOwner(documentId, request.navigationId);
      if (request.type === "analysis.cancel") {
        reply({
          state: resources.cancelRequest(owner, request.targetRequestId)
            ? "canceled"
            : "idle",
        });
        return;
      }
      if (request.type === "analysis.status") {
        const state = coordinator.status(owner);
        reply({
          state:
            state !== "idle"
              ? state
              : (await interrupted(owner))
                ? "interrupted"
                : "idle",
        });
        return;
      }
      if (
        (request.type === "repository.lookup" ||
          request.type === "analysis.request") &&
        typeof request.owner === "string" &&
        typeof request.name === "string" &&
        validRepository(request.owner, request.name)
      ) {
        if (request.type === "analysis.request") {
          pending.get(owner)?.controller.abort("navigation");
          pending.delete(owner);
          coordinator.detachOwner(owner);
          if (pending.size + coordinator.subscriptionCount() >= 32) {
            reply({ state: "busy" });
            return;
          }
        }
        const controller = new AbortController();
        if (request.type === "analysis.request")
          pending.set(owner, { requestId: request.requestId, controller });
        try {
          const auth = await connection.auth();
          const key = `options:${auth.generation}:${request.owner.toLowerCase()}/${request.name.toLowerCase()}`;
          const resolved = await optionRefs.resolveWithStatus(
            key,
            async () => ({
              ...(await resolveRepository(
                trackedFetch(auth.token !== undefined),
                request.owner!,
                request.name!,
                auth.token,
                AbortSignal.timeout(10_000),
              )),
              resolvedAt: Date.now(),
            }),
          );
          const envelope = resolved.envelope;
          if (controller.signal.aborted) return;
          if ((await connection.generation()) !== auth.generation) {
            reply({ state: "stale" });
            return;
          }
          if (envelope.visibility === "private") {
            await resources.confirmPrivate(envelope);
          }
          if (
            envelope.visibility === "public" &&
            resolved.fresh &&
            optionRefs.isCurrent(resolved.epoch)
          )
            cache.allowRepository(envelope);
          if (request.type === "repository.lookup") {
            reply({ state: "resolved", resolution: envelope });
            return;
          }
          if (pending.get(owner)?.requestId !== request.requestId) return;
          pending.delete(owner);
          await clearInterrupted(owner);
          const rules = await currentRules();
          const semantic = resolutionIdentity(envelope, rules.hash);
          if (controller.signal.aborted) return;
          const identity = auth.token
            ? `authorized:${auth.generation}:${semantic}`
            : semantic;
          const accepted = coordinator.subscribe(
            identity,
            envelope,
            auth.token,
            auth.generation,
            {
              requestId: request.requestId,
              owner,
              public: false,
              onProgress: () => undefined,
              onComplete: async (analysis, current) => {
                if (!coordinator.isSubscribed(owner, request.requestId)) return;
                if ((await connection.generation()) !== auth.generation) {
                  if (coordinator.isSubscribed(owner, request.requestId))
                    reply({ state: "stale" });
                  return;
                }
                if (current.visibility === "public")
                  await cache
                    .put(current, analysis.result)
                    .catch(() => undefined);
                if ((await connection.generation()) !== auth.generation) {
                  if (coordinator.isSubscribed(owner, request.requestId))
                    reply({ state: "stale" });
                  return;
                }
                if (coordinator.isSubscribed(owner, request.requestId))
                  reply({
                    state: "analyzed",
                    resolution: current,
                    ...analysis,
                  });
              },
              onFailure: (error, signal) =>
                reply({
                  state: "failed",
                  ...resources.analysisFailure(error, signal),
                }),
            },
            ARCHIVE_TIMEOUTS.job,
            rules.ignore,
          );
          if (!accepted) reply({ state: "busy" });
        } catch (error) {
          if (!controller.signal.aborted)
            reply({
              state: "failed",
              ...safeFailure(error, controller.signal),
            });
        } finally {
          resources.finishPending(owner, request.requestId);
        }
        return;
      }
      reply({ state: "failed", code: "invalid_repository" });
    })().catch(() => reply({ state: "failed", code: "network_unavailable" }));
    return true;
  }

  return { handle: handleGithub };
}
