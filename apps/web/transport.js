const WINDOW_SIZE = 262144;
const CHUNK_SIZE = 32768;

export class LocalTransport {
  constructor() {
    this.channel = [...crypto.getRandomValues(new Uint8Array(16))].map(x => x.toString(16).padStart(2, '0')).join('');
    this.pending = new Map(); this.nextID = 1; this.queue = []; this.queuedBytes = 0;
    this.waiter = null; this.closed = false; this.writeTail = Promise.resolve();
    this.onMessage = event => {
      if (event.source !== window || event.origin !== location.origin || event.data?.source !== 'bigssh-extension-v1' || event.data.channel !== this.channel) return;
      const msg = event.data.payload;
      if (!msg || this.closed) return;
      if (msg.type === 'bridge-ready') { this.send({ type: 'probe', id: 0 }); return; }
      if (msg.type === 'ready') { this.resolveReady?.(msg); return; }
      if (msg.type === 'transport-error') { this.fail(new Error(msg.message)); return; }
      if (msg.type === 'data') {
        try {
          const raw = atob(msg.data);
          if (!raw.length || raw.length > CHUNK_SIZE || this.queuedBytes + raw.length > WINDOW_SIZE) throw new Error('Connector exceeded its receive window.');
          const data = Uint8Array.from(raw, c => c.charCodeAt(0));
          if (this.waiter) { const waiter = this.waiter; this.waiter = null; this.credit(data.length); waiter.resolve(data); }
          else { this.queue.push(data); this.queuedBytes += data.length; }
        } catch (error) { this.fail(error); }
        return;
      }
      if (msg.type === 'eof') { this.ended = true; if (this.waiter) { this.waiter.resolve(null); this.waiter = null; } return; }
      if (msg.type === 'closed') { this.close(); return; }
      const pending = this.pending.get(msg.id);
      if (pending) {
        if (msg.type === 'error') { this.pending.delete(msg.id); clearTimeout(pending.timer); pending.reject(new Error(msg.message)); }
        else if (msg.type === pending.expected) { this.pending.delete(msg.id); clearTimeout(pending.timer); pending.resolve(msg); }
      } else if (msg.type === 'error') { this.fail(new Error(msg.message)); }
    };
  }

  send(payload) { window.postMessage({ source: 'bigssh-page-v1', channel: this.channel, action: 'send', payload }, location.origin); }

  ready() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.fail(new Error('Extension not detected. Install it, then reload this page.')); }, 4000);
      this.resolveReady = value => { clearTimeout(timer); this.resolveReady = null; this.rejectReady = null; resolve(value); };
      this.rejectReady = error => { clearTimeout(timer); reject(error); };
      window.addEventListener('message', this.onMessage);
      window.postMessage({ source: 'bigssh-page-v1', channel: this.channel, action: 'attach' }, location.origin);
    });
  }

  request(type, payload, expected) {
    if (this.closed) return Promise.reject(new Error('Connector is closed.'));
    const id = this.nextID++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error(`${type} timed out.`)), 20000);
      this.pending.set(id, { resolve, reject, expected, timer });
      this.send({ type, id, ...payload });
    });
  }

  async open(host, port) {
    const result = await this.request('open', { host, port }, 'opened');
    this.credit(WINDOW_SIZE);
    return result;
  }

  credit(bytes) { if (!this.closed && !this.ended) this.send({ type: 'credit', id: this.nextID++, bytes }); }

  read() {
    if (this.queue.length) {
      const data = this.queue.shift(); this.queuedBytes -= data.length; this.credit(data.length); return Promise.resolve(data);
    }
    if (this.closed || this.ended) return this.failure ? Promise.reject(this.failure) : Promise.resolve(null);
    if (this.waiter) return Promise.reject(new Error('Concurrent transport read.'));
    return new Promise((resolve, reject) => { this.waiter = { resolve, reject }; });
  }

  write(data) {
    const copy = new Uint8Array(data);
    const result = this.writeTail.then(async () => {
      for (let offset = 0; offset < copy.length; offset += CHUNK_SIZE) {
        const chunk = copy.subarray(offset, offset + CHUNK_SIZE);
        const encoded = btoa(String.fromCharCode(...chunk));
        await this.request('write', { data: encoded }, 'written');
      }
    });
    this.writeTail = result.catch(() => {});
    return result;
  }

  fail(error) { this.failure = error; this.close(); }

  close() {
    if (this.closed) return;
    this.send({ type: 'close', id: this.nextID++ });
    this.closed = true;
    const error = this.failure ?? new Error('Connection closed.');
    this.rejectReady?.(error); this.rejectReady = null;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
    if (this.waiter) { this.failure ? this.waiter.reject(error) : this.waiter.resolve(null); this.waiter = null; }
    this.queue = []; this.queuedBytes = 0;
    window.removeEventListener('message', this.onMessage);
    window.postMessage({ source: 'bigssh-page-v1', channel: this.channel, action: 'detach' }, location.origin);
  }
}
