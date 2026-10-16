/* A dedicated worker owns the WASM engine. It has no native socket access. */
importScripts('/wasm_exec.js');

let nextID = 1;
const pending = new Map();
function request(method, value) {
  const id = nextID++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    const message = { kind: 'request', id, method, value };
    const transfer = value instanceof Uint8Array ? [value.buffer] : [];
    self.postMessage(message, transfer);
  });
}
const transport = {
  read: () => request('transport.read'),
  write: data => request('transport.write', data),
  close: () => self.postMessage({ kind: 'transport-close' }),
};
const callbacks = {
  verifyHostKey: key => request('ui.verifyHostKey', key),
  prompt: prompt => request('ui.prompt', prompt),
  output: bytes => request('ui.output', bytes),
  state: state => self.postMessage({ kind: 'state', state }),
  closed: message => self.postMessage({ kind: 'closed', message }),
};
self.onmessage = async ({ data }) => {
  if (data.kind === 'reply') {
    const operation = pending.get(data.id);
    if (!operation) return;
    pending.delete(data.id);
    data.error ? operation.reject(new Error(data.error)) : operation.resolve(data.value);
    return;
  }
  if (data.kind !== 'call' || !['connect', 'input', 'resize', 'close', 'generateKey'].includes(data.method)) return;
  try {
    const args = data.method === 'connect' ? [data.args[0], transport, callbacks] : data.args;
    const value = await self.BigSSH[data.method](...args);
    self.postMessage({ kind: 'result', id: data.id, value });
  } catch (error) { self.postMessage({ kind: 'result', id: data.id, error: error.message }); }
};
(async () => {
  const go = new Go();
  const response = await fetch('/ssh.wasm');
  if (!response.ok) throw new Error('SSH engine asset missing. Run npm run build first.');
  const { instance } = await WebAssembly.instantiateStreaming(response, go.importObject);
  go.run(instance).catch(error => self.postMessage({ kind: 'fatal', error: error.message }));
  self.postMessage({ kind: 'ready' });
})().catch(error => self.postMessage({ kind: 'fatal', error: error.message }));
