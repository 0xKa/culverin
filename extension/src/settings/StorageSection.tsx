import { ExternalLink } from "../ui/ExternalLink";
import { sendSettings } from "./client";
import { useEffect, useRef, useState } from "preact/hooks";
import { defaultIgnore, effectiveRulesHash } from "../counter/rules";
import {
  cachedResultSummaries,
  privateCache,
  publicCache,
  type CacheOptions,
  type CachedResultSummary,
} from "../github/cache";
import { formatBytes } from "../ui/format";
import { Separator } from "../ui/Separator";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { tip } from "../ui/tooltip";
import { Eye, Trash } from "lucide-preact";
import { ResultDialog } from "./ResultDialog";
import { cacheSummary, relativeTime } from "./cache-list";
import { ActionStatus, useAction, type ActionOptions } from "./ActionStatus";
import { Panel, SectionHeader } from "./layout";

const exact = (time: number) =>
  new Date(time).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });

const clearActions = {
  public: {
    type: "cache.clear-public",
    state: "public-cache-cleared",
    message: "Public results cleared.",
  },
  private: {
    type: "auth.clear-private-session",
    state: "cleared",
    message: "Private results cleared.",
  },
  all: {
    type: "cache.clear-all",
    state: "all-results-cleared",
    message: "All results cleared.",
  },
} as const;

type ClearScope = keyof typeof clearActions;

