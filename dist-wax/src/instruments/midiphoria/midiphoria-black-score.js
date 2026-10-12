/** Compact, lossless note index for the falling-score view. No audio or DOM. */
export const BLACK_MIDI_LIMITS = Object.freeze({ bytes: 200 * 1024 * 1024, notes: 12_000_000, tracks: 2048, tempos: 100_000 });
const BLOCK = 64;
const fail = message => { throw new Error(message); };
const upper = (array, value, begin = 0, end = array.length) => {
  while (begin < end) { const middle = (begin + end) >>> 1; if (array[middle] <= value) begin = middle + 1; else end = middle; }
  return begin;
};

function header(buffer, limits) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 14) fail('Choose a Standard MIDI file.');
  if (buffer.byteLength > limits.bytes) fail(`Falling notes accepts files up to ${Math.floor(limits.bytes / 1048576)} MB.`);
  const view = new DataView(buffer);
  if (view.getUint32(0) !== 0x4d546864) fail('Missing MIDI header.');
  const length = view.getUint32(4), format = view.getUint16(8), count = view.getUint16(10), division = view.getUint16(12);
  if (length < 6 || length + 8 > buffer.byteLength || !count || !division) fail('Invalid MIDI header.');
  if (format > 1) fail('Falling notes supports MIDI formats 0 and 1; format 2 contains separate timelines.');
  if (count > limits.tracks || (format === 0 && count !== 1)) fail('Unsupported MIDI track count.');
  let secondsPerTick = null;
  if (division & 0x8000) {
    const fps = 256 - (division >> 8), subframes = division & 255;
    if (![24, 25, 29, 30].includes(fps) || !subframes) fail('Invalid SMPTE MIDI timing.');
    secondsPerTick = 1 / ((fps === 29 ? 30000 / 1001 : fps) * subframes);
  }
  const chunks = []; let offset = length + 8;
  while (offset + 8 <= buffer.byteLength && chunks.length < count) {
    const id = view.getUint32(offset), size = view.getUint32(offset + 4), start = offset + 8;
    if (size > buffer.byteLength - start) fail('Truncated MIDI track.');
    if (id === 0x4d54726b) chunks.push({ start, end: start + size });
    offset = start + size;
  }
  if (chunks.length !== count) fail('Missing MIDI tracks.');
  return { format, division, chunks, secondsPerTick };
}

function walk(bytes, chunk, event, meta) {
  let at = chunk.start, tick = 0, running = 0;
  const read = () => { if (at >= chunk.end) fail('Truncated MIDI event.'); return bytes[at++]; };
  const variable = () => {
    let result = 0;
    for (let index = 0; index < 4; index++) { const byte = read(); result = result * 128 + (byte & 127); if (!(byte & 128)) return result; }
    return fail('Invalid MIDI variable-length quantity.');
  };
  while (at < chunk.end) {
    tick += variable(); if (!Number.isSafeInteger(tick)) fail('MIDI timeline exceeds safe precision.');
    let status = read();
    if (status < 128) { if (!running) fail('Invalid MIDI running status.'); at--; status = running; }
    if (status >= 0x80 && status <= 0xef) {
      running = status;
      const kind = status >> 4, a = read(), b = kind === 0xc || kind === 0xd ? 0 : read();
      if (a > 127 || b > 127) fail('Invalid MIDI data byte.');
      event?.(tick, kind, status & 15, a, b);
    } else if (status === 0xff) {
      running = 0;
      const type = read(), length = variable();
      if (length > chunk.end - at) fail('Truncated MIDI metadata.');
      meta?.(tick, type, at, length);
      at += length; if (type === 0x2f) break;
    } else if (status === 0xf0 || status === 0xf7) {
      running = 0; const length = variable();
      if (length > chunk.end - at) fail('Truncated MIDI system message.');
      at += length;
    } else fail('Unsupported event in Standard MIDI file.');
  }
  return tick;
}

/** Positive Note On attacks are retained, including overlapping identical notes.
 * Note Off pairing is FIFO within each track/channel/pitch. Held counts mean
 * note gates, not SoundFont voices or CC64 sustain. Unclosed gates end at EOT.
 * Typed storage is about 27 bytes/note plus a small block tree; parsing adds a
 * temporary 4-byte/note FIFO link array and the source buffer, inside a worker.
 */
