import { useEffect, useState } from "preact/hooks";
import { formatElapsed } from "./duration";

export function ElapsedTimer({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  return (
    <span id="analysis-timer" aria-hidden="true" className="tabular text-xs">
      {formatElapsed(now - startedAt)}
    </span>
  );
}
