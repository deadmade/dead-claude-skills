// Our marketplace on its release branch, and the URLs of the release this installer belongs to.
import type { Settings } from './settings.ts';

export const MARKETPLACE = 'dead-claude-skills';

// Our marketplace on the `release` branch, which release.yml moves to each new release once it is published: Claude
// Code's marketplace auto-update follows it, so plugins update after every release without rerunning the installer
// (the binaries still come from the installer). As `claude plugin marketplace add` takes it, and as its settings entry.
const REPO = 'deadmade/dead-claude-skills';
export const RELEASE_BRANCH = 'release';
export const marketplaceArg = () => `${REPO}@${RELEASE_BRANCH}`;
export const marketplaceSource = () => ({ source: 'github', repo: REPO, ref: RELEASE_BRANCH });

// Claude Code refuses to add a marketplace whose source differs from its extraKnownMarketplaces entry, so the entry
// is pinned before the add (an install pinned to a vX.Y.Z tag moves to the branch); the add then moves the checkout
// and keeps its plugins. Unchanged otherwise.
export function pinMarketplace(settings: Settings) {
  const entry = settings?.extraKnownMarketplaces?.[MARKETPLACE];
  if (!entry || JSON.stringify(entry.source) === JSON.stringify(marketplaceSource())) return settings;
  const out = structuredClone(settings);
  out.extraKnownMarketplaces![MARKETPLACE].source = marketplaceSource();
  return out;
}

// Release assets: the binaries and the installer, attached to each vX.Y.Z by release.yml.
export const RELEASES = `https://github.com/${REPO}/releases/download`;
// The installer itself, built to JS and attached to every release by release.yml. npx caches by URL, so the README's
// latest/ link keeps running the first installer it fetched: each run hands over to a newer release (newerInstaller).
export const installerUrl = (version: string) => `${RELEASES}/v${version}/installer.tgz`;
export const LATEST_INSTALLER = `https://github.com/${REPO}/releases/latest/download/installer.tgz`;
// npm 12 refuses tarball URLs unless allowed.
export const npxArgs = (url: string) => ['--yes', '--allow-remote=root', url];
// The version latest/ redirects to (its Location header), when it is newer than ours.
export function newerInstaller(location: string | null | undefined, version: string) {
  const v = /\/releases\/download\/v(\d+\.\d+\.\d+)\/installer\.tgz$/.exec(location ?? '')?.[1];
  return v && newer(v, version) ? v : undefined;
}

export const semver = (v: string | undefined) =>
  /^(\d+)\.(\d+)\.(\d+)$/
    .exec(v ?? '')
    ?.slice(1)
    .map(Number);
export const newer = (a: string | undefined, b: string | undefined) => {
  const [x, y] = [semver(a), semver(b)];
  if (!x || !y) return false;
  const i = x.findIndex((n, k) => n !== y[k]);
  return i >= 0 && x[i] > y[i];
};
