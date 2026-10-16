import { mountAudioInputControl } from "./audio-input-control.js";
import { createInputSource, SAMPLE_INPUT_OPTIONS, MAX_INPUT_FILE_BYTES } from "./instruments/micmic/native/input-source.js";

export const RECORDER_SOURCES = Object.freeze([
  { value: "mic", label: "Mic" }, { value: "file", label: "File" }, { value: "samples", label: "Samples" },
]);
const FEATURED = ["music-vocal-scat", "music-vocal-phrase", "music-sax-multiphonic", "music-sax-fingerings", "music-tabla"];

export const sourceMode = value => (value === "file" || value === "samples" ? value : "mic");
export const nextIndex = (index, count) => (count > 0 ? (index + 1) % count : 0);

export function sampleChoices(options = SAMPLE_INPUT_OPTIONS) {
  const featured = FEATURED.map(id => options.find(option => option.id === id)).filter(Boolean);
  return [...featured, ...options.filter(option => !featured.includes(option))];
}

export function checkInputFile(file) {
  if (!file || typeof file.arrayBuffer !== "function") return "Choose an audio file.";
  if (!(file.size > 0) || file.size > MAX_INPUT_FILE_BYTES) return "Choose a nonempty audio file smaller than 64 MiB.";
  return "";
}

export function recorderStatus({ mode, snapshot, pendingFile = "" }) {
  if (mode === "mic") return "";
  if (snapshot.pending) return "Loading…";
  if (snapshot.playing) return `${snapshot.label} · ${snapshot.loop ? "looping" : "once"}`;
  if (snapshot.ended) return "Finished. Press Play to hear it again.";
  if (mode === "file") return pendingFile || snapshot.hasFile ? `${pendingFile || snapshot.fileName} ready. Press Play or Record.` : "Choose an audio file with the upload button.";
  return "Ready. Press Play, or Record to capture this sample.";
}

/** Adds a Mic / File / Samples source to a loop recorder. File and samples play
 * into the same nodes the microphone feeds; only the mic toggle asks for the mic. */
