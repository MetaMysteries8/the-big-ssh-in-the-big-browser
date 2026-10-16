self.onmessage = async () => {
  let connect;
  try { await fetch('http://127.0.0.1:2224/worker-connect', { method: 'CONNECT' }); connect = 'unexpectedly accepted'; }
  catch (error) { connect = `${error.name}: ${error.message}`; }
  self.postMessage({
    secureContext: self.isSecureContext,
    crossOriginIsolated: self.crossOriginIsolated,
    TCPSocket: typeof self.TCPSocket,
    UDPSocket: typeof self.UDPSocket,
    WebSocket: typeof self.WebSocket,
    WebTransport: typeof self.WebTransport,
    connect,
  });
};
