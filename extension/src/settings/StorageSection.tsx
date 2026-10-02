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
import { Button } from "../ui/Button";
import { Status } from "../ui/Status";
import { cacheSummary, relativeTime } from "./cache-list";

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

function CacheList({ id, options }: { id: string; options: CacheOptions }) {
  const [entries, setEntries] = useState<CachedResultSummary[]>();
  const [used, setUsed] = useState(0);
  const [defaultHash, setDefaultHash] = useState<string>();
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
  return (
    <div id={`${id}-list`} className="mt-3">
      <p id={`${id}-summary`} className="m-0">
        {cacheSummary(entries)}
      </p>
      <p className="text-muted mt-0 mb-3">
        {formatBytes(used)} of {formatBytes(options.bytes)} used, up to{" "}
        {options.entries} results. When full, the results viewed least recently
        are removed first.
      </p>
      {entries.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-divider border-b">
                <th className="py-1.5 pr-4 font-semibold">Repository</th>
                <th className="py-1.5 pr-4 text-right font-semibold">
                  Code lines
                </th>
                <th className="py-1.5 pr-4 text-right font-semibold">Files</th>
                <th className="py-1.5 pr-4 font-semibold">Counted</th>
                <th className="py-1.5 font-semibold">Last viewed</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.identity} className="border-divider border-b">
                  <td className="py-1.5 pr-4 align-top">
                    <a
                      href={`https://github.com/${entry.owner}/${entry.name}`}
                      target="_blank"
                      rel="noreferrer"
                      className="underline"
                    >
                      {entry.owner}/{entry.name}
                    </a>
                    <div className="text-muted text-[0.9em]">
                      <span className="font-mono">{entry.sha.slice(0, 7)}</span>
                      {entry.topLanguage && ` · mostly ${entry.topLanguage}`}
                      {defaultHash &&
                        entry.rulesHash !== defaultHash &&
                        " · custom ignore"}
                    </div>
                  </td>
                  <td className="py-1.5 pr-4 text-right align-top tabular-nums">
                    {entry.codeLines.toLocaleString()}
                  </td>
                  <td className="py-1.5 pr-4 text-right align-top tabular-nums">
                    {entry.files.toLocaleString()}
                  </td>
                  <td
                    className="py-1.5 pr-4 align-top whitespace-nowrap"
                    title={exact(entry.storedAt)}
                  >
                    {relativeTime(entry.storedAt, now)}
                  </td>
                  <td
                    className="py-1.5 align-top whitespace-nowrap"
                    title={exact(entry.lastAccess)}
                  >
                    {relativeTime(entry.lastAccess, now)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
      <h2 id="storage-heading" className="mb-4 text-[1.5em] font-bold">
        Storage
      </h2>
      <p className="text-muted mb-6">
        Clearing saved results keeps your settings and GitHub connection.
      </p>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 id="cache-heading" className="text-[1.17em] font-bold">
          Public results
        </h3>
        <Button
          id="clear-public"
          type="button"
          className="px-3 py-[7px]"
          disabled={busy}
          onClick={() => clear("public")}
        >
          Clear public results
        </Button>
      </div>
      <p>
        Complete public results are stored locally for reuse. Culverin checks
        repository visibility before showing a cached result.
      </p>
      <Status id="status">
        {status?.scope === "public" && status.message}
      </Status>
      <CacheList id="cache" options={publicCache} />
      <div className="mt-6 mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 id="private-heading" className="text-[1.17em] font-bold">
          Private results
        </h3>
        <Button
          id="clear-private"
          type="button"
          className="px-3 py-[7px]"
          disabled={busy}
          onClick={() => clear("private")}
        >
          Clear private results
        </Button>
      </div>
      <p>
        Complete results for private repositories are stored separately and
        shown only after GitHub confirms your connection can still read the
        repository. They are also deleted when you disconnect GitHub.
      </p>
      <Status id="private-status">
        {status?.scope === "private" && status.message}
      </Status>
      <CacheList id="private" options={privateCache} />
      <div className="border-divider mt-6 border-t pt-4">
        <Button
          id="clear-all"
          type="button"
          className="border-error/60! px-3 py-[7px]"
          disabled={busy}
          onClick={() => clear("all")}
        >
          Clear all results
        </Button>
        <Status id="all-status" className="mt-2">
          {status?.scope === "all" && status.message}
        </Status>
      </div>
    </section>
  );
}
