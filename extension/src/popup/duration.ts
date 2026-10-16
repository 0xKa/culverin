export function formatElapsed(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

export const durationText = {
  counted: (milliseconds: number) =>
    `Counted in ${formatDuration(milliseconds)}`,
  saved: (milliseconds: number) =>
    `Took ${formatDuration(milliseconds)} when counted`,
  stopped: (milliseconds: number) =>
    `Stopped after ${formatDuration(milliseconds)}`,
};
