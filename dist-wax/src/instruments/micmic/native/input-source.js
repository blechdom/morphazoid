import { PROCESSING_INPUT_OPTIONS, loadProcessingDemo } from '../../synthesis/demo-sources.js';

/** Recorded inputs share Synthesaurus's bundled assets and their credits. */
export const SAMPLE_INPUT_OPTIONS = Object.freeze(PROCESSING_INPUT_OPTIONS.filter(option => option.kind === 'demo'));
export const DEFAULT_SAMPLE_ID = 'sample-drums';
export const MAX_INPUT_FILE_BYTES = 64 * 1024 * 1024;
export const MAX_INPUT_FILE_SECONDS = 120;

/** One file and one selected demo buffer; playback always enters the Rust input. */
export function createInputSource({ prepare, getContext, getTarget, canPlay,
  onChange = () => {}, onError = () => {}, loadDemo = loadProcessingDemo } = {}) {
  let mode = 'mic', sampleId = DEFAULT_SAMPLE_ID, loop = true, ended = false, pending = false, disposed = false;
  let file, fileBuffer, fileName = '', sampleBuffer, loadedSampleId, sampleCredit = '', sampleCreditUrl = '';
  let source, version = 0, controller, loading;
  const sampleOption = () => SAMPLE_INPUT_OPTIONS.find(option => option.id === sampleId);
  const snapshot = () => ({ mode, sampleId, label: mode === 'samples' ? sampleOption().label
    : mode === 'file' ? fileName || 'Choose an audio file' : 'Mic / audio-in', pending, playing: Boolean(source),
    hasFile: Boolean(file || fileBuffer), fileName, loop, ended,
    credit: mode === 'samples' && loadedSampleId === sampleId ? sampleCredit : '',
    creditUrl: mode === 'samples' && loadedSampleId === sampleId ? sampleCreditUrl : '' });
  const changed = () => onChange(snapshot());
  const assertOpen = () => { if (disposed) throw new Error('This input session has closed.'); };

  function stop() {
    version++; controller?.abort(); controller = null; loading = null; pending = false;
    if (source) {
      const previous = source; source = null; previous.onended = null;
      try { previous.stop(); } catch { /* Already ended. */ }
      previous.disconnect(); previous.buffer = null;
    }
    changed(); return snapshot();
  }
  function selectMode(next) {
    assertOpen();
    if (!['mic', 'file', 'samples'].includes(next)) throw new RangeError('Choose Mic, File or Samples input.');
    if (next !== mode) { stop(); mode = next; ended = false; changed(); }
    return snapshot();
  }
  function selectSample(id) {
    assertOpen();
    if (!SAMPLE_INPUT_OPTIONS.some(option => option.id === id)) throw new RangeError('Choose a bundled recorded sample.');
    if (id !== sampleId) {
      if (mode === 'samples') stop();
      sampleId = id; sampleBuffer = null; loadedSampleId = null; sampleCredit = sampleCreditUrl = ''; ended = false; changed();
    }
    return snapshot();
  }
  function setLoop(enabled) {
    assertOpen(); loop = Boolean(enabled); if (source) source.loop = loop; changed(); return snapshot();
  }
  function connect() {
    if (disposed || !canPlay() || source || mode === 'mic') return snapshot();
    const buffer = mode === 'file' ? fileBuffer : loadedSampleId === sampleId ? sampleBuffer : null;
    const context = getContext(), target = getTarget();
    if (!buffer || !target || !context || context.state === 'closed') return snapshot();
    const next = context.createBufferSource(); next.buffer = buffer; next.loop = loop;
    next.onended = () => {
      if (source !== next) return;
      source = null; next.onended = null; next.disconnect(); next.buffer = null; ended = true; changed();
    };
    next.connect(target);
    try { next.start(context.currentTime); }
    catch (error) { next.onended = null; next.disconnect(); next.buffer = null; throw error; }
    source = next; ended = false; changed(); return snapshot();
  }
  function loadSelected() {
    if (loading) return loading;
    const token = version, selectedMode = mode, selectedId = sampleId;
    const selectedFile = file;
    const abort = controller = new AbortController(); pending = true; changed();
    const current = () => !disposed && token === version && selectedMode === mode
      && (selectedMode !== 'samples' || selectedId === sampleId);
    const operation = (async () => {
      await prepare(); if (!current()) return snapshot();
      const context = getContext();
      if (selectedMode === 'samples') {
        const result = await loadDemo(context, selectedId, { signal: abort.signal });
        if (!current() || context !== getContext()) return snapshot();
        sampleBuffer = result.buffer; loadedSampleId = selectedId; sampleCredit = result.credit; sampleCreditUrl = result.creditUrl;
      } else {
        const bytes = await selectedFile.arrayBuffer(); if (!current()) return snapshot();
        if (bytes.byteLength > MAX_INPUT_FILE_BYTES) throw new RangeError('Choose an audio file smaller than 64 MiB.');
        const decoded = await context.decodeAudioData(bytes); if (!current() || context !== getContext()) return snapshot();
        if (!decoded.length || !decoded.numberOfChannels || !(decoded.sampleRate > 0)) throw new Error('The audio file contains no playable audio.');
        const frames = Math.min(decoded.length, Math.round(decoded.sampleRate * MAX_INPUT_FILE_SECONDS));
        const buffer = context.createBuffer(Math.min(2, decoded.numberOfChannels), frames, decoded.sampleRate);
        for (let channel = 0; channel < buffer.numberOfChannels; channel++) buffer.getChannelData(channel).set(decoded.getChannelData(channel).subarray(0, frames));
        fileBuffer = buffer; file = null;
        fileName = `${selectedFile.name || 'Audio file'} · ${(frames / decoded.sampleRate).toFixed(1)} s${frames < decoded.length ? ' excerpt' : ''}`;
      }
      return snapshot();
    })().catch(error => {
      if (!current()) return snapshot();
      if (selectedMode === 'file') file = null;
      onError(error); throw error;
    }).finally(() => {
      if (current()) { loading = null; controller = null; pending = false; changed(); }
    });
    loading = operation; operation.catch(() => {}); return operation;
  }
  async function start() {
    assertOpen();
    if (mode === 'mic' || !canPlay() || source) return snapshot();
    // File selection is a waiting input, including when Audio is already on.
    if (mode === 'file' && !file && !fileBuffer) return snapshot();
    const token = version;
    if (mode === 'file' ? !fileBuffer : loadedSampleId !== sampleId) await loadSelected();
    else await prepare();
    if (token !== version || disposed || !canPlay()) return snapshot();
    return connect();
  }
  async function loadFile(next) {
    assertOpen();
    if (!next || typeof next.arrayBuffer !== 'function') throw new TypeError('Choose an audio file.');
    if (!(next.size > 0) || next.size > MAX_INPUT_FILE_BYTES) throw new RangeError('Choose a nonempty audio file smaller than 64 MiB.');
    stop(); mode = 'file'; file = next; fileBuffer = null; fileName = next.name || 'Audio file'; ended = false; changed();
    const token = version; await loadSelected();
    if (token === version && !disposed && canPlay()) connect();
    return snapshot();
  }
  function dispose() { stop(); disposed = true; file = fileBuffer = sampleBuffer = null; }
  return { snapshot, stop, selectMode, selectSample, setLoop, start, loadFile,
    restart: () => { stop(); ended = false; return start(); }, dispose };
}
