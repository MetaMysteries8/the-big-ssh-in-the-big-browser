import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { LocalTransport } from './transport.js';
import { Engine } from './engine.js';
import workspace from './workspace.js';

const $ = id => document.getElementById(id);
const terminal = new Terminal({
  fontFamily: '"Cascadia Code", "SFMono-Regular", Consolas, monospace',
  fontSize: workspace.terminal.fontSize, scrollback: workspace.terminal.scrollback,
  cursorBlink: true, cursorStyle: 'bar', screenReaderMode: true,
  theme: { background: '#101512', foreground: '#d8e6dc', cursor: '#b0ecc3', selectionBackground: '#3a5945', black: '#142118', red: '#e59b87', green: '#a5d8ad', yellow: '#d9cc9a', blue: '#a1bddb', magenta: '#c4abcf', cyan: '#9acfc6', white: '#e6eee8' },
});
const fit = new FitAddon();
terminal.loadAddon(fit);
terminal.loadAddon(new WebLinksAddon((_event, url) => {
  try { if (['http:', 'https:'].includes(new URL(url).protocol)) window.open(url, '_blank', 'noopener,noreferrer'); } catch {}
}));
terminal.open($('terminal'));
let connected = false, busy = false, transport, privateKey = '', publicKey = '', resizeTimer, inputTail = Promise.resolve(), sessionEpoch = 0;

function error(message) { $('error').textContent = message; $('error').hidden = !message; }
function state(message) { $('connection-state').textContent = message; }
function idle() { busy = false; connected = false; $('connect').disabled = false; $('disconnect').disabled = true; $('status-dot').classList.remove('live'); }

