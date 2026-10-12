import { OutputRecorder, MAX_MEMORY_BYTES } from "../../output-recorder.js";
import { spartialLayout } from "./spartial-audio.js";
import { buildSpartialTracks, createSpartialZip, saveSpartialFolder } from "./spartial-recording-export.js";

const active = state => ["starting", "recording", "stopping"].includes(state);
const time = seconds => `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;

/** One clock, one immutable physical patch, and both exports from the same take. */
export function mountSpartialRecording({ audio, getPatch, onLockChange, doc = document, runtime = globalThis }) {
  const $ = id => doc.getElementById(id);
  const row = $("multitrackControls");
  if (runtime.MorphazoidWAX) { row.hidden = true; return { locked: false, update() {}, stop() {}, destroy() {} }; }
  const button = $("multitrackRecord");
  const clock = $("multitrackTime");
  const hint = $("multitrackHint");
  const dialog = $("multitrackDialog");
  const summary = $("multitrackSummary");
  const message = $("multitrackMessage");
  const folder = $("multitrackFolder");
  const zip = $("multitrackZip");
  const wav = $("multitrackWav");
  const discard = $("multitrackDiscard");
  const supported = typeof runtime.AudioWorkletNode === "function" && runtime.isSecureContext !== false;
  folder.hidden = typeof runtime.showDirectoryPicker !== "function";
  let recorder = null, status = { state: "idle" }, metadata = null;
  let busy = false, destroyed = false, exported = false, lastState = "idle";
  let tracksPromise = null;
  const urls = new Map();
  const open = () => { if (!destroyed && !dialog.open) dialog.showModal(); };
  function update() {
    const locked = active(status.state);
    const ready = Boolean(status.blob);
    const patch = getPatch();
    const count = spartialLayout(patch.layoutId).speakers.length;
    const maxSeconds = (locked || ready) ? status.maxSeconds : Math.floor((MAX_MEMORY_BYTES - 68) / (count * 3)) / audio.recordingSampleRate();
    button.textContent = status.state === "starting" ? "Cancel recording" : status.state === "stopping" ? "Finishing…"
      : locked ? "Stop multitrack" : ready ? "Export multitrack" : "Record multitrack";
    button.setAttribute("aria-pressed", String(locked));
    button.dataset.state = status.state;
    button.disabled = !supported || status.state === "stopping" || busy || (!locked && !ready && !audio.canRecord());
    clock.textContent = time(status.seconds || 0);
    hint.textContent = !supported ? "Recording needs a browser with AudioWorklet support."
      : ready ? `${status.channelCount} tracks · 24-bit WAV · take ready`
      : locked ? `${status.channelCount} tracks · stops at ${time(maxSeconds)} · speaker setup locked`
      : !audio.canRecord() ? "Turn Audio on to record all speaker channels."
      : `${count} tracks · up to ${time(maxSeconds)} per take · folder / ZIP + multichannel WAV`;
    for (const control of [folder, zip, wav, discard]) control.disabled = busy || !ready;
    onLockChange?.(locked);
  }
  function changed(next) {
    status = next;
    update();
    if (next.state === "ready" && lastState !== "ready") {
      summary.textContent = `${next.channelCount} channels · ${time(next.seconds)} · ${next.sampleRate.toLocaleString()} Hz · 24-bit WAV`;
      $("multitrackChannelMap").textContent = metadata.speakers.map(speaker => `${speaker.channel}: ${speaker.label}${metadata.omitLfe && speaker.kind === "lfe" ? " (silent)" : ""}`).join(" · ");
      message.textContent = next.error || (next.reason === "buffer-limit"
        ? "The take reached its time limit. Both exports are ready."
        : "Save separate tracks together in a folder, or download one multichannel WAV. Both use the same channel order.");
      open();
    } else if (next.state === "error") {
      hint.textContent = next.error || "Recording could not start. Try again.";
    }
    lastState = next.state;
  }
  button.addEventListener("click", async () => {
    if (active(status.state)) { await recorder.stop(); return; }
    if (status.blob) { open(); return; }
    const patch = getPatch();
    const layout = spartialLayout(patch.layoutId);
    const createdAt = new Date();
    metadata = { ...patch, layoutName: layout.name, speakers: layout.speakers.map(speaker => ({ ...speaker })), createdAt,
      name: `spartial-${createdAt.toISOString().replace(/[:.]/g, "-")}` };
    exported = false; tracksPromise = null;
    void recorder?.destroy();
    recorder = new OutputRecorder({ manager: audio, channelCount: layout.speakers.length, runtime, onchange: changed });
    try { await recorder.start({ filename: `${metadata.name}.wav` }); }
    catch (error) { hint.textContent = error.message; }
  });
  function download(blob, filename) {
    const url = runtime.URL.createObjectURL(blob);
    const link = doc.createElement("a");
    link.href = url; link.download = filename; doc.body.append(link); link.click(); link.remove();
    const timer = runtime.setTimeout(() => { runtime.URL.revokeObjectURL(url); urls.delete(url); }, 60_000);
    urls.set(url, timer);
  }
  function tracks() {
    // Retain the capture, not a second complete set of stems, between exports.
    if (!tracksPromise) tracksPromise = buildSpartialTracks(status, metadata).catch(error => { tracksPromise = null; throw error; });
    return tracksPromise;
  }
  async function save(operation) {
    if (busy || !status.blob) return;
    busy = true; update(); message.textContent = "Preparing export…";
    try { await operation(); exported = true; }
    catch (error) { message.textContent = error.name === "AbortError" ? "Save cancelled. Your take is still available." : `Could not save: ${error.message}. Your take is still available.`; }
    finally { busy = false; tracksPromise = null; update(); }
  }
  folder.addEventListener("click", () => {
    if (busy || !status.blob) return;
    // The picker must begin in this click, before any encoding/await.
    let selection;
    try { selection = runtime.showDirectoryPicker({ mode: "readwrite", startIn: "music" }); }
    catch (error) { message.textContent = error.message; return; }
    void save(async () => {
      const directory = await selection;
      const take = await tracks();
      const name = await saveSpartialFolder(directory, take.files, take.name);
      message.textContent = `Saved tracks and channel map in ${name}.`;
    });
  });
  zip.addEventListener("click", () => void save(async () => {
    const take = await tracks();
    download(await createSpartialZip(take.files, take.name), `${take.name}.zip`);
    message.textContent = "Tracks ZIP download started. Extract it to get the take folder.";
  }));
  wav.addEventListener("click", () => void save(async () => {
    download(status.blob, `${metadata.name}-multichannel.wav`);
    message.textContent = "Multichannel WAV download started. Channels follow the numbered speaker patch; the tracks export includes a channel map.";
  }));
  discard.addEventListener("click", () => {
    if (busy) return;
    recorder.discard(); tracksPromise = null; metadata = null; exported = false; dialog.close();
  });
  $("multitrackClose").addEventListener("click", () => dialog.close());
  dialog.addEventListener("cancel", event => { if (busy) event.preventDefault(); });
  function beforeUnload(event) {
    if (active(status.state) || (status.blob && status.frames > 0 && !exported) || busy) { event.preventDefault(); event.returnValue = ""; }
  }
  runtime.addEventListener("beforeunload", beforeUnload);
  update();
  return {
    get locked() { return active(status.state); },
    update,
    stop(reason = "interrupted") { return recorder?.stop(reason); },
    destroy() {
      destroyed = true; runtime.removeEventListener("beforeunload", beforeUnload);
      for (const [url, timer] of urls) { runtime.clearTimeout(timer); runtime.URL.revokeObjectURL(url); }
      urls.clear(); tracksPromise = null; void recorder?.destroy();
    },
  };
}
