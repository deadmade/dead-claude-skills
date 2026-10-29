// Downloads against local servers: real fetch, real TLS, real tar, real files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createServer as createHttp, type Server } from 'node:http';
import { createServer as createHttps } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import tls from 'node:tls';
import { downloadBin, trustSystemCerts } from './net.ts';

const fixture = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url));
const listen = (server: Server) =>
  new Promise<string>((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      resolve(`127.0.0.1:${port}`);
    }),
  );

// The ESET fix rests on this: fetch has no CA option, so a root reaches it only through the default store.
test('fetch trusts a root once it is in the default CA store', async () => {
  const server = createHttps({ key: fixture('localhost.key'), cert: fixture('localhost.pem') }, (_, res) =>
    res.end('ok'),
  ).unref();
  const url = `https://${await listen(server)}/`;
  const before = tls.getCACertificates('default');
  try {
    await assert.rejects(fetch(url));
    tls.setDefaultCACertificates([...before, fixture('test-ca.pem').toString()]);
    assert.equal(await (await fetch(url)).text(), 'ok');
  } finally {
    tls.setDefaultCACertificates(before);
    server.close();
  }
});

test('trustSystemCerts adds the OS store to the roots fetch trusts', () => {
  const before = tls.getCACertificates('default');
  try {
    assert.equal(trustSystemCerts(), undefined);
    const now = new Set(tls.getCACertificates('default'));
    for (const cert of [...before, ...tls.getCACertificates('system')]) assert.ok(now.has(cert));
  } finally {
    tls.setDefaultCACertificates(before);
  }
});

// The release archive of this OS, served with its .sha256 like a GitHub release.
async function release(file: string, sum = createHash('sha256').update(fixture(file)).digest('hex')) {
  const server = createHttp((req, res) =>
    res.end(req.url === `/${file}` ? fixture(file) : `${sum}  ${file}\n`),
  ).unref();
  const url = `http://${await listen(server)}/${file}`;
  return { server, url };
}
const WIN = process.platform === 'win32';
const archive = WIN ? 'fake-x86_64-pc-windows-msvc.zip' : 'fake-x86_64-unknown-linux-musl.tar.gz';
const exe = WIN ? 'fake.exe' : 'fake';

test("downloadBin unpacks this OS's release archive into place", async () => {
  const { server, url } = await release(archive);
  const bin = join(mkdtempSync(join(tmpdir(), 'dcs-net-')), exe);
  try {
    await downloadBin('fake', { file: archive, url, sha256: `${url}.sha256`, exe }, bin);
    assert.equal(readFileSync(bin, 'utf8'), 'fake binary\n');
  } finally {
    server.close();
  }
});

test('downloadBin writes nothing when the checksum differs', async () => {
  const { server, url } = await release(archive, '0'.repeat(64));
  const bin = join(mkdtempSync(join(tmpdir(), 'dcs-net-')), exe);
  try {
    await assert.rejects(
      downloadBin('fake', { file: archive, url, sha256: `${url}.sha256`, exe }, bin),
      /checksum mismatch/,
    );
    assert.equal(existsSync(bin), false);
  } finally {
    server.close();
  }
});

// The flow cockpit's zip holds its exe and its default extensions: the whole archive is its folder, and an update
// replaces the old folder whole, so a default the release dropped doesn't linger.
function oldFolder() {
  const dir = join(mkdtempSync(join(tmpdir(), 'dcs-net-')), 'fake');
  mkdirSync(join(dir, 'extensions', 'gone'), { recursive: true });
  writeFileSync(join(dir, 'extensions', 'gone', 'gone.ts'), 'old view');
  writeFileSync(join(dir, exe), 'old binary');
  return dir;
}

test('downloadBin unpacks a folder archive into its own folder, replacing the old copy whole', async () => {
  const { server, url } = await release(archive);
  const dir = oldFolder();
  try {
    await downloadBin('fake', { file: archive, url, sha256: `${url}.sha256`, exe, folder: true }, join(dir, exe));
    assert.equal(readFileSync(join(dir, exe), 'utf8'), 'fake binary\n');
    assert.deepEqual(readdirSync(dir), [exe], 'only what the archive holds');
    assert.deepEqual(readdirSync(join(dir, '..')), ['fake'], 'no staged or old copy left beside it');
  } finally {
    server.close();
  }
});

test('downloadBin keeps the old folder when the archive lacks the program', async () => {
  const { server, url } = await release(archive);
  const dir = oldFolder();
  const asset = { file: archive, url, sha256: `${url}.sha256`, exe: 'missing', folder: true };
  try {
    await assert.rejects(downloadBin('fake', asset, join(dir, 'missing')), /missing/);
    assert.equal(readFileSync(join(dir, exe), 'utf8'), 'old binary');
    assert.ok(existsSync(join(dir, 'extensions', 'gone', 'gone.ts')));
    assert.deepEqual(readdirSync(join(dir, '..')), ['fake']);
  } finally {
    server.close();
  }
});
