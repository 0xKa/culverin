import { Sizes, Totals } from "../popup/ResultParts";
import { ResultSection } from "../popup/ResultSection";
import type { BreakdownRow, ResultView } from "../popup/view";
import {
  defaultNumberFormats,
  exactBytes,
  formatBytes,
  formatCount,
} from "../ui/format";
import { useNumberFormats } from "../appearance/useNumberFormats";

const codeLines = 12_480;
const codeFiles = 74;
const sampleBytes = 1.5 * 1024 ** 2;

export function ThemeSample() {
  const [savedFormats] = useNumberFormats();
  const formats = savedFormats ?? defaultNumberFormats;
  const count = (value: number) => formatCount(value, formats.counts);
  const exact = (text: string) =>
    formats.counts === "abbreviated" ? text : undefined;
  const sample = {
    codeTotal: count(codeLines),
    codeTitle: exact(`${codeLines.toLocaleString()} code lines`),
    fileTotal: count(86),
    fileLabel: "files",
    fileTitle:
      "86 files. All files in this sample, 82 counted as code or text.",
    stats: [
      {
        label: "Text lines",
        value: count(640),
        title:
          "640 text lines. Non-blank prose lines in the sample's Markdown files",
        id: "text-lines",
      },
      {
        label: "Physical lines",
        value: count(15_120),
        title: `${(15_120).toLocaleString()} physical lines. Physical lines = code + comments + blanks`,
      },
      {
        label: "Comments",
        value: count(2_016),
        title: exact(`${(2_016).toLocaleString()} comments`),
      },
      { label: "Blanks", value: count(624), title: exact("624 blanks") },
    ],
    snapshotSize: formatBytes(sampleBytes, undefined, formats.sizes),
    sizeTitle: `${exactBytes(sampleBytes)}. Total size of the sample files. Doesn't include Git history.`,
  } satisfies Pick<
    ResultView,
    | "codeTotal"
    | "codeTitle"
    | "fileTotal"
    | "fileLabel"
    | "fileTitle"
    | "stats"
    | "snapshotSize"
    | "sizeTitle"
  >;

  const rows: BreakdownRow[] = [
    { name: "TypeScript", code: 7_800, files: 44 },
    { name: "Rust", code: 3_120, files: 18 },
    { name: "CSS", code: 1_560, files: 12 },
  ].map(({ name, code, files }) => {
    const share = (code / codeLines) * 100;
    const label = `${name}: ${code.toLocaleString()} code lines (${share.toFixed(1)}% of code lines), ${files.toLocaleString()} files`;
    return {
      label,
      title: exact(label),
      name,
      value: count(code),
      share,
      files: `${count(files)} files`,
    };
  });

  return (
    <figure className="border-divider m-0 mt-5 border-t pt-5">
      <figcaption className="mb-3">
        <span className="text-md font-semibold">Popup preview</span>
        <p className="text-muted m-0 mt-1 text-sm">
          Sample data using your appearance settings.
        </p>
      </figcaption>
      <div className="border-divider bg-surface rounded-lg border border-dashed p-3 sm:p-5">
        <div
          id="theme-sample"
          className="border-border bg-canvas text-ink mx-auto w-full max-w-[360px] rounded-xl border px-4 pt-3 pb-4 text-sm"
        >
          <h3 className="m-0 text-base font-semibold">example/project</h3>
          <Totals result={sample} idPrefix="theme-sample-" />
          <Sizes result={sample} idPrefix="theme-sample-" />
          <ResultSection
            title="Code"
            summary={[
              `${count(codeLines)} code lines`,
              `${count(codeFiles)} files`,
            ]}
            summaryTitle={exact(
              `${codeLines.toLocaleString()} code lines, ${codeFiles.toLocaleString()} files`,
            )}
            summaryId="theme-sample-code-summary"
            rows={rows}
            label="Sample languages by code lines"
            moreLabel="More sample languages by code lines"
            id="theme-sample-more-languages"
          />
        </div>
      </div>
    </figure>
  );
}
