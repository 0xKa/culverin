import { ExternalLink } from "../ui/ExternalLink";
import { sendSettings } from "./client";
import { useEffect, useState } from "preact/hooks";
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
import { EyeIcon, TrashIcon } from "../ui/icons";
import { ResultDialog } from "./ResultDialog";
import { Status } from "../ui/Status";
import { cacheSummary, relativeTime } from "./cache-list";
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
  onDelete: (entry: CachedResultSummary) => void;
}) {
  const [entries, setEntries] = useState<CachedResultSummary[]>();
  const [used, setUsed] = useState(0);
  const [defaultHash, setDefaultHash] = useState<string>();
  const [inspected, setInspected] = useState<CachedResultSummary>();
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

  if (!entries) return null;
  const share = Math.min(100, (used / options.bytes) * 100);
  return (
    <div id={`${id}-list`} className="mt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p id={`${id}-summary`} className="m-0 font-medium">
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
          <table className="w-full border-collapse text-left text-sm">
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
              {entries.map((entry) => (
                <tr
                  key={entry.identity}
                  className="border-divider hover:bg-surface border-b transition-colors duration-150 last:border-b-0"
                >
                  <td className="py-2.5 pr-4 pl-4 align-top">
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
                    title={exact(entry.storedAt)}
                  >
                    {relativeTime(entry.storedAt, now)}
                  </td>
                  <td
                    className="py-2.5 pr-4 align-top whitespace-nowrap"
                    title={exact(entry.lastAccess)}
                  >
                    {relativeTime(entry.lastAccess, now)}
                  </td>
                  <td className="py-1.5 pr-2 text-right align-top whitespace-nowrap">
                    <IconButton
                      type="button"
                      label={`Show details for ${entry.owner}/${entry.name} at ${entry.sha.slice(0, 7)}`}
                      onClick={() => setInspected(entry)}
                    >
                      <EyeIcon />
                    </IconButton>
                    <IconButton
                      type="button"
                      tone="danger"
                      label={`Delete result for ${entry.owner}/${entry.name} at ${entry.sha.slice(0, 7)}`}
                      className="disabled:pointer-events-none disabled:opacity-50"
                      disabled={busy}
                      onClick={() => onDelete(entry)}
                    >
                      <TrashIcon />
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
  const [status, setStatus] = useState<{
    scope: ClearScope;
    message: string;
  }>();

  function remove(
    scope: "public" | "private",
    entry: CachedResultSummary,
  ): void {
    setBusy(true);
    setStatus(undefined);
    void sendSettings({
      type: "cache.delete",
      scope,
      identity: entry.identity,
    }).then((reply) => {
      setBusy(false);
      setStatus({
        scope,
        message:
          reply?.state === "result-deleted"
            ? `Deleted the result for ${entry.owner}/${entry.name} at ${entry.sha.slice(0, 7)}.`
            : "Couldn't delete the result. Try again.",
      });
    });
  }

  function clear(scope: ClearScope): void {
    const action = clearActions[scope];
    setBusy(true);
    setStatus(undefined);
    void sendSettings({ type: action.type }).then((reply) => {
      setBusy(false);
      setStatus({
        scope,
        message:
          reply?.state === action.state
            ? action.message
            : "Couldn't clear saved results. Try again.",
      });
    });
  }

  return (
    <section aria-labelledby="storage-heading" hidden={hidden}>
      <SectionHeader id="storage-heading" title="Storage">
        Clearing saved results keeps your settings and GitHub connection.
      </SectionHeader>
      <div className="grid gap-4">
        <Panel
          title="Public results"
          titleId="cache-heading"
          actions={
            <Button
              id="clear-public"
              type="button"
              size="md"
              disabled={busy}
              onClick={() => clear("public")}
            >
              Clear public results
            </Button>
          }
        >
          <p className="text-muted m-0">
            Complete public results are stored locally for reuse. Culverin
            checks repository visibility before showing a cached result.
          </p>
          <Status id="status" className="m-0 text-sm not-empty:mt-2">
            {status?.scope === "public" && status.message}
          </Status>
          <CacheList
            id="cache"
            options={publicCache}
            busy={busy}
            onDelete={(entry) => remove("public", entry)}
          />
        </Panel>
        <Panel
          title="Private results"
          titleId="private-heading"
          actions={
            <Button
              id="clear-private"
              type="button"
              size="md"
              disabled={busy}
              onClick={() => clear("private")}
            >
              Clear private results
            </Button>
          }
        >
          <p className="text-muted m-0">
            Complete results for private repositories are stored separately and
            shown only after GitHub confirms your connection can still read the
            repository. They are also deleted when you disconnect GitHub.
          </p>
          <Status id="private-status" className="m-0 text-sm not-empty:mt-2">
            {status?.scope === "private" && status.message}
          </Status>
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
          <Status id="all-status" className="m-0 w-full text-sm empty:-mt-3">
            {status?.scope === "all" && status.message}
          </Status>
        </div>
      </div>
    </section>
  );
}
