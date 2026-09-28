import { validateResult, type AnalysisResultV2 } from "./result";

type WasmAnalyzer = {
  classify_path(path: string, prefix: Uint8Array): string;
  add_file(path: string, bytes: Uint8Array): string;
  finish(): string;
  free(): void;
};

export type CounterFile = { path: string; bytes: Uint8Array };
export type CounterRules = {
  repositoryId: string;
  commitSha: string;
  exclusions?: string[];
  disabledGroups?: string[];
};

import init, {
  Analyzer,
  force_trap,
} from "../wasm/instance/culverin_counter.js";

let queue: Promise<unknown> = Promise.resolve();

export function runCounter(
  rules: CounterRules,
  files: CounterFile[],
  trap = false,
): Promise<
  | { ok: true; result: AnalysisResultV2 }
  | { ok: false; error: "counter_failed" | "invalid_input" }
> {
  const job = queue.then(() => runOne(rules, files, trap));
  queue = job.catch(() => undefined);
  return job;
}

async function runOne(
  rules: CounterRules,
  files: CounterFile[],
  trap: boolean,
): Promise<
  | { ok: true; result: AnalysisResultV2 }
  | { ok: false; error: "counter_failed" | "invalid_input" }
> {
  let analyzer: WasmAnalyzer | undefined;
  let trapped = false;
  try {
    await init();
    analyzer = new Analyzer(JSON.stringify(rules));
    if (trap) force_trap();
    for (const file of files) analyzer.add_file(file.path, file.bytes);
    const result: unknown = JSON.parse(analyzer.finish());
    if (!validateResult(result)) throw new Error("invalid result");
    return { ok: true, result };
  } catch (error) {
    trapped = typeof error !== "string";
    return { ok: false, error: trapped ? "counter_failed" : "invalid_input" };
  } finally {
    if (!trapped && analyzer) {
      try {
        analyzer.free();
      } catch (cleanupError) {
        void cleanupError;
      }
    }
  }
}
