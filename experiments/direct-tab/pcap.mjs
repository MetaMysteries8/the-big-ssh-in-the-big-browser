// Read tcpdump's bounded Ethernet PCAP stream. This is packet observation, not
// TCP stream reassembly; repeated/reordered payloads remain separate packets.
export function packets(buffer) {
  if (buffer.length < 24) return [];
  const magic = buffer.readUInt32LE(0);
  const little = magic === 0xa1b2c3d4;
  if (!little && magic !== 0xd4c3b2a1) throw new Error('Expected microsecond Ethernet PCAP.');
  const u32 = offset => little ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
  if (u32(20) !== 1) throw new Error('Expected Ethernet capture; refusing to guess a link type.');
  const result = [];
  for (let offset = 24; offset + 16 <= buffer.length;) {
    const length = u32(offset + 8);
    if (length > 65535) throw new Error('PCAP record exceeds capture bound.');
    if (offset + 16 + length > buffer.length) break; // A live stream may end mid-record.
    const frame = buffer.subarray(offset + 16, offset + 16 + length);
    offset += 16 + length;
    if (frame.length < 34 || frame.readUInt16BE(12) !== 0x0800) continue;
    const ip = 14, ipLength = (frame[ip] & 15) * 4;
    if (ipLength < 20 || frame.length < ip + ipLength || (frame.readUInt16BE(ip + 6) & 0x1fff)) continue;
    const end = Math.min(frame.length, ip + frame.readUInt16BE(ip + 2));
    const start = ip + ipLength, protocol = frame[ip + 9];
    if (protocol !== 6 && protocol !== 17) continue;
    if (end < start + (protocol === 6 ? 20 : 8)) continue;
    const source = frame.readUInt16BE(start), destination = frame.readUInt16BE(start + 2);
    const header = protocol === 6 ? (frame[start + 12] >>> 4) * 4 : 8;
    if (header < (protocol === 6 ? 20 : 8) || end < start + header) continue;
    result.push({ protocol: protocol === 6 ? 'tcp' : 'udp', source, destination, flags: protocol === 6 ? frame[start + 13] : 0, payload: frame.subarray(start + header, end) });
  }
  return result;
}

function prefix(data) {
  return { hex: data.subarray(0, 96).toString('hex'), ascii: data.subarray(0, 160).toString('latin1').replace(/[^\x20-\x7e\r\n\t]/gu, '.') };
}

export function summarize(observed) {
  const client = observed.filter(packet => packet.destination === 22);
  const server = observed.filter(packet => packet.source === 22);
  const clientData = client.filter(packet => packet.protocol === 'tcp' && packet.payload.length);
  const serverData = server.filter(packet => packet.protocol === 'tcp' && packet.payload.length);
  const udpData = client.filter(packet => packet.protocol === 'udp' && packet.payload.length);
  return {
    clientSyns: client.filter(packet => packet.protocol === 'tcp' && (packet.flags & 2)).length,
    serverSynAcks: server.filter(packet => packet.protocol === 'tcp' && (packet.flags & 18) === 18).length,
    clientPayloadPackets: clientData.length, serverPayloadPackets: serverData.length,
    udpPackets: observed.filter(packet => packet.protocol === 'udp').length,
    clientFirstUDPPayload: udpData[0] ? prefix(udpData[0].payload) : null,
    clientFirstPayload: clientData[0] ? prefix(clientData[0].payload) : null,
    serverFirstPayload: serverData[0] ? prefix(serverData[0].payload) : null,
    sshTextSeenInClientPayload: clientData.some(packet => packet.payload.includes('SSH-2.0-')),
    // Seeing a banner-shaped string inside HTTP or ICE is not SSH negotiation.
    clientFirstPayloadStartsSSH: clientData[0]?.payload.subarray(0, 8).toString() === 'SSH-2.0-',
  };
}
