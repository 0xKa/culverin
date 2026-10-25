import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { X } from "lucide-preact";
import { IconButton } from "../ui/IconButton";

export function InfoDialog({
  id,
  title,
  onClose,
  children,
}: {
  id: string;
  title: string;
  onClose: () => void;
  children: ComponentChildren;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  return (
    <dialog
      ref={dialog}
      id={id}
      aria-labelledby={`${id}-title`}
      className="bg-canvas text-ink border-border m-auto max-h-[min(560px,90vh)] w-[480px] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border p-0 text-sm shadow-xl [scrollbar-gutter:stable_both-edges] backdrop:bg-black/40"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) event.currentTarget.close();
      }}
    >
      <div className="px-4 pt-3 pb-4">
        <div className="flex items-start justify-between gap-3">
          <h2
            id={`${id}-title`}
            className="m-0 min-w-0 text-base font-semibold"
          >
            {title}
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
        {children}
      </div>
    </dialog>
  );
}
