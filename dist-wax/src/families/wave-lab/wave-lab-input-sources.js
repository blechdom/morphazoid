import { mountProcessorSamplePlayer } from "../../processor-sample-player.js";

export const INPUT_SOURCE_OPTIONS = Object.freeze([
  { value: "mic", label: "Mic" },
  { value: "file", label: "File" },
  { value: "samples", label: "Samples" },
]);

export function normalizeInputSource(value) {
  return INPUT_SOURCE_OPTIONS.some((option) => option.value === value) ? value : "mic";
}

export function recordedSourceStatus(mode, snapshot, armed) {
  if (mode === "mic") return "";
  if (snapshot.pending) return mode === "file" ? "Loading file…" : "Loading sample…";
  if (mode === "file" && !snapshot.hasFile) return "Choose an audio file with the ↥ button.";
  if (!armed) return "Switch Audio on, then press Play.";
  if (snapshot.playing) return `${snapshot.label} · ${snapshot.loop ? "looping" : "once"}`;
  return snapshot.ended ? "Finished." : "Ready to play.";
}

function addStylesheet(doc, name) {
  if (doc.querySelector(`link[data-wave-lab-input="${name}"]`)) return;
  const link = doc.createElement("link");
  link.rel = "stylesheet";
  link.href = new URL(`../../${name}`, import.meta.url).href;
  link.setAttribute("data-wave-lab-input", name);
  doc.head?.append(link);
}

/** File and Samples play through the bounded input source into the same trim
 * node the microphone uses, so gain, meters, recording and the lab engine see
 * one input path. Nothing here ever requests the microphone or arms Audio. */
export function createWaveLabInputSources({ container, before = null, prepare, getContext, getTarget,
  isArmed, onChange = () => {}, onError = () => {} }) {
  const doc = container.ownerDocument;
  addStylesheet(doc, "processor-sample-player.css");
  addStylesheet(doc, "families/wave-lab/wave-lab-input-sources.css");
  const fileInput = doc.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "audio/*";
  fileInput.id = "waveLabFilePicker";
  fileInput.hidden = true;
  const panel = doc.createElement("div");
  panel.className = "wave-lab-input-sources";
  panel.hidden = true;
  container.insertBefore(panel, before);
  let mode = "mic";
  const paint = (snapshot) => {
    panel.dataset.mode = mode;
    const play = panel.querySelector("#samplePlay");
    const status = panel.querySelector("#sampleStatus");
    if (mode === "file") {
      if (play) play.textContent = snapshot.playing ? "Restart file" : "Play file";
      if (play) play.disabled = !isArmed() || snapshot.pending || !snapshot.hasFile;
      if (status) status.textContent = recordedSourceStatus(mode, snapshot, isArmed());
    }
    onChange(snapshot);
  };
  const player = mountProcessorSamplePlayer({
    container: panel, prepare, getContext, getTarget, isArmed,
    isSelected: () => mode !== "mic", onChange: paint, onError,
  });
  player.selectMode("mic");
  player.refresh();
  const onFile = () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file) return;
    mode = "file";
    void player.loadFile(file).catch(onError);
  };
  fileInput.addEventListener("change", onFile);
  return {
    fileInput,
    panel,
    sources: INPUT_SOURCE_OPTIONS,
    get mode() { return mode; },
    snapshot: () => player.snapshot(),
    selectMode(next) {
      mode = normalizeInputSource(next);
      player.selectMode(mode);
      player.refresh();
    },
    start: () => player.start(),
    stop: () => player.stop(),
    refresh: () => player.refresh(),
    destroy() {
      fileInput.removeEventListener("change", onFile);
      player.destroy();
      panel.remove();
    },
  };
}
