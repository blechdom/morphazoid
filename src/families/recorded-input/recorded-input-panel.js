import { createInputSource, SAMPLE_INPUT_OPTIONS } from '../../instruments/micmic/native/input-source.js';

const FEATURED_SAMPLES = ['music-vocal-scat', 'music-vocal-phrase', 'music-sax-multiphonic', 'music-sax-fingerings', 'music-tabla'];
let panelCount = 0;

/** Map any instrument's source value onto the three shared input modes. */
export function recordedModeOf(value) {
  const text = String(value ?? '').toLowerCase();
  if (/^(mic|input|microphone|line|live)/.test(text)) return 'mic';
  if (/^sample/.test(text)) return 'samples';
  if (/^(file|upload)/.test(text)) return 'file';
  return null;
}

/** Strip source value (matched by its file/sample icon rules) for a recorded mode. */
export function stripSourceOf(mode) {
  return mode === 'samples' ? 'samples' : mode === 'file' ? 'file' : 'mic';
}

/** Featured recordings first, then the rest in catalogue order. */
export function orderedSampleChoices(options = SAMPLE_INPUT_OPTIONS) {
  const featured = FEATURED_SAMPLES.map(id => options.find(option => option.id === id)).filter(Boolean);
  return [...featured, ...options.filter(option => !FEATURED_SAMPLES.includes(option.id))];
}

export function recordedStatusText({ mode, armed, snapshot }) {
  if (mode === 'mic') return '';
  const noun = mode === 'file' ? 'file' : 'sample';
  if (snapshot.pending) return `Loading ${noun}…`;
  if (mode === 'file' && !snapshot.hasFile) return 'Choose an audio file to play.';
  if (!armed) return `Switch Audio on, then play the ${noun}.`;
  if (snapshot.playing) return `${snapshot.label} · ${snapshot.loop ? 'looping' : 'once'}`;
  return snapshot.ended ? `${noun[0].toUpperCase()}${noun.slice(1)} finished.` : 'Ready to play.';
}

/** Samples and local files that enter the same node a microphone would feed.
 * The instrument owns arming and its effect; the shared bounded loader owns
 * decoding, cancellation and the single live buffer source. */
export function mountRecordedInputPanel({ container, fileInput = null, prepare, getContext, getTarget,
  isArmed, onChange = () => {}, onError = () => {}, label = 'Recorded input' }) {
  const doc = container.ownerDocument;
  const abort = new AbortController();
  const id = `recorded-input-${++panelCount}`;
  container.classList.add('recorded-input-panel');
  container.hidden = true;
  container.innerHTML = `<label class="recorded-input-sample control" for="${id}-sample"><span><b>Sample</b></span>
    <span class="recorded-input-choice"><select id="${id}-sample" aria-label="Sample loop"></select>
    <button type="button" data-role="next" aria-label="Next sample">›</button></span></label>
    <div class="recorded-input-file"><button type="button" data-role="choose">Choose audio file</button>
    <span data-role="filename" aria-live="polite"></span></div>
    <div class="recorded-input-transport"><button type="button" data-role="play" aria-pressed="false">Play</button>
    <button type="button" data-role="stop">Stop</button>
    <button type="button" data-role="loop" aria-pressed="true">Loop</button></div>
    <p data-role="status" role="status"></p>
    <a data-role="credit" target="_blank" rel="noopener noreferrer" hidden></a>`;
  container.setAttribute('role', 'group');
  container.setAttribute('aria-label', label);
  const $ = role => container.querySelector(`[data-role="${role}"]`);
  const select = container.querySelector('select');
  const groups = new Map();
  const choices = orderedSampleChoices();
  for (const option of choices) {
    const group = FEATURED_SAMPLES.includes(option.id) ? 'Voices, sax & tabla' : option.group;
    if (!groups.has(group)) {
      const element = doc.createElement('optgroup'); element.label = group;
      select.append(element); groups.set(group, element);
    }
    const element = doc.createElement('option');
    element.value = option.id; element.textContent = option.label.replace(/^Sample · /, '');
    groups.get(group).append(element);
  }

  let mode = 'mic', bridge = null, bridgeTarget = null, player;
  const armed = () => Boolean(isArmed());
  const refresh = () => {
    if (!player) return;
    const state = player.snapshot();
    container.hidden = mode === 'mic';
    container.querySelector('.recorded-input-sample').hidden = mode !== 'samples';
    container.querySelector('.recorded-input-file').hidden = mode !== 'file';
    select.value = state.sampleId;
    $('filename').textContent = state.fileName;
    $('play').disabled = !armed() || state.pending || (mode === 'file' && !state.hasFile);
    $('play').setAttribute('aria-pressed', String(state.playing));
    $('play').textContent = state.playing ? 'Restart' : 'Play';
    $('play').setAttribute('aria-label', `${state.playing ? 'Restart' : 'Play'} ${mode === 'file' ? 'file' : 'sample'}`);
    $('stop').disabled = !state.playing && !state.pending;
    $('stop').setAttribute('aria-label', state.pending ? 'Cancel loading' : 'Stop input');
    $('loop').setAttribute('aria-pressed', String(state.loop));
    $('status').textContent = recordedStatusText({ mode, armed: armed(), snapshot: state });
    $('credit').hidden = !state.credit;
    $('credit').textContent = state.credit;
    $('credit').href = state.creditUrl || '#';
    onChange(state);
  };
  const connectBridge = () => {
    const context = getContext(), target = getTarget();
    if (bridge && bridge.context === context && bridgeTarget === target) return;
    try { bridge?.disconnect(); } catch { /* Already detached. */ }
    bridge = context.createGain();
    bridge.channelCount = 2; bridge.channelCountMode = 'explicit'; bridge.channelInterpretation = 'speakers';
    bridge.connect(target); bridgeTarget = target;
  };
  player = createInputSource({
    prepare: async () => { await prepare(); connectBridge(); },
    getContext, getTarget: () => bridge, canPlay: () => armed() && mode !== 'mic',
    onChange: refresh, onError,
  });
  player.selectMode('mic');
  player.selectSample(choices[0].id);
  const run = task => Promise.resolve(task).catch(error => { if (!abort.signal.aborted) onError(error); });
  const listen = (target, type, handler) => target.addEventListener(type, handler, { signal: abort.signal });

  function setMode(next) {
    const value = recordedModeOf(next);
    if (!value) return;
    mode = value;
    player.selectMode(value);
    refresh();
  }
  listen(select, 'change', () => {
    const state = player.snapshot();
    player.selectSample(select.value);
    if (state.playing || state.pending) void run(player.start());
  });
  listen($('next'), 'click', () => {
    select.selectedIndex = (select.selectedIndex + 1) % select.options.length;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  listen($('play'), 'click', () => { void run(player.restart()); });
  listen($('stop'), 'click', () => { player.stop(); });
  listen($('loop'), 'click', () => player.setLoop(!player.snapshot().loop));
  listen($('choose'), 'click', () => fileInput?.click());
  if (fileInput) {
    listen(fileInput, 'change', () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      fileInput.value = '';
      mode = 'file';
      void run(player.loadFile(file));
    });
  } else $('choose').hidden = true;
  refresh();
  return {
    player, refresh, setMode, getMode: () => mode, getSignal: () => bridge,
    snapshot: () => player.snapshot(),
    isPlaying: () => player.snapshot().playing,
    isPending: () => player.snapshot().pending,
    start: () => run(player.start()),
    stop: () => player.stop(),
    destroy() {
      abort.abort(); player.dispose();
      try { bridge?.disconnect(); } catch { /* Already detached. */ }
      bridge = null;
    },
  };
}
