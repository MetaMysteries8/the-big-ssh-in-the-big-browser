(() => {
  if (window !== window.top) return;
  let port;
  let channel;
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin) return;
    const msg = event.data;
    if (!msg || msg.source !== 'bigssh-page-v1' || typeof msg.channel !== 'string' || msg.channel.length !== 32) return;
    if (msg.action === 'attach') {
      if (port) { port.disconnect(); port = undefined; }
      channel = msg.channel;
      const currentChannel = channel;
      port = chrome.runtime.connect({ name: 'bigssh-v1' });
      const currentPort = port;
      port.onMessage.addListener(payload => window.postMessage({ source: 'bigssh-extension-v1', channel: currentChannel, payload }, location.origin));
      port.onDisconnect.addListener(() => {
        const message = chrome.runtime.lastError?.message ?? 'Extension bridge disconnected.';
        if (port === currentPort) port = undefined;
        window.postMessage({ source: 'bigssh-extension-v1', channel: currentChannel, payload: { type: 'transport-error', message } }, location.origin);
      });
    } else if (msg.channel === channel && port) {
      if (msg.action === 'detach') { port.disconnect(); port = undefined; }
      else if (msg.action === 'send' && msg.payload && typeof msg.payload === 'object') port.postMessage(msg.payload);
    }
  });
  window.addEventListener('pagehide', () => port?.disconnect());
})();
