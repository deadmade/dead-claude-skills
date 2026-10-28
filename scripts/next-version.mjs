// The version a release gets: `bump` (patch, minor, major or X.Y.Z) applied to the highest of package.json's version
// and the vX.Y.Z tags. A release cut on every merge to main stamps its commit off main, so main's package.json lags
// behind the tags; counting from the tags keeps the next number past both.
const parse = (v) =>
  /^v?(\d+)\.(\d+)\.(\d+)$/
    .exec(v ?? '')
    ?.slice(1)
    .map(Number);
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

export function nextVersion(current, tags, bump) {
  const base = [current, ...tags].map(parse).filter(Boolean).sort(cmp).at(-1);
  if (!base) return undefined;
  const [major, minor, patch] = base;
  const next =
    { major: `${major + 1}.0.0`, minor: `${major}.${minor + 1}.0`, patch: `${major}.${minor}.${patch + 1}` }[bump] ??
    bump;
  return /^\d+\.\d+\.\d+$/.test(next ?? '') ? next : undefined;
}
