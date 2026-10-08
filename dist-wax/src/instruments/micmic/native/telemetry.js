const fields = ['activeVoiceIndices', 'tapActivity', 'tapVoiceIndices', 'generationActivity', 'generationVoiceCounts'];
const typed = value => ArrayBuffer.isView(value) && typeof value.length === 'number';

/** Only owned snapshot copies may be transferred; live WASM views stay attached. */
export function audioStatusTransfers(status) {
  const transfers = fields.map(key => status[key].buffer);
  transfers.push(status.inputEnvelope.values.buffer);
  return transfers;
}

/** Expand compact worklet telemetry on the main thread, preserving the public
 * arrays, missing-slot sentinel and coherent envelope used by the renderers.
 * Legacy/plain status replies remain usable without another copy. */
export function normalizeAudioStatus(status) {
  if (!status || typeof status !== 'object') return status;
  let normalized = status;
  for (const key of fields) {
    const value = status[key];
    if (!typed(value)) continue;
    if (normalized === status) normalized = { ...status };
    normalized[key] = key === 'tapVoiceIndices'
      ? Array.from(value, slot => slot === 0xffffffff ? -1 : slot) : Array.from(value);
  }
  const envelope = status.inputEnvelope;
  if (typed(envelope?.values)) {
    if (normalized === status) normalized = { ...status };
    normalized.inputEnvelope = { ...envelope, values: Array.from(envelope.values) };
  }
  return normalized;
}