function savedJSON(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
const profile = { ...workspace.connection, ...savedJSON('bigssh.profile', {}) };
$('host').value = profile.host; $('port').value = profile.port; $('username').value = profile.username;

async function verifyHostKey(key) {
  const id = `${key.host.toLowerCase()}:${key.port}`;
  const known = savedJSON('bigssh.known-hosts', {});
  if (known[id]) {
    if (known[id].fingerprint !== key.fingerprint) throw new Error(`HOST KEY CHANGED for ${id}. Connection blocked. Verify the change with the server owner before forgetting the saved key.`);
    return true;
  }
  const dialog = $('trust-dialog');
  $('trust-target').textContent = `${key.host}:${key.port} · ${key.algorithm}`;
  $('trust-fingerprint').textContent = key.fingerprint;
  dialog.returnValue = '';
  return new Promise(resolve => {
    dialog.addEventListener('close', () => {
      const trusted = dialog.returnValue === 'trust';
      if (trusted) { known[id] = { fingerprint: key.fingerprint, algorithm: key.algorithm }; localStorage.setItem('bigssh.known-hosts', JSON.stringify(known)); }
      resolve(trusted);
    }, { once: true });
    dialog.showModal();
  });
}

function prompt(challenge) {
  const dialog = $('auth-dialog');
  $('auth-title').textContent = challenge.name || 'Server challenge';
  $('auth-instruction').textContent = challenge.instruction;
  const fields = $('auth-fields'); fields.replaceChildren();
  for (const question of challenge.questions) {
    const label = document.createElement('label'); label.append(document.createTextNode(question.question));
    const input = document.createElement('input'); input.type = question.echo ? 'text' : 'password'; input.autocomplete = 'off'; label.append(input); fields.append(label);
  }
  return new Promise((resolve, reject) => {
    let finished = false;
    const close = () => { if (!finished) { finished = true; reject(new Error('Authentication cancelled.')); } };
    dialog.addEventListener('close', close, { once: true });
    $('cancel-prompt').onclick = () => dialog.close();
    $('prompt-form').onsubmit = event => {
      event.preventDefault(); finished = true;
      const answers = [...fields.querySelectorAll('input')].map(input => input.value);
      dialog.close(); fields.replaceChildren(); resolve(answers);
    };
    dialog.showModal(); fields.querySelector('input')?.focus();
  });
}

const engine = new Engine({
  verifyHostKey, prompt,
  output: bytes => new Promise(resolve => terminal.write(bytes, resolve)),
  state: value => {
    if (value === 'connected') { connected = true; busy = false; $('status-dot').classList.add('live'); state('Connected · no remote relay'); $('disconnect').disabled = false; }
    else state('SSH negotiation · verifying identity and authenticating…');
  },
  closed: message => { sessionEpoch++; idle(); state('Disconnected'); $('route-detail').textContent = ''; terminal.writeln(`\r\n\x1b[90m[${message}]\x1b[0m`); },
});
engine.ready.then(() => state('Ready · local connection')).catch(err => { error(err.message); state('SSH engine unavailable'); $('connect').disabled = true; });

$('auth').addEventListener('change', () => { $('key-auth').hidden = $('auth').value !== 'key'; $('password-auth').hidden = $('auth').value !== 'password'; });
$('key-file').addEventListener('change', async () => {
  const file = $('key-file').files[0]; if (!file) return;
  if (file.size > 1024 * 1024) { error('Private key file is too large.'); return; }
  privateKey = await file.text(); publicKey = '';
  $('key-label').textContent = file.name; $('key-status').textContent = 'Loaded in this session only.'; $('download-key').hidden = true;
});
$('generate-key').addEventListener('click', async () => {
  try {
    const key = await engine.call('generateKey'); privateKey = key.privateKey; publicKey = key.publicKey;
    $('key-label').textContent = 'New Ed25519 key · session only'; $('key-status').textContent = 'Save this key to keep it after closing the page.'; $('download-key').hidden = false;
  } catch (err) { error(err.message); }
});
$('download-key').addEventListener('click', () => {
  const download = (content, filename) => { const url = URL.createObjectURL(new Blob([content], { type: 'text/plain' })); const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
  download(privateKey, 'bigssh_ed25519'); if (publicKey) download(publicKey, 'bigssh_ed25519.pub');
});

$('connection-form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy || connected) return;
  error(''); busy = true; sessionEpoch++; $('connect').disabled = true;
  const config = { host: $('host').value.trim().toLowerCase(), port: Number($('port').value), username: $('username').value.trim(), auth: $('auth').value, password: $('password').value, privateKey, passphrase: $('passphrase').value, cols: terminal.cols, rows: terminal.rows };
  if (config.auth === 'key' && !privateKey) { idle(); error('Choose a private key or generate one first.'); return; }
  try {
    state('Finding the local connector…'); transport = new LocalTransport();
    const ready = await transport.ready(); if (ready.protocol !== 1) throw new Error('Connector version mismatch.');
    state('Opening direct TCP connection…');
    const socket = await transport.open(config.host, config.port);
    localStorage.setItem('bigssh.profile', JSON.stringify({ host: config.host, port: config.port, username: config.username }));
    $('welcome').hidden = true; $('terminal').hidden = false; fit.fit();
    config.cols = terminal.cols; config.rows = terminal.rows;
    $('session-name').textContent = `${config.username}@${config.host}`;
    $('route-detail').textContent = `Device → ${socket.remoteAddress}`;
    $('disconnect').disabled = false;
    await engine.connect(config, transport);
    $('password').value = ''; $('passphrase').value = '';
    terminal.focus();
    if (workspace.startup.command) await engine.call('input', workspace.startup.command + '\n');
  } catch (err) { transport?.close(); idle(); state('Connection stopped · no retry'); error(err.message); }
});
$('disconnect').addEventListener('click', async () => {
  sessionEpoch++; connected = false; busy = true;
  $('connect').disabled = true; $('disconnect').disabled = true;
  if ($('trust-dialog').open) $('trust-dialog').close('cancel');
  if ($('auth-dialog').open) $('auth-dialog').close();
  try { await engine.close(); } catch (err) { error(err.message); }
  finally { idle(); state('Disconnected'); }
});
terminal.onData(data => {
  if (!connected) return;
  const epoch = sessionEpoch;
  inputTail = inputTail.then(() => { if (connected && epoch === sessionEpoch) return engine.call('input', data); }).catch(err => error(err.message));
});
terminal.onResize(({ cols, rows }) => { $('session-size').textContent = `${cols} × ${rows}`; if (connected) void engine.call('resize', cols, rows).catch(err => error(err.message)); });
new ResizeObserver(() => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (!$('terminal').hidden) fit.fit(); }, 80); }).observe($('terminal'));
$('forget-host').addEventListener('click', () => {
  const id = `${$('host').value.trim().toLowerCase()}:${$('port').value}`;
  if (!confirm(`Forget the saved SSH host key for ${id}? Only do this after verifying the server's new identity.`)) return;
  const known = savedJSON('bigssh.known-hosts', {}); delete known[id]; localStorage.setItem('bigssh.known-hosts', JSON.stringify(known)); state('Saved host key removed.');
});
window.addEventListener('pagehide', () => transport?.close());
if (workspace.startup.connect) {
  // Live providers must never be reached by an automatic development recipe.
  const host = profile.host.toLowerCase();
  if (host === 'railway.new' || host === 'dev.new' || host.endsWith('.railway.com')) error('Automatic startup is disabled for Railway. Its live test is manual and limited to one attempt.');
  else void engine.ready.then(() => $('connection-form').requestSubmit());
}
