import { SAMPLE_INPUT_OPTIONS } from "../micmic/native/input-source.js";
import { loadProcessingDemo } from "../synthesis/demo-sources.js";
import { orderedSampleChoices } from "../micmic/native/recorded-input-player.js";

export const ACOUSTIC_INPUT_SOURCES = Object.freeze([
  { value: "mic", label: "Mic" },
  { value: "file", label: "File" },
  { value: "samples", label: "Samples" },
]);

export const SAMPLE_DECODE_RATE = 48_000;
export const MAX_SAMPLE_SECONDS = 60;

const MODES = new Set(ACOUSTIC_INPUT_SOURCES.map((entry) => entry.value));

export function normalizeInputMode(value) {
  return MODES.has(value) ? value : "mic";
}

export function acousticSampleChoices(options = SAMPLE_INPUT_OPTIONS) {
  return orderedSampleChoices(options);
}

export function nextSampleId(choices, currentId) {
  if (!choices.length) return null;
  const index = choices.findIndex((choice) => choice.id === currentId);
  return choices[(index + 1) % choices.length].id;
}

export function inputModeVisibility(mode) {
  const current = normalizeInputMode(mode);
  return {
    liveControls: current === "mic",
    fileLabel: current === "file",
    sampleRow: current === "samples",
  };
}

export function sampleOriginId(sampleId) {
  return `sample:${sampleId}`;
}

export function sampleSourceOrigin(choice, loaded = {}) {
  return {
    kind: "recording",
    id: sampleOriginId(choice.id),
    commonName: choice.label,
    attribution: String(loaded.credit || "Bundled recorded sample"),
    license: "Bundled with this site",
    sourceUrl: typeof loaded.creditUrl === "string" ? loaded.creditUrl : "",
    note: "Bundled sample · decoded at 48 kHz",
  };
}

export function boundedSampleChannel(samples, sampleRate, maxSeconds = MAX_SAMPLE_SECONDS) {
  const limit = Math.max(1, Math.floor(sampleRate * maxSeconds));
  return samples.length > limit ? samples.slice(0, limit) : samples;
}

export function sampleStatusText({ pending = false, playing = false, loop = true, label = "", error = "" } = {}) {
  if (error) return error;
  if (pending) return "Preparing sample…";
  if (playing) return `${label} · ${loop ? "looping" : "once"}`;
  return "Press Play to map and play the selected sample.";
}

function defaultCreateContext() {
  const Offline = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!Offline) throw new Error("This browser does not expose Web Audio decoding.");
  return new Offline(1, 1, SAMPLE_DECODE_RATE);
}

/** Decodes one bundled sample to a bounded mono Float32Array without arming output audio. */
export function createSampleLoader({
  createContext = defaultCreateContext,
  loadDemo = loadProcessingDemo,
  toMono,
  choices = acousticSampleChoices(),
  maxSeconds = MAX_SAMPLE_SECONDS,
} = {}) {
  if (typeof toMono !== "function") throw new TypeError("A mono channel selector is required.");
  return {
    choices,
    async load(id, { signal } = {}) {
      const choice = choices.find((entry) => entry.id === id);
      if (!choice) throw new RangeError("Choose a bundled recorded sample.");
      if (signal?.aborted) throw Object.assign(new Error("Sample load cancelled."), { name: "AbortError" });
      const context = createContext();
      const loaded = await loadDemo(context, id, { signal });
      if (signal?.aborted) throw Object.assign(new Error("Sample load cancelled."), { name: "AbortError" });
      const buffer = loaded.buffer;
      const samples = boundedSampleChannel(toMono(buffer), buffer.sampleRate, maxSeconds);
      if (!samples.length) throw new Error("The sample contains no audio.");
      return {
        samples,
        sampleRate: buffer.sampleRate,
        name: `${choice.label} · bundled sample`,
        origin: sampleSourceOrigin(choice, loaded),
        decodeMetadata: Object.freeze({
          label: "browser-decoded bundled sample",
          method: "web-audio",
          originalSampleRatePreserved: false,
          numberOfChannels: buffer.numberOfChannels,
          selectedChannelIndex: null,
        }),
      };
    },
  };
}

