import { connectAudioOutput } from '../../audio-output-manager.js';
import { sanitizeGardenSettings, prepareGardenSettings, TINE_COUNT, tineFrequency } from './dsp.js';
import { PRESETS, fillPitchProbabilities, bankSpectralEmphasis, randomizeGardenPreset } from './garden-model.js';
import { drawGarden, materialPointer, bankPointer } from './garden-view.js';
import { createChoosePickerShell, anchorChoosePickerPanel } from '../../ui/patterns/choose-picker-shell.js';

const $ = id => document.getElementById(id);
const controls = ['baseFrequency', 'pitchSpread', 'decay', 'dispersion', 'brightness', 'modes'];
const state = {
  settings: { ...PRESETS.original }, x: 0.42, y: 0.65, pointer: false,
  repeating: false, rate: 3, pitchFocus: 0.5, chanceWidth: 1, pitchProbabilities: new Float64Array(TINE_COUNT), appliedPitchSpread: null, exciter: "impulse", pattern: "random", ticks: 0, lastTine: 13,
  audioOn: false, audioStarting: false, context: null, node: null, master: null,
  releaseOutput: null, backend: 'wasm', hasWasm: null, peak: 0, rms: 0, audioTime: 0, renderedFrames: 0,
  energies: new Float32Array(TINE_COUNT), disposed: false,
};
const chanceBars = Array.from({ length: TINE_COUNT }, () => { const bar = document.createElement('span'); bar.setAttribute('aria-hidden', 'true'); $('pitchChanceBars').append(bar); return bar; });
const listeners = new AbortController();
const on = (target, name, callback, options = {}) => target.addEventListener(name, callback, { ...options, signal: listeners.signal });
let visibleSurface = null, presetPicker = null, lastPresetId = 'original';
let modulePromise, frame, configureFrame, configurationPending = false, lastPaint = -100, lastStrike = -100, pointerId = null;

// The kernel is bounded below 0.8; 1.2x at full Volume stays below 0.96.
const outputGain = () => 1.2 * Number($('outputLevel').value);

function status(message) { $('liveStatus').textContent = message; }
function error(message = '') { $('audioError').textContent = message; $('audioError').hidden = !message; }
function send(data, transfer = []) { state.node?.port.postMessage(data, transfer); }
function getModule() {
  modulePromise ||= (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(new URL('../../../assets/wasm/wasm-garden.wasm', import.meta.url), { signal: controller.signal });
      if (!response.ok) throw new Error(`Wasm request failed (${response.status}).`);
      return await WebAssembly.compile(await response.arrayBuffer());
    } catch (reason) {
      error(`${reason.name === 'AbortError' ? 'Wasm loading timed out.' : reason.message} Compatibility audio is available with up to 1,024 resonances.`);
      return null;
    } finally { clearTimeout(timeout); }
  })();
  return modulePromise;
}

function renderAudio() {
  $('audioButton').disabled = state.audioStarting;
  $('audioButton').setAttribute('aria-pressed', String(state.audioOn));
  $('audioState').textContent = state.audioStarting ? 'starting' : state.audioOn ? 'on' : 'off';
}

