/** Shared file limits and inexpensive inspection; never decodes PCM or starts audio. */
export const MAX_SOUNDFONT_BYTES = 128 * 1024 * 1024;

export function inspectSoundFont(input) {
  const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : ArrayBuffer.isView(input) ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength) : null;
  const fail = message => { throw new Error(`SoundFont: ${message}`); };
  if (!bytes || bytes.length < 12) fail('choose a valid SF2 or SF3 file.');
  if (bytes.length > MAX_SOUNDFONT_BYTES) fail('files must be 128 MiB or smaller.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (at, length) => new TextDecoder('windows-1252').decode(bytes.subarray(at, at + length)).replace(/\0.*$/s, '').trim();
  if (text(0, 4) !== 'RIFF' || text(8, 4) !== 'sfbk') fail('this is not an SF2 or SF3 bank. Extract ZIP or SFArk archives first.');
  const end = view.getUint32(4, true) + 8;
  if (end !== bytes.length) fail('the file is truncated or has an invalid RIFF length.');
  const sections = new Map();
  function chunks(start, stop, visit) {
    for (let at = start; at < stop;) {
      if (at + 8 > stop) fail('truncated chunk header.');
      const size = view.getUint32(at + 4, true), next = at + 8 + size + (size & 1);
      if (next > stop) fail('truncated chunk data.');
      visit(text(at, 4), at + 8, size); at = next;
    }
  }
  chunks(12, end, (tag, at, size) => {
    if (tag !== 'LIST') return;
    if (size < 4) fail('invalid LIST chunk.');
    const name = text(at, 4);
    if (sections.has(name)) fail(`duplicate ${name} section.`);
    const items = new Map();
    chunks(at + 4, at + size, (id, offset, length) => {
      if (items.has(id)) fail(`duplicate ${id} chunk.`);
      items.set(id, { offset, length });
    });
    sections.set(name, items);
  });
  const required = (section, id, record = 1, minimum = record) => {
    const chunk = sections.get(section)?.get(id);
    if (!chunk || chunk.length < minimum || chunk.length % record) fail(`invalid or missing ${id} chunk.`);
    return chunk;
  };
  const version = required('INFO', 'ifil', 4), major = view.getUint16(version.offset, true);
  if (major !== 2 && major !== 3) fail('only SF2 and SF3 banks are supported.');
  const phdr = required('pdta', 'phdr', 38, 76), shdr = required('pdta', 'shdr', 46, 92);
  for (const [id, size] of [['pbag', 4], ['pmod', 10], ['pgen', 4], ['inst', 22], ['ibag', 4], ['imod', 10], ['igen', 4]]) required('pdta', id, size);
  const samples = required('sdta', 'smpl');
  // Terminal names are informational; MuseScore's official FluidR3Mono SF3
  // leaves them blank. Validate the actual hydra table boundaries instead.
  function validateTables(headers, width, field, bagsId, generatorsId, modulatorsId) {
    const bags = required('pdta', bagsId, 4), generators = required('pdta', generatorsId, 4), modulators = required('pdta', modulatorsId, 10);
    let previous = 0;
    for (let at = headers.offset; at < headers.offset + headers.length; at += width) {
      const index = view.getUint16(at + field, true);
      if (index < previous || index >= bags.length / 4 || (at === headers.offset && index !== 0)) fail('invalid preset/instrument bag index.');
      previous = index;
    }
    if (previous !== bags.length / 4 - 1) fail('invalid terminal bag index.');
    let previousGen = 0, previousMod = 0;
    for (let at = bags.offset; at < bags.offset + bags.length; at += 4) {
      const gen = view.getUint16(at, true), mod = view.getUint16(at + 2, true);
      if (gen < previousGen || mod < previousMod || gen >= generators.length / 4 || mod >= modulators.length / 10 || (at === bags.offset && (gen !== 0 || mod !== 0))) fail('invalid generator/modulator index.');
      previousGen = gen; previousMod = mod;
    }
    if (previousGen !== generators.length / 4 - 1 || previousMod !== modulators.length / 10 - 1) fail('invalid terminal generator/modulator index.');
  }
  validateTables(phdr, 38, 24, 'pbag', 'pgen', 'pmod');
  validateTables(required('pdta', 'inst', 22, 44), 22, 20, 'ibag', 'igen', 'imod');
  let compressed = major === 3 || text(samples.offset, Math.min(4, samples.length)) === 'OggS';
  for (let at = shdr.offset; at < shdr.offset + shdr.length - 46; at += 46) compressed ||= Boolean(view.getUint16(at + 44, true) & 0x10);
  const presets = [];
  for (let at = phdr.offset; at < phdr.offset + phdr.length - 38; at += 38) presets.push({ name: text(at, 20), program: view.getUint16(at + 20, true), bank: view.getUint16(at + 22, true) });
  const info = id => { const chunk = sections.get('INFO')?.get(id); return chunk ? text(chunk.offset, chunk.length) : ''; };
  return { format: compressed ? 'sf3' : 'sf2', name: info('INAM'), author: info('IENG'), license: info('ICOP'), presetCount: presets.length, sampleCount: shdr.length / 46 - 1, presets };
}
