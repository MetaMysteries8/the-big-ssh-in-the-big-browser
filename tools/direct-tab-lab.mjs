// Controlled protocol experiments. No extension, native connector, SSH relay,
// live sandbox, external ICE service, or user-supplied destination is involved.
import assert from 'node:assert/strict';
import { createServer as httpServer } from 'node:http';
import { createServer as tcpServer, connect } from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium, firefox, webkit } from 'playwright';
import { packets, summarize } from '../experiments/direct-tab/pcap.mjs';

const root = resolve(import.meta.dirname, '..');
const directory = join(root, 'experiments/direct-tab');
const evidence = join(root, '.bigssh/direct-tab');
const fixture = `bigssh-direct-tab-${process.pid}`;
const browserName = process.argv[2] ?? 'chromium';
const browserType = { chromium, firefox, webkit }[browserName];
const executablePath = process.argv[3] === '--executable' && process.argv[4] ? resolve(process.argv[4]) : undefined;
if (!browserType || (process.argv.length > 3 && (!executablePath || process.argv.length !== 5))) throw new Error('Usage: npm run lab:direct -- [chromium|firefox|webkit] [--executable PATH]');
const launchOptions = { headless: true, ...(executablePath ? { executablePath } : {}) };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let browser, server, capture, fixtureStarted = false, captureError;
const chunks = []; let capturedBytes = 0;
const report = {
  schemaVersion: 1, date: new Date().toISOString(), os: process.platform,
  sourceRevision: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim(),
  sourceDirty: !!spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).stdout.trim(),
  setup: { fixture: 'unchanged OpenSSH in a loopback-published container; passive eth0 packet capture', probeIsolation: 'fresh browser process per experiment', extensions: false, nativeConnector: false, remoteRelay: false, externalSTUN: false, TURN: false, networkingCapabilityFlags: false, liveRailwayAttemptsUsed: 0 },
  results: [],
};

function docker(args, includeStderr = false) {
  const result = spawnSync('docker', args, { cwd: root, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(`Docker operation failed: ${result.stderr}`);
  return (result.stdout + (includeStderr ? result.stderr : '')).trim();
}

async function unused(port) {
  const listener = tcpServer();
  try {
    await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(port, '127.0.0.1', resolve); });
    await new Promise(resolve => listener.close(resolve));
    return true;
  } catch (error) { if (error.code === 'EADDRINUSE' || error.code === 'EACCES') return false; throw error; }
}

async function nativeIdentification() {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port: 2224 });
    let seen = Buffer.alloc(0), finished = false;
    const timer = setTimeout(() => done(new Error('Local sshd did not return its identification.')), 3000);
    function done(error) {
      if (finished) return; finished = true; clearTimeout(timer); socket.destroy();
      error ? reject(error) : resolve({ outcome: 'identification', prefix: seen.toString().split('\r\n')[0] });
    }
    socket.once('connect', () => socket.write('SSH-2.0-BigSSH_Lab\r\n'));
    socket.on('data', data => { seen = Buffer.concat([seen, data]); if (seen.includes('\n')) done(); });
    socket.once('error', done); socket.once('close', () => { if (!finished) done(new Error('Fixture closed before its banner.')); });
  });
}

function observed() { if (captureError) throw captureError; return packets(Buffer.concat(chunks, capturedBytes)); }

async function runCase(reportPage, id, hypothesis, operation, control = false, isolated = false) {
  // An in-flight QUIC connection can outlive context.close() in Firefox.
  // Terminate the entire per-case browser process before taking its final
  // capture, so retries cannot become another experiment's evidence.
  const caseBrowser = await browserType.launch(launchOptions);
  const context = await caseBrowser.newContext();
  const page = await context.newPage();
  await page.goto(new URL(isolated ? '/isolated' : '/', reportPage.url()).href);
  await page.waitForFunction(() => !!window.probes);
  const start = observed().length;
  const errors = [], failedRequests = [];
  const onConsole = message => { if (message.type() === 'error') errors.push(message.text().slice(0, 350)); };
  const onRequest = request => failedRequests.push(request.failure()?.errorText);
  page.on('console', onConsole); page.on('requestfailed', onRequest);
  const started = performance.now();
  let result;
  try { result = await operation(page); }
  catch (error) { result = { outcome: 'harness-error', error: `${error.name}: ${error.message}` }; }
  await context.close();
  await caseBrowser.close();
  await sleep(200); // Allow the passive capture pipe to flush; not a retry.
  page.off('console', onConsole); page.off('requestfailed', onRequest);
  const entry = { id, hypothesis, control, durationMs: Math.round(performance.now() - started), result, wire: summarize(observed().slice(start)), consoleErrors: errors, failedRequests };
  report.results.push(entry);
  await reportPage.locator('#results').evaluate((element, data) => { element.textContent += '\n' + JSON.stringify(data, null, 2); }, entry);
  console.log(`${id}: ${result.outcome ?? 'observed'}; TCP payloads=${entry.wire.clientPayloadPackets}; UDP=${entry.wire.udpPackets}`);
  if (result.outcome === 'harness-error') throw new Error(`${id}: ${result.error}`);
  return entry;
}

