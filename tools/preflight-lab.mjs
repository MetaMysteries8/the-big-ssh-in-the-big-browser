import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium, firefox, webkit } from 'playwright';
import { corsEndpoint, SSH_METHOD } from '../experiments/preflight/cors-endpoint.mjs';
import { docker, requireFreePort, waitSSH, nativeProbe, observe, sleep } from '../experiments/preflight/fixture.mjs';
import { summarize } from '../experiments/direct-tab/pcap.mjs';

const root = resolve(import.meta.dirname, '..');
const evidence = join(root, '.bigssh/preflight');
const nativeBinary = join(evidence, process.platform === 'win32' ? 'native-control.exe' : 'native-control');
const engine = process.argv[2] ?? 'chromium';
const selection = process.argv[3] ?? 'both';
const browserType = { chromium, firefox, webkit }[engine];
if (!browserType || !['openssh', 'dropbear', 'both'].includes(selection) || process.argv.length > 4) throw new Error('Usage: npm run lab:preflight -- [chromium|firefox|webkit] [openssh|dropbear|both]');
const daemons = selection === 'both' ? ['openssh', 'dropbear'] : [selection];
const ownedBrowsers = new Set();
const source = args => spawnSync('git', args, { cwd: root, encoding: 'utf8' }).stdout.trim();
const report = {
  schemaVersion: 1, date: new Date().toISOString(), os: process.platform, nodeVersion: process.version,
  sourceRevision: source(['rev-parse', 'HEAD']), sourceDirty: !!source(['status', '--porcelain']),
  setup: {
    target: '127.0.0.1:2225', targetPreparationRequired: true,
    preparation: 'An owned HTTP service primes CORS on the exact URL, then fully stops before a real SSH daemon takes its port.',
    relay: false, extension: false, nativeConnector: false, browserSecurityDisabled: false,
    liveRailwayAttemptsUsed: 0,
  },
  sequences: [],
};
let assets;

async function pageFor(origin) {
  const browser = await browserType.launch({ headless: true }); ownedBrowsers.add(browser);
  report.browser ??= { engine, version: browser.version() };
  const page = await browser.newPage(); await page.goto(origin);
  await page.waitForFunction(() => !!window.labRequest);
  return { browser, page };
}

async function closeBrowser(browser) { await browser.close(); ownedBrowsers.delete(browser); }

function fullHandshake(version) {
  const child = spawnSync(nativeBinary, ['-version', version], { encoding: 'utf8', windowsHide: true });
  if (child.error || !child.stdout) throw child.error ?? new Error('Native handshake control returned no result: ' + child.stderr);
  const result = JSON.parse(child.stdout);
  if (child.status !== 0) throw new Error('Native handshake control did not reach authentication: ' + result.error);
  return result;
}

