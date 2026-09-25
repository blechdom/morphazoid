import { rubixoidsClock } from './clock.js';
import { seedRubixoidsDrumBank } from './bank-storage.js';
import { sharedParameterChanges, nativeParameterPatch } from './shared-settings.js';
import { RUBIXOIDS_VIEWS } from './native-views.js';
import { registerNativeInstrumentRoot, unregisterNativeInstrumentRoot } from './native-context.js';
import { registerHeaderPresets } from '../../site/header-presets.js';
import { installBrowserMidiAdapter, isWaxWrappedDocument } from '../../browser-midi-adapter.js';
import { activeInstrumentControls } from '../../ui/active-instrument-controls.js';
import { initializeMidiOutputMonitor } from '../../midi-output-preview.js';
import { instrumentMidiCapabilityForId } from '../../site/instrument-midi-capabilities.js';

seedRubixoidsDrumBank();

const CONTROLLERS = {
  '2d': () => import('./sliding-puzzle/sliding-puzzle-app.js'),
  '3d': () => import('./rubix/rubix-app.js'),
  '4d': () => import('./hyper-rubix/hyper-rubix-app.js'),
};
const shell = document.getElementById('rubixoids');
const status = document.getElementById('rubixoidsStatus');
const audioButton = document.getElementById('audioButton');
const playButton = document.getElementById('playButton');
const output = document.getElementById('output');
const tempo = document.getElementById('tempo');
const swing = document.getElementById('swing');
const instances = new Map();
const controllerRetries = new Map();
const controllerEvaluationErrors = new Map();
const shared = {};
const versions = {};
const controlDocument = activeInstrumentControls(document);
let dimension = null;
let revision = 0;
let switching = Promise.resolve();
let disposed = false;
let presetController = null;
let midiOutputMonitor = null;
let chromePending = false;
let busy = false;

function current() { return instances.get(dimension); }

function syncChrome() {
  chromePending = false;
  const instance = current();
  if (!instance) return;
  const nativeAudio = instance.root.getElementById('audioButton');
  const nativePlay = instance.root.getElementById('playButton');
  const nativeOutput = instance.root.getElementById('output');
  const playing = nativePlay.getAttribute('aria-pressed') === 'true';
  const audioOn = nativeAudio.getAttribute('aria-pressed') === 'true';
  // Temporary engine preparation keeps its transport intent; dimension parking
  // must never pause the shared beat. The stable native bridge owns that intent.
  if (!busy && !instance.bridge.capture().playing) rubixoidsClock.pause();
  tempo.value = String(rubixoidsClock.tempo);
  swing.value = String(rubixoidsClock.swing);
  tempo.disabled = swing.disabled = busy;
  document.getElementById('tempoOut').textContent = `${Math.round(rubixoidsClock.tempo)} BPM`;
  document.getElementById('swingOut').textContent = `${Math.round(rubixoidsClock.swing * 100)}%`;
  audioButton.setAttribute('aria-pressed', String(audioOn));
  audioButton.dataset.audioState = audioOn ? 'on' : 'off';
  audioButton.disabled = busy || nativeAudio.disabled;
  document.getElementById('audioState').textContent = instance.root.getElementById('audioState')?.textContent ?? (audioOn ? 'on' : 'off');
  playButton.setAttribute('aria-pressed', String(playing));
  playButton.disabled = busy || nativePlay.disabled;
  document.getElementById('playLabel').textContent = playing ? 'Pause' : 'Play';
  playButton.firstElementChild.textContent = playing ? 'Ⅱ' : '▶';
  for (const key of ['min', 'max', 'step', 'value']) output[key] = nativeOutput[key];
  output.disabled = busy || nativeOutput.disabled;
  document.getElementById('outputOut').textContent = instance.root.getElementById('outputOut')?.textContent ?? `${Math.round(Number(output.value) * 100)}%`;
}
function queueChrome() {
  if (chromePending) return;
  chromePending = true;
  queueMicrotask(syncChrome);
}

function collect(instance) {
  if (!instance) return;
  const settings = instance.bridge.capture().settings;
  const changes = sharedParameterChanges(instance.dimension, instance.baseline, settings);
  for (const [key, value] of Object.entries(changes)) {
    shared[key] = value;
    versions[key] = ++revision;
    instance.applied[key] = revision;
  }
  instance.baseline = settings;
}

