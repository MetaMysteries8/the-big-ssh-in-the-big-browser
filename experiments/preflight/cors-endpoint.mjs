import { createServer } from 'node:net';

export const SSH_METHOD = 'SSH-2.0-BigSSH_Lab';

// A deliberately cooperating HTTP fixture, never a TCP/SSH forwarding service.
// It is fully stopped before the real SSH daemon takes the same host port.
export async function corsEndpoint(origin, port = 2225) {
  const url = new URL(origin);
  if (url.hostname !== '127.0.0.1' || url.protocol !== 'http:' || port !== 2225) throw new Error('Only the fixed loopback fixture may be primed.');
  const requests = [], sockets = new Set();
  const server = createServer(socket => {
    sockets.add(socket); socket.once('close', () => sockets.delete(socket));
    socket.setTimeout(4000, () => socket.destroy());
    let buffered = Buffer.alloc(0), replied = false;
    socket.on('error', () => {});
    socket.on('data', chunk => {
      if (replied) return;
      if (buffered.length + chunk.length > 16384) { socket.destroy(); return; }
      buffered = Buffer.concat([buffered, chunk]);
      const end = buffered.indexOf('\r\n\r\n'); if (end < 0) return;
      replied = true;
      const [firstLine, ...lines] = buffered.subarray(0, end).toString('latin1').split('\r\n');
      const [method, path, version] = firstLine.split(' ');
      const headers = Object.fromEntries(lines.map(line => { const colon = line.indexOf(':'); return [line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim()]; }));
      requests.push({ method, path, origin: headers.origin ?? null, host: headers.host ?? null, headerNames: Object.keys(headers) });
      const allowed = path === '/primed' && version === 'HTTP/1.1' && headers.origin === origin &&
        (method === SSH_METHOD || (method === 'OPTIONS' && headers['access-control-request-method'] === SSH_METHOD));
      const body = allowed && method !== 'OPTIONS' ? 'PRIMED_HTTP_CONTROL' : '';
      const status = !allowed ? '403 Forbidden' : method === 'OPTIONS' ? '204 No Content' : '200 OK';
      socket.end([
        `HTTP/1.1 ${status}`,
        ...(allowed ? [`Access-Control-Allow-Origin: ${origin}`, `Access-Control-Allow-Methods: ${SSH_METHOD}`, 'Access-Control-Max-Age: 600'] : []),
        'Cache-Control: no-store', 'Connection: close', 'Content-Type: text/plain',
        `Content-Length: ${Buffer.byteLength(body)}`, '', body,
      ].join('\r\n'));
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return {
    requests,
    async close() {
      const closed = new Promise(resolve => server.close(resolve));
      for (const socket of sockets) socket.destroy();
      await closed;
    },
  };
}
