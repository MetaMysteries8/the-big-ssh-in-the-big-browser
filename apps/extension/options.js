import { DEFAULT_ORIGINS, normalizeTarget } from './policy.js';

const status = document.querySelector('#status');
const originInput = document.querySelector('#origin');
const hostInput = document.querySelector('#host');
const portInput = document.querySelector('#port');

async function render() {
  const { targets = [] } = await chrome.storage.local.get('targets');
  const list = document.querySelector('#grants');
  list.replaceChildren();
  for (const target of targets) {
    const item = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = `${target.host}:${target.port} · ${target.origin}`;
    const remove = document.createElement('button');
    remove.textContent = 'Remove';
    remove.addEventListener('click', async () => {
      const current = await chrome.storage.local.get('targets');
      await chrome.storage.local.set({ targets: current.targets.filter(t => !(t.host === target.host && t.port === target.port && t.origin === target.origin)) });
      await render();
    });
    item.append(label, remove); list.append(item);
  }
  if (!targets.length) { const item = document.createElement('li'); item.textContent = 'No destinations allowed yet.'; list.append(item); }
}

document.querySelector('#grant-form').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const url = new URL(originInput.value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.origin !== originInput.value.replace(/\/$/u, '')) throw new Error('Enter an exact HTTP or HTTPS origin, without a path.');
    if (url.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Use HTTPS for a non-local web app.');
    const origin = url.origin;
    const target = normalizeTarget(hostInput.value.trim(), portInput.value);
    if (!DEFAULT_ORIGINS.includes(origin)) {
      const pattern = `${url.protocol}//${url.hostname}/*`;
      if (!await chrome.permissions.request({ origins: [pattern] })) throw new Error('Web app access was not granted.');
      const scriptID = 'paired-' + [...new TextEncoder().encode(origin)].map(x => x.toString(16).padStart(2, '0')).join('');
      const scripts = await chrome.scripting.getRegisteredContentScripts({ ids: [scriptID] });
      if (!scripts.length) await chrome.scripting.registerContentScripts([{ id: scriptID, matches: [pattern], js: ['content.js'], runAt: 'document_start', allFrames: false }]);
    }
    const settings = await chrome.storage.local.get(['origins', 'targets']);
    const targets = (settings.targets ?? []).filter(t => !(t.host === target.host && t.port === target.port && t.origin === origin));
    targets.push({ ...target, origin });
    await chrome.storage.local.set({ origins: [...new Set([...(settings.origins ?? DEFAULT_ORIGINS), origin])], targets });
    status.textContent = 'Destination allowed. Return to the terminal and connect.';
    await render();
  } catch (error) { status.textContent = error.message; }
});

const { lastRequested } = await chrome.storage.session.get('lastRequested');
if (lastRequested) { originInput.value = lastRequested.origin; hostInput.value = lastRequested.host; portInput.value = lastRequested.port; }
await render();