function renderControls() {
  const bank = state.settings.model === 'bank';
  $('pitchSpread').max = bank ? '6' : '4';
  $('exciterControl').hidden = bank;
  $('rootLabel').textContent = bank ? 'Root' : 'Lowest tine';
  $('metalLabel').textContent = bank ? 'Metal' : 'Overtone spacing';
  $('brightnessLabel').textContent = bank ? 'Brightness' : 'Overtone level';
  $('decayLabel').textContent = bank ? 'Ring' : 'Decay';
  $('patternLabel').textContent = bank ? 'Excitation' : 'Pitch selection';
  $('focusLabel').textContent = bank ? 'Spectral focus' : 'Pitch focus';
  $('chanceLegend').textContent = bank ? 'Spectral emphasis probability' : 'Next-strike probability';
  $('gardenCanvas').setAttribute('aria-label', bank ? 'Resonance bank. Arrows change excitation position and spectral emphasis; Enter strikes. Turn on Audio first.' : 'Metal tines, low to high from left to right. Arrows select a tine and contact point; Enter strikes. Turn on Audio first.');
  for (const key of controls) $(key).value = String(state.settings[key]);
  $('baseFrequencyOut').textContent = `${Math.round(state.settings.baseFrequency)} Hz`;
  $('pitchSpreadOut').textContent = `${state.settings.pitchSpread.toFixed(2)} oct`;
  $('decayOut').textContent = `${state.settings.decay.toFixed(1)} s`;
  $('dispersionOut').textContent = `${Math.round(state.settings.dispersion * 100)}%`;
  $('brightnessOut').textContent = `${Math.round(state.settings.brightness * 100)}%`;
  $('modesOut').textContent = state.settings.modes.toLocaleString();
  $('rate').value = String(state.rate);
  $('rateOut').textContent = `${state.rate} / s`;
  $('exciter').value = state.exciter;
  $('pattern').value = state.pattern;
  const tine = Math.min(TINE_COUNT - 1, Math.floor(state.x * TINE_COUNT));
  const weighted = state.pattern === 'weighted';
  $('pitchChance').hidden = !weighted;
  $('pitchFocus').value = String(state.pitchFocus);
  $('chanceWidth').value = String(state.chanceWidth);
  const focusTine = state.chanceWidth === 0 ? Math.round(state.pitchFocus * (TINE_COUNT - 1)) : state.pitchFocus * (TINE_COUNT - 1);
  const focusHz = tineFrequency(focusTine, state.settings.baseFrequency, state.settings.pitchSpread);
  const spectralFocus = bankSpectralEmphasis(focusTine / (TINE_COUNT - 1));
  $('pitchFocusOut').textContent = state.chanceWidth === 1 ? 'equal odds' : bank ? `${Math.round(spectralFocus * 100)}% bright` : `${Math.round(focusHz)} Hz`;
  $('pitchFocus').disabled = state.chanceWidth === 1;
  $('chanceWidthOut').textContent = state.chanceWidth === 0 ? bank ? 'one region' : 'one tine' : state.chanceWidth === 1 ? 'all equal' : `${Math.round(state.chanceWidth * 100)}%`;
  fillPitchProbabilities(state.pitchProbabilities, state.pitchFocus, state.chanceWidth);
  $('chanceLow').textContent = bank ? 'Darker' : state.settings.pitchSpread === 0 ? 'Tine 1' : 'Low';
  $('chanceHigh').textContent = bank ? 'Brighter' : state.settings.pitchSpread === 0 ? 'Tine 32' : 'High';
  const maximum = Math.max(...state.pitchProbabilities);
  for (let tine = 0; tine < TINE_COUNT; tine++) {
    const chance = state.pitchProbabilities[tine];
    chanceBars[tine].style.height = `${chance / maximum * 100}%`;
    chanceBars[tine].title = `${bank ? 'Region' : 'Tine'} ${tine + 1}: ${(chance * 100).toFixed(1)}%`;
  }
  $('pitchChanceBars').setAttribute('aria-label', bank ? `Spectral emphasis probability. Focus ${Math.round(spectralFocus * 100)} percent; width ${Math.round(state.chanceWidth * 100)} percent.` : `Next-strike probability from low to high. ${state.chanceWidth === 1 ? 'All 32 tines have equal odds.' : `Focus ${Math.round(focusHz)} Hz; width ${Math.round(state.chanceWidth * 100)} percent.`}`);
  $('capacityHint').hidden = state.settings.modes < 32768;
  presetPicker?.refresh();
}

