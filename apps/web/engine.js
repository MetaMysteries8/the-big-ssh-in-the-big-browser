export class Engine {
  constructor(callbacks) {
    this.callbacks = callbacks; this.transport = null; this.nextID = 1; this.pending = new Map();
    this.worker = new Worker('/engine-worker.js');
    this.ready = new Promise((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject; });
    this.worker.onerror = event => this.fatal(new Error(event.message));
    this.worker.onmessage = async ({ data }) => {
      if (data.kind === 'ready') { this.resolveReady(); return; }
      if (data.kind === 'fatal') { this.fatal(new Error(data.error)); return; }
      if (data.kind === 'state') { callbacks.state(data.state); return; }
      if (data.kind === 'closed') { this.transport?.close(); callbacks.closed(data.message); return; }
      if (data.kind === 'transport-close') { this.transport?.close(); return; }
      if (data.kind === 'result') {
        const pending = this.pending.get(data.id); if (!pending) return;
        this.pending.delete(data.id);
        data.error ? pending.reject(new Error(data.error)) : pending.resolve(data.value);
      }
      if (data.kind === 'request') {
        try {
          let value;
          if (data.method === 'transport.read') value = await this.transport.read();
          else if (data.method === 'transport.write') value = await this.transport.write(data.value);
          else if (data.method.startsWith('ui.')) value = await callbacks[data.method.slice(3)](data.value);
          else throw new Error('Unknown engine request.');
          this.worker.postMessage({ kind: 'reply', id: data.id, value }, value instanceof Uint8Array ? [value.buffer] : []);
        } catch (error) { this.worker.postMessage({ kind: 'reply', id: data.id, error: error.message }); }
      }
    };
  }
  fatal(error) { this.rejectReady(error); this.transport?.fail(error); for (const pending of this.pending.values()) pending.reject(error); this.pending.clear(); this.callbacks.closed(error.message); }
  async call(method, ...args) { await this.ready; const id = this.nextID++; return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.worker.postMessage({ kind: 'call', id, method, args }); }); }
  async connect(config, transport) { this.transport = transport; return this.call('connect', config); }
  close() { this.transport?.close(); return this.call('close'); }
}