export function parseBlackMidiScore(buffer, { limits: requested = {} } = {}) {
  const limits = Object.fromEntries(Object.entries(BLACK_MIDI_LIMITS).map(([key, value]) => [key,
    Math.min(value, Math.max(1, Number.isFinite(requested[key]) ? Math.floor(requested[key]) : value))]));
  const midi = header(buffer, limits), bytes = new Uint8Array(buffer), tempos = [], tracks = [];
  let total = 0;
  midi.chunks.forEach((chunk, id) => {
    const start = total; let name = `Track ${id + 1}`; const channels = new Set();
    const tick = walk(bytes, chunk, (_, kind, channel, _pitch, velocity) => {
      if (kind === 9 && velocity > 0) { total++; channels.add(channel); if (total > limits.notes) fail(`Falling notes accepts at most ${limits.notes.toLocaleString('en-US')} notes; this score was not thinned.`); }
    }, (time, type, at, size) => {
      if (type === 3 && size) name = new TextDecoder().decode(bytes.subarray(at, at + Math.min(size, 256))).replace(/[\x00-\x1f]/g, '').trim() || name;
      if (type === 0x51 && size === 3) {
        const tempo = bytes[at] * 65536 + bytes[at + 1] * 256 + bytes[at + 2];
        if (!tempo) fail('Invalid zero MIDI tempo.');
        tempos.push({ tick: time, tempo }); if (tempos.length > limits.tempos) fail('Too many MIDI tempo changes.');
      }
    });
    tracks.push({ id, name, start, end: total, noteCount: total - start, channels: [...channels], endTick: tick });
  });
  tempos.sort((a, b) => a.tick - b.tick);
  const tempoTicks = [0], tempoSeconds = [0], tempoValues = [500000];
  if (!midi.secondsPerTick) for (const change of tempos) {
    const last = tempoTicks.length - 1;
    if (change.tick === tempoTicks[last]) tempoValues[last] = change.tempo;
    else {
      tempoSeconds.push(tempoSeconds[last] + (change.tick - tempoTicks[last]) * tempoValues[last] / midi.division / 1e6);
      tempoTicks.push(change.tick); tempoValues.push(change.tempo);
    }
  }
  const seconds = tick => {
    if (midi.secondsPerTick) return tick * midi.secondsPerTick;
    const index = upper(tempoTicks, tick) - 1;
    return tempoSeconds[index] + (tick - tempoTicks[index]) * tempoValues[index] / midi.division / 1e6;
  };
  const starts = new Float64Array(total), ends = new Float64Array(total), sortedEnds = new Float64Array(total);
  const pitches = new Uint8Array(total), velocities = new Uint8Array(total), channels = new Uint8Array(total), next = new Uint32Array(total);
  const heads = new Uint32Array(2048), tails = new Uint32Array(2048);
  let unclosed = 0, unmatchedOffs = 0, duration = 0;
  for (const track of tracks) {
    heads.fill(0); tails.fill(0); let index = track.start;
    walk(bytes, midi.chunks[track.id], (tick, kind, channel, pitch, velocity) => {
      const key = channel * 128 + pitch;
      if (kind === 9 && velocity > 0) {
        const cursor = index++;
        starts[cursor] = seconds(tick); pitches[cursor] = pitch; velocities[cursor] = velocity; channels[cursor] = channel;
        if (tails[key]) next[tails[key] - 1] = cursor + 1; else heads[key] = cursor + 1;
        tails[key] = cursor + 1;
      } else if (kind === 8 || (kind === 9 && velocity === 0)) {
        const cursor = heads[key];
        if (cursor) { ends[cursor - 1] = seconds(tick); heads[key] = next[cursor - 1]; if (!heads[key]) tails[key] = 0; }
        else unmatchedOffs++;
      }
    });
    const end = seconds(track.endTick); duration = Math.max(duration, end);
    for (let key = 0; key < heads.length; key++) for (let cursor = heads[key]; cursor; cursor = next[cursor - 1]) { ends[cursor - 1] = end; unclosed++; }
    sortedEnds.set(ends.subarray(track.start, track.end), track.start);
    sortedEnds.subarray(track.start, track.end).sort();
    track.blocks = Math.ceil(track.noteCount / BLOCK); track.treeSize = 1;
    while (track.treeSize < track.blocks) track.treeSize *= 2;
    track.maxEnds = new Float64Array(track.treeSize * 2);
    for (let note = track.start; note < track.end; note++) {
      const slot = track.treeSize + Math.floor((note - track.start) / BLOCK);
      track.maxEnds[slot] = Math.max(track.maxEnds[slot], ends[note]);
    }
    for (let slot = track.treeSize - 1; slot > 0; slot--) track.maxEnds[slot] = Math.max(track.maxEnds[slot * 2], track.maxEnds[slot * 2 + 1]);
  }
  // Merge sorted per-track attacks without allocating one JS object per note.
  // All matching gate ends at the same instant precede its new attacks.
  const mergeHeap = values => {
    const heap = tracks.filter(track => track.noteCount).map(track => ({ at: track.start, end: track.end }));
    const down = slot => {
      while (slot * 2 + 1 < heap.length) {
        let child = slot * 2 + 1;
        if (child + 1 < heap.length && values[heap[child + 1].at] < values[heap[child].at]) child++;
        if (values[heap[slot].at] <= values[heap[child].at]) break;
        const previous = heap[slot]; heap[slot] = heap[child]; heap[child] = previous; slot = child;
      }
    };
    for (let index = (heap.length >> 1) - 1; index >= 0; index--) down(index);
    return { get first() { return heap.length ? values[heap[0].at] : Infinity; }, next() {
      if (++heap[0].at === heap[0].end) { heap[0] = heap[heap.length - 1]; heap.pop(); }
      if (heap.length) down(0);
    } };
  };
  const attacks = mergeHeap(starts), releases = mergeHeap(sortedEnds);
  let passed = 0, released = 0, peakPolyphony = 0;
  while (attacks.first !== Infinity) {
    const time = attacks.first; passed++;
    while (releases.first <= time) { released++; releases.next(); }
    peakPolyphony = Math.max(peakPolyphony, passed - released); attacks.next();
  }
  return { version: 1, format: midi.format, division: midi.division, total, duration, peakPolyphony,
    starts, ends, sortedEnds, pitches, velocities, channels, tracks,
    diagnostics: { unclosed, unmatchedOffs, sourceBytes: buffer.byteLength, noteLimit: limits.notes, thinned: false },
  };
}

