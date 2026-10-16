import { createInputSource, SAMPLE_INPUT_OPTIONS } from './input-source.js';

export const RECORDED_INPUT_SOURCES = Object.freeze([
  { value: 'mic', label: 'Mic' },
  { value: 'file', label: 'File' },
  { value: 'samples', label: 'Samples' },
]);

const FEATURED = ['music-vocal-scat', 'music-vocal-phrase', 'music-sax-multiphonic', 'music-sax-fingerings', 'music-tabla'];

/** Bundled sample order shared with the processor player: featured recordings first. */
export function orderedSampleChoices(options = SAMPLE_INPUT_OPTIONS) {
  const featured = FEATURED.map(id => options.find(option => option.id === id)).filter(Boolean);
  return [...featured, ...options.filter(option => !FEATURED.includes(option.id))]
    .map(option => ({ ...option, group: FEATURED.includes(option.id) ? 'Voices, sax & tabla' : option.group }));
}

export function recordedInputStatus(state, { armed = false, mode = state.mode } = {}) {
  if (mode === 'mic') return '';
  if (state.pending) return mode === 'file' ? 'Decoding file…' : 'Loading sample…';
  if (mode === 'file' && !state.hasFile) return 'Choose an audio file with the upload button.';
  if (!armed) return mode === 'file' ? 'Switch Audio on, then play the file.' : 'Switch Audio on, then play a sample.';
  if (state.playing) return `${state.label} · ${state.loop ? 'looping' : 'once'}`;
  return state.ended ? 'Finished.' : 'Ready to play.';
}

let counter = 0;

/** Looping File and Samples source for instruments with a live-input node.
 * The instrument owns arming and the effect graph; createInputSource owns bounded
 * decoding, cancellation and one buffer source. Output goes through a trim gain
 * that doubles as the meter tap, then into the node the microphone also feeds. */
export function mountRecordedInput({ container, prepare, getContext, getTarget, canPlay = () => true,
  isArmed, getMode, fileInput = null, getGain = () => 1, onChange = () => {}, onError = () => {} }) {
  const doc = container.ownerDocument;
  const abort = new AbortController();
  const uid = `recorded-input-${++counter}`;
  container.classList.add('recorded-input');
  container.innerHTML = `<label class="recorded-input__choice" for="${uid}-select">Sample
    <span><select id="${uid}-select" aria-label="Sample loop"></select>
    <button type="button" data-act="next" aria-label="Next sample">›</button></span></label>
    <div class="recorded-input__transport"><button type="button" data-act="play" aria-pressed="false">Play</button>
    <button type="button" data-act="stop">Stop</button>
    <button type="button" data-act="loop" aria-pressed="true">Loop</button></div>
    <p data-role="status" role="status"></p><a data-role="credit" target="_blank" rel="noopener" hidden></a>`;
  const $ = selector => container.querySelector(selector);
  const select = $('select');
  const choices = orderedSampleChoices();
  const groups = new Map();
  for (const choice of choices) {
    if (!groups.has(choice.group)) {
      const group = doc.createElement('optgroup'); group.label = choice.group;
      select.append(group); groups.set(choice.group, group);
    }
    const element = doc.createElement('option');
    element.value = choice.id; element.textContent = choice.label;
    groups.get(choice.group).append(element);
  }
  let bridge = null, bridgeTarget = null, player, disposed = false;
  const mode = () => (disposed ? 'mic' : getMode());
  const refresh = () => {
    if (!player || disposed) return;
    const state = player.snapshot(), current = mode();
    container.hidden = current === 'mic';
    $('.recorded-input__choice').hidden = current !== 'samples';
    select.value = state.sampleId;
    const play = $('[data-act="play"]');
    play.disabled = !isArmed() || state.pending || (current === 'file' && !state.hasFile);
    play.setAttribute('aria-pressed', String(state.playing));
    play.textContent = `${state.playing ? 'Restart' : 'Play'} ${current === 'file' ? 'file' : 'sample'}`;
    $('[data-act="stop"]').disabled = !state.playing && !state.pending;
    $('[data-act="loop"]').setAttribute('aria-pressed', String(state.loop));
    $('[data-role="status"]').textContent = recordedInputStatus(state, { armed: isArmed(), mode: current });
    const credit = $('[data-role="credit"]');
    credit.hidden = current !== 'samples' || !state.credit;
    credit.textContent = state.credit; credit.href = state.creditUrl || '#';
    onChange(state);
  };
  player = createInputSource({
    prepare: async () => {
      await prepare();
      const context = getContext(), target = getTarget();
      if (!context || !target) return;
      if (!bridge || bridge.context !== context || bridgeTarget !== target) {
        bridge?.disconnect();
        bridge = context.createGain(); bridge.gain.value = getGain();
        bridge.connect(target); bridgeTarget = target;
      }
    },
    getContext, getTarget: () => bridge, canPlay: () => !disposed && mode() !== 'mic' && isArmed() && canPlay(),
    onChange: refresh, onError,
  });
  player.selectSample(choices[0].id);
  const run = task => Promise.resolve(task).catch(onError);
  const listen = (node, type, handler) => node?.addEventListener(type, handler, { signal: abort.signal });
  listen(select, 'change', () => {
    const active = player.snapshot().playing || player.snapshot().pending;
    player.selectSample(select.value);
    if (active) void run(player.start());
  });
  listen($('[data-act="next"]'), 'click', () => {
    select.selectedIndex = (select.selectedIndex + 1) % choices.length;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  listen($('[data-act="play"]'), 'click', () => { void run(player.restart()); });
  listen($('[data-act="stop"]'), 'click', () => player.stop());
  listen($('[data-act="loop"]'), 'click', () => player.setLoop(!player.snapshot().loop));
  listen(fileInput, 'change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (file) void run(player.loadFile(file));
  });
  const setMode = next => { player.selectMode(next); refresh(); };
  if (mode() !== 'mic') player.selectMode(mode());
  refresh();
  return {
    ...player, setMode, refresh, getSignal: () => bridge,
    setGain(value) { if (bridge) bridge.gain.setTargetAtTime(value, bridge.context.currentTime, 0.015); },
    destroy() {
      if (disposed) return;
      abort.abort(); player.dispose(); disposed = true;
      bridge?.disconnect(); bridge = null;
    },
  };
}
