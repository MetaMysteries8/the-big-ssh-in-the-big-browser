import { DEFAULT_ORIGINS, normalizeTarget, authorize } from './policy.js';

const NATIVE_HOST = 'io.bigssh.connector';
const MAX_DATA = 45000;
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

chrome.runtime.onConnect.addListener(page => {
  if (page.name !== 'bigssh-v1' || page.sender?.frameId !== 0 || !page.sender?.tab) { page.disconnect(); return; }
  let origin;
  try { origin = new URL(page.sender.url).origin; } catch { page.disconnect(); return; }
  let native;
  let granted = false;
  let closed = false;
  let opening = false;
  let serial = Promise.resolve();
  const post = event => { if (!closed) { try { page.postMessage(event); } catch {} } };
  const fail = (id, message) => post({ type: 'error', id, message });
  page.onDisconnect.addListener(() => { closed = true; native?.disconnect(); });
  page.onMessage.addListener(message => {
    serial = serial.then(async () => {
      if (closed || !message || typeof message !== 'object' || !Number.isSafeInteger(message.id)) return;
      const settings = await chrome.storage.local.get(['origins', 'targets']);
      if (!(settings.origins ?? DEFAULT_ORIGINS).includes(origin)) { fail(message.id, 'This web app origin is not paired with the extension.'); return; }
      if (message.type === 'probe') {
        if (native) { post({ type: 'ready', id: message.id, protocol: 1 }); return; }
        try {
          native = chrome.runtime.connectNative(NATIVE_HOST);
          native.onMessage.addListener(event => post(event));
          native.onDisconnect.addListener(() => {
            const reason = chrome.runtime.lastError?.message ?? 'Local connector disconnected.';
            native = undefined;
            granted = false;
            post({ type: 'transport-error', message: reason });
          });
          native.postMessage({ type: 'hello', protocol: 1 });
        } catch (error) { fail(message.id, error.message); }
        return;
      }
      if (message.type === 'open') {
        if (opening) { fail(message.id, 'A connection was already requested.'); return; }
        let target;
        try { target = normalizeTarget(message.host, message.port); } catch (error) { fail(message.id, error.message); return; }
        if (!authorize(page.sender, settings, target)) {
          await chrome.storage.session.set({ lastRequested: { ...target, origin } });
          fail(message.id, 'Approve this destination in the extension settings, then connect again.');
          await chrome.runtime.openOptionsPage();
          return;
        }
        if (!native) { fail(message.id, 'The local connector is unavailable.'); return; }
        opening = true;
        granted = true;
        native.postMessage({ type: 'open', id: message.id, ...target });
        return;
      }
      if (!native || !granted) { fail(message.id, 'No approved TCP session.'); return; }
      if (message.type === 'write' && typeof message.data === 'string' && message.data.length <= MAX_DATA) {
        native.postMessage({ type: 'write', id: message.id, data: message.data });
      } else if (message.type === 'credit' && Number.isInteger(message.bytes) && message.bytes > 0 && message.bytes <= 262144) {
        native.postMessage({ type: 'credit', bytes: message.bytes });
      } else if (message.type === 'close') {
        native.postMessage({ type: 'close', id: message.id });
      } else { fail(message.id, 'Invalid transport message.'); }
    }).catch(error => fail(message?.id, error.message));
  });
  post({ type: 'bridge-ready', protocol: 1 });
});