export function blackMidiStatistics(score, position, { lookAhead = 6, hiddenTracks = [] } = {}) {
  if (!score) return { total: 0, passed: 0, held: 0, notesPerSecond: 0, peakPolyphony: 0, candidateCount: 0 };
  const time = Math.max(0, Number(position) || 0), hidden = new Set(hiddenTracks.map(Number));
  let passed = 0, held = 0, notesPerSecond = 0, candidateCount = 0;
  for (const track of score.tracks) {
    const attacks = upper(score.starts, time, track.start, track.end) - track.start;
    const released = upper(score.sortedEnds, time, track.start, track.end) - track.start;
    passed += attacks; held += attacks - released;
    notesPerSecond += attacks - (upper(score.starts, time - 1, track.start, track.end) - track.start);
    if (!hidden.has(track.id)) candidateCount += upper(score.starts, time + lookAhead, track.start, track.end) - track.start - released;
  }
  return { total: score.total, passed, held, notesPerSecond, peakPolyphony: score.peakPolyphony, candidateCount };
}

/** Bounded interval query. Score counts stay exact even when display is capped. */
export function queryBlackMidiNotes(score, position, lookAhead = 6, { limit = 200_000, scanLimit = 400_000, hiddenTracks = [], visit = () => {} } = {}) {
  if (!score) return { visible: 0, scanned: 0 };
  const time = Math.max(0, Number(position) || 0), hidden = new Set(hiddenTracks.map(Number));
  let visible = 0, scanned = 0;
  for (const track of score.tracks) {
    if (!track.noteCount || hidden.has(track.id)) continue;
    const last = upper(score.starts, time + lookAhead, track.start, track.end);
    const search = (node, firstBlock, blockCount) => {
      if (visible >= limit || scanned >= scanLimit || track.maxEnds[node] <= time || track.start + firstBlock * BLOCK >= last) return;
      if (blockCount === 1) {
        const end = Math.min(last, track.start + (firstBlock + 1) * BLOCK);
        for (let index = track.start + firstBlock * BLOCK; index < end && visible < limit && scanned < scanLimit; index++) {
          scanned++; if (score.ends[index] > time) { visit(index, track.id); visible++; }
        }
      } else { search(node * 2, firstBlock, blockCount / 2); search(node * 2 + 1, firstBlock + blockCount / 2, blockCount / 2); }
    };
    search(1, 0, track.treeSize);
    if (visible >= limit || scanned >= scanLimit) break;
  }
  return { visible, scanned };
}
