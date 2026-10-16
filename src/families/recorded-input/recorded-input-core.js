import { createInputSource, SAMPLE_INPUT_OPTIONS, MAX_INPUT_FILE_BYTES } from '../../instruments/micmic/native/input-source.js';
import { mountProcessorSamplePlayer } from '../../processor-sample-player.js';

export const RECORDED_INPUT_SOURCES = Object.freeze([
  Object.freeze({ value: 'mic', label: 'Mic' }),
  Object.freeze({ value: 'file', label: 'File' }),
  Object.freeze({ value: 'samples', label: 'Samples' }),
]);

const FEATURED_SAMPLES = ['music-vocal-scat', 'music-vocal-phrase', 'music-sax-multiphonic', 'music-sax-fingerings', 'music-tabla'];

export function normalizeInputSource(value) {
  return RECORDED_INPUT_SOURCES.some(source => source.value === value) ? value : 'mic';
}

/** Map any instrument's source value onto the three shared input modes. */
export function recordedModeOf(value) {
  const text = String(value ?? '').toLowerCase();
  if (/^(mic|input|microphone|line|live)/.test(text)) return 'mic';
  if (/^sample/.test(text)) return 'samples';
  if (/^(file|upload)/.test(text)) return 'file';
  return null;
}

export const stripSourceOf = mode => normalizeInputSource(mode);

/** Featured recordings first, then the rest in catalogue order. */
export function orderedSampleChoices(options = SAMPLE_INPUT_OPTIONS) {
  const featured = FEATURED_SAMPLES.map(id => options.find(option => option.id === id)).filter(Boolean);
  return [...featured, ...options.filter(option => !FEATURED_SAMPLES.includes(option.id))]
    .map(option => ({ ...option, group: FEATURED_SAMPLES.includes(option.id) ? 'Voices, sax & tabla' : option.group }));
}

