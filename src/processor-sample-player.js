import { createInputSource, SAMPLE_INPUT_OPTIONS } from './instruments/micmic/native/input-source.js';

const featured = ['music-vocal-scat', 'music-vocal-phrase', 'music-sax-multiphonic', 'music-sax-fingerings', 'music-tabla'];
const choices = [...featured.map(id => SAMPLE_INPUT_OPTIONS.find(option => option.id === id)),
  ...SAMPLE_INPUT_OPTIONS.filter(option => !featured.includes(option.id))];

/** Recorded input controls shared by the barber delays and Slippery Resynthesis.
 * The instrument owns arming and the effect graph; the existing bounded loader
 * owns decoding, cancellation, one live buffer source and sample attribution.
 * Pass `player` to render an input source the caller already owns. */
export function mountProcessorSamplePlayer({ container, prepare, getContext, getTarget,
  isArmed, isSelected, onChange = () => {}, onError = () => {}, player: shared = null }) {
  const doc = container.ownerDocument;
  const abort = new AbortController();
  container.classList.add('processor-sample-player');
  container.innerHTML = `<label class="select-field" for="sampleSelect">Sample
    <span class="processor-sample-choice"><select id="sampleSelect" aria-label="Sample loop"></select>
    <button id="sampleNext" type="button" aria-label="Next sample">›</button></span></label>
    <div class="processor-sample-transport"><button id="samplePlay" type="button" aria-pressed="false">Play sample</button>
    <button id="sampleStop" type="button">Stop</button>
    <button id="sampleLoop" type="button" aria-pressed="true">Loop</button></div>
    <p id="sampleStatus" role="status">Switch Audio on, then play a sample.</p>
    <a id="sampleCredit" target="_blank" rel="noopener" hidden></a>`;
  const $ = id => container.querySelector(`#${id}`);
  const groups = new Map();
  for (const option of choices) {
    const group = featured.includes(option.id) ? 'Voices, sax & tabla' : option.group;
    if (!groups.has(group)) {
      const element = doc.createElement('optgroup'); element.label = group;
      $('sampleSelect').append(element); groups.set(group, element);
    }
    const element = doc.createElement('option');
    element.value = option.id; element.textContent = option.label;
    groups.get(group).append(element);
  }
  let bridge = null, player;
  const refresh = () => {
    if (!player) return;
    const state = player.snapshot();
    container.hidden = !isSelected();
    $('sampleSelect').value = state.sampleId;
    $('samplePlay').disabled = !isArmed() || state.pending;
    $('samplePlay').setAttribute('aria-pressed', String(state.playing));
    $('samplePlay').textContent = state.playing ? 'Restart sample' : 'Play sample';
    $('sampleStop').disabled = !state.playing && !state.pending;
    $('sampleLoop').setAttribute('aria-pressed', String(state.loop));
    $('sampleStatus').textContent = !isArmed() ? 'Switch Audio on, then play a sample.'
      : state.pending ? 'Loading sample…' : state.playing ? `${state.label} · ${state.loop ? 'looping' : 'once'}`
        : state.ended ? 'Sample finished.' : 'Ready to play.';
    $('sampleCredit').hidden = !state.credit;
    $('sampleCredit').textContent = state.credit;
    $('sampleCredit').href = state.creditUrl || '#';
    onChange(state);
  };
  player = shared ?? createInputSource({
    prepare: async () => {
      await prepare();
      if (!bridge || bridge.context !== getContext()) {
        bridge?.disconnect();
        bridge = getContext().createGain();
        bridge.connect(getTarget());
      }
    },
    getContext, getTarget: () => bridge, canPlay: () => isArmed() && isSelected(),
    onChange: refresh, onError,
  });
  if (!shared) { player.selectMode('samples'); player.selectSample(featured[0]); }
  const run = task => Promise.resolve(task).catch(onError);
  const listen = (id, type, handler) => $(id).addEventListener(type, handler, { signal: abort.signal });
  listen('sampleSelect', 'change', () => {
    const playing = player.snapshot().playing || player.snapshot().pending;
    player.selectSample($('sampleSelect').value);
    if (playing) void run(player.start());
  });
  listen('sampleNext', 'click', () => {
    $('sampleSelect').selectedIndex = ($('sampleSelect').selectedIndex + 1) % choices.length;
    $('sampleSelect').dispatchEvent(new Event('change', { bubbles: true }));
  });
  listen('samplePlay', 'click', () => { void run(player.restart()); });
  listen('sampleStop', 'click', () => player.stop());
  listen('sampleLoop', 'click', () => player.setLoop(!player.snapshot().loop));
  refresh();
  return {
    ...player, refresh, getSignal: () => bridge,
    destroy() { abort.abort(); if (!shared) player.dispose(); bridge?.disconnect(); bridge = null; },
  };
}
