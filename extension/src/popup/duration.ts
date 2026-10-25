export function formatElapsed(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function formatDuration(milliseconds: number): string {
  const value = Math.max(0, Math.round(milliseconds));
  if (value < 1000) return `${value}ms`;
  const tenths = Math.round(value / 100);
  if (tenths < 100) return `${(tenths / 10).toFixed(1)}s`;
  const seconds = Math.round(value / 1000);
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
  waited: (github: number, counter: number) =>
    `Waited ${formatDuration(github)} for GitHub and ${formatDuration(counter)} for the counter`,
};
