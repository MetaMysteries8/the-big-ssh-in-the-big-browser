// The runner supplies only its owned loopback target. There is no remote UI.
function localURL(url) {
  const parsed = new URL(url, location.href);
  if (parsed.hostname !== '127.0.0.1' || !(['22', '2224'].includes(parsed.port) || parsed.origin === location.origin)) throw new Error('Lab destination is not an owned loopback fixture.');
  return parsed.href;
}

export function capabilities() {
  return {
    secureContext: isSecureContext, crossOriginIsolated,
    TCPSocket: typeof globalThis.TCPSocket, UDPSocket: typeof globalThis.UDPSocket,
    WebSocket: typeof globalThis.WebSocket, WebSocketStream: typeof globalThis.WebSocketStream,
    WebTransport: typeof globalThis.WebTransport, RTCPeerConnection: typeof globalThis.RTCPeerConnection,
    chromeSocketsTCP: typeof globalThis.chrome?.sockets?.tcp,
  };
}

export async function workerCapabilities() {
  const worker = new Worker('/worker.js');
  try {
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Worker probe timed out.')), 4000);
      worker.onmessage = ({ data }) => { clearTimeout(timeout); resolve(data); };
      worker.onerror = event => { clearTimeout(timeout); reject(new Error(event.message)); };
      worker.postMessage({});
    });
  } finally { worker.terminate(); }
}

export async function directTCP() {
  if (typeof globalThis.TCPSocket === 'undefined') return { outcome: 'unsupported' };
  let socket, timer;
  try {
    socket = new TCPSocket('127.0.0.1', 2224);
    socket.closed.catch(() => {});
    const probe = async () => {
      const { readable, writable } = await socket.opened;
      const writer = writable.getWriter(), reader = readable.getReader();
      await writer.write(new TextEncoder().encode('SSH-2.0-BigSSH_Lab\r\n'));
      const { value } = await reader.read();
      return { outcome: 'bytes', prefix: new TextDecoder().decode(value).slice(0, 120) };
    };
    return await Promise.race([probe(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Direct socket timed out.')), 3000); })]);
  } catch (error) { return { outcome: 'rejected', error: `${error.name}: ${error.message}` }; }
  finally { clearTimeout(timer); try { await socket?.close(); } catch {} }
}

export async function fetchProbe(url, kind = 'get') {
  url = localURL(url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  const options = { cache: 'no-store', credentials: 'omit', signal: controller.signal };
  const identification = 'SSH-2.0-BigSSH_Lab\r\n';
  if (kind === 'get') options.mode = 'no-cors';
  if (kind === 'post') Object.assign(options, { mode: 'no-cors', method: 'POST', body: identification });
  if (kind === 'connect') options.method = 'CONNECT';
  if (kind === 'ssh-method') options.method = 'SSH-2.0-BigSSH_Lab';
  if (kind === 'ssh-method-no-cors') Object.assign(options, { method: 'SSH-2.0-BigSSH_Lab', mode: 'no-cors' });
  if (kind === 'stream') Object.assign(options, {
    method: 'POST', duplex: 'half',
    body: new ReadableStream({ start(stream) { stream.enqueue(new TextEncoder().encode(identification)); stream.close(); } }),
  });
  try {
    const response = await fetch(url, options);
    return { outcome: 'response', type: response.type, status: response.status, readableBody: response.body !== null, bodyPrefix: (await response.text()).slice(0, 120) };
  } catch (error) { return { outcome: 'rejected', error: `${error.name}: ${error.message}` }; }
  finally { clearTimeout(timeout); }
}

export function websocketProbe(url, protocol) {
  url = localURL(url);
  return new Promise(resolve => {
    let socket, timer;
    const finish = result => { clearTimeout(timer); try { socket?.close(); } catch {} resolve(result); };
    timer = setTimeout(() => finish({ outcome: 'timeout' }), 3000);
    try {
      socket = protocol ? new WebSocket(url, protocol) : new WebSocket(url);
      socket.binaryType = 'arraybuffer';
      socket.onopen = () => {
        // Only emit SSH application bytes after the browser accepts the peer.
        socket.send(new TextEncoder().encode('SSH-2.0-BigSSH_Lab\r\n'));
      };
      socket.onmessage = event => finish({ outcome: 'message', bodyPrefix: typeof event.data === 'string' ? event.data.slice(0, 120) : new TextDecoder().decode(event.data).slice(0, 120) });
      socket.onerror = () => finish({ outcome: 'error', readyState: socket.readyState });
      socket.onclose = event => finish({ outcome: 'closed', code: event.code });
    } catch (error) { finish({ outcome: 'rejected', error: `${error.name}: ${error.message}` }); }
  });
}

export async function webtransportProbe(url) {
  url = localURL(url);
  if (typeof WebTransport === 'undefined') return { outcome: 'unsupported' };
  let transport, timeout;
  try {
    transport = new WebTransport(url);
    transport.closed.catch(() => {});
    await Promise.race([
      transport.ready,
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('QUIC handshake timed out.')), 3000); }),
    ]);
    return { outcome: 'ready' };
  } catch (error) { return { outcome: 'rejected', error: `${error.name}: ${error.message}` }; }
  finally { clearTimeout(timeout); try { transport?.close(); } catch {} }
}

