import { useEffect, useState } from "preact/hooks";
import { defaultIgnore, effectiveRulesHash } from "../counter/rules";
import {
  cachedResultSummaries,
  PUBLIC_CACHE_BYTES,
  PUBLIC_CACHE_ENTRIES,
  PUBLIC_CACHE_KEY,
  type CachedResultSummary,
} from "../github/cache";
import { formatBytes } from "../popup/size";
import { Button } from "../ui/Button";
import { Status } from "../ui/Status";
import { cacheSummary, relativeTime } from "./cache-list";

const exact = (time: number) =>
  new Date(time).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });

function CacheList() {
  const [entries, setEntries] = useState<CachedResultSummary[]>();
  const [used, setUsed] = useState(0);
  const [defaultHash, setDefaultHash] = useState<string>();
  const now = Date.now();

  useEffect(() => {
    const load = () =>
      void Promise.all([
        chrome.storage.local.get(PUBLIC_CACHE_KEY),
        chrome.storage.local.getBytesInUse(PUBLIC_CACHE_KEY),
      ])
        .then(([state, bytes]) => {
          setEntries(cachedResultSummaries(state[PUBLIC_CACHE_KEY]));
          setUsed(bytes);
        })
        .catch(() => setEntries([]));
    const changed = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area === "local" && PUBLIC_CACHE_KEY in changes) load();
    };
    load();
    void effectiveRulesHash(defaultIgnore).then(setDefaultHash);
    chrome.storage.onChanged.addListener(changed);
    return () => chrome.storage.onChanged.removeListener(changed);
  }, []);

  if (!entries) return null;
  return (
    <div id="cache-list" className="mt-3">
      <h3 className="mb-2 text-[1.17em] font-bold">Saved results</h3>
      <p id="cache-summary" className="m-0">
        {cacheSummary(entries)}
      </p>
      <p className="text-muted mt-0 mb-3">
        {formatBytes(used)} of {formatBytes(PUBLIC_CACHE_BYTES)} used, up to{" "}
        {PUBLIC_CACHE_ENTRIES} results. When full, the results viewed least
        recently are removed first.
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
  const [cacheStatus, setCacheStatus] = useState("");

  function clearPublic(): void {
    chrome.runtime.sendMessage(
      {
        protocolVersion: 1,
        type: "cache.clear-public",
        requestId: crypto.randomUUID(),
        navigationId: crypto.randomUUID(),
      },
      (reply: { state?: string } | undefined) => {
        setCacheStatus(
          !chrome.runtime.lastError && reply?.state === "public-cache-cleared"
            ? "Public cache cleared."
            : "Extension unavailable. Try again.",
        );
      },
    );
  }

  return (
    <section aria-labelledby="storage-heading" hidden={hidden}>
      <h2 id="storage-heading" className="mb-4 text-[1.5em] font-bold">
        Storage
      </h2>
      <h3 id="cache-heading" className="mb-2 text-[1.17em] font-bold">
        Public result cache
      </h3>
      <p>
        Complete public results are stored locally for reuse. Culverin checks
        repository visibility before showing a cached result.
      </p>
      <Button
        id="clear-public"
        type="button"
        className="my-3 px-3 py-[7px]"
        onClick={clearPublic}
      >
        Clear public cache
      </Button>
      <Status id="status" className="min-h-[1.5em] whitespace-pre-wrap">
        {cacheStatus}
      </Status>
      <CacheList />
    </section>
  );
}
