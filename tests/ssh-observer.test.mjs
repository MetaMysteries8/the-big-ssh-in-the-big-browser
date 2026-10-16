import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectServer } from '../experiments/preflight/ssh-observer.mjs';

function packet(payload) {
  const padding = 8 - ((payload.length + 5) % 8) + 8;
  const data = Buffer.alloc(5 + payload.length + padding);
  data.writeUInt32BE(1 + payload.length + padding); data[4] = padding; payload.copy(data, 5);
  return data;
}

test('observer separates an SSH banner from cleartext KEXINIT and disconnect packets', () => {
  const description = Buffer.from('Bad packet length');
  const disconnect = Buffer.alloc(9 + description.length); disconnect[0] = 1;
  disconnect.writeUInt32BE(2, 1); disconnect.writeUInt32BE(description.length, 5); description.copy(disconnect, 9);
  const result = inspectServer(Buffer.concat([Buffer.from('SSH-2.0-Fixture\r\n'), packet(Buffer.from([20, 1, 2])), packet(disconnect)]));
  assert.equal(result.banner, 'SSH-2.0-Fixture'); assert.deepEqual(result.messageTypes, [20, 1]);
  assert.deepEqual(result.disconnects, ['Bad packet length']);
});

test('partial or malformed cleartext frames do not become fake KEXINIT evidence', () => {
  const valid = packet(Buffer.from([20, 1]));
  assert.deepEqual(inspectServer(Buffer.concat([Buffer.from('SSH-2.0-Fixture\r\n'), valid.subarray(0, valid.length - 1)])).messageTypes, []);
  const oversized = Buffer.alloc(8); oversized.writeUInt32BE(0xffffffff);
  assert.deepEqual(inspectServer(Buffer.concat([Buffer.from('SSH-2.0-Fixture\r\n'), oversized])).messageTypes, []);
  assert.equal(inspectServer(Buffer.from('SSH-2.0-partial')).banner, null);
});