function configure(settings, { preset = 'custom' } = {}) {
  const changingModel = settings.model && settings.model !== state.settings.model;
  if (changingModel) state.energies.fill(0);
  state.settings = sanitizeGardenSettings({ ...state.settings, ...settings });
  if (changingModel && state.settings.model === 'tines') {
    state.x = (Math.min(TINE_COUNT - 1, Math.floor(state.x * TINE_COUNT)) + 0.5) / TINE_COUNT;
    state.y = Math.max(0.08, Math.min(0.98, state.y));
  }
  if (state.hasWasm === false) state.settings.modes = Math.min(1024, state.settings.modes);
  $('presetSelect').value = preset;
  // Coalesce pointer/slider updates and prepare expensive math on the page.
  cancelAnimationFrame(configureFrame);
  configurationPending = Boolean(state.node);
  if (configurationPending) configureFrame = requestAnimationFrame(flushConfiguration);
  renderControls();
}

function flushConfiguration() {
  cancelAnimationFrame(configureFrame);
  if (!configurationPending || !state.node || state.disposed) return;
  const prepared = prepareGardenSettings(state.settings, state.context.sampleRate);
  send({ type: 'configure', settings: state.settings, prepared }, [prepared.coefficients.buffer]);
  configurationPending = false;
}

function sendExcitation() {
  send({ type: 'excitation', playing: state.repeating, rate: state.rate,
    exciter: state.exciter, pattern: state.pattern, pitchFocus: state.pitchFocus, chanceWidth: state.chanceWidth, x: state.x, y: state.y });
}
function setRepeat(playing) {
  state.repeating = playing;
  $('playButton').setAttribute('aria-pressed', String(playing));
  $('playButton').setAttribute('aria-label', playing ? 'Pause' : 'Play');
  $('playButton').title = playing ? 'Pause' : 'Play';
  $('playIcon').textContent = playing ? 'Ⅱ' : '▶';
  sendExcitation();
  status(playing ? state.audioOn ? 'Rain is playing.' : 'Press Audio to hear playback.' : 'Paused. Resonances keep ringing.');
}
function strike(velocity = 0.7, x = state.x) {
  if (!state.audioOn) { status('Turn on Audio first.'); return; }
  flushConfiguration();
  send({ type: 'strike', x, y: state.y, velocity, exciter: state.exciter });
  state.manualContactTime = state.context.currentTime;
  status(state.settings.model === 'bank' ? 'Drag to excite the bank; higher emphasizes brighter resonances.' : 'Drag across tines. Strike near the tip or clamp to change overtones.');
}

async function disposeAudio() {
  const context = state.context;
  state.audioOn = false;
  send({ type: 'dispose' });
  state.node?.disconnect(); state.node?.port.close(); state.master?.disconnect();
  state.releaseOutput?.(); state.releaseOutput = null;
  state.context = state.node = state.master = null;
  state.peak = state.rms = 0; state.energies.fill(0);
  if (context && context.state !== 'closed') await context.close().catch(() => {});
}

