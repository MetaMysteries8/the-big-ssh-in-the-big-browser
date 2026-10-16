import test from 'node:test';
import assert from 'node:assert/strict';
import { packets, summarize } from '../experiments/direct-tab/pcap.mjs';

function fixture(payload, { little = true, source = 50000, destination = 22, flags = 24, udp = false } = {}) {
  const header = Buffer.alloc(24);
  const put = (buffer, value, offset) => little ? buffer.writeUInt32LE(value, offset) : buffer.writeUInt32BE(value, offset);
  put(header, 0xa1b2c3d4, 0); put(header, 65535, 16); put(header, 1, 20);
  const data = Buffer.from(payload), transportHeader = udp ? 8 : 20;
  const frame = Buffer.alloc(14 + 20 + transportHeader + data.length);
  frame.writeUInt16BE(0x0800, 12); frame[14] = 0x45; frame.writeUInt16BE(20 + transportHeader + data.length, 16); frame[23] = udp ? 17 : 6;
  frame.writeUInt16BE(source, 34); frame.writeUInt16BE(destination, 36);
  if (udp) frame.writeUInt16BE(8 + data.length, 38);
  else { frame[46] = 0x50; frame[47] = flags; }
  data.copy(frame, 14 + 20 + transportHeader);
  const record = Buffer.alloc(16); put(record, frame.length, 8); put(record, frame.length, 12);
  return Buffer.concat([header, record, frame]);
}

test('wire observer distinguishes real identification from an HTTP body containing SSH text', () => {
  const real = summarize(packets(fixture('SSH-2.0-Lab\r\n')));
  assert.equal(real.clientFirstPayloadStartsSSH, true);
  const http = summarize(packets(fixture('POST / HTTP/1.1\r\n\r\nSSH-2.0-Lab\r\n')));
  assert.equal(http.sshTextSeenInClientPayload, true);
  assert.equal(http.clientFirstPayloadStartsSSH, false);
});

test('wire observer handles PCAP byte orders and partial live records without fabricating data', () => {
  const capture = fixture('SSH-2.0-Lab\r\n', { little: false });
  assert.equal(packets(capture)[0].payload.toString(), 'SSH-2.0-Lab\r\n');
  assert.deepEqual(packets(capture.subarray(0, capture.length - 1)), []);
  assert.deepEqual(packets(Buffer.alloc(10)), []);
  const unsupported = fixture('x'); unsupported.writeUInt32LE(113, 20);
  assert.throws(() => packets(unsupported), /Ethernet/u);
});

test('wire observer keeps server banners separate from TCP acknowledgments', () => {
  const server = summarize(packets(fixture('SSH-2.0-OpenSSH\r\n', { source: 22, destination: 50000 })));
  assert.equal(server.clientPayloadPackets, 0); assert.equal(server.serverPayloadPackets, 1);
  assert.match(server.serverFirstPayload.ascii, /^SSH-2.0-/u);
  const ack = summarize(packets(fixture('', { flags: 16 })));
  assert.equal(ack.clientPayloadPackets, 0); assert.equal(ack.clientFirstPayload, null);
});

test('QUIC/UDP payloads are not mistaken for TCP payloads', () => {
  const wire = summarize(packets(fixture('QUIC-shaped control', { udp: true })));
  assert.equal(wire.udpPackets, 1); assert.equal(wire.clientPayloadPackets, 0);
  assert.equal(wire.clientFirstPayload, null); assert.equal(wire.clientFirstUDPPayload.ascii, 'QUIC-shaped control');
});
