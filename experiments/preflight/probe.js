export async function request(kind = 'method') {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch('http://127.0.0.1:2225/primed', {
      method: kind === 'get' ? 'GET' : 'SSH-2.0-BigSSH_Lab',
      mode: 'cors', credentials: 'omit', signal: controller.signal,
      ...(kind === 'strip-headers' ? { headers: { Host: '', Connection: '', Accept: '' } } : {}),
    });
    return { outcome: 'response', type: response.type, status: response.status, readableBody: response.body !== null, text: (await response.text()).slice(0, 160) };
  } catch (error) { return { outcome: 'rejected', error: `${error.name}: ${error.message}` }; }
  finally { clearTimeout(timeout); }
}

export async function serviceWorkerProbe() {
  const intercepted = [];
  const message = event => { if (event.data?.source === 'preflight-lab-worker') intercepted.push(event.data.method); };
  navigator.serviceWorker.addEventListener('message', message);
  try {
    await navigator.serviceWorker.register('/worker.js');
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { navigator.serviceWorker.removeEventListener('controllerchange', changed); reject(new Error('Service Worker did not claim the test page.')); }, 4000);
      function changed() { if (navigator.serviceWorker.controller) { clearTimeout(timer); navigator.serviceWorker.removeEventListener('controllerchange', changed); resolve(); } }
      navigator.serviceWorker.addEventListener('controllerchange', changed); changed();
    });
    const control = await (await fetch('/sw-local-control')).text();
    if (control !== 'LOCAL_SW_CONTROL') throw new Error('Service Worker positive control did not execute.');
    const result = await request();
    await new Promise(resolve => setTimeout(resolve, 100));
    return { ...result, serviceWorkerControlled: !!navigator.serviceWorker.controller, positiveControl: control, intercepted };
  } finally { navigator.serviceWorker.removeEventListener('message', message); }
}