/** Shared by the app's strip callbacks, which run before the app's own state is declared. */
export const inputState = { mode: "mic", pending: false, error: "" };

let counter = 0;

/** Mode switch visibility plus the Samples row; analysis, routing and playback stay with the app. */
export function mountAcousticInput({
  container,
  liveControls = [],
  fileLabels = [],
  choices = acousticSampleChoices(),
  loopInput,
  playbackEvents,
  busyHost,
  getMode,
  isPlaying,
  isPending,
  onSelect,
  onPlay,
  onStop,
  onError = () => {},
}) {
  const doc = container.ownerDocument;
  const abort = new AbortController();
  const uid = `acoustic-sample-${++counter}`;
  container.classList.add("recorded-input", "acoustic-sample-input");
  container.innerHTML = `<label class="recorded-input__choice" for="${uid}-select">Sample
    <span><select id="${uid}-select" aria-label="Sample recording"></select>
    <button type="button" data-act="next" aria-label="Next sample">›</button></span></label>
    <div class="recorded-input__transport"><button type="button" data-act="play" aria-pressed="false">Play sample</button>
    <button type="button" data-act="stop" aria-label="Stop sample playback">Stop</button>
    <button type="button" data-act="loop" aria-pressed="true" aria-label="Loop playback">Loop</button></div>
    <p data-role="status" role="status"></p>`;
  const $ = (selector) => container.querySelector(selector);
  const select = $("select");
  const groups = new Map();
  for (const choice of choices) {
    if (!groups.has(choice.group)) {
      const group = doc.createElement("optgroup");
      group.label = choice.group;
      select.append(group);
      groups.set(choice.group, group);
    }
    const option = doc.createElement("option");
    option.value = choice.id;
    option.textContent = choice.label;
    groups.get(choice.group).append(option);
  }
  let error = "";
  const selected = () => choices.find((choice) => choice.id === select.value) ?? choices[0];
  const refresh = () => {
    const mode = normalizeInputMode(getMode());
    const visibility = inputModeVisibility(mode);
    container.hidden = !visibility.sampleRow;
    for (const element of liveControls) if (element) element.hidden = !visibility.liveControls;
    for (const element of fileLabels) if (element) element.hidden = !visibility.fileLabel;
    const playing = Boolean(isPlaying()), pending = Boolean(isPending());
    const play = $('[data-act="play"]');
    play.setAttribute("aria-pressed", String(playing));
    play.textContent = playing ? "Restart sample" : "Play sample";
    play.disabled = pending;
    $('[data-act="stop"]').disabled = !playing && !pending;
    $('[data-act="loop"]').setAttribute("aria-pressed", String(Boolean(loopInput.checked)));
    $('[data-role="status"]').textContent = sampleStatusText({
      pending, playing, loop: loopInput.checked, label: selected().label, error,
    });
  };
  const run = (task) => Promise.resolve(task).catch((failure) => {
    if (failure?.name === "AbortError") return;
    error = failure?.message || String(failure);
    refresh();
    onError(failure);
  });
  const listen = (node, type, handler) => node?.addEventListener(type, handler, { signal: abort.signal });
  listen(select, "change", () => { error = ""; refresh(); void run(onSelect(select.value)); });
  listen($('[data-act="next"]'), "click", () => {
    select.value = nextSampleId(choices, select.value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  listen($('[data-act="play"]'), "click", () => { error = ""; void run(onPlay(select.value)); });
  listen($('[data-act="stop"]'), "click", () => { void run(onStop()); });
  listen($('[data-act="loop"]'), "click", () => {
    loopInput.checked = !loopInput.checked;
    loopInput.dispatchEvent(new Event("change", { bubbles: true }));
  });
  listen(loopInput, "change", refresh);
  if (busyHost && typeof MutationObserver === "function") {
    const observer = new MutationObserver(refresh);
    observer.observe(busyHost, { attributes: true, attributeFilter: ["aria-busy"] });
    abort.signal.addEventListener("abort", () => observer.disconnect());
  }
  for (const type of ["play", "pause", "ended", "emptied"]) listen(playbackEvents, type, refresh);
  refresh();
  return {
    refresh,
    get sampleId() { return select.value; },
    destroy() {
      abort.abort();
      container.innerHTML = "";
    },
  };
}
