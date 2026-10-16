import { createInputSource } from '../../instruments/micmic/native/input-source.js';
import { mountProcessorSamplePlayer } from '../../processor-sample-player.js';
import { RECORDED_INPUT_SOURCES, createActiveEdge, normalizeInputSource, recordedStartBlocker, shouldStopRecorded } from './recorded-input-model.js';

/** File and bundled-sample inputs for an instrument that already owns a mic path.
 * The host supplies the entry node the microphone source feeds, plus arming and
 * availability; this module never touches getUserMedia or output arming. */
export function createRecordedInput({ prepare, getContext, getTarget, isArmed, isAvailable = () => true,
  onActiveChange = () => {}, onChange = () => {}, onError = () => {}, doc = globalThis.document }) {
  const abort = new AbortController();
  const element = doc.createElement('div');
  element.className = 'recorded-input';
  element.hidden = true;
  const fileInput = doc.createElement('input');
  fileInput.type = 'file'; fileInput.accept = 'audio/*'; fileInput.id = 'recordedFileInput';
  const available = () => Boolean(isAvailable());
  const armed = () => Boolean(isArmed()) && available();
  const edge = createActiveEdge(onActiveChange);
  let fileBridge = null, disposed = false, built = false, samples, file, source = 'mic', error = '', armedMark = '';
  const getSource = () => source;
  const fail = failure => { error = failure?.message || String(failure); onError(failure); onChange(); };

  const playing = () => Boolean(samples?.snapshot().playing || file?.snapshot().playing);
  const pending = () => Boolean(samples?.snapshot().pending || file?.snapshot().pending);
  const notify = () => { edge(playing()); onChange(); };
  const $ = id => element.querySelector(`#${id}`);

  const paintFile = () => {
    element.hidden = source === 'mic';
    if (!built || !file) return;
    const state = file.snapshot();
    $('recordedFilePlay').disabled = !armed() || !state.hasFile || state.pending;
    $('recordedFilePlay').setAttribute('aria-pressed', String(state.playing));
    $('recordedFilePlay').textContent = state.playing ? 'Restart file' : 'Play file';
    $('recordedFileStop').disabled = !state.playing && !state.pending;
    $('recordedFileLoop').setAttribute('aria-pressed', String(state.loop));
    $('recordedFileStatus').textContent = state.pending ? 'Loading file…'
      : !state.hasFile ? 'Choose an audio file with the file button.'
        : !armed() ? `${state.fileName} · switch Audio on to play.`
          : state.playing ? `${state.fileName} · ${state.loop ? 'looping' : 'once'}`
            : state.ended ? 'File finished.' : `${state.fileName} · ready to play.`;
    element.querySelector('.recorded-input-file').hidden = source !== 'file';
  };

  const run = task => Promise.resolve(task).catch(fail);
  const listen = (target, type, handler) => target.addEventListener(type, handler, { signal: abort.signal });
  listen(fileInput, 'change', () => {
    const chosen = fileInput.files?.[0];
    fileInput.value = '';
    if (chosen && source === 'file') { build(); void run(file.loadFile(chosen)); }
  });

  /** The player UI is built on first use so a Mic-only session is untouched. */
  function build() {
    if (built || disposed) return;
    built = true;
    element.innerHTML = `<div class="recorded-input-samples"></div>
    <div class="recorded-input-file processor-sample-player" hidden>
      <div class="processor-sample-transport"><button id="recordedFilePlay" type="button" aria-pressed="false">Play file</button>
      <button id="recordedFileStop" type="button">Stop</button>
      <button id="recordedFileLoop" type="button" aria-pressed="true">Loop</button></div>
      <p id="recordedFileStatus" role="status">Choose an audio file with the file button.</p></div>`;
    samples = mountProcessorSamplePlayer({
      container: element.querySelector('.recorded-input-samples'), prepare, getContext, getTarget,
      isArmed: armed, isSelected: () => getSource() === 'samples', onChange: notify, onError: fail,
    });
    file = createInputSource({
      prepare: async () => {
        await prepare();
        const context = getContext();
        if (!fileBridge || fileBridge.context !== context) {
          fileBridge?.disconnect();
          fileBridge = context.createGain();
          fileBridge.connect(getTarget());
        }
      },
      getContext, getTarget: () => fileBridge, canPlay: () => armed() && getSource() === 'file',
      onChange: () => { paintFile(); notify(); }, onError: fail,
    });
    file.selectMode('file');
    listen($('recordedFilePlay'), 'click', () => { void run(file.restart()); });
    listen($('recordedFileStop'), 'click', () => file.stop());
    listen($('recordedFileLoop'), 'click', () => file.setLoop(!file.snapshot().loop));
    paintFile();
  }

  const stop = () => { samples?.stop(); file?.stop(); };
  return {
    element, fileInput,
    mountBefore(reference) { reference?.parentNode?.insertBefore?.(element, reference); },
    snapshot: () => ({ active: playing(), pending: pending() }),
    signal: () => (samples?.snapshot().playing ? samples.getSignal() : file?.snapshot().playing ? fileBridge : null),
    stop,
    get source() { return source; },
    get error() { return error; },
    async start() {
      build(); error = '';
      const reason = recordedStartBlocker({ source, armed: armed(), hasFile: file.snapshot().hasFile });
      if (reason) throw new Error(reason);
      return source === 'samples' ? samples.start() : file.start();
    },
    setSource(value) {
      stop(); source = normalizeInputSource(value); error = '';
      if (source !== 'mic') build();
      samples?.refresh(); paintFile(); notify();
    },
    refresh() { samples?.refresh(); paintFile(); },
    reconcile() {
      if (!built || !samples || !file) return;
      const mark = `${armed()}`;
      if (mark !== armedMark) { armedMark = mark; samples.refresh(); paintFile(); }
      const context = getContext();
      if (shouldStopRecorded({ active: playing(), armed: armed(), available: available(), contextClosed: context?.state === 'closed' })) stop();
    },
    destroy() {
      if (disposed) return;
      disposed = true; abort.abort();
      samples?.destroy(); file?.dispose(); fileBridge?.disconnect(); fileBridge = null;
      edge(false); element.remove(); fileInput.remove();
    },
  };
}

/** Adds the Mic / File / Samples source select to an existing audio-input strip
 * option set without altering how the microphone path starts, stops or reports. */
export function withRecordedInput(options, recorded) {
  const mic = () => recorded.source === 'mic';
  return {
    ...options,
    sources: RECORDED_INPUT_SOURCES, sourceValue: recorded.source, fileInput: recorded.fileInput,
    onSourceChange: value => {
      try { Promise.resolve(options.onStop?.()).catch(() => {}); } catch { /* mic already stopped */ }
      recorded.setSource(value);
    },
    getState: () => {
      recorded.reconcile();
      const base = options.getState?.() ?? {};
      if (mic()) return { ...base, source: 'mic' };
      const { active, pending } = recorded.snapshot();
      return { ...base, active, pending, source: recorded.source, error: recorded.error };
    },
    getSignal: () => {
      const base = options.getSignal?.() ?? {};
      return mic() ? base : { ...base, node: base.node ?? recorded.signal(), stream: null, channels: 2 };
    },
    onStart: () => (mic() ? options.onStart?.() : recorded.start()),
    onStop: () => { recorded.stop(); return options.onStop?.(); },
  };
}
