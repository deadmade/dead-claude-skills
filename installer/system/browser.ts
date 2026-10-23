// web-mcp's search browser: the newest Chrome for Testing agent-browser installed if it starts, else helium, else
// chromium on PATH (the order web-mcp itself uses). On NixOS Chrome for Testing downloads but can't start.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { newestChromeForTesting } from '../core/binaries.ts';
import { startSync, which } from './proc.ts';

// The binary of the newest Chrome for Testing under <home>/.agent-browser/browsers, or undefined. Only folders that
// hold a binary count; upstream's nested chrome-linux64/chrome and chrome-win64\chrome.exe are accepted too.
export function findChromeForTesting(home: string, platform: NodeJS.Platform) {
  const root = join(home, '.agent-browser', 'browsers');
  const win = platform === 'win32';
  const names = win ? ['chrome.exe', join('chrome-win64', 'chrome.exe')] : ['chrome', join('chrome-linux64', 'chrome')];
  const binary = (dir: string) => names.map((n) => join(root, dir, n)).find((f) => existsSync(f));
  let entries: string[] = [];
  try {
    entries = readdirSync(root).filter((d) => binary(d));
  } catch {
    /* no browsers folder yet */
  }
  const newest = newestChromeForTesting(entries);
  return newest && binary(newest);
}

// Whether web-mcp will find a search browser that runs.
export function searchBrowserWorks(home: string, platform: NodeJS.Platform) {
  const cft = findChromeForTesting(home, platform);
  if (cft && startSync(cft, ['--version'], { timeout: 10000 }).status === 0) return true;
  return !!(which('helium') || which('chromium'));
}