function preservePresetPosition(instance) {
  if (!instance || !presetController) return;
  instance.presetPosition = {
    lastPresetId: presetController.lastPresetId,
    hasPresetInteraction: presetController.hasPresetInteraction,
  };
}
function installPresets(instance) {
  presetController?.destroy();
  presetController = null;
  const adapter = instance.context.presets;
  if (!adapter) return;
  presetController = registerHeaderPresets({
    ...adapter,
    apply(snapshot) { adapter.apply(snapshot); syncChrome(); },
    document, runtime: globalThis, host: instance.root.querySelector('[data-instrument-preset-host]'),
  });
  Object.assign(presetController, instance.presetPosition);
  presetController.refresh();
}
function clearMidiOutputMonitor(instance = current()) {
  if (!midiOutputMonitor) return;
  if (instance) instance.previewOpen = midiOutputMonitor.details.open;
  midiOutputMonitor.destroy();
  midiOutputMonitor = null;
}
function installMidiOutputPreview(instance) {
  clearMidiOutputMonitor();
  midiOutputMonitor = initializeMidiOutputMonitor(instance.context.document, globalThis, {
    routeId: instance.id,
    capability: instrumentMidiCapabilityForId(instance.id),
    controlEventTargets: [document],
  });
  if (midiOutputMonitor && typeof instance.previewOpen === 'boolean') {
    midiOutputMonitor.details.open = instance.previewOpen;
  }
}
function installMidi(instance) {
  // One browser client follows the selected instrument. The shared manager,
  // device connection, profile and main toolbar survive dimensional changes.
  globalThis[Symbol.for('morphazoid.browserMidiAdapter')]?.dispose();
  if (!isWaxWrappedDocument(globalThis, document)) {
    installBrowserMidiAdapter(globalThis, controlDocument, { routeId: instance.id });
  }
  globalThis.dispatchEvent(new CustomEvent('morphazoid:instrument-root-change', {
    detail: { dimension: instance.dimension, instrumentId: instance.id },
  }));
}

async function initializeInstance(instance) {
  if (!instance.initialized) {
    await instance.bridge.deactivate();
    instance.baseline = instance.bridge.capture().settings;
    instance.initialized = true;
  }
  return instance;
}

async function getInstance(dim) {
  if (instances.has(dim)) return initializeInstance(instances.get(dim));
  if (controllerEvaluationErrors.has(dim)) throw controllerEvaluationErrors.get(dim);
  const view = RUBIXOIDS_VIEWS[dim];
  const pane = document.createElement('div');
  pane.className = 'rubixoids-pane';
  pane.dataset.dimension = dim;
  pane.hidden = true;
  pane.inert = true;
  pane.setAttribute('aria-label', `${view.label} — Rubixoids ${dim.toUpperCase()}`);
  const root = pane.attachShadow({ mode: 'open' });
  root.innerHTML = view.markup;
  root.querySelector('.panel').setAttribute('data-instrument-preset-host', '');
  const styles = view.styles.map(path => new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL(path.replace(/^\//, ''), document.baseURI).href;
    link.addEventListener('load', resolve, { once: true });
    link.addEventListener('error', () => reject(new Error(`Could not load ${view.label} styles.`)), { once: true });
    root.append(link);
  }));
  shell.append(pane);
  let context;
  let controller;
  let failedBeforeEvaluation = true;
  try {
    await Promise.all(styles);
    context = registerNativeInstrumentRoot(view.id, root);
    failedBeforeEvaluation = false;
    try {
      const retry = controllerRetries.get(dim) ?? 0;
      // A rejected module fetch is cached by browsers. Retry only that failed
      // entry URL; evaluated controllers remain attached to their original root.
      controller = retry
        ? await import(new URL(`./${view.id}/${view.id}-app.js?rubixoids-retry=${retry}`, import.meta.url).href)
        : await CONTROLLERS[dim]();
    } catch (error) {
      if (error instanceof TypeError && /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(error.message)) {
        failedBeforeEvaluation = true;
        controllerRetries.set(dim, (controllerRetries.get(dim) ?? 0) + 1);
      }
      throw error;
    }
  } catch (error) {
    if (failedBeforeEvaluation) {
      unregisterNativeInstrumentRoot(view.id, root);
      pane.remove();
    } else {
      // Evaluation failures may have installed listeners. Keep their original
      // document, report the error, and never evaluate that controller twice.
      controllerEvaluationErrors.set(dim, error);
    }
    throw error;
  }
  const bridge = controller.rubixoidsNative;
  // Store a successfully evaluated controller before any asynchronous parking or
  // capture work. A retry must reuse its closed-over document and listeners.
  const instance = { dimension: dim, id: view.id, pane, root, context, bridge,
    baseline: {}, applied: {}, presetPosition: {}, initialized: false };
  instances.set(dim, instance);
  // Watch only controls, never canvas/score animation mutations. Audio stays
  // independent of the shared chrome and visual frame rate.
  const observer = new MutationObserver(() => { if (current() === instance) queueChrome(); });
  for (const id of ['audioButton', 'audioState', 'playButton', 'playLabel', 'outputOut']) {
    const node = root.getElementById(id);
    if (node) observer.observe(node, { attributes: true, childList: true, characterData: true, subtree: true });
  }
  instance.observer = observer;
  for (const type of ['input', 'change', 'click']) root.addEventListener(type, () => {
    if (current() === instance) queueChrome();
  });
  return initializeInstance(instance);
}

