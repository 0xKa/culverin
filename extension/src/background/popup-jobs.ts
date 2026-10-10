import type { AnalysisResultV2 } from "../counter/result";
import {
  validPopupPublicRequest,
  type PublicPayload,
  type PublicRequest,
  type SummaryUpdate,
} from "../github/public-protocol";
import { pageRepository, sameRepository } from "../github/repository";
import type { createPublicAnalysis } from "./analysis";
import type { BackgroundResources } from "./resources";
import { popupOwner, publicReply } from "./senders";

export function createPopupJobs(
  resources: BackgroundResources,
  analysis: ReturnType<typeof createPublicAnalysis>,
) {
  const { chrome, coordinator, pending, currentRules, defaultRulesHash } =
    resources;
  const popupPorts = new Set<chrome.runtime.Port>();
  type PopupViewer = {
    port: chrome.runtime.Port;
    request: PublicRequest;
  };
  type PopupJob = {
    owner: string;
    requestId: string;
    repository: { owner: string; name: string };
    viewer?: PopupViewer;
  };
  const popupJobs = new Map<number, PopupJob>();
  type PageJob = {
    owner: string;
    requestId: string;
    repository: { owner: string; name: string };
    cancel: () => void;
    viewer?: PopupViewer;
  };
  const pageJobs = new Map<number, PageJob>();
  function pageJobAlive(job: PageJob): boolean {
    return (
      pending.get(job.owner)?.requestId === job.requestId ||
      coordinator.isSubscribed(job.owner, job.requestId)
    );
  }
  function trackPageJob(
    tabId: number,
    job: Omit<PageJob, "viewer">,
  ): {
    progress: (
      phase:
        "resolving" | "queued" | "downloading" | "decompressing" | "counting",
      processedBytes?: number,
    ) => void;
    settle: (payload: PublicPayload) => void;
  } {
    const entry: PageJob = { ...job };
    pageJobs.set(tabId, entry);
    return {
      progress: (phase, processedBytes) => {
        if (pageJobs.get(tabId) !== entry || !entry.viewer) return;
        postToPopup(entry.viewer.port, entry.viewer.request, {
          type: "analysis.progress",
          phase,
          ...(processedBytes === undefined ? {} : { processedBytes }),
        });
      },
      settle: (payload) => {
        if (pageJobs.get(tabId) !== entry) return;
        pageJobs.delete(tabId);
        if (entry.viewer)
          postToPopup(entry.viewer.port, entry.viewer.request, payload);
      },
    };
  }
  function forgetPageJobs(tabId: number, prefix = ""): void {
    if (pageJobs.get(tabId)?.owner.startsWith(prefix)) pageJobs.delete(tabId);
  }
  async function updateSummary(
    tabId: number,
    repository: { owner: string; name: string },
    result: AnalysisResultV2,
  ): Promise<void> {
    if (result.engine.rulesHash !== (await currentRules()).hash) return;
    const update: SummaryUpdate = {
      protocolVersion: 1,
      type: "summary.update",
      repository,
      totalCodeLines: result.totals.code,
      uncountedFiles: result.coverage.skippedByReason.oversized_source,
      totalFiles: result.coverage.regularFiles,
      totalBytes: result.coverage.totalBytes,
      customIgnore: result.engine.rulesHash !== (await defaultRulesHash),
    };
    await chrome.tabs
      .sendMessage(tabId, update, { frameId: 0 })
      .catch(() => undefined);
  }

  function postToPopup(
    port: chrome.runtime.Port,
    request: PublicRequest,
    payload: PublicPayload,
  ): void {
    if (popupPorts.has(port)) port.postMessage(publicReply(request, payload));
  }

  function settlePopupJob(
    tabId: number,
    job: PopupJob,
    payload: PublicPayload,
  ): void {
    if (popupJobs.get(tabId) !== job) return;
    popupJobs.delete(tabId);
    if (job.viewer) postToPopup(job.viewer.port, job.viewer.request, payload);
    if (payload.type === "analysis.completed")
      void updateSummary(tabId, job.repository, payload.result);
  }

  function endPopupJob(tabId: number, reason: string): void {
    const job = popupJobs.get(tabId);
    if (!job) return;
    settlePopupJob(tabId, job, {
      type: "analysis.failed",
      code: "analysis_canceled",
    });
    const resolving = pending.get(job.owner);
    if (resolving?.requestId === job.requestId) {
      resolving.controller.abort(reason);
      pending.delete(job.owner);
    }
    coordinator.detach(job.owner, job.requestId);
  }

  function handlePopupMessage(port: chrome.runtime.Port, value: unknown): void {
    if (!validPopupPublicRequest(value)) return;
    const { tabId, reanalyze, ...publicRequest } = value;
    const reply = (payload: PublicPayload) =>
      postToPopup(port, publicRequest, payload);
    if (publicRequest.type === "analysis.cancel") {
      const job = popupJobs.get(tabId);
      const targetRequestId = publicRequest.targetRequestId!;
      const pageJob = pageJobs.get(tabId);
      if (
        !job &&
        pageJob &&
        targetRequestId === pageJob.viewer?.request.requestId
      ) {
        pageJobs.delete(tabId);
        pageJob.cancel();
        reply({ type: "analysis.canceled", targetRequestId });
        return;
      }
      if (
        !job ||
        (targetRequestId !== job.requestId &&
          targetRequestId !== job.viewer?.request.requestId)
      ) {
        reply({ type: "analysis.failed", code: "analysis_interrupted" });
        return;
      }
      endPopupJob(tabId, "cancel");
      reply({ type: "analysis.canceled", targetRequestId });
      return;
    }
    void (async () => {
      let [activeTab] = await chrome.tabs.query({
        active: true,
        lastFocusedWindow: true,
      });
      const tab = await chrome.tabs.get(tabId);
      if (
        !activeTab &&
        port.sender?.tab === undefined &&
        tab.windowId !== undefined
      )
        [activeTab] = await chrome.tabs.query({
          active: true,
          windowId: tab.windowId,
        });
      const repository = pageRepository(tab.url ?? "");
      if (
        activeTab?.id !== tabId ||
        !repository ||
        (publicRequest.repository &&
          !sameRepository(publicRequest.repository, repository))
      ) {
        reply({ type: "analysis.failed", code: "invalid_repository" });
        return;
      }
      if (publicRequest.type === "analysis.status") {
        const running = popupJobs.get(tabId);
        const pageJob = pageJobs.get(tabId);
        if (
          !running &&
          pageJob &&
          sameRepository(repository, pageJob.repository) &&
          pageJobAlive(pageJob)
        ) {
          pageJob.viewer = { port, request: publicRequest };
          reply({
            type: "analysis.status",
            state:
              coordinator.status(pageJob.owner) === "queued"
                ? "queued"
                : "running",
          });
          return;
        }
        if (!running || !sameRepository(repository, running.repository)) {
          reply({ type: "analysis.status", state: "idle" });
          return;
        }
        running.viewer = { port, request: publicRequest };
        reply({
          type: "analysis.status",
          state:
            coordinator.status(running.owner) === "queued"
              ? "queued"
              : "running",
        });
        return;
      }
      const owner = popupOwner(tabId, publicRequest.navigationId);
      if (publicRequest.type === "repository.lookup") {
        analysis.run(publicRequest, {
          repository,
          owner,
          prefix: `u:${tabId}:`,
          page: false,
          isAlive: () => popupPorts.has(port),
          reply: (current, payload) => {
            postToPopup(port, current, payload);
            if (payload.type === "repository.cache_hit")
              void updateSummary(tabId, repository, payload.result);
          },
          progress: () => undefined,
        });
        return;
      }
      const next: PopupJob = {
        owner,
        requestId: publicRequest.requestId,
        repository,
        viewer: { port, request: publicRequest },
      };
      popupJobs.set(tabId, next);
      analysis.run(publicRequest, {
        repository,
        owner,
        prefix: `u:${tabId}:`,
        page: false,
        force: reanalyze === true,
        isAlive: () => popupJobs.get(tabId) === next,
        reply: (_current, payload) => settlePopupJob(tabId, next, payload),
        progress: (_current, phase, processedBytes) => {
          const viewer = next.viewer;
          if (popupJobs.get(tabId) !== next || !viewer) return;
          postToPopup(viewer.port, viewer.request, {
            type: "analysis.progress",
            phase,
            ...(processedBytes === undefined ? {} : { processedBytes }),
          });
        },
      });
    })().catch(() =>
      reply({ type: "analysis.failed", code: "invalid_repository" }),
    );
  }

  function attach(port: chrome.runtime.Port): void {
    popupPorts.add(port);
    port.onMessage.addListener((value: unknown) =>
      handlePopupMessage(port, value),
    );
    port.onDisconnect.addListener(() => {
      popupPorts.delete(port);
      for (const job of [...popupJobs.values(), ...pageJobs.values()])
        if (job.viewer?.port === port) job.viewer = undefined;
    });
  }
  function initialize(): void {
    chrome.tabs.onRemoved.addListener((tabId) => {
      endPopupJob(tabId, "navigation");
      forgetPageJobs(tabId);
    });
    chrome.tabs.onUpdated.addListener((tabId, _change, tab) => {
      const job = popupJobs.get(tabId);
      if (job && !sameRepository(pageRepository(tab.url ?? ""), job.repository))
        endPopupJob(tabId, "navigation");
    });
  }

  return { attach, initialize, trackPageJob, forgetPageJobs };
}