async function toggleAudio() {
  if (state.audioStarting || state.disposed) return;
  error();
  if (state.context) {
    const context = state.context, master = state.master;
    state.audioStarting = true; renderAudio();
    try {
      if (state.audioOn) {
        master.gain.setTargetAtTime(0, context.currentTime, 0.015);
        state.audioOn = false;
        status('Audio is off. Rain keeps its position.');
      } else {
        await context.resume();
        if (state.disposed || state.context !== context) return;
        state.audioOn = true;
        master.gain.setTargetAtTime(outputGain(), context.currentTime, 0.015);
        status('Audio is on. Press Play or drag the surface.');
      }
    } catch (reason) {
      error(reason.message || 'Audio could not resume.');
      await disposeAudio();
    } finally { state.audioStarting = false; renderAudio(); }
    return;
  }
  state.audioStarting = true; renderAudio();
  let readyTimer;
  try {
    const AudioContextType = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextType || !window.AudioWorkletNode) throw new Error('This browser needs AudioWorklet support.');
    // Create and resume immediately within the explicit Audio gesture.
    const context = new AudioContextType({ latencyHint: 'interactive' });
    state.context = context;
    const resume = context.resume();
    const [module] = await Promise.all([getModule(), context.audioWorklet.addModule(new URL('./garden-processor.js', import.meta.url)), resume]);
    if (state.disposed) { await disposeAudio(); return; }
    if (!module) state.settings.modes = Math.min(1024, state.settings.modes);
    const node = new AudioWorkletNode(context, 'morphazoid-wasm-garden', {
      numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
      processorOptions: { module, settings: state.settings, prepared: prepareGardenSettings(state.settings, context.sampleRate),
        playing: state.repeating, rate: state.rate, exciter: state.exciter, pattern: state.pattern, pitchFocus: state.pitchFocus, chanceWidth: state.chanceWidth, x: state.x, y: state.y },
    });
    state.node = node;
    const ready = new Promise((resolve, reject) => {
      readyTimer = setTimeout(() => reject(new Error('The audio engine did not become ready.')), 8000);
      node.port.onmessage = ({ data }) => {
        if (data.type === 'ready') {
          state.backend = data.backend; state.hasWasm = data.hasWasm;
          if (!data.hasWasm) {
            configure({ modes: Math.min(1024, state.settings.modes) });
            for (const option of $('modes').options) option.disabled = Number(option.value) > 1024;
          }
          resolve();
        }
        if (data.type === 'meter') {
          state.peak = data.peak; state.rms = data.rms; state.audioTime = data.time; state.renderedFrames = data.renderedFrames;
          state.backend = data.backend;
          if (data.model === state.settings.model) state.energies.set(data.energies); else state.energies.fill(0);
          state.lastTine = data.lastTine; state.lastX = data.lastX; state.lastY = data.lastY; state.appliedModel = data.model; state.appliedRate = data.rate; state.appliedPitchSpread = data.pitchSpread;
          if (data.ticks !== state.ticks) state.lastContactTime = data.time;
          state.ticks = data.ticks;
        }
      };
      node.onprocessorerror = () => {
        reject(new Error('The audio processor stopped.'));
        error('The audio processor stopped. Turn Audio on to retry.');
        void disposeAudio().then(renderAudio);
      };
    });
    const master = context.createGain(); master.gain.value = 0; state.master = master;
    node.connect(master);
    state.releaseOutput = connectAudioOutput(context, master, { runtime: globalThis });
    await ready;
    if (state.disposed) { await disposeAudio(); return; }
    state.audioOn = true;
    master.gain.setTargetAtTime(outputGain(), context.currentTime, 0.015);
    status(state.hasWasm ? 'Audio is on. Press Play or drag the surface.' : 'Compatibility audio is on. Rust SIMD is unavailable in this browser.');
  } catch (reason) {
    error(reason.message || 'Audio could not start.');
    await disposeAudio();
  } finally {
    clearTimeout(readyTimer); state.audioStarting = false; renderAudio();
  }
}