async function sequence(daemon, origin) {
  await requireFreePort();
  const container = `bigssh-preflight-${process.pid}-${daemon}`;
  const result = { daemon, primer: {}, results: [] }; report.sequences.push(result);
  let primer, capture, started = false;
  try {
    primer = await corsEndpoint(origin);
    const { browser, page } = await pageFor(origin);
    result.primer.first = await page.evaluate(() => window.labRequest());
    assert.equal(result.primer.first.text, 'PRIMED_HTTP_CONTROL', 'The prepared HTTP endpoint must be readable.');
    const preflights = primer.requests.filter(request => request.method === 'OPTIONS').length;
    result.primer.repeat = await page.evaluate(() => window.labRequest());
    assert.equal(result.primer.repeat.text, 'PRIMED_HTTP_CONTROL');
    assert.equal(preflights, 1, 'The first custom method must trigger preflight.');
    assert.equal(primer.requests.filter(request => request.method === 'OPTIONS').length, 1, 'The repeat must use a verified preflight cache entry.');
    result.primer.headerRemoval = await page.evaluate(() => window.labRequest('strip-headers'));
    result.primer.hostStillPresent = primer.requests.at(-1)?.host === '127.0.0.1:2225';
    result.primer.requests = [...primer.requests]; result.primer.cacheVerified = true;
    await primer.close(); primer = undefined;
    docker(['run', '--detach', '--rm', '--name', container, '--publish', '127.0.0.1:2225:22/tcp', '--env', `LAB_DAEMON=${daemon}`, 'bigssh-preflight-lab:dev']); started = true;
    result.server = await waitSSH();
    capture = await observe(container);

    async function measure(id, operation, control = false, targetPage) {
      const before = capture.packets().length;
      const logsBefore = docker(['logs', container], true);
      const errors = [], requests = [];
      const onConsole = message => { if (message.type() === 'error') errors.push(message.text().slice(0, 350)); };
      const onRequest = request => requests.push(request.failure()?.errorText);
      targetPage?.on('console', onConsole); targetPage?.on('requestfailed', onRequest);
      let observed;
      try { observed = await operation(); await sleep(200); }
      finally { targetPage?.off('console', onConsole); targetPage?.off('requestfailed', onRequest); }
      const wire = capture.packets().slice(before);
      const logs = docker(['logs', container], true).slice(logsBefore.length)
        .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/gu, '[fixture-address]').trim();
      const entry = { id, control, result: observed, wire: summarize(wire), serverLogs: logs.slice(0, 4500), consoleErrors: errors, failedRequests: requests };
      result.results.push(entry);
      console.log(`${engine}/${daemon}/${id}: ${observed.outcome}; first client bytes=${entry.wire.clientFirstPayload?.ascii.split('\r\n')[0] ?? '(none)'}`);
      return { entry, wire };
    }

    const primed = await measure('primed-browser-method', () => page.evaluate(() => window.labRequest()), false, page);
    await closeBrowser(browser);
    const clientPacket = primed.wire.find(packet => packet.protocol === 'tcp' && packet.destination === 22 && packet.payload.length);
    const sent = clientPacket?.payload;
    const firstLineEnd = sent?.indexOf('\r\n') ?? -1;
    const firstLine = firstLineEnd >= 0 ? sent.subarray(0, firstLineEnd + 2) : null;
    result.primedFirstLineStartsSSH = !!firstLine?.subarray(0, 8).equals(Buffer.from('SSH-2.0-'));

    const unprimed = await pageFor(origin);
    await measure('fresh-browser-method', () => unprimed.page.evaluate(() => window.labRequest()), false, unprimed.page);
    await closeBrowser(unprimed.browser);

    const baseline = await measure('native-identification', () => nativeProbe(Buffer.from('SSH-2.0-BigSSH_Control\r\n')), true);
    assert.ok(baseline.entry.result.banner?.startsWith('SSH-2.0-'), 'The native control must still reach the owned SSH server.');
    await measure('native-full-handshake', () => fullHandshake('SSH-2.0-BigSSH_Control'), true);
    if (firstLine && result.primedFirstLineStartsSSH) {
      await measure('native-exact-first-line', () => nativeProbe(firstLine), true);
      await measure('native-full-handshake-exact-line', () => fullHandshake(firstLine.toString().trimEnd()), true);
      if (sent.includes('\r\n\r\n')) await measure('native-exact-http-replay', () => nativeProbe(sent), true);
      else result.replaySkipped = 'The first captured packet did not contain complete HTTP headers; no partial replay was misclassified.';
    }
    await measure('native-http-prefix', () => nativeProbe(Buffer.from('GET / HTTP/1.1\r\n\r\nSSH-2.0-BigSSH_Control\r\n')), true);
    const stun = Buffer.alloc(22); stun.writeUInt16BE(20); stun.writeUInt16BE(1, 2); stun.writeUInt32BE(0x2112a442, 6); stun.fill(1, 10);
    await measure('native-stun-prefix', () => nativeProbe(Buffer.concat([stun, Buffer.from('\r\nSSH-2.0-BigSSH_Control\r\n')])), true);
    await writeFile(join(evidence, `${engine}-${daemon}.pcap`), capture.raw());
    result.summary = {
      cacheVerified: result.primer.cacheVerified,
      sshLookingFirstLine: result.primedFirstLineStartsSSH,
      browserReadServerData: primed.entry.result.outcome === 'response' && primed.entry.result.readableBody && !!primed.entry.result.text,
      fullSSHSessionAttempted: false,
    };
  } finally {
    await primer?.close(); capture?.stop();
    if (started) docker(['stop', container]);
  }
}

try {
  await mkdir(evidence, { recursive: true });
  const build = spawnSync('go', ['build', '-trimpath', '-o', nativeBinary, './experiments/preflight/native-control'], {
    cwd: root, stdio: 'inherit', windowsHide: true,
    env: { ...process.env, GOCACHE: join(root, '.bigssh/go-cache'), GOMODCACHE: join(root, '.bigssh/go-mod') },
  });
  if (build.status !== 0) throw new Error('Native handshake control failed to build.');
  report.goVersion = spawnSync('go', ['version'], { encoding: 'utf8' }).stdout.trim();
  docker(['build', '--tag', 'bigssh-preflight-lab:dev', join(root, 'experiments/preflight')]);
  report.setup.fixtureImage = docker(['image', 'inspect', 'bigssh-preflight-lab:dev', '--format', '{{.Id}}']);
  const probe = await readFile(join(root, 'experiments/preflight/probe.js'));
  assets = createServer((request, response) => {
    if (request.url === '/probe.js') { response.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' }).end(probe); return; }
    if (request.url !== '/') { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }).end('<!doctype html><meta charset="utf-8"><title>Local preflight research fixture</title><p>Local-only cooperating CORS control. No SSH relay.</p><script type="module">import {request} from "/probe.js"; window.labRequest=request;</script>');
  });
  await new Promise((resolve, reject) => { assets.once('error', reject); assets.listen(0, '127.0.0.1', resolve); });
  const origin = `http://127.0.0.1:${assets.address().port}`;
  for (const daemon of daemons) await sequence(daemon, origin);
  report.scope = 'Requires cooperating HTTP preparation of the target endpoint. This is not a portable technique for unchanged third-party servers. Native replays are controls, not browser-originated SSH sessions.';
  await writeFile(join(evidence, `${engine}.json`), JSON.stringify(report, null, 2) + '\n');
  console.log(`Completed ${report.sequences.length} prepared-endpoint sequences. Railway: 0/1.`);
} catch (error) {
  report.harnessError = error.message;
  await mkdir(evidence, { recursive: true });
  await writeFile(join(evidence, `${engine}-failure.json`), JSON.stringify(report, null, 2) + '\n');
  throw error;
} finally {
  await Promise.allSettled([...ownedBrowsers].map(browser => browser.close()));
  if (assets) await new Promise(resolve => assets.close(resolve));
}
