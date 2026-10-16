import { mountProcessorSamplePlayer } from "../../processor-sample-player.js";
import { createAudioInputMeter } from "../../audio-input-meter.js";
import { MAX_INPUT_FILE_BYTES } from "../../instruments/micmic/native/input-source.js";

export const RECORDED_INPUT_SOURCES = Object.freeze([
  { value: "mic", label: "Mic" },
  { value: "file", label: "File" },
  { value: "samples", label: "Samples" },
]);

export function normalizeInputSource(value) {
  return RECORDED_INPUT_SOURCES.some(source => source.value === value) ? value : "mic";
}

/** Returns an error message, or "" when the file may be offered to the bounded decoder. */
export function checkInputFile(file) {
  if (!file || typeof file.arrayBuffer !== "function") return "Choose an audio file.";
  if (!(file.size > 0)) return "Choose a nonempty audio file.";
  if (file.size > MAX_INPUT_FILE_BYTES) return "Choose an audio file smaller than 64 MiB.";
  const type = String(file.type ?? "");
  if (type && !/^audio\//i.test(type) && !/^(application|video)\/ogg$/i.test(type)) return "Choose an audio file.";
  return "";
}

/** Status line for the File source; Samples keeps the shared sample player's own wording. */
export function recordedFileStatus({ armed, state, pendingName = "" }) {
  if (state.pending) return "Loading file…";
  if (state.playing) return `${state.fileName || "File"} · ${state.loop ? "looping" : "once"}`;
  const name = state.hasFile ? state.fileName : pendingName;
  if (!name) return "Choose an audio file with the file button.";
  if (!armed) return `${name} · switch Audio on, then play.`;
  return state.ended ? "File finished." : "Ready to play.";
}

function ensureStyles(doc) {
  for (const [name, file] of [["processor-sample", "../../processor-sample-player.css"], ["recorded-input", "./recorded-input.css"]]) {
    if (doc.querySelector(`link[data-${name}-styles]`)) continue;
    const link = doc.createElement("link");
    link.rel = "stylesheet";
    link.href = new URL(file, import.meta.url).href;
    link.setAttribute(`data-${name}-styles`, "");
    doc.head?.append(link);
  }
}

/** Adds File and Samples to an existing audio-input strip. Recorded audio is
 * fed to the instrument's own microphone entry node, so the instrument owns
 * arming and the signal path; selecting a source never requests the microphone. */
export function mountRecordedInput({
  control, host, prepare, getContext, getTarget, isArmed,
  isEngaged = () => true, channels = () => 2, multiplier = () => Number(control.gainInput.value) || 1, meterNode = null,
  onSourceChange = () => {}, onLiveChange = () => {},
}) {
  const root = control.root;
  const doc = root.ownerDocument;
  const runtime = doc.defaultView ?? globalThis;
  ensureStyles(doc);
  const abort = new AbortController();
  const listen = (target, type, handler, options = {}) => target.addEventListener(type, handler, { ...options, signal: abort.signal });
  let source = "mic", pendingFile = null, error = "", destroyed = false, live = false, meter = null, player = null;

  const select = doc.createElement("select");
  select.className = "mz-input-source";
  select.setAttribute("aria-label", "Input source");
  for (const { value, label } of RECORDED_INPUT_SOURCES) {
    const option = doc.createElement("option");
    option.value = value;
    option.textContent = label;
    select.append(option);
  }
  const fileInput = doc.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "audio/*";
  fileInput.hidden = true;
  const fileButton = doc.createElement("button");
  fileButton.type = "button";
  fileButton.className = "mz-input-file";
  fileButton.setAttribute("aria-label", "Choose audio file");
  fileButton.title = "Choose audio file";
  fileButton.textContent = "↥";
  fileButton.hidden = true;
  root.append(select, fileInput, fileButton);

  const panel = doc.createElement("div");
  panel.className = "recorded-input-panel";
  panel.setAttribute("role", "group");
  panel.setAttribute("aria-label", "Recorded input");
  host.container.insertBefore(panel, host.before ?? null);

  const zero = Object.freeze({ left: 0, right: 0 });
  const releaseMeter = () => { meter?.destroy(); meter = null; };
  const readLevels = () => {
    if (!player?.snapshot().playing) { releaseMeter(); return zero; }
    const node = meterNode?.() ?? player.getSignal();
    if (!node || node.context?.state === "closed") { releaseMeter(); return zero; }
    if (meter?.node !== node) { releaseMeter(); meter = createAudioInputMeter(node, { channels: channels() }); }
    return meter?.read(multiplier()) ?? zero;
  };

  const restore = [];
  const override = (name, wrap) => {
    const original = root[name];
    Object.defineProperty(root, name, { configurable: true, enumerable: false, writable: true, value: wrap(original.bind(root)) });
    restore.push(() => Object.defineProperty(root, name, { configurable: true, enumerable: false, writable: false, value: original }));
  };
  const recorded = () => source !== "mic";
  override("setInputState", original => next => {
    if (!recorded()) return original(next);
    const state = player.snapshot();
    return original({ active: state.playing, pending: state.pending, supported: true });
  });
  override("setChannels", original => count => original(recorded() ? channels() : count));
  override("setError", original => message => original(recorded() ? error : message));
  override("setLevels", original => (left, right) => (recorded() ? original(readLevels()) : original(left, right)));

  const fail = failure => {
    error = failure?.message ?? String(failure);
    control.refresh();
  };
  const run = task => Promise.resolve(task).catch(fail);

  const decorate = state => {
    panel.dataset.recordedSource = source;
    if (source !== "file") return;
    const armed = Boolean(isArmed());
    const play = panel.querySelector("#samplePlay");
    play.textContent = state.playing ? "Restart file" : "Play file";
    play.disabled = !armed || state.pending || !(state.hasFile || pendingFile);
    panel.querySelector("#sampleStatus").textContent = recordedFileStatus({ armed, state, pendingName: pendingFile?.name ?? "" });
  };
  const changed = state => {
    if (destroyed) return;
    if (state.playing) error = "";
    decorate(state);
    if (state.playing !== live) { live = state.playing; onLiveChange(live, state); }
    control.refresh();
  };

  player = mountProcessorSamplePlayer({
    container: panel, prepare,
    getContext, getTarget,
    isArmed: () => !destroyed && Boolean(isArmed()),
    isSelected: () => source !== "mic",
    onChange: changed, onError: fail,
  });
  player.selectMode("mic");

  const play = async () => {
    if (!isArmed()) throw new Error("Switch Audio on before playing recorded input.");
    if (source === "file" && pendingFile) {
      const file = pendingFile;
      pendingFile = null;
      await player.loadFile(file);
    } else await player.start();
  };
  const toggle = () => {
    const state = player.snapshot();
    if (state.playing || state.pending) { player.stop(); return; }
    error = "";
    if (source === "file" && !state.hasFile && !pendingFile) { fileInput.click(); return; }
    void run(play());
  };

  function selectSource(value) {
    const next = normalizeInputSource(value);
    if (next === source) return;
    const previous = source;
    source = next;
    error = "";
    releaseMeter();
    player.selectMode(next);
    select.value = next;
    fileButton.hidden = next !== "file";
    root.setSource(next);
    onSourceChange(next, previous);
    decorate(player.snapshot());
    control.refresh();
  }

  listen(select, "change", () => selectSource(select.value));
  listen(fileButton, "click", () => fileInput.click());
  listen(fileInput, "change", () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file) return;
    const problem = checkInputFile(file);
    if (problem) { fail(new Error(problem)); return; }
    selectSource("file");
    error = "";
    if (isArmed()) { pendingFile = null; void run(player.loadFile(file)); }
    else { pendingFile = file; decorate(player.snapshot()); control.refresh(); }
  });
  listen(root, "click", event => {
    if (!recorded() || !event.target?.closest?.(".mz-input-toggle")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    toggle();
  }, { capture: true });
  listen(panel, "click", event => {
    if (source !== "file" || !pendingFile || !event.target?.closest?.("#samplePlay")) return;
    event.stopImmediatePropagation();
    void run(play());
  }, { capture: true });

  let wasArmed = Boolean(isArmed());
  const watcher = runtime.setInterval(() => {
    const armed = Boolean(isArmed());
    if (armed !== wasArmed) { wasArmed = armed; player.refresh(); }
    const state = player.snapshot();
    if ((state.playing || state.pending) && (!isArmed() || (state.playing && !isEngaged()))) player.stop();
  }, 200);
  watcher?.unref?.();

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    runtime.clearInterval(watcher);
    abort.abort();
    releaseMeter();
    player.destroy();
    for (const undo of restore) undo();
    select.remove(); fileInput.remove(); fileButton.remove(); panel.remove();
    pendingFile = null;
  }
  runtime.addEventListener?.("pagehide", event => { if (event.persisted) player.stop(); else destroy(); }, { signal: abort.signal });

  return {
    selectSource, destroy, stop: () => player.stop(),
    source: () => source, isLive: () => live, snapshot: () => player.snapshot(),
    signal: () => player.getSignal(),
  };
}
