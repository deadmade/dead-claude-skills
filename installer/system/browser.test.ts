import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findChromeForTesting, searchBrowserWorks } from './browser.ts';

const skip = process.platform === 'win32';
const script = (code: number) => `#!/bin/sh\nexit ${code}\n`;

// A home with an older Chrome for Testing, a newest one (a script with this exit code) and a newer folder without a binary.
function home(newestExit: number) {
  const h = mkdtempSync(join(tmpdir(), 'dcs-browser-'));
  const root = join(h, '.agent-browser', 'browsers');
  for (const [v, code] of [
    ['100.0.0.1', 1],
    ['156.0.1.2', newestExit],
  ] as const) {
    mkdirSync(join(root, `chrome-${v}`), { recursive: true });
    const bin = join(root, `chrome-${v}`, 'chrome');
    writeFileSync(bin, script(code));
    chmodSync(bin, 0o755);
  }
  mkdirSync(join(root, 'chrome-999.0.0.0'));
  return h;
}

test('finds the newest Chrome for Testing that has a binary', { skip }, () => {
  const h = home(0);
  assert.equal(findChromeForTesting(h, 'linux'), join(h, '.agent-browser/browsers/chrome-156.0.1.2/chrome'));
  assert.equal(findChromeForTesting(join(h, 'nope'), 'linux'), undefined);
});

test('the search browser works when Chrome for Testing starts, else when helium or chromium is on PATH', { skip }, () => {
  const bin = mkdtempSync(join(tmpdir(), 'dcs-path-'));
  const saved = process.env.PATH;
  try {
    process.env.PATH = bin;
    assert.equal(searchBrowserWorks(home(0), 'linux'), true);
    assert.equal(searchBrowserWorks(home(1), 'linux'), false);
    writeFileSync(join(bin, 'helium'), '');
    chmodSync(join(bin, 'helium'), 0o755);
    assert.equal(searchBrowserWorks(home(1), 'linux'), true);
  } finally {
    process.env.PATH = saved;
  }
});

// existsSync only, so these run anywhere: each layout holds the newest version's binary at a different place.
for (const [platform, parts] of [
  ['win32', ['chrome.exe']],
  ['win32', ['chrome-win64', 'chrome.exe']],
  ['linux', ['chrome-linux64', 'chrome']],
] as const)
  test(`finds Chrome for Testing at ${parts.join("/")} on ${platform}`, () => {
    const h = mkdtempSync(join(tmpdir(), 'dcs-layout-'));
    const dir = join(h, '.agent-browser', 'browsers', 'chrome-156.0.1.2');
    mkdirSync(join(dir, ...parts.slice(0, -1)), { recursive: true });
    writeFileSync(join(dir, ...parts), '');
    mkdirSync(join(h, '.agent-browser', 'browsers', 'chrome-999.0.0.0'));
    assert.equal(findChromeForTesting(h, platform), join(dir, ...parts));
  });
