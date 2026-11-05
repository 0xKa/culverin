import { useEffect, useState } from "preact/hooks";
import { Info } from "lucide-preact";
import { DOWNLOAD_LIMITS } from "../archive/limits";
import { downloadLimit } from "../counting/download-limit";
import { IconButton } from "../ui/IconButton";
import { useAction } from "./ActionStatus";
import { InfoDialog } from "./InfoDialog";
import { Panel, SectionHeader } from "./layout";
import {
  downloadLimitOptions,
  fixedLimits,
  sizeLabel,
} from "./large-repositories";
import { preferenceReset } from "./reset";
import { SettingRow, TickChoice } from "./SettingRow";

const MIB = 1024 * 1024;

export function LargeRepositoriesSection({ hidden }: { hidden: boolean }) {
  const [limit, setLimit] = useState<number>();
  const [showLimitsInfo, setShowLimitsInfo] = useState(false);
  const { state, run } = useAction();

  useEffect(() => {
    void downloadLimit.read().then(setLimit);
  }, []);

  function change(next: number): void {
    setLimit(next);
    void run(() => downloadLimit.write(next), {
      restore: () => void downloadLimit.read().then(setLimit),
    });
  }

  return (
    <section aria-labelledby="large-repositories-heading" hidden={hidden}>
      <SectionHeader id="large-repositories-heading" title="Large repositories">
        GitHub doesn't report a repository's download size in advance, so
        Culverin stops a count when it reaches this limit.
      </SectionHeader>
      <div className="grid gap-4">
        <Panel>
          <SettingRow
            id="download-limit"
            label="Maximum download for counts you start"
            hint={`Counts that start when you open a repository page stop at ${sizeLabel(DOWNLOAD_LIMITS.automatic / MIB)}.`}
            state={state}
            statusCorner
            reset={preferenceReset(
              downloadLimit,
              limit,
              sizeLabel(downloadLimit.fallback),
              change,
            )}
          >
            <TickChoice
              name="download-limit"
              options={downloadLimitOptions}
              value={limit === undefined ? undefined : String(limit)}
              disabled={limit === undefined}
              onChange={(value) => change(Number(value))}
            />
          </SettingRow>
        </Panel>
        <Panel
          className="relative"
          title="Fixed limits"
          titleId="fixed-limits-heading"
        >
          <div className="absolute top-3 right-3">
            <IconButton
              id="show-limits-info"
              tone="accent"
              type="button"
              label="Why there are limits"
              aria-haspopup="dialog"
              onClick={() => setShowLimitsInfo(true)}
            >
              <Info />
            </IconButton>
          </div>
          <dl
            aria-labelledby="fixed-limits-heading"
            className="m-0 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]"
          >
            {fixedLimits.map((item) => (
              <div key={item.label} className="contents">
                <dt className="text-muted">{item.label}</dt>
                <dd className="m-0">{item.value}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      </div>
      {showLimitsInfo && (
        <InfoDialog
          id="limits-info-dialog"
          title="Why there are limits"
          onClose={() => setShowLimitsInfo(false)}
        >
          <div className="mt-3 grid gap-3">
            <p className="m-0">
              Your code stays in your browser, but counting still uses your
              data, memory and time. GitHub usually doesn't share a repository's
              size in advance, so limits stop a count before it downloads far
              more than you expected.
            </p>
            <p className="m-0">
              Anyone can publish a repository, including one built to overwhelm
              a browser. The fixed limits keep a count from doing that, so they
              can't be changed.
            </p>
            <p className="m-0">
              Most large projects fit within the default. If one doesn't,
              raising the limit mainly costs more data and time.
            </p>
          </div>
        </InfoDialog>
      )}
    </section>
  );
}
