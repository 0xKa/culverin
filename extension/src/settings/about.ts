export const REPOSITORY_URL = "https://github.com/0xKa/culverin";
export const STORE_URL =
  "https://chromewebstore.google.com/detail/culverin/hpcpmjmklfpfaddiheiobggojdhcoopn";
export const REVIEWS_URL = `${STORE_URL}/reviews`;

export function browserVersion(userAgent: string): string {
  const version = /(?:Chrome|Chromium)\/(\d+)/.exec(userAgent)?.[1];
  return version ? `Chrome ${version}` : "Unknown";
}

export function aboutDetails(rows: [string, string][]): string {
  return rows.map(([label, value]) => `${label}: ${value}`).join("\n");
}
