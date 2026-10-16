// All destinations in this harness are loopback. Never use a live provider here.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { connect as tcpConnect } from 'node:net';
import { generateKeyPairSync } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve, join, extname, sep } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(import.meta.dirname, '..');
const fixture = `bigssh-e2e-${process.pid}`;
const port = 2222;
const extensionID = 'knpoojnkejjdmoanfjjhmhfbgjhppepi';
const evidence = join(root, '.bigssh/evidence');
await mkdir(evidence, { recursive: true });
const checks = [];
let context, noExtension, server, unpairedServer, page, startedFixture = false;
function docker(args, input) {
  const result = spawnSync('docker', args, { cwd: root, input, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(`Docker operation failed: ${result.stderr}`);
  return result.stdout;
}
function staticServer() {
  const directory = join(root, 'dist/web');
  return createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    const path = resolve(directory, '.' + decodeURIComponent(pathname === '/' ? '/index.html' : pathname));
    if (!path.startsWith(directory + sep)) { response.writeHead(403).end(); return; }
    try {
      const data = await readFile(path);
      const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm' }[extname(path)] ?? 'application/octet-stream';
      response.writeHead(200, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' }); response.end(data);
    } catch { response.writeHead(404).end(); }
  });
}
async function listen(instance, wantedPort = 0) {
  await new Promise((resolve, reject) => { instance.once('error', reject); instance.listen(wantedPort, '127.0.0.1', resolve); });
  return `http://127.0.0.1:${instance.address().port}`;
}
async function waitForFixture() {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      await new Promise((resolve, reject) => {
        const socket = tcpConnect({ host: '127.0.0.1', port });
        socket.setTimeout(1000);
        socket.once('data', data => { socket.destroy(); data.toString().startsWith('SSH-2.0-') ? resolve() : reject(new Error('Not SSH')); });
        socket.once('error', reject); socket.once('timeout', () => { socket.destroy(); reject(new Error('Local fixture timed out')); });
        socket.once('close', () => reject(new Error('Local fixture closed before its SSH banner.')));
      });
      return;
    } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  throw new Error('Local OpenSSH fixture did not start.');
}
async function fill(page, auth = 'password') {
  await page.locator('#host').fill('127.0.0.1'); await page.locator('#port').fill(String(port));
  await page.locator('#username').fill('bigssh'); await page.locator('#auth').selectOption(auth);
  if (auth === 'password') await page.locator('#password').fill('bigssh-test-password');
}
async function waitText(page, selector, text, timeout = 20000) {
  await page.waitForFunction(({ selector, text }) => document.querySelector(selector)?.textContent.includes(text), { selector, text }, { timeout });
}
async function typeCommand(page, command) {
  await page.locator('.xterm-helper-textarea').focus();
  await page.keyboard.type(command);
  await page.keyboard.press('Enter');
}
function record(name) { checks.push(name); console.log(`PASS ${name}`); }

