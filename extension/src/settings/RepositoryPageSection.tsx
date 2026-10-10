import {
  ChevronDown,
  ChevronUp,
  Code,
  Database,
  Files,
  type LucideIcon,
} from "lucide-preact";
import { useEffect, useRef, useState } from "preact/hooks";
import {
  aboutLayout,
  moveItem,
  shownItems,
  toggleItem,
  type AboutItem,
  type AboutLayout,
} from "../repository-page/about-items";
import { IconButton } from "../ui/IconButton";
import { Panel, SectionHeader } from "./layout";
import { ActionStatus, useAction } from "./ActionStatus";
import { useNumberFormats } from "../appearance/useNumberFormats";
import {
  defaultPageNumberFormats,
  formatPageCount,
} from "../repository-page/format";
import { pageNumberPreferences } from "../repository-page/numbers";
import { exactBytes, formatBytes } from "../ui/format";
import { tip } from "../ui/tooltip";
import { NumberOptions } from "./NumberOptions";

const items: Record<
  AboutItem,
  { label: string; icon: LucideIcon; value: number; unit: string }
> = {
  lines: {
    label: "Lines of code",
    icon: Code,
    value: 12_300,
    unit: "lines of code",
  },
  files: { label: "Files", icon: Files, value: 1_200, unit: "files" },
  size: { label: "Size", icon: Database, value: 4.5 * 1024 ** 2, unit: "" },
};

type Direction = "up" | "down";

export function RepositoryPageSection({ hidden }: { hidden: boolean }) {
  const [layout, setLayout] = useState<AboutLayout>();
  const { state, run } = useAction();
  const [focus, setFocus] = useState<{
    item: AboutItem;
    direction: Direction;
  }>();
  const list = useRef<HTMLUListElement>(null);
  const [savedFormats] = useNumberFormats(pageNumberPreferences);
  const formats = savedFormats ?? defaultPageNumberFormats;

  useEffect(() => {
    void aboutLayout.read().then(setLayout);
  }, []);

  useEffect(() => {
    if (!focus) return;
    const opposite = focus.direction === "up" ? "down" : "up";
    const arrow = (direction: Direction) =>
      list.current?.querySelector<HTMLButtonElement>(
        `[data-arrow="${focus.item}:${direction}"]`,
      );
    const pressed = arrow(focus.direction);
    const other = arrow(opposite);
    (pressed && !pressed.disabled ? pressed : other)?.focus();
    setFocus(undefined);
  }, [focus, layout]);

  function change(next: AboutLayout, message: string): void {
    setLayout(next);
    void run(() => aboutLayout.write(next), {
      message: `${message} Saved.`,
      restore: () => void aboutLayout.read().then(setLayout),
    });
  }

  function toggle(current: AboutLayout, item: AboutItem): void {
    const next = toggleItem(current, item);
    if (next === current) return;
    const shown = !next.hidden.includes(item);
    change(next, `${items[item].label} ${shown ? "shown" : "hidden"}.`);
  }

  function move(current: AboutLayout, item: AboutItem, direction: Direction) {
    const next = moveItem(current, item, direction === "up" ? -1 : 1);
    if (next === current) return;
    setFocus({ item, direction });
    change(
      next,
      `${items[item].label} moved to position ${next.order.indexOf(item) + 1}.`,
    );
  }

  const visible = layout ? shownItems(layout) : [];

  return (
    <section aria-labelledby="repository-page-heading" hidden={hidden}>
      <SectionHeader id="repository-page-heading" title="Repository page">
        What Culverin adds to the About list on GitHub repository pages.
      </SectionHeader>
      <Panel className="relative">
        <fieldset className="m-0 border-0 p-0">
          <legend className="text-md mb-1 p-0 font-semibold">
            Show in the About list
          </legend>
          <p className="text-muted m-0 mb-3 text-sm">
            These rows appear after a count, in this order. Before a count, the
            page shows Analyze with Culverin. Changes apply when you open or
            return to a repository page. At least one item stays shown.
          </p>
          <ul
            ref={list}
            id="about-items"
            className="border-divider divide-divider m-0 list-none divide-y rounded-lg border p-0"
          >
            {layout?.order.map((item, index) => {
              const { label, icon: Icon } = items[item];
              const shown = !layout.hidden.includes(item);
              return (
                <li key={item} className="flex items-center gap-3 px-3 py-1.5">
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 py-1.5">
                    <input
                      type="checkbox"
                      name="about-items"
                      value={item}
                      className="size-4"
                      checked={shown}
                      disabled={shown && visible.length === 1}
                      onChange={() => toggle(layout, item)}
                    />
                    <Icon class="text-muted" />
                    <span className="font-medium">{label}</span>
                  </label>
                  <IconButton
                    type="button"
                    label={`Move ${label} up`}
                    disabled={index === 0}
                    className="disabled:opacity-40"
                    data-arrow={`${item}:up`}
                    onClick={() => move(layout, item, "up")}
                  >
                    <ChevronUp />
                  </IconButton>
                  <IconButton
                    type="button"
                    label={`Move ${label} down`}
                    disabled={index === layout.order.length - 1}
                    className="disabled:opacity-40"
                    data-arrow={`${item}:down`}
                    onClick={() => move(layout, item, "down")}
                  >
                    <ChevronDown />
                  </IconButton>
                </li>
              );
            })}
          </ul>
        </fieldset>
        <ActionStatus
          id="repository-page-status"
          state={state}
          className="absolute top-4 right-4 h-[1.375rem]"
        />
        <NumberOptions
          preferences={pageNumberPreferences}
          idPrefix="repository-page-"
          formatExample={formatPageCount}
          description="Independent from Appearance. Changes apply when you open or return to a repository page. Exact counts and bytes stay in the page's tooltips."
        />
        <figure className="m-0 mt-4">
          <figcaption className="text-muted mb-2 text-xs font-medium">
            Preview
          </figcaption>
          <div
            id="about-preview"
            className="border-divider text-muted grid justify-items-start gap-2 rounded-lg border border-dashed px-4 py-3 text-sm"
          >
            {visible.map((item) => {
              const { icon: Icon, value, unit } = items[item];
              const count =
                item === "size"
                  ? formatBytes(value, "en", formats.sizes)
                  : formatPageCount(value, formats.counts);
              const title =
                item === "size"
                  ? exactBytes(value, "en")
                  : `${value.toLocaleString("en")} ${unit}`;
              return (
                <span
                  key={item}
                  {...tip(title)}
                  className="inline-flex items-center gap-2"
                >
                  <Icon />
                  <span>
                    <strong className="font-semibold">{count}</strong>
                    {unit && ` ${unit}`}
                  </span>
                </span>
              );
            })}
          </div>
        </figure>
      </Panel>
    </section>
  );
}
