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
