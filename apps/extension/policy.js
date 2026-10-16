export const DEFAULT_ORIGINS = [
  'http://127.0.0.1:5173', 'http://localhost:5173',
  'http://127.0.0.1:4173', 'http://localhost:4173',
];

export function normalizeTarget(host, port) {
  if (typeof host !== 'string' || !host || host.length > 253 || /[\s/@\\\x00]/u.test(host)) throw new Error('Invalid hostname.');
  const number = Number(port);
  if (!Number.isInteger(number) || number < 1 || number > 65535) throw new Error('Invalid port.');
  return { host: host.toLowerCase(), port: number };
}

export function authorize(sender, settings, target) {
  if (!sender.tab || sender.frameId !== 0 || !sender.url) return false;
  let origin;
  try { origin = new URL(sender.url).origin; } catch { return false; }
  if (!(settings.origins ?? DEFAULT_ORIGINS).includes(origin)) return false;
  return (settings.targets ?? []).some(grant => grant.origin === origin && grant.host === target.host && grant.port === target.port);
}
