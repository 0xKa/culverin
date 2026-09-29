export function isPageUrl(url: string | undefined, expected: string): boolean {
  if (!url) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  parsed.hash = "";
  return parsed.href === expected;
}