try {
  await mkdir(evidence, { recursive: true });
  assert.ok(await unused(2224), 'Port 2224 is in use. Stop only a fixture you own before running the lab.');
  const port22 = await unused(22);
  docker(['build', '--tag', 'bigssh-protocol-lab:dev', 'experiments/direct-tab']);
  const publish = ['--publish', '127.0.0.1:2224:22/tcp', '--publish', '127.0.0.1:2224:22/udp'];
  if (port22) publish.push('--publish', '127.0.0.1:22:22/tcp');
  docker(['run', '--detach', '--rm', '--name', fixture, ...publish, 'bigssh-protocol-lab:dev']); fixtureStarted = true;
  report.setup.port22Published = port22;
  // Only the owned local fixture is retried during its startup.
  for (let attempt = 0;; attempt++) {
    try { await nativeIdentification(); break; }
    catch (error) { if (attempt === 39) throw error; await sleep(100); }
  }
  report.setup.sshVersion = docker(['exec', fixture, '/usr/sbin/sshd', '-V'], true);
  capture = spawn('docker', ['exec', '-i', fixture, 'tcpdump', '--immediate-mode', '-i', 'eth0', '-U', '-s', '2048', '-w', '-', 'tcp port 22 or udp port 22'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  capture.stdout.on('data', data => {
    if (capturedBytes + data.length > 8 * 1024 * 1024) { captureError = new Error('Lab capture exceeded 8 MiB.'); return; }
    chunks.push(data); capturedBytes += data.length;
  });
  capture.on('error', error => { captureError = error; });
  await new Promise((resolve, reject) => {
    let diagnostics = '';
    const timer = setTimeout(() => reject(new Error('Packet observer failed to start: ' + diagnostics)), 5000);
    capture.stderr.on('data', data => { diagnostics += data.toString(); if (diagnostics.includes('listening on eth0')) { clearTimeout(timer); resolve(); } });
    capture.once('error', error => { clearTimeout(timer); reject(error); });
    capture.once('exit', code => { if (code) { captureError = new Error(`Packet observer exited with ${code}.`); clearTimeout(timer); reject(captureError); } });
  });

  server = httpServer(async (request, response) => {
    const path = new URL(request.url, 'http://127.0.0.1').pathname;
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin' };
    if (path === '/worker.js') headers['Cross-Origin-Embedder-Policy'] = 'require-corp';
    if (path === '/isolated') Object.assign(headers, { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' });
    if (path === '/http-control') { response.writeHead(200, { ...headers, 'Content-Type': 'text/plain' }).end('SSH-2.0-HTTP_Control\r\n'); return; }
    const file = ({ '/': 'index.html', '/isolated': 'index.html', '/probes.js': 'probes.js', '/worker.js': 'worker.js' })[path];
    if (!file) { response.writeHead(404).end(); return; }
    response.writeHead(200, { ...headers, 'Content-Type': file.endsWith('.js') ? 'text/javascript' : 'text/html' });
    response.end(await readFile(join(directory, file)));
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  console.log(`Local lab: ${origin}`);
  browser = await browserType.launch(launchOptions);
  report.browser = { engine: browserName, version: browser.version(), customExecutable: !!executablePath };
  const page = await browser.newPage();
  await page.goto(origin); await page.waitForFunction(() => !!window.probes);
  const probe = (method, ...args) => activePage => activePage.evaluate(({ method, args }) => window.probes[method](...args), { method, args });

  const baseline = await runCase(page, 'native-ssh-control', 'The real sshd accepts a native client SSH identification.', nativeIdentification, true);
  assert.equal(baseline.wire.clientFirstPayloadStartsSSH, true, 'Observer must capture the native SSH identification.');
  assert.match(baseline.wire.serverFirstPayload?.ascii ?? '', /^SSH-2.0-/u, 'Observer must capture the real server banner.');
  const http = await runCase(page, 'http-positive-control', 'Normal HTTP can carry a banner-shaped body, with a cooperating HTTP server.', probe('fetchProbe', origin + '/http-control', 'control'), true);
  assert.equal(http.result.bodyPrefix, 'SSH-2.0-HTTP_Control\r\n');
  await runCase(page, 'ordinary-tab-sockets', 'Look for direct socket APIs in a secure ordinary tab.', probe('capabilities'));
  await runCase(page, 'ordinary-tab-direct-tcp', 'Attempt actual raw TCP only if TCPSocket is exposed.', probe('directTCP'));
  await runCase(page, 'worker-sockets', 'Does moving the code into a worker expose TCP or permit CONNECT?', probe('workerCapabilities'));
  if (port22) {
    await runCase(page, 'fetch-port-22', 'Does Fetch reach sshd on its usual port?', probe('fetchProbe', 'http://127.0.0.1:22/port22'));
    await runCase(page, 'websocket-port-22', 'Does WebSocket reach sshd on its usual port?', probe('websocketProbe', 'ws://127.0.0.1:22/port22'));
  } else report.results.push({ id: 'port-22-controls', result: { outcome: 'skipped', reason: 'Port 22 is already in use or unavailable; no existing service was touched.' } });
  const target = 'http://127.0.0.1:2224';
  for (const [id, kind, hypothesis] of [
    ['fetch-allowed-port', 'get', 'Does moving SSH to a browser-allowed port remove the barrier?'],
    ['fetch-cors-get', 'cors', 'Does a normal CORS fetch expose the SSH response where no-CORS does not?'],
    ['fetch-ssh-body', 'post', 'Can an SSH identification in a no-CORS POST body become the SSH stream?'],
    ['fetch-connect', 'connect', 'Can Fetch issue HTTP CONNECT as a raw tunnel?'],
    ['fetch-ssh-method', 'ssh-method', 'Can a custom HTTP method make the first line look like an SSH identification?'],
    ['fetch-ssh-method-no-cors', 'ssh-method-no-cors', 'Can no-CORS suppress the preflight for that SSH-shaped method?'],
    ['fetch-stream', 'stream', 'Does a ReadableStream request body bypass the HTTP protocol?'],
  ]) await runCase(page, id, hypothesis, probe('fetchProbe', target + '/' + id, kind));
  await runCase(page, 'websocket-allowed-port', 'Will a stock SSH peer satisfy a WebSocket handshake?', probe('websocketProbe', 'ws://127.0.0.1:2224/websocket'));
  await runCase(page, 'websocket-ssh-subprotocol', 'Does declaring an SSH-shaped WebSocket subprotocol change the first bytes?', probe('websocketProbe', 'ws://127.0.0.1:2224/subprotocol', 'SSH-2.0-BigSSH_Lab'));
  await runCase(page, 'wss-to-ssh', 'Can a TLS WebSocket wrapper negotiate directly with ordinary sshd?', probe('websocketProbe', 'wss://127.0.0.1:2224/secure'));
  await runCase(page, 'webtransport-to-ssh', 'Does WebTransport reach TCP SSH, or emit QUIC on UDP?', probe('webtransportProbe', 'https://127.0.0.1:2224/transport'));
  const rtc = await runCase(page, 'webrtc-local-control', 'Can two cooperating local data-channel peers exchange bytes without STUN/TURN?', probe('rtcEcho'), true);
  assert.equal(rtc.result.outcome, 'echo', 'WebRTC control must work before interpreting its negative test.');
  assert.notEqual(rtc.result.selectedPair?.localType, 'relay'); assert.notEqual(rtc.result.selectedPair?.remoteType, 'relay');
  await runCase(page, 'webrtc-tcp-to-ssh', 'Can an ICE-TCP candidate pointing at sshd act as a raw SSH socket?', probe('rtcTCP', 2224));

  await page.goto(origin + '/isolated'); await page.waitForFunction(() => !!window.probes);
  const isolated = await runCase(page, 'isolated-tab-sockets', 'Do COOP/COEP and cross-origin isolation grant IWA-style socket APIs?', probe('capabilities'), false, true);
  assert.equal(isolated.result.crossOriginIsolated, true, 'Isolation control must actually enable COOP/COEP.');
  await runCase(page, 'isolated-tab-direct-tcp', 'Attempt the raw TCP constructor in the COOP/COEP-isolated tab.', probe('directTCP'), false, true);
  await runCase(page, 'isolated-worker-sockets', 'Does a worker inherit TCP access from an isolated ordinary tab?', probe('workerCapabilities'), false, true);
  report.scope = 'Transport/capability lab only. A banner-shaped payload is not a completed SSH negotiation or login. This run does not attempt full browser SSH authentication.';
  report.promisingDirectTCP = report.results.some(entry => ['ordinary-tab-direct-tcp', 'isolated-tab-direct-tcp'].includes(entry.id) && entry.result.outcome === 'bytes' && entry.result.prefix.startsWith('SSH-2.0-'));
  await writeFile(join(evidence, `${browserName}.json`), JSON.stringify(report, null, 2) + '\n');
  await writeFile(join(evidence, `${browserName}.pcap`), Buffer.concat(chunks, capturedBytes));
  console.log(`Recorded ${report.results.length} experiments. Direct TCP candidate: ${report.promisingDirectTCP}. Railway: 0/1.`);
} catch (error) {
  report.harnessError = error.message;
  await mkdir(evidence, { recursive: true });
  await writeFile(join(evidence, `${browserName}-failure.json`), JSON.stringify(report, null, 2) + '\n');
  await writeFile(join(evidence, `${browserName}-failure.pcap`), Buffer.concat(chunks, capturedBytes));
  throw error;
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  capture?.kill();
  if (fixtureStarted) docker(['stop', fixture]);
}
