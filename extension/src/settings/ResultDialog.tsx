import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { CachedResultSummary } from "../github/cache";
import { Details, OversizedFiles, Sizes, Totals } from "../popup/ResultParts";
import { resultView } from "../popup/view";
import { IconButton } from "../ui/IconButton";
import { X } from "lucide-preact";
import { StatusBadge } from "../ui/StatusBadge";
import { useNumberFormats } from "../appearance/useNumberFormats";

export function ResultDialog({
  entry,
  counted,
  onClose,
}: {
  entry: CachedResultSummary;
  counted: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(true);
  const [formats] = useNumberFormats();
  const result = useMemo(
    () => resultView(entry.result, entry.resolution, formats),
    [entry, formats],
  );

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  return (
    <dialog
      ref={dialog}
      id="result-dialog"
      aria-labelledby="result-dialog-title"
      className="bg-canvas text-ink border-border m-auto max-h-[min(560px,90vh)] w-[360px] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border p-0 text-sm shadow-xl [scrollbar-gutter:stable_both-edges] backdrop:bg-black/40"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) event.currentTarget.close();
      }}
    >
      <div className="px-4 pt-3 pb-4">
        <div className="flex items-start justify-between gap-3">
          <h2
            id="result-dialog-title"
            className="m-0 min-w-0 text-base font-semibold break-words"
          >
            {entry.owner}/{entry.name}
          </h2>
          <div className="-mt-1 -mr-2 flex shrink-0 items-center gap-1">
            <StatusBadge
              tone="neutral"
              mark="saved"
              label="Saved"
              detail={`Saved result, counted ${counted}. Open the repository on GitHub to check for a newer commit.`}
            />
            <IconButton
              type="button"
              label="Close"
              autofocus
              onClick={() => dialog.current?.close()}
            >
              <X />
            </IconButton>
          </div>
        </div>
        <Totals result={result} />
        {result.warning && <OversizedFiles result={result} />}
        <Sizes result={result} />
        <Details result={result} open={open} onToggle={setOpen} />
      </div>
    </dialog>
  );
}