function updatePointer(event) {
  const rect = $('gardenCanvas').getBoundingClientRect();
  const point = state.settings.model === 'bank' ? bankPointer(rect.width, rect.height, event.clientX - rect.left, event.clientY - rect.top, visibleSurface) : materialPointer(rect.width, rect.height, event.clientX - rect.left, event.clientY - rect.top, state.settings.baseFrequency, state.settings.pitchSpread);
  state.x = point.x; state.y = point.y;
  sendExcitation();
  renderControls();
}
on($('gardenCanvas'), 'pointerdown', event => {
  if (pointerId !== null || (event.pointerType === 'mouse' && event.button !== 0)) return;
  pointerId = event.pointerId; state.pointer = true;
  $('gardenCanvas').setPointerCapture(pointerId); $('gardenCanvas').focus();
  updatePointer(event); strike(); lastStrike = performance.now();
});
on($('gardenCanvas'), 'pointermove', event => {
  if (event.pointerId !== pointerId) return;
  const previous = Math.floor(state.x * TINE_COUNT);
  updatePointer(event);
  const selected = Math.floor(state.x * TINE_COUNT);
  if (state.settings.model === 'bank') {
    if (performance.now() - lastStrike >= 45) { strike(0.45); lastStrike = performance.now(); }
    return;
  }
  if (selected !== previous) {
    const direction = Math.sign(selected - previous);
    for (let tine = previous + direction; direction > 0 ? tine <= selected : tine >= selected; tine += direction) strike(0.55, (tine + 0.5) / TINE_COUNT);
    lastStrike = performance.now();
  } else if (state.exciter === 'scraper' && performance.now() - lastStrike >= 30) {
    strike(0.45); lastStrike = performance.now();
  }
});
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) on($('gardenCanvas'), name, event => {
  if (event.pointerId !== pointerId) return;
  if ($('gardenCanvas').hasPointerCapture(pointerId)) $('gardenCanvas').releasePointerCapture(pointerId);
  pointerId = null; state.pointer = false;
});
on($('gardenCanvas'), 'keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter'].includes(event.key)) return;
  event.preventDefault();
  if (event.key === 'Enter') { if (!event.repeat) strike(); return; }
  const bank = state.settings.model === 'bank';
  if (event.key === 'ArrowLeft') state.x = Math.max(bank ? 0 : 0.5 / TINE_COUNT, state.x - (bank ? 0.04 : 1 / TINE_COUNT));
  if (event.key === 'ArrowRight') state.x = Math.min(bank ? 1 : 1 - 0.5 / TINE_COUNT, state.x + (bank ? 0.04 : 1 / TINE_COUNT));
  if (event.key === 'ArrowUp') state.y = Math.min(bank ? 1 : 0.98, state.y + 0.04);
  if (event.key === 'ArrowDown') state.y = Math.max(bank ? 0 : 0.08, state.y - 0.04);
  renderControls(); sendExcitation();
});
on($('audioButton'), 'click', () => { void toggleAudio(); });
on($('playButton'), 'click', () => setRepeat(!state.repeating));
on($('outputLevel'), 'input', () => {
  const value = Number($('outputLevel').value);
  $('outputLevelOut').textContent = `${Math.round(value * 100)}%`;
  if (state.audioOn) state.master.gain.setTargetAtTime(outputGain(), state.context.currentTime, 0.015);
});
for (const key of controls) on($(key), key === 'modes' ? 'change' : 'input', () => configure({ [key]: Number($(key).value) }));
on($('rate'), 'input', () => { state.rate = Number($('rate').value); sendExcitation(); $('presetSelect').value = 'custom'; renderControls(); });
for (const key of ['pitchFocus', 'chanceWidth']) on($(key), 'input', () => { state[key] = Number($(key).value); sendExcitation(); $('presetSelect').value = 'custom'; renderControls(); });
for (const key of ['exciter', 'pattern']) on($(key), 'change', () => { state[key] = $(key).value; sendExcitation(); $('presetSelect').value = 'custom'; renderControls(); });
function applySound(preset, id = 'custom') {
  state.rate = preset.rate; state.pitchFocus = preset.pitchFocus; state.chanceWidth = preset.chanceWidth; state.exciter = preset.exciter; state.pattern = preset.pattern;
  configure(preset, { preset: id }); flushConfiguration(); sendExcitation();
}
function applyPreset(id) {
  const preset = PRESETS[id]; if (!preset) return;
  lastPresetId = id;
  applySound(preset, id);
}
function mountPresetPicker() {
  const select = $('presetSelect'), root = $('presetControls');
  const options = Array.from(select.options).filter(option => PRESETS[option.value]);
  const shell = createChoosePickerShell(document, {
    current: 'Metal', label: 'Choose preset', title: 'Choose preset', panelId: 'garden-preset-panel',
    placeholder: 'Find a sound', filterLabel: 'Filter presets', listLabel: 'Presets',
  });
  const { details, summary, currentLabel, panel, search, searchInput, list } = shell;
  details.classList.add('header-preset-picker');
  const buttons = options.map(option => {
    const row = document.createElement('div'); row.className = 'instrument-picker-row';
    const button = document.createElement('button'); button.type = 'button';
    button.className = 'instrument-picker-link'; button.dataset.presetId = option.value;
    button.textContent = option.textContent;
    on(button, 'click', () => {
      select.value = option.value; select.dispatchEvent(new Event('change', { bubbles: true }));
      details.open = false; summary.focus();
    });
    row.append(button); list.append(row); return button;
  });
  const empty = document.createElement('p'); empty.className = 'instrument-picker-empty';
  empty.textContent = 'No presets found'; empty.hidden = true; list.append(empty);
  const filter = () => {
    const query = searchInput.value.trim().toLowerCase();
    for (const button of buttons) button.parentNode.hidden = !button.textContent.toLowerCase().includes(query);
    empty.hidden = buttons.some(button => !button.parentNode.hidden);
  };
  const cycle = direction => {
    const index = options.findIndex(option => option.value === lastPresetId);
    select.value = options[(index + direction + options.length) % options.length].value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  };
  on(searchInput, 'input', filter);
  on($('nextPresetButton'), 'click', () => cycle(1));
  on($('randomPresetButton'), 'click', () => {
    applySound(randomizeGardenPreset()); details.open = false; status('Parameters randomized.');
  });
  on(details, 'toggle', () => {
    if (details.open) queueMicrotask(() => { if (details.open) searchInput.focus(); });
    else { searchInput.value = ''; filter(); }
  });
  on(document, 'pointerdown', event => { if (details.open && !root.contains(event.target)) details.open = false; });
  on(root, 'keydown', event => {
    if (event.key === 'Escape' && details.open) {
      event.preventDefault(); details.open = false; summary.focus();
    }
    if ([summary, $('nextPresetButton'), $('randomPresetButton')].includes(event.target)
        && ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(event.key)) {
      event.preventDefault(); cycle(['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1);
    }
  });
  panel.append(search, list); details.append(summary, panel); root.prepend(details);
  const anchored = anchorChoosePickerPanel(shell);
  return {
    refresh() {
      currentLabel.textContent = select.selectedOptions[0]?.textContent || 'Custom';
      for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.presetId === select.value));
    },
    destroy() { anchored.destroy(); },
  };
}
on($('presetSelect'), 'change', () => applyPreset($('presetSelect').value));
on($('resetButton'), 'click', () => { state.x = 0.42; state.y = 0.65; applyPreset('original'); status('Metal selected.'); });
on(window, 'blur', () => { state.pointer = false; pointerId = null; });

