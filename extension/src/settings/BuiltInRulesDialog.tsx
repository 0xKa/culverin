import { useEffect, useRef } from "preact/hooks";
import { X } from "lucide-preact";
import { ignoreGroups } from "../counter/rules";
import { IconButton } from "../ui/IconButton";
import { entries } from "./rules-input";

export function BuiltInRulesDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  return (
    <dialog
      ref={dialog}
      id="built-in-dialog"
      aria-labelledby="built-in-dialog-title"
      className="bg-canvas text-ink border-border m-auto max-h-[min(560px,90vh)] w-[480px] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border p-0 text-sm shadow-xl [scrollbar-gutter:stable_both-edges] backdrop:bg-black/40"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) event.currentTarget.close();
      }}
    >
      <div className="px-4 pt-3 pb-4">
        <div className="flex items-start justify-between gap-3">
          <h2
            id="built-in-dialog-title"
            className="m-0 min-w-0 text-base font-semibold"
          >
            Built-in rules
          </h2>
          <IconButton
            type="button"
            label="Close"
            autofocus
            className="-mt-1 -mr-2"
            onClick={() => dialog.current?.close()}
          >
            <X />
          </IconButton>
        </div>
        <dl className="mt-3 mb-0 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-[10rem_1fr] sm:gap-y-2.5">
          {ignoreGroups.map((group) => (
            <>
              <dt key={group.id + "-label"} className="font-medium">
                {group.label}
              </dt>
              <dd
                key={group.id + "-entries"}
                className="text-muted m-0 mb-2 font-mono text-xs leading-5 break-words sm:mb-0"
              >
                {entries(group).join(", ")}
              </dd>
            </>
          ))}
        </dl>
      </div>
    </dialog>
  );
}
