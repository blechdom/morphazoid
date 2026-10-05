/** Shared byte boundary; AudioWorklet does not consistently provide TextEncoder. */
export function encodeUtf8(value) {
  const text = String(value), bytes = [];
  for (const character of text) {
    const code = character.codePointAt(0);
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | code >> 6, 0x80 | code & 63);
    else if (code < 0x10000) bytes.push(0xe0 | code >> 12, 0x80 | code >> 6 & 63, 0x80 | code & 63);
    else bytes.push(0xf0 | code >> 18, 0x80 | code >> 12 & 63, 0x80 | code >> 6 & 63, 0x80 | code & 63);
  }
  return Uint8Array.from(bytes);
}

export function decodeUtf8(bytes) {
  let result = '';
  for (let i = 0; i < bytes.length;) {
    const lead = bytes[i++]; let code = lead;
    if (lead >= 0xf0) code = (lead & 7) << 18 | (bytes[i++] & 63) << 12 | (bytes[i++] & 63) << 6 | bytes[i++] & 63;
    else if (lead >= 0xe0) code = (lead & 15) << 12 | (bytes[i++] & 63) << 6 | bytes[i++] & 63;
    else if (lead >= 0xc0) code = (lead & 31) << 6 | bytes[i++] & 63;
    result += String.fromCodePoint(code);
  }
  return result;
}

export function wasmError(api, fallback) {
  const count = api.lsd_error_len();
  return count ? decodeUtf8(new Uint8Array(api.memory.buffer, api.lsd_error_ptr(), count)) : fallback;
}

export function withBytes(api, bytes, callback) {
  const pointer = api.lsd_alloc(bytes.length);
  if (!pointer) throw new Error(wasmError(api, 'The audio engine could not allocate memory.'));
  try {
    new Uint8Array(api.memory.buffer, pointer, bytes.length).set(bytes);
    return callback(pointer, bytes.length);
  } finally { api.lsd_free(pointer, bytes.length); }
}

export function withJson(api, value, callback) {
  return withBytes(api, encodeUtf8(JSON.stringify(value)), callback);
}