async function gathered(peer) {
  if (peer.iceGatheringState === 'complete') return;
  await new Promise(resolve => {
    const timer = setTimeout(done, 2000);
    function done() { clearTimeout(timer); peer.removeEventListener('icegatheringstatechange', change); resolve(); }
    function change() { if (peer.iceGatheringState === 'complete') done(); }
    peer.addEventListener('icegatheringstatechange', change);
  });
}

async function selectedPair(peer) {
  const stats = await peer.getStats();
  const pair = [...stats.values()].find(item => item.type === 'candidate-pair' && item.state === 'succeeded' && item.nominated);
  if (!pair) return null;
  const local = stats.get(pair.localCandidateId), remote = stats.get(pair.remoteCandidateId);
  // Do not persist local adapter addresses or the SDP/fingerprint.
  return { protocol: local?.protocol, localType: local?.candidateType, remoteType: remote?.candidateType };
}

export async function rtcEcho() {
  if (typeof RTCPeerConnection === 'undefined') return { outcome: 'unsupported' };
  const a = new RTCPeerConnection({ iceServers: [] }), b = new RTCPeerConnection({ iceServers: [] });
  let timeout;
  try {
    const channel = a.createDataChannel('local-control', { ordered: true }); channel.binaryType = 'arraybuffer';
    b.ondatachannel = ({ channel }) => { channel.binaryType = 'arraybuffer'; channel.onmessage = ({ data }) => channel.send(data); };
    const echo = new Promise((resolve, reject) => {
      timeout = setTimeout(() => reject(new Error('Local WebRTC echo timed out.')), 6000);
      channel.onopen = () => channel.send(new TextEncoder().encode('SSH-2.0-RTC_Control\r\n'));
      channel.onmessage = ({ data }) => resolve(new TextDecoder().decode(data));
    });
    // No signaling server, STUN server, or TURN. Both peers are on this device.
    await a.setLocalDescription(await a.createOffer()); await gathered(a);
    await b.setRemoteDescription(a.localDescription);
    await b.setLocalDescription(await b.createAnswer()); await gathered(b);
    await a.setRemoteDescription(b.localDescription);
    return { outcome: 'echo', body: await echo, selectedPair: await selectedPair(a), externalIceServers: 0 };
  } catch (error) { return { outcome: 'rejected', error: `${error.name}: ${error.message}`, iceState: a.iceConnectionState }; }
  finally { clearTimeout(timeout); a.close(); b.close(); }
}

export async function rtcTCP(port) {
  if (port !== 2224) throw new Error('The ICE experiment has one fixed owned destination.');
  if (typeof RTCPeerConnection === 'undefined') return { outcome: 'unsupported' };
  const a = new RTCPeerConnection({ iceServers: [] }), b = new RTCPeerConnection({ iceServers: [] });
  const strip = description => ({ type: description.type, sdp: description.sdp.replace(/^a=(?:candidate:.*|end-of-candidates)\r?\n/gmu, '') });
  try {
    const channel = a.createDataChannel('ssh-over-ice', { ordered: true });
    // The second local peer supplies only a syntactically valid answer. None
    // of its candidates are sent to A; A's sole remote candidate is sshd.
    await a.setLocalDescription(await a.createOffer());
    await b.setRemoteDescription(strip(a.localDescription));
    await b.setLocalDescription(await b.createAnswer());
    await a.setRemoteDescription(strip(b.localDescription));
    await a.addIceCandidate({ candidate: `candidate:1 1 tcp 2122260223 127.0.0.1 ${port} typ host tcptype passive`, sdpMid: '0', sdpMLineIndex: 0 });
    await a.addIceCandidate(null);
    await new Promise(resolve => setTimeout(resolve, 3000));
    return { outcome: channel.readyState, iceState: a.iceConnectionState, selectedPair: await selectedPair(a), externalIceServers: 0 };
  } catch (error) { return { outcome: 'rejected', error: `${error.name}: ${error.message}` }; }
  finally { a.close(); b.close(); }
}