function CacheList({
  id,
  options,
  busy,
  onDelete,
}: {
  id: string;
  options: CacheOptions;
  busy: boolean;
  onDelete: (entry: CachedResultSummary) => Promise<boolean>;
}) {
  const [entries, setEntries] = useState<CachedResultSummary[]>();
  const [used, setUsed] = useState(0);
  const [defaultHash, setDefaultHash] = useState<string>();
  const [inspected, setInspected] = useState<CachedResultSummary>();
  const [focusAfter, setFocusAfter] = useState<{
    removed: string;
    next?: string;
  }>();
  const list = useRef<HTMLDivElement>(null);
  const summary = useRef<HTMLParagraphElement>(null);
  const now = Date.now();

  useEffect(() => {
    const load = () =>
      void Promise.all([
        chrome.storage.local.get(options.key),
        chrome.storage.local.getBytesInUse(options.key),
      ])
        .then(([state, bytes]) => {
          setEntries(cachedResultSummaries(state[options.key], options));
          setUsed(bytes);
        })
        .catch(() => setEntries([]));
    const changed = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area === "local" && options.key in changes) load();
    };
    load();
    void effectiveRulesHash(defaultIgnore).then(setDefaultHash);
    chrome.storage.onChanged.addListener(changed);
    return () => chrome.storage.onChanged.removeListener(changed);
  }, [options]);

  useEffect(() => {
    if (
      !focusAfter ||
      busy ||
      !entries ||
      entries.some((entry) => entry.identity === focusAfter.removed)
    )
      return;
    setFocusAfter(undefined);
    if (document.activeElement && document.activeElement !== document.body)
      return;
    const next =
      focusAfter.next &&
      list.current?.querySelector<HTMLButtonElement>(
        `[data-delete="${CSS.escape(focusAfter.next)}"]`,
      );
    (next || summary.current)?.focus();
  }, [focusAfter, busy, entries]);

  function remove(entry: CachedResultSummary, index: number): void {
    const next = (entries?.[index + 1] ?? entries?.[index - 1])?.identity;
    void onDelete(entry).then((deleted) => {
      if (deleted) setFocusAfter({ removed: entry.identity, next });
    });
  }

  if (!entries) return null;
  const share = Math.min(100, (used / options.bytes) * 100);
  return (
    <div ref={list} id={`${id}-list`} className="mt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p
          ref={summary}
          id={`${id}-summary`}
          tabIndex={-1}
          className="m-0 font-medium"
        >
          {cacheSummary(entries)}
        </p>
        <span className="text-muted tabular text-sm">
          {formatBytes(used)} of {formatBytes(options.bytes)} used
        </span>
      </div>
      <span
        aria-hidden="true"
        className="bg-track mt-2 block h-1.5 overflow-hidden forced-colors:border forced-colors:border-[CanvasText]"
      >
        <span
          className="bg-accent block h-full transition-[width] duration-200 ease-(--ease-out-quick) forced-colors:bg-[CanvasText]"
          style={{ width: `${Math.max(share, used > 0 ? 1 : 0)}%` }}
        />
      </span>
      <p className="text-muted m-0 mt-2 text-sm">
        Holds up to {options.entries} results. When full, the results viewed
        least recently are removed first.
      </p>
      {entries.length > 0 && (
        <div className="border-divider -mx-4 mt-4 -mb-4 overflow-x-auto rounded-b-xl border-t">
          <table className="w-full min-w-[700px] table-fixed border-collapse text-left text-sm">
            <colgroup>
              <col />
              <col className="w-26" />
              <col className="w-20" />
              <col className="w-30" />
              <col className="w-30" />
              <col className="w-20" />
            </colgroup>
            <thead>
              <tr className="border-divider text-muted border-b text-xs">
                <th className="py-2 pr-4 pl-4 font-medium">Repository</th>
                <th className="py-2 pr-4 text-right font-medium">Code lines</th>
                <th className="py-2 pr-4 text-right font-medium">Files</th>
                <th className="py-2 pr-4 font-medium">Counted</th>
                <th className="py-2 pr-4 font-medium">Last viewed</th>
                <th className="py-2 pr-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, index) => (
                <tr
                  key={entry.identity}
                  className="border-divider hover:bg-surface border-b transition-colors duration-150 last:border-b-0"
                >
                  <td className="py-2.5 pr-4 pl-4 align-top wrap-anywhere">
                    <ExternalLink
                      href={`https://github.com/${entry.owner}/${entry.name}`}
                      className="font-medium no-underline hover:underline"
                    >
                      {entry.owner}/{entry.name}
                    </ExternalLink>
                    <div className="text-muted mt-0.5 text-xs">
                      <span className="font-mono">{entry.sha.slice(0, 7)}</span>
                      {entry.topLanguage && (
                        <>
                          <Separator />
                          mostly {entry.topLanguage}
                        </>
                      )}
                      {defaultHash && entry.rulesHash !== defaultHash && (
                        <>
                          <Separator />
                          custom ignore
                        </>
                      )}
                    </div>
                  </td>
                  <td className="py-2.5 font-mono pr-4 text-right align-top">
                    {entry.codeLines.toLocaleString()}
                  </td>
                  <td className="py-2.5 font-mono pr-4 text-right align-top">
                    {entry.files.toLocaleString()}
                  </td>
                  <td
                    className="py-2.5 pr-4 align-top whitespace-nowrap"
                    {...tip(exact(entry.storedAt), { side: "top" })}
                  >
                    {relativeTime(entry.storedAt, now)}
                  </td>
                  <td
                    className="py-2.5 pr-4 align-top whitespace-nowrap"
                    {...tip(exact(entry.lastAccess), { side: "top" })}
                  >
                    {relativeTime(entry.lastAccess, now)}
                  </td>
                  <td className="py-1.5 pr-2 text-right align-top whitespace-nowrap">
                    <IconButton
                      type="button"
                      tip={{ side: "left" }}
                      label={`Show details for ${entry.owner}/${entry.name} at ${entry.sha.slice(0, 7)}`}
                      onClick={() => setInspected(entry)}
                    >
                      <Eye />
                    </IconButton>
                    <IconButton
                      type="button"
                      tone="danger"
                      tip={{ side: "left" }}
                      label={`Delete result for ${entry.owner}/${entry.name} at ${entry.sha.slice(0, 7)}`}
                      className="disabled:pointer-events-none disabled:opacity-50"
                      data-delete={entry.identity}
                      disabled={busy}
                      onClick={() => remove(entry, index)}
                    >
                      <Trash />
                    </IconButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {inspected && (
        <ResultDialog
          entry={inspected}
          counted={exact(inspected.storedAt)}
          onClose={() => setInspected(undefined)}
        />
      )}
    </div>
  );
}

export function StorageSection({ hidden }: { hidden: boolean }) {
  const [busy, setBusy] = useState(false);
  const actions = {
    public: useAction(),
    private: useAction(),
    all: useAction(),
  };

  async function act(
    scope: ClearScope,
    request: () => Promise<boolean>,
    options: ActionOptions,
  ): Promise<boolean> {
    setBusy(true);
    const done = await actions[scope].run(async () => {
      if (!(await request())) throw new Error("Request failed");
    }, options);
    setBusy(false);
    return done;
  }

  function remove(
    scope: "public" | "private",
    entry: CachedResultSummary,
  ): Promise<boolean> {
    return act(
      scope,
      async () => {
        const reply = await sendSettings({
          type: "cache.delete",
          scope,
          identity: entry.identity,
        });
        if (reply?.state !== "result-deleted") return false;
        const cache = scope === "public" ? publicCache : privateCache;
        const stored = await chrome.storage.local.get(cache.key);
        return !cachedResultSummaries(stored[cache.key], cache).some(
          (saved) => saved.identity === entry.identity,
        );
      },
      {
        label: "Deleted",
        message: `Deleted the result for ${entry.owner}/${entry.name} at ${entry.sha.slice(0, 7)}.`,
        failure: "Couldn't delete. Try again.",
      },
    );
  }

  function clear(scope: ClearScope): void {
    const action = clearActions[scope];
    void act(
      scope,
      async () =>
        (await sendSettings({ type: action.type }))?.state === action.state,
      {
        label: "Cleared",
        message: action.message,
        failure: "Couldn't clear. Try again.",
      },
    );
  }

  return (
    <section aria-labelledby="storage-heading" hidden={hidden}>
      <SectionHeader id="storage-heading" title="Storage">
        Clearing saved results keeps your settings and GitHub connection.
      </SectionHeader>
      <div className="grid gap-4">
        <Panel
          title="Public results"
          className="min-w-0"
          titleId="cache-heading"
          actions={
            <div className="flex items-center gap-3">
              <ActionStatus id="status" state={actions.public.state} />
              <Button
                id="clear-public"
                type="button"
                size="md"
                disabled={busy}
                onClick={() => clear("public")}
              >
                Clear public results
              </Button>
            </div>
          }
        >
          <p className="text-muted m-0">
            Complete public results are stored locally for reuse. Culverin
            checks repository visibility before showing a cached result.
          </p>
          <CacheList
            id="cache"
            options={publicCache}
            busy={busy}
            onDelete={(entry) => remove("public", entry)}
          />
        </Panel>
        <Panel
          title="Private results"
          className="min-w-0"
          titleId="private-heading"
          actions={
            <div className="flex items-center gap-3">
              <ActionStatus id="private-status" state={actions.private.state} />
              <Button
                id="clear-private"
                type="button"
                size="md"
                disabled={busy}
                onClick={() => clear("private")}
              >
                Clear private results
              </Button>
            </div>
          }
        >
          <p className="text-muted m-0">
            Complete results for private repositories are stored separately and
            shown only after GitHub confirms your connection can still read the
            repository. They are also deleted when you disconnect GitHub.
          </p>
          <CacheList
            id="private"
            options={privateCache}
            busy={busy}
            onDelete={(entry) => remove("private", entry)}
          />
        </Panel>
        <div className="border-error/30 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-xl border border-dashed p-4">
          <div>
            <p className="m-0 font-medium">Clear everything</p>
            <p className="text-muted m-0 mt-0.5 text-sm">
              Removes every saved public and private result.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <ActionStatus id="all-status" state={actions.all.state} />
            <Button
              id="clear-all"
              type="button"
              size="md"
              variant="danger"
              disabled={busy}
              onClick={() => clear("all")}
            >
              Clear all results
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
