import { useEffect, useState } from "preact/hooks";
import { DOWNLOAD_LIMITS } from "../archive/limits";
import { downloadLimit } from "../counting/download-limit";
import { useAction } from "./ActionStatus";
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
        <Panel title="Fixed limits" titleId="fixed-limits-heading">
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
    </section>
  );
}
