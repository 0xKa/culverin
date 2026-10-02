import { startArchiveWorker } from "../../extension/src/archive/worker-runtime";
startArchiveWorker((blockMs) => {
  if (!blockMs) return;
  const until = performance.now() + blockMs;
  while (performance.now() < until) Math.sqrt(2);
});