function paint(now) {
  if (state.disposed) return;
  if (!document.hidden && now - lastPaint >= 32) {
    visibleSurface = drawGarden($('gardenCanvas'), state, state.context?.currentTime || now / 1000);
    lastPaint = now;
  }
  frame = requestAnimationFrame(paint);
}
on(window, 'pagehide', () => {
  state.disposed = true; presetPicker?.destroy(); listeners.abort(); cancelAnimationFrame(frame); cancelAnimationFrame(configureFrame);
  void disposeAudio();
}, { once: true });
window.addEventListener('pageshow', event => { if (event.persisted && state.disposed) location.reload(); });
globalThis.__MORPHAZOID_WASM_GARDEN__ = Object.freeze({
  getState: () => ({ audioOn: state.audioOn, audioStarting: state.audioStarting, repeating: state.repeating, rate: state.rate, exciter: state.exciter, pattern: state.pattern,
    pitchFocus: state.pitchFocus, chanceWidth: state.chanceWidth, pitchProbabilities: Array.from(state.pitchProbabilities), lastTine: state.lastTine, lastX: state.lastX, lastY: state.lastY, appliedModel: state.appliedModel, appliedRate: state.appliedRate, appliedPitchSpread: state.appliedPitchSpread,
    backend: state.backend, hasWasm: state.hasWasm, settings: { ...state.settings },
    peak: state.audioOn ? state.peak : 0, rms: state.audioOn ? state.rms : 0,
    audioTime: state.audioTime, renderedFrames: state.renderedFrames, ticks: state.ticks, x: state.x, y: state.y,
    sampleRate: state.context?.sampleRate || null }),
});
state.settings = sanitizeGardenSettings(state.settings);
presetPicker = mountPresetPicker();
renderControls(); renderAudio(); frame = requestAnimationFrame(paint);
