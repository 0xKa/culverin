import { startDiagnosticHost } from "./analysis/host";
startDiagnosticHost(
  () =>
    new Worker(new URL("./archive-worker.ts", import.meta.url), {
      type: "module",
    }),
);
