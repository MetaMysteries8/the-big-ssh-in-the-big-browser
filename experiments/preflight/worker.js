self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin === self.location.origin && url.pathname === '/sw-local-control') {
    event.respondWith(new Response('LOCAL_SW_CONTROL', { headers: { 'Content-Type': 'text/plain' } }));
    return;
  }
  if (event.request.url !== 'http://127.0.0.1:2225/primed') return;
  event.waitUntil(self.clients.matchAll({ type: 'window' }).then(clients => {
    for (const client of clients) client.postMessage({ source: 'preflight-lab-worker', method: event.request.method });
  }));
  if (event.request.method === 'OPTIONS') {
    // This deliberately tries to answer preflight locally. The lab records
    // whether the browser ever delivers that request to a Service Worker.
    event.respondWith(new Response(null, { status: 204, headers: {
      'Access-Control-Allow-Origin': self.location.origin,
      'Access-Control-Allow-Methods': 'SSH-2.0-BigSSH_Lab',
      'Access-Control-Max-Age': '600',
    } }));
  } else event.respondWith(fetch(event.request));
});