async function activateDimension(dim) {
  if (disposed || !RUBIXOIDS_VIEWS[dim] || dim === dimension) return;
  const previous = current();
  const next = await getInstance(dim);
  if (disposed) return;
  busy = true;
  syncChrome();
  let transport = previous?.bridge.capture() ?? { playing: false, audioOn: false };
  preservePresetPosition(previous);
  try {
    clearMidiOutputMonitor(previous);
    if (previous) previous.pane.inert = true;
    if (previous) {
      rubixoidsClock.detach(previous.dimension);
      transport = await previous.bridge.deactivate();
    }
    collect(previous);
    preservePresetPosition(previous);
    if (previous) {
      previous.pane.hidden = true;
      previous.pane.removeAttribute('data-active-instrument-root');
    }
    const pending = Object.fromEntries(Object.entries(shared).filter(([key]) => (next.applied[key] ?? 0) < versions[key]));
    await next.bridge.applySettings({ ...nativeParameterPatch(dim, pending),
      tempo: rubixoidsClock.tempo, swing: rubixoidsClock.swing });
    for (const key of Object.keys(pending)) next.applied[key] = versions[key];
    next.pane.hidden = false;
    next.pane.setAttribute('data-active-instrument-root', '');
    dimension = dim;
    await next.bridge.activate({ audioOn: transport.audioOn, playing: transport.playing });
    next.pane.inert = false;
    next.baseline = next.bridge.capture().settings;
    installPresets(next);
    installMidiOutputPreview(next);
    installMidi(next);
    shell.dataset.dimension = dim;
    for (const button of document.querySelectorAll('.rubixoids-dimensions button')) {
      button.setAttribute('aria-pressed', String(button.dataset.dimension === dim));
    }
    const url = new URL(location.href);
    url.searchParams.set('dimension', dim);
    history.replaceState(null, '', url);
    status.textContent = '';
  } catch (error) {
    // Do not strand the player on an inert view after a failed engine resume.
    // Park any partially activated destination before restoring the source.
    await next.bridge.deactivate().catch(() => {});
    clearMidiOutputMonitor(next);
    next.pane.inert = true;
    next.pane.hidden = true;
    next.pane.removeAttribute('data-active-instrument-root');
    dimension = previous?.dimension ?? null;
    shell.dataset.dimension = dimension ?? '';
    for (const button of document.querySelectorAll('.rubixoids-dimensions button')) {
      button.setAttribute('aria-pressed', String(button.dataset.dimension === dimension));
    }
    if (previous) {
      previous.pane.hidden = false;
      previous.pane.setAttribute('data-active-instrument-root', '');
      installPresets(previous);
      installMidiOutputPreview(previous);
      installMidi(previous);
      try {
        await previous.bridge.activate({ audioOn: transport.audioOn, playing: transport.playing });
      } finally { previous.pane.inert = false; }
    }
    throw error;
  } finally { busy = false; syncChrome(); }
}

export function selectRubixoidsDimension(dim) {
  switching = switching.then(() => activateDimension(dim)).catch(error => {
    status.textContent = error.message;
    console.error(error);
  });
  return switching;
}
for (const button of document.querySelectorAll('.rubixoids-dimensions button')) {
  button.addEventListener('click', () => { void selectRubixoidsDimension(button.dataset.dimension); });
}
audioButton.addEventListener('click', () => { current()?.root.getElementById('audioButton').click(); queueChrome(); });
playButton.addEventListener('click', () => { current()?.root.getElementById('playButton').click(); queueChrome(); });
output.addEventListener('input', () => {
  const control = current()?.root.getElementById('output');
  if (!control) return;
  control.value = output.value;
  control.dispatchEvent(new Event('input', { bubbles: true }));
  syncChrome();
});

for (const [key, input] of [['tempo', tempo], ['swing', swing]]) {
  input.addEventListener('input', () => {
    const control = current()?.root.getElementById(key);
    if (!control || busy) return;
    control.value = input.value;
    control.dispatchEvent(new Event('input', { bubbles: true }));
    // Native handlers update synthesis settings and the shared clock together.
    syncChrome();
  });
}

export function rubixoidsInstrument(dim = dimension) { return instances.get(dim) ?? null; }
export function rubixoidsSnapshot() {
  collect(current());
  return {
    dimension, settings: { ...shared }, clock: rubixoidsClock.snapshot(),
    dimensions: Object.fromEntries([...instances].map(([dim, instance]) => {
      const value = instance.bridge.capture();
      return [dim, { ...value, contextState: value.diagnostics.contextState }];
    })),
  };
}
globalThis.__rubixoidsSnapshot = rubixoidsSnapshot;
window.addEventListener('pagehide', event => {
  disposed = true;
  rubixoidsClock.pause();
  rubixoidsClock.detach(dimension);
  clearMidiOutputMonitor();
  // Cached pages retain native state; final navigation uses native teardown.
  if (event.persisted) for (const { bridge } of instances.values()) void bridge.deactivate();
});
window.addEventListener('pageshow', event => {
  if (!event.persisted) return;
  disposed = false;
  const active = current();
  if (active) void active.bridge.activate().then(() => {
    if (disposed || current() !== active) return;
    installMidiOutputPreview(active);
    syncChrome();
  });
});
const requested = new URLSearchParams(location.search).get('dimension') ?? '3d';
void selectRubixoidsDimension(RUBIXOIDS_VIEWS[requested] ? requested : '3d');
