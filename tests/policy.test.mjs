import test from 'node:test';
import assert from 'node:assert/strict';
import { authorize, normalizeTarget, DEFAULT_ORIGINS } from '../apps/extension/policy.js';
import workspace from '../apps/web/workspace.js';

const target = { host: '127.0.0.1', port: 2222 };
const sender = { tab: { id: 1 }, frameId: 0, url: 'http://127.0.0.1:5173/' };
const settings = { origins: DEFAULT_ORIGINS, targets: [{ ...target, origin: 'http://127.0.0.1:5173' }] };

test('only the paired top-level origin and approved destination may open TCP', () => {
  assert.equal(authorize(sender, settings, target), true);
  assert.equal(authorize({ ...sender, frameId: 1 }, settings, target), false);
  assert.equal(authorize({ ...sender, tab: undefined }, settings, target), false);
  assert.equal(authorize({ ...sender, url: 'https://untrusted.example/' }, settings, target), false);
  assert.equal(authorize({ ...sender, url: 'http://127.0.0.1:9999/' }, settings, target), false);
  assert.equal(authorize(sender, settings, { ...target, port: 22 }), false);
  assert.equal(authorize(sender, { ...settings, targets: [] }, target), false);
});

test('destination input is data, not a URL or command', () => {
  assert.deepEqual(normalizeTarget('Example.COM', 2222), { host: 'example.com', port: 2222 });
  for (const host of ['ssh://host', 'user@host', 'host\nother', 'host/path', '']) assert.throws(() => normalizeTarget(host, 22));
  for (const port of [0, -1, 65536, 1.5, 'bad']) assert.throws(() => normalizeTarget('host', port));
});

test('default workspace cannot initiate a live sandbox or run a startup command', () => {
  assert.equal(workspace.connection.host, '');
  assert.equal(workspace.startup.connect, false);
  assert.equal(workspace.startup.command, '');
});