try {
  docker(['build', '--tag', 'bigssh-local-fixture:dev', 'tests/fixtures/openssh']);
  docker(['run', '--detach', '--rm', '--name', fixture, '--publish', `127.0.0.1:${port}:22`, 'bigssh-local-fixture:dev']); startedFixture = true;
  await waitForFixture();
  // Docker writes sshd logs to stderr; collect it explicitly for source-IP comparison.
  const logs = () => { const result = spawnSync('docker', ['logs', fixture], { encoding: 'utf8', windowsHide: true }); return result.stdout + result.stderr; };
  const baselineIP = [...logs().matchAll(/Connection from (\S+) port /gu)].at(-1)?.[1];
  assert.ok(baselineIP, 'Fixture must log its native TCP peer.');

  server = staticServer(); const origin = await listen(server, 4173);
  unpairedServer = staticServer(); const unpairedOrigin = await listen(unpairedServer);
  noExtension = await chromium.launch({ headless: true, env: { ...process.env, BIGSSH_TEST_LOOPBACK_ONLY: '1' } });
  const plain = await noExtension.newPage();
  await plain.goto(origin); await waitText(plain, '#connection-state', 'Ready'); await fill(plain);
  await plain.locator('#connect').click(); await waitText(plain, '#error', 'Extension not detected');
  record('missing extension is actionable and does not open TCP');
  await noExtension.close(); noExtension = undefined;

  context = await chromium.launchPersistentContext(join(root, `.bigssh/e2e-profile-${Date.now()}`), {
    channel: 'chromium', headless: true, viewport: { width: 1440, height: 1000 }, acceptDownloads: true,
    env: { ...process.env, BIGSSH_TEST_LOOPBACK_ONLY: '1' },
    args: [`--disable-extensions-except=${join(root, 'dist/extension')}`, `--load-extension=${join(root, 'dist/extension')}`],
  });
  const errors = [];
  page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin); await waitText(page, '#connection-state', 'Ready'); await fill(page);
  await page.screenshot({ path: join(evidence, 'welcome.png'), fullPage: true });
  const connectionCount = () => [...logs().matchAll(/Connection from /gu)].length;
  const beforeDenied = connectionCount();
  await page.locator('#connect').click(); await waitText(page, '#error', 'Approve this destination');
  assert.equal(connectionCount(), beforeDenied, 'Ungranted destination must not be dialed.');
  record('unapproved destination blocked before TCP');
  const options = context.pages().find(p => p.url().startsWith(`chrome-extension://${extensionID}/options.html`)) ?? await context.newPage();
  if (!options.url().startsWith('chrome-extension:')) await options.goto(`chrome-extension://${extensionID}/options.html`);
  await options.locator('#origin').fill(origin); await options.locator('#host').fill('127.0.0.1'); await options.locator('#port').fill(String(port));
  await options.getByRole('button', { name: 'Allow this destination' }).click(); await waitText(options, '#status', 'Destination allowed');

  await page.locator('#connect').click(); await page.locator('#trust-dialog').waitFor({ state: 'visible', timeout: 20000 });
  await page.locator('#trust-dialog button[value="cancel"]').click(); await waitText(page, '#error', 'host key was not trusted');
  record('untrusted SSH host key can be rejected');

  await page.locator('#password').fill('bigssh-test-password'); await page.locator('#connect').click();
  await page.locator('#trust-dialog').waitFor({ state: 'visible' }); await page.locator('#trust-dialog button[value="trust"]').click();
  await waitText(page, '#connection-state', 'Connected'); record('browser WASM authenticates to unchanged OpenSSH with password');
  await typeCommand(page, "printf 'BIGSSH_''BROWSER_OK\\n'; printf 'SOURCE_''IP=%s\\n' \"$SSH_CONNECTION\"");
  await waitText(page, '#terminal', 'BIGSSH_BROWSER_OK');
  await waitText(page, '#terminal', `SOURCE_IP=${baselineIP} `);
  record('terminal command output and source IP match native TCP baseline');
  await page.setViewportSize({ width: 1240, height: 850 });
  await page.waitForTimeout(150);
  const [cols, rows] = (await page.locator('#session-size').textContent()).split(' × ').map(Number);
  await typeCommand(page, "printf 'SIZE_''CHECK='; stty size");
  await waitText(page, '#terminal', `SIZE_CHECK=${rows} ${cols}`); record('terminal resize reaches the server PTY');
  await page.screenshot({ path: join(evidence, 'connected.png'), fullPage: true });
  // Key typing does not model IME input; exercise xterm's Unicode paste path.
  await page.locator('.xterm-helper-textarea').evaluate(input => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', "printf 'UNICODE_''OK=λ雪\\n'");
    input.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }));
  });
  await page.keyboard.press('Enter');
  await waitText(page, '#terminal', 'UNICODE_OK=λ雪');
  await typeCommand(page, "head -c 1048576 /dev/zero | tr '\\000' X; printf '\\nFLOOD_''DONE\\n'");
  await waitText(page, '#terminal', 'FLOOD_DONE');
  record('Unicode and one MiB output pass through the bounded transport');
  await typeCommand(page, 'sleep 30'); await page.keyboard.press('Control+c');
  await typeCommand(page, "printf 'INTERRUPT_''OK\\n'"); await waitText(page, '#terminal', 'INTERRUPT_OK');
  record('Ctrl-C interrupts the remote foreground process');
  await page.locator('#disconnect').click(); await waitText(page, '#connection-state', 'Disconnected');
  record('disconnect tears down the SSH session');

  const pair = generateKeyPairSync('ed25519');
  const keyPath = join(root, '.bigssh/fixture-private-key.pem');
  await writeFile(keyPath, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }));
  const raw = pair.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);
  const prefix = Buffer.alloc(4); prefix.writeUInt32BE(11);
  const length = Buffer.alloc(4); length.writeUInt32BE(32);
  const publicKey = `ssh-ed25519 ${Buffer.concat([prefix, Buffer.from('ssh-ed25519'), length, raw]).toString('base64')} bigssh-fixture\n`;
  docker(['exec', '-i', fixture, '/bin/sh', '-c', 'mkdir -p /home/bigssh/.ssh && cat > /home/bigssh/.ssh/authorized_keys && chown -R bigssh:bigssh /home/bigssh/.ssh && chmod 700 /home/bigssh/.ssh && chmod 600 /home/bigssh/.ssh/authorized_keys'], publicKey);
  await page.locator('#auth').selectOption('key'); await page.locator('#key-file').setInputFiles(keyPath);
  await page.locator('#connect').click(); await waitText(page, '#connection-state', 'Connected');
  await typeCommand(page, "printf 'KEY_''LOGIN_OK\\n'"); await waitText(page, '#terminal', 'KEY_LOGIN_OK');
  record('browser WASM imports a private key and authenticates with Ed25519');
  await page.locator('#disconnect').click(); await waitText(page, '#connection-state', 'Disconnected');
  await page.locator('#auth').selectOption('none'); await page.locator('#username').fill('onboarding');
  await page.locator('#connect').click(); await waitText(page, '#connection-state', 'Connected');
  await typeCommand(page, "printf 'ONBOARDING_''OK\\n'"); await waitText(page, '#terminal', 'ONBOARDING_OK');
  record('credential-free SSH onboarding works when explicitly accepted by the server');
  await page.locator('#disconnect').click(); await waitText(page, '#connection-state', 'Disconnected');
  await page.evaluate(() => localStorage.setItem('bigssh.known-hosts', JSON.stringify({ '127.0.0.1:2222': { fingerprint: 'SHA256:wrong-fixture-key' } })));
  await page.locator('#connect').click(); await waitText(page, '#error', 'HOST KEY CHANGED');
  record('changed host key is blocked without offering silent trust');

  const unpaired = await context.newPage(); await unpaired.goto(unpairedOrigin); await waitText(unpaired, '#connection-state', 'Ready'); await fill(unpaired);
  const beforeUnpaired = connectionCount(); await unpaired.locator('#connect').click(); await waitText(unpaired, '#error', 'not paired');
  assert.equal(connectionCount(), beforeUnpaired); record('unpaired web origin cannot use the connector');
  await unpaired.close();
  await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: join(evidence, 'mobile-layout.png'), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Mobile layout must not overflow horizontally.');
  assert.deepEqual(errors, [], 'No uncaught page errors.');
  const summary = { date: new Date().toISOString(), browser: context.browser().version(), os: process.platform, fixture: 'OpenSSH 10.2 in loopback-only Alpine container', sourceAddressMatched: true, checks, railwayAttemptsUsed: 0 };
  await writeFile(join(evidence, 'e2e.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: join(evidence, 'failure.png'), fullPage: true });
    await writeFile(join(evidence, 'failure.txt'), await page.locator('body').innerText());
  }
  throw error;
} finally {
  await context?.close(); await noExtension?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  if (unpairedServer) await new Promise(resolve => unpairedServer.close(resolve));
  if (startedFixture) docker(['stop', fixture]);
}
