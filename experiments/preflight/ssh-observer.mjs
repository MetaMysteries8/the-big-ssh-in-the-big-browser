// Inspect only cleartext packets before SSH encryption. No credentials, host
// trust, or SSH session implementation is provided by this test helper.
export function inspectServer(data) {
  const lineEnd = data.indexOf('\n');
  if (lineEnd < 0) return { banner: null, messageTypes: [], disconnects: [] };
  const banner = data.subarray(0, lineEnd).toString().replace(/\r$/u, '');
  const messageTypes = [], disconnects = [];
  let offset = lineEnd + 1;
  while (offset + 5 <= data.length) {
    const length = data.readUInt32BE(offset), padding = data[offset + 4];
    if (length < 6 || length > 65535 || padding < 4 || padding + 2 > length || offset + 4 + length > data.length) break;
    const payload = data.subarray(offset + 5, offset + 4 + length - padding);
    messageTypes.push(payload[0]);
    if (payload[0] === 1 && payload.length >= 9) {
      const descriptionLength = payload.readUInt32BE(5);
      if (descriptionLength <= payload.length - 9) disconnects.push(payload.subarray(9, 9 + descriptionLength).toString().slice(0, 250));
    }
    offset += 4 + length;
  }
  return { banner, messageTypes, disconnects };
}