/** Returns an error message, or "" when the file may be offered to the bounded decoder. */
export function checkInputFile(file) {
  if (!file || typeof file.arrayBuffer !== 'function') return 'Choose an audio file.';
  if (!(file.size > 0)) return 'Choose a nonempty audio file.';
  if (file.size > MAX_INPUT_FILE_BYTES) return 'Choose an audio file smaller than 64 MiB.';
  const type = String(file.type ?? '');
  if (type && !/^audio\//i.test(type) && !/^(application|video)\/ogg$/i.test(type)) return 'Choose an audio file.';
  return '';
}

/** Status line for the File source; Samples keeps the shared sample player's own wording. */
export function recordedFileStatus({ armed, state, pendingName = '' }) {
  if (state.pending) return 'Loading file…';
  if (state.playing) return `${state.fileName || 'File'} · ${state.loop ? 'looping' : 'once'}`;
  const name = state.hasFile ? state.fileName : pendingName;
  if (!name) return 'Choose an audio file with the file button.';
  if (!armed) return `${name} · switch Audio on, then play.`;
  return state.ended ? 'File finished.' : 'Ready to play.';
}

/** Empty string means playback may start; otherwise the user-facing reason. */
export function recordedStartBlocker({ source, armed, hasFile }) {
  if (source === 'mic') return 'Mic input starts from the microphone button.';
  if (!armed) return source === 'file' ? 'Switch Audio on before playing a file.' : 'Switch Audio on before playing a sample.';
  if (source === 'file' && !hasFile) return 'Choose an audio file first.';
  return '';
}

/** Playback must end when its host stops being armed, available, engaged or open. */
export function shouldStopRecorded({ active, pending = false, armed, available = true, engaged = true, contextClosed = false,
  pendingNeedsArmed = false }) {
  if (active) return !armed || !available || !engaged || Boolean(contextClosed);
  return Boolean(pending) && pendingNeedsArmed && !armed;
}

/** Reports only true/false transitions of the recorded-input active flag. */
export function createActiveEdge(onEdge) {
  let previous = false;
  return next => {
    const value = Boolean(next);
    if (value === previous) return false;
    previous = value;
    onEdge(value);
    return true;
  };
}

const STYLES = [['processor-sample', '../../processor-sample-player.css'], ['recorded-input', './recorded-input-core.css']];

/** Pages that already link a stylesheet keep it; otherwise it is added once. */
export function ensureRecordedInputStyles(doc) {
  for (const [name, file] of STYLES) {
    const href = new URL(file, import.meta.url).href;
    const linked = [...(doc.querySelectorAll?.('link[rel="stylesheet"]') ?? [])]
      .some(link => link.hasAttribute(`data-${name}-styles`) || link.href === href);
    if (linked) continue;
    const link = doc.createElement('link');
    link.rel = 'stylesheet'; link.href = href;
    link.setAttribute(`data-${name}-styles`, '');
    doc.head?.append(link);
  }
}

/** One Mic / File / Samples source for an instrument that already owns a microphone path.
 * The host supplies where recorded audio enters (the nodes the mic feeds), when Audio is
 * armed and what to do on state changes; this module never calls getUserMedia and never
 * arms Audio. It owns the source state machine, the bridge gain node, the sample / file
 * panel, file limits, Play / Stop / Loop, auto-stop and cleanup. */
export function createRecordedInputCore({
  host = null, element = null, label = 'Recorded input', className = '',
  fileInput = null, fileInputId = '', chooseButton = false, stopLabel = null,
  getContext, prepare = async () => {}, targets, getTarget, isArmed, isAvailable = () => true, isEngaged = () => true,
  loadDemo, gain = () => 1, stereoBridge = false, initialSample = FEATURED_SAMPLES[0], fileLoad = 'now', watchMs = 200,
  onChange = () => {}, onActiveChange = () => {}, onSourceChange = () => {}, onError = () => {}, onDestroy = () => {},
  doc = host?.container?.ownerDocument ?? element?.ownerDocument ?? globalThis.document,
  withPanel = Boolean(doc),
} = {}) {
  const runtime = doc?.defaultView ?? globalThis;
  const abort = new AbortController();
  const listen = (target, type, handler, options = {}) => target?.addEventListener?.(type, handler, { ...options, signal: abort.signal });
  const targetList = targets ?? (() => [getTarget?.()]);
  const available = () => Boolean(isAvailable());
  const armed = () => Boolean(isArmed()) && available();
  const edge = createActiveEdge((active) => onActiveChange(active, player.snapshot()));
  let source = 'mic', error = '', pendingFile = null, bridge = null, disposed = false, armedMark = null, autoStarted = false;
  let player, ui = null, panel = null, chooseRow = null, ownsPanel = false, ownsFileInput = false, watcher = null, ready = false;
  const connected = new Set();

  const fail = failure => {
    if (disposed || abort.signal.aborted) return;
    error = failure?.message || String(failure);
    onError(failure); onChange(snapshot());
  };
  const run = task => Promise.resolve(task).catch(fail);

  function connectBridge() {
    const context = getContext();
    if (!context || context.state === 'closed') return;
    const wanted = targetList().filter(Boolean);
    if (bridge && bridge.context !== context) { try { bridge.disconnect(); } catch { /* Already detached. */ } bridge = null; }
    if (bridge && (wanted.length !== connected.size || wanted.some(node => !connected.has(node)))) {
      try { bridge.disconnect(); } catch { /* Already detached. */ }
      connected.clear();
    }
    if (!bridge) {
      bridge = context.createGain();
      bridge.gain.value = Number(gain());
      if (stereoBridge) { bridge.channelCount = 2; bridge.channelCountMode = 'explicit'; bridge.channelInterpretation = 'speakers'; }
      connected.clear();
    }
    for (const node of wanted) if (!connected.has(node)) { bridge.connect(node); connected.add(node); }
  }

  const snapshot = () => ({ ...player.snapshot(), source, armed: armed(), pendingFileName: pendingFile?.name ?? '', error });
  const afterChange = state => {
    if (disposed || !ready) return;
    if (state.playing) error = '';
    decorate(state);
    edge(state.playing);
    onChange(snapshot());
  };
  player = createInputSource({
    prepare: async () => { await prepare(); connectBridge(); },
    getContext, getTarget: () => bridge, canPlay: () => !disposed && armed() && source !== 'mic',
    onChange: state => (ui ? ui.refresh() : afterChange(state)), onError: fail, ...(loadDemo ? { loadDemo } : {}),
  });
  player.selectSample(initialSample);

  const $ = id => panel?.querySelector(`#${id}`);
  function decorate(state) {
    if (!ui) return;
    panel.dataset.recordedSource = source;
    const stop = $('sampleStop');
    if (stopLabel) stop.setAttribute('aria-label', stopLabel(state));
    if (chooseRow) {
      chooseRow.hidden = source !== 'file';
      chooseRow.querySelector('[data-role="filename"]').textContent = state.hasFile ? state.fileName : pendingFile?.name ?? '';
    }
    if (source !== 'file') return;
    const play = $('samplePlay'), live = armed();
    play.textContent = state.playing ? 'Restart file' : 'Play file';
    play.disabled = !live || state.pending || !(state.hasFile || pendingFile);
    $('sampleStatus').textContent = recordedFileStatus({ armed: live, state, pendingName: pendingFile?.name ?? '' });
  }

  function setSource(value) {
    const next = normalizeInputSource(value);
    if (next === source || disposed) return source;
    const previous = source;
    player.stop(); autoStarted = false;
    source = next; error = '';
    if (next !== 'mic') ensureUi();
    player.selectMode(next);
    onSourceChange(next, previous);
    onChange(snapshot());
    return source;
  }

  async function start() {
    error = '';
    const reason = recordedStartBlocker({ source, armed: armed(), hasFile: player.snapshot().hasFile || Boolean(pendingFile) });
    if (reason) throw new Error(reason);
    if (pendingFile) { const file = pendingFile; pendingFile = null; return player.loadFile(file); }
    return player.start();
  }
  const restart = () => { player.stop(); return start(); };

  function chooseFile(file) {
    const problem = checkInputFile(file);
    if (problem) { fail(new Error(problem)); return Promise.resolve(); }
    if (source !== 'file') setSource('file');
    error = '';
    if (fileLoad === 'on-play' || (fileLoad === 'when-armed' && !armed())) {
      player.stop(); pendingFile = file; ui?.refresh(); return Promise.resolve();
    }
    pendingFile = null;
    return run(player.loadFile(file));
  }

  function reconcile() {
    if (disposed) return;
    const isArmedNow = armed();
    if (isArmedNow !== armedMark) { armedMark = isArmedNow; ui?.refresh(); }
    const state = player.snapshot();
    if (shouldStopRecorded({ active: state.playing, pending: state.pending, armed: isArmedNow, available: available(),
      engaged: Boolean(isEngaged()), contextClosed: getContext()?.state === 'closed', pendingNeedsArmed: fileLoad !== 'now' })) stop();
  }

  function stop() { autoStarted = false; return player.stop(); }

  if (!fileInput && doc) {
    fileInput = doc.createElement('input');
    fileInput.type = 'file'; fileInput.accept = 'audio/*'; fileInput.hidden = true;
    ownsFileInput = true;
  }
  if (fileInputId && ownsFileInput) fileInput.id = fileInputId;

  if (withPanel && doc) {
    panel = element;
    if (!panel) {
      panel = doc.createElement('div'); ownsPanel = true;
      panel.className = ['recorded-input-panel', ...className.split(' ')].filter(Boolean).join(' ');
    }
    panel.hidden = true;
    ensureRecordedInputStyles(doc);
    if (host?.container) host.container.insertBefore(panel, host.before ?? null);
  }

  /** The panel is built on first use so a Mic-only session stays untouched. */
  function ensureUi() {
    if (ui || !panel || disposed) return;
    panel.classList.add('recorded-input-panel', ...className.split(' ').filter(Boolean));
    panel.setAttribute('role', 'group');
    panel.setAttribute('aria-label', label);
    ui = mountProcessorSamplePlayer({
      container: panel, player, isArmed: armed, isSelected: () => source !== 'mic', onChange: afterChange, onError: fail,
    });
    if (chooseButton) {
      chooseRow = doc.createElement('div');
      chooseRow.className = 'recorded-input-choose'; chooseRow.hidden = true;
      chooseRow.innerHTML = '<button type="button" data-role="choose">Choose audio file</button><span data-role="filename" aria-live="polite"></span>';
      panel.prepend(chooseRow);
      listen(chooseRow.querySelector('button'), 'click', () => fileInput?.click());
    }
    listen(panel, 'click', event => {
      if (!event.target?.closest?.('#samplePlay')) return;
      event.stopImmediatePropagation();
      void run(restart());
    }, { capture: true });
    ui.refresh();
  }
  if (fileInput) {
    listen(fileInput, 'change', () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (file) void chooseFile(file);
    });
  }
  ready = true;
  if (watchMs > 0 && runtime.setInterval) {
    watcher = runtime.setInterval(reconcile, watchMs);
    watcher?.unref?.();
  }

  function destroy() {
    if (disposed) return;
    disposed = true;
    if (watcher) runtime.clearInterval(watcher);
    abort.abort();
    edge(false);
    ui?.destroy(); player.dispose();
    try { bridge?.disconnect(); } catch { /* Already detached. */ }
    bridge = null; connected.clear(); pendingFile = null;
    if (ownsPanel) panel?.remove();
    if (ownsFileInput) fileInput?.remove();
    onDestroy();
  }
  listen(runtime, 'pagehide', event => { if (event.persisted) stop(); else destroy(); });

  return {
    element: panel, fileInput, player,
    get source() { return source; },
    get error() { return error; },
    get bridge() { return bridge; },
    snapshot, setSource, start, restart, stop, chooseFile, reconcile, destroy, run,
    selectSample: id => player.selectSample(id),
    setLoop: enabled => player.setLoop(enabled),
    refresh: () => ui?.refresh(),
    signal: () => (player.snapshot().playing ? bridge : null),
    isPlaying: () => player.snapshot().playing,
    isPending: () => player.snapshot().pending,
    setGain(value) { if (bridge) bridge.gain.setTargetAtTime(value, bridge.context.currentTime, 0.015); },
    /** Record paths: play the recorded source for the take, remembering whether this call started it. */
    async acquire() {
      const was = player.snapshot().playing;
      if (!was) await start();
      if (!player.snapshot().playing) return false;
      autoStarted = !was;
      return true;
    },
    release() { if (autoStarted) { autoStarted = false; player.stop(); } },
  };
}
