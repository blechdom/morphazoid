// Browser-only WASI subset for Flite 2.3. No filesystem, network or device access.
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function runFlite(module, args) {
  let instance;
  let exitCode = 0;
  const files = new Map();
  const streams = new Map([[0, { data: new Uint8Array(), pos: 0, size: 0 }],
    [1, { data: new Uint8Array(1024), pos: 0, size: 0 }],
    [2, { data: new Uint8Array(1024), pos: 0, size: 0 }]]);
  let nextFd = 4;
  const argBytes = args.map(arg => encoder.encode(`${arg}\0`));
  const memory = () => new DataView(instance.exports.memory.buffer);
  const bytes = () => new Uint8Array(instance.exports.memory.buffer);
  const u32 = (ptr, val) => memory().setUint32(ptr, val, true);
  const u64 = (ptr, val) => memory().setBigUint64(ptr, BigInt(val), true);
  const pathAt = (ptr, len) => decoder.decode(bytes().subarray(ptr, ptr + len)).replace(/^\.\//, '').replace(/^\//, '');
  const append = (stream, chunk) => {
    const end = stream.pos + chunk.length;
    if (end > 32 * 1024 * 1024) throw new Error('Flite output exceeds 32 MB.');
    if (end > stream.data.length) {
      const expanded = new Uint8Array(Math.max(end, stream.data.length * 2, 1024));
      expanded.set(stream.data);
      stream.data = expanded;
    }
    stream.data.set(chunk, stream.pos);
    stream.pos = end;
    stream.size = Math.max(stream.size, end);
  };
  const imports = {
    args_sizes_get(argc, size) {
      u32(argc, argBytes.length);
      u32(size, argBytes.reduce((sum, arg) => sum + arg.length, 0));
      return 0;
    },
    args_get(argv, argBuffer) {
      argBytes.forEach((arg, index) => {
        u32(argv + index * 4, argBuffer);
        bytes().set(arg, argBuffer);
        argBuffer += arg.length;
      });
      return 0;
    },
    clock_time_get(id, precision, ptr) {
      // A fixed origin makes noise excitation reproducible between previews.
      u64(ptr, 1000000000n);
      return 0;
    },
    fd_close(fd) {
      if (!streams.has(fd)) return 8;
      streams.delete(fd);
      return 0;
    },
    fd_fdstat_get(fd, ptr) {
      if (fd !== 3 && !streams.has(fd)) return 8;
      bytes().fill(0, ptr, ptr + 24);
      memory().setUint8(ptr, fd === 3 ? 3 : fd < 3 ? 2 : 4);
      u64(ptr + 8, 0x1fffffffn);
      u64(ptr + 16, 0x1fffffffn);
      return 0;
    },
    fd_fdstat_set_flags(fd) { return streams.has(fd) ? 0 : 8; },
    fd_prestat_get(fd, ptr) {
      if (fd !== 3) return 8;
      bytes().fill(0, ptr, ptr + 8);
      u32(ptr + 4, 1);
      return 0;
    },
    fd_prestat_dir_name(fd, ptr, length) {
      if (fd !== 3) return 8;
      if (length < 1) return 28;
      bytes()[ptr] = 46;
      return 0;
    },
    fd_read(fd, iovs, length, count) {
      const stream = streams.get(fd);
      if (!stream) return 8;
      let read = 0;
      for (let n = 0; n < length; n++) {
        const ptr = memory().getUint32(iovs + n * 8, true);
        const size = memory().getUint32(iovs + n * 8 + 4, true);
        const chunk = stream.data.subarray(stream.pos, Math.min(stream.size, stream.pos + size));
        bytes().set(chunk, ptr);
        stream.pos += chunk.length;
        read += chunk.length;
      }
      u32(count, read);
      return 0;
    },
    fd_seek(fd, offset, whence, ptr) {
      const stream = streams.get(fd);
      if (!stream) return 8;
      const next = Number(offset) + (whence === 0 ? 0 : whence === 1 ? stream.pos : stream.size);
      if (!Number.isSafeInteger(next) || next < 0 || next > 32 * 1024 * 1024) return 28;
      stream.pos = next;
      u64(ptr, next);
      return 0;
    },
    fd_write(fd, iovs, length, count) {
      const stream = streams.get(fd);
      if (!stream) return 8;
      let written = 0;
      for (let n = 0; n < length; n++) {
        const ptr = memory().getUint32(iovs + n * 8, true);
        const size = memory().getUint32(iovs + n * 8 + 4, true);
        append(stream, bytes().subarray(ptr, ptr + size));
        written += size;
      }
      u32(count, written);
      return 0;
    },
    path_open(fd, dirflags, ptr, length, flags, rights, inheritingRights, fdflags, result) {
      if (fd !== 3) return 8;
      const path = pathAt(ptr, length);
      // The command can only create/read its one output file, not host paths.
      if (path !== 'output.wav') return 44;
      let file = files.get(path);
      if (!file && !(flags & 1)) return 44;
      if (!file || (flags & 8)) {
        file = { data: new Uint8Array(1024), pos: 0, size: 0 };
        files.set(path, file);
      }
      file.pos = fdflags & 1 ? file.size : 0;
      const assigned = nextFd++;
      streams.set(assigned, file);
      u32(result, assigned);
      return 0;
    },
    proc_exit(code) {
      exitCode = code;
      throw { fliteExit: true };
    },
  };
  instance = new WebAssembly.Instance(module, { wasi_snapshot_preview1: imports });
  try { instance.exports._start(); }
  catch (error) { if (!error?.fliteExit) throw error; }
  const textStream = fd => {
    const stream = streams.get(fd);
    return stream ? decoder.decode(stream.data.subarray(0, stream.size)) : '';
  };
  const file = files.get('output.wav');
  return { exitCode, stdout: textStream(1), stderr: textStream(2), wav: file?.data.slice(0, file.size) };
}

export function decodeFliteWav(wav) {
  if (!(wav instanceof Uint8Array) || wav.length < 44) throw new Error('Flite returned no WAV.');
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const label = offset => decoder.decode(wav.subarray(offset, offset + 4));
  if (label(0) !== 'RIFF' || label(8) !== 'WAVE') throw new Error('Invalid Flite WAV header.');
  let sampleRate, dataStart, dataSize;
  for (let pos = 12; pos + 8 <= wav.length;) {
    const size = view.getUint32(pos + 4, true);
    if (pos + 8 + size > wav.length) throw new Error('Truncated Flite WAV.');
    if (label(pos) === 'fmt ') {
      if (size < 16 || view.getUint16(pos + 8, true) !== 1 || view.getUint16(pos + 10, true) !== 1 || view.getUint16(pos + 22, true) !== 16) {
        throw new Error('Expected mono PCM16 Flite audio.');
      }
      sampleRate = view.getUint32(pos + 12, true);
    }
    if (label(pos) === 'data') { dataStart = pos + 8; dataSize = size; }
    pos += 8 + size + (size & 1);
  }
  if (!sampleRate || dataStart == null || dataSize % 2) throw new Error('Missing Flite PCM.');
  const samples = new Float32Array(dataSize / 2);
  for (let n = 0; n < samples.length; n++) samples[n] = view.getInt16(dataStart + n * 2, true) / 32768;
  return { samples, sampleRate };
}

export function synthesizeFlite(module, { text = 'Hello from Voicesaurus.', phones = null, voice = 'kal16', rate = 1, pitch = null, pitchRange = null, phonemes = false } = {}) {
  const allowed = new Set(['kal', 'kal16', 'awb', 'rms', 'slt', 'awb_time']);
  if (!allowed.has(voice)) throw new Error('Unknown Flite voice.');
  if (phones !== null) { text = Array.isArray(phones) ? phones.join(' ') : phones; phonemes = true; }
  if (typeof text !== 'string' || !text.trim() || text.length > 1000) throw new Error('Enter between 1 and 1000 characters.');
  if (phonemes && !/^[a-z0-9\s]+$/i.test(text)) throw new Error('Use Flite phoneme symbols separated by spaces.');
  if (!Number.isFinite(rate) || pitch !== null && !Number.isFinite(pitch) || pitchRange !== null && !Number.isFinite(pitchRange)) throw new TypeError('Flite controls must be finite numbers.');
  const durationStretch = 1 / rate;
  if (!Number.isFinite(durationStretch)) throw new TypeError('The rate cannot be represented as a finite native duration stretch.');
  const args = ['flite', '-voice', voice,
    '--setf', `duration_stretch=${durationStretch}`,
    ...(pitch === null ? [] : ['--setf', `int_f0_target_mean=${pitch}`]),
    ...(pitchRange === null ? [] : ['--setf', `int_f0_target_stddev=${pitchRange}`]),
    '-psdur', phonemes ? '-p' : '-t', text, '-o', 'output.wav'];
  const result = runFlite(module, args);
  if (result.exitCode) throw new Error(result.stderr || `Flite exited ${result.exitCode}.`);
  const decoded = decodeFliteWav(result.wav);
  let start = 0;
  const events = [...result.stdout.matchAll(/([a-z0-9]+):([0-9.]+)/g)].map(([, phone, endText]) => {
    const end = Number(endText);
    const event = { type: 'phoneme', phone, start, end };
    start = end;
    return event;
  });
  return { ...decoded, events, phonemeText: result.stdout, wav: result.wav };
}