export function mountRecorderInput(inputOptions, {
  getContext, prepare, targets, canPlay = () => true,
  onSourceLeave = () => {}, onSourceChange = () => {}, onError = () => {}, onChange = () => {},
}) {
  const { container, before } = inputOptions;
  const mic = { start: inputOptions.onStart, stop: inputOptions.onStop, getState: inputOptions.getState,
    getSignal: inputOptions.getSignal, onGainInput: inputOptions.onGainInput };
  const doc = container.ownerDocument, abort = new AbortController(), { signal } = abort;
  let mode = "mic", inputError = "", bridge = null, pendingFile = null, autoStarted = false, destroyed = false, control, player;
  if (!doc.querySelector("link[data-recorder-input-styles]")) {
    const link = doc.createElement("link");
    link.rel = "stylesheet"; link.href = new URL("./recorder-input-sources.css", import.meta.url).href;
    link.setAttribute("data-recorder-input-styles", ""); doc.head.append(link);
  }
  const fileInput = doc.createElement("input");
  Object.assign(fileInput, { type: "file", accept: "audio/*" });
  const panel = doc.createElement("div");
  panel.className = "recorder-input-panel"; panel.hidden = true;
  panel.innerHTML = `<label class="recorder-input-sample">Sample
    <span class="recorder-input-choice"><select aria-label="Sample loop"></select>
    <button type="button" data-next aria-label="Next sample">›</button></span></label>
    <p class="recorder-input-file" data-file></p>
    <div class="recorder-input-transport"><button type="button" data-play aria-pressed="false">Play</button>
    <button type="button" data-stop>Stop</button><button type="button" data-loop aria-pressed="true">Loop</button></div>
    <p class="recorder-input-status" role="status"></p><a class="recorder-input-credit" target="_blank" rel="noopener" hidden></a>`;
  const q = selector => panel.querySelector(selector);
  const select = q("select"), choices = sampleChoices(), groups = new Map();
  for (const choice of choices) {
    const group = FEATURED.includes(choice.id) ? "Voices, sax & tabla" : choice.group;
    if (!groups.has(group)) {
      const element = doc.createElement("optgroup"); element.label = group; select.append(element); groups.set(group, element);
    }
    const element = doc.createElement("option"); element.value = choice.id; element.textContent = choice.label; groups.get(group).append(element);
  }
  const fail = error => { inputError = error?.message || String(error); onError(error); control?.refresh(); };
  const ensureBridge = () => {
    const context = getContext();
    if (!context || context.state === "closed") return;
    if (!bridge || bridge.context !== context) {
      bridge?.disconnect(); bridge = context.createGain();
      bridge.gain.value = Number(control.gainInput.value);
    }
    for (const target of targets()) if (target) bridge.connect(target);
  };
  const render = () => {
    if (destroyed || !player) return;
    const snapshot = player.snapshot();
    panel.hidden = mode === "mic";
    panel.dataset.mode = mode;
    q(".recorder-input-sample").hidden = mode !== "samples";
    q("[data-file]").hidden = mode !== "file";
    q("[data-file]").textContent = pendingFile?.name || (snapshot.hasFile ? snapshot.fileName : "No file chosen");
    select.value = snapshot.sampleId;
    q("[data-play]").setAttribute("aria-pressed", String(snapshot.playing));
    q("[data-play]").textContent = snapshot.playing ? (mode === "file" ? "Restart file" : "Restart sample") : (mode === "file" ? "Play file" : "Play sample");
    q("[data-play]").disabled = snapshot.pending;
    q("[data-stop]").disabled = !snapshot.playing && !snapshot.pending;
    q("[data-loop]").setAttribute("aria-pressed", String(snapshot.loop));
    q(".recorder-input-status").textContent = inputError || recorderStatus({ mode, snapshot, pendingFile: pendingFile?.name });
    const credit = q(".recorder-input-credit");
    credit.hidden = !snapshot.credit; credit.textContent = snapshot.credit; credit.href = snapshot.creditUrl || "#";
    control?.refresh(); onChange(snapshot);
  };
  player = createInputSource({
    prepare: async () => { await prepare(); ensureBridge(); },
    getContext, getTarget: () => bridge, canPlay: () => !destroyed && canPlay(), onChange: render, onError: fail,
  });
  const startRecorded = async () => {
    inputError = "";
    if (mode === "file" && pendingFile) { const file = pendingFile; pendingFile = null; return player.loadFile(file); }
    if (mode === "file" && !player.snapshot().hasFile) throw new Error("Choose an audio file first.");
    return player.start();
  };
  control = mountAudioInputControl({
    ...inputOptions, fileInput,
    sources: RECORDER_SOURCES, sourceValue: "mic",
    onStart: () => (mode === "mic" ? mic.start?.() : startRecorded()),
    onStop: () => { if (mode === "mic") return mic.stop?.(); player.stop(); return undefined; },
    onGainInput: value => mic.onGainInput?.(value),
    onSourceChange: value => {
      const next = sourceMode(value);
      if (next === mode) return;
      onSourceLeave(mode); autoStarted = false;
      if (mode === "mic") mic.stop?.(); else player.stop();
      mode = next; inputError = ""; player.selectMode(next); render(); onSourceChange(next);
    },
    getState: () => {
      if (mode === "mic") return { ...mic.getState?.(), source: "mic" };
      const snapshot = player.snapshot();
      return { active: snapshot.playing, pending: snapshot.pending, error: inputError, source: mode };
    },
    getSignal: () => (mode === "mic" ? mic.getSignal?.() : { node: bridge, channels: 2 }),
  });
  control.root.querySelector(".mz-input-file")?.setAttribute("aria-label", "Choose audio file");
  panel.querySelectorAll("button, select").forEach(element => { element.classList.add("recorder-input-control"); });
  container.insertBefore(panel, before ?? null);
  const on = (target, type, handler) => target.addEventListener(type, handler, { signal });
  const run = task => Promise.resolve(task).catch(fail);
  on(control.gainInput, "input", () => {
    if (bridge) bridge.gain.setTargetAtTime(Number(control.gainInput.value), bridge.context.currentTime, 0.015);
  });
  on(fileInput, "change", () => {
    const file = fileInput.files?.[0]; fileInput.value = "";
    if (!file) return;
    const problem = checkInputFile(file);
    if (problem) { fail(new Error(problem)); render(); return; }
    inputError = ""; player.stop(); pendingFile = file; render();
  });
  on(select, "change", () => {
    const active = player.snapshot().playing || player.snapshot().pending;
    player.selectSample(select.value);
    if (active) void run(player.start());
  });
  on(q("[data-next]"), "click", () => {
    select.selectedIndex = nextIndex(select.selectedIndex, choices.length);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  on(q("[data-play]"), "click", () => { player.stop(); void run(startRecorded()); });
  on(q("[data-stop]"), "click", () => player.stop());
  on(q("[data-loop]"), "click", () => player.setLoop(!player.snapshot().loop));
  const destroy = () => {
    if (destroyed) return;
    destroyed = true; abort.abort(); player.dispose();
    try { bridge?.disconnect(); } catch { /* context already closed */ }
    bridge = null; control.destroy(); panel.remove();
  };
  (doc.defaultView ?? globalThis).addEventListener?.("pagehide", event => { if (event.persisted) player.stop(); else destroy(); }, { signal });
  render();
  return {
    control, player, destroy, refresh: render,
    get source() { return mode; },
    get bridge() { return bridge; },
    stop: () => { autoStarted = false; player.stop(); },
    /** Record paths call this instead of starting the mic directly. */
    async acquireInput(startMic) {
      if (mode === "mic") return startMic();
      const was = player.snapshot().playing;
      if (!was) await startRecorded();
      if (!player.snapshot().playing) return false;
      autoStarted = !was; return true;
    },
    releaseInput(stopMic) {
      if (mode === "mic") { stopMic?.(); return; }
      if (autoStarted) { autoStarted = false; player.stop(); }
    },
  };
}
