export type RefView = { name: string; note?: string; commit: boolean };

export function refView(resolution: {
  ref?: string;
  defaultBranch: string;
  sha: string;
}): RefView {
  const { ref, defaultBranch } = resolution;
  if (ref === undefined) return { name: defaultBranch, commit: false };
  if (
    /^[0-9a-f]{7,64}$/i.test(ref) &&
    resolution.sha.startsWith(ref.toLowerCase())
  )
    return {
      name: "commit",
      note: `A specific commit, not the latest on the default branch (${defaultBranch})`,
      commit: true,
    };
  return {
    name: ref,
    note: `${ref} is not the default branch (${defaultBranch})`,
    commit: false,
  };
}

export function refUrl(resolution: {
  owner: string;
  name: string;
  ref?: string;
}): string {
  const base = `https://github.com/${resolution.owner}/${resolution.name}`;
  return resolution.ref === undefined
    ? base
    : `${base}/tree/${resolution.ref.split("/").map(encodeURIComponent).join("/")}`;
}
