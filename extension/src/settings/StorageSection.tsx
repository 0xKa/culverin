import { useState } from "preact/hooks";
import { Button } from "../ui/Button";
import { Status } from "../ui/Status";

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
    </section>
  );
}
