import { OutputRecorder, MAX_FILE_BYTES, MAX_MEMORY_BYTES, wavFrameCapacity } from "../../output-recorder.js";
import { spartialLayout } from "./spartial-audio.js";
import { buildSpartialTracks, createSpartialZip, saveSpartialFolder } from "./spartial-recording-export.js";

const active = state => ["starting", "recording", "stopping"].includes(state);
const time = seconds => {
  const total = Math.max(0, Math.floor(seconds || 0));
  const minutes = Math.floor(total / 60);
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};
const pickerOptions = name => ({
  suggestedName: name,
  types: [{ description: "Multichannel WAV audio", accept: { "audio/wav": [".wav"] } }],
});
function abortWritable(writable) {
  try { Promise.resolve(writable?.abort?.()).catch(() => {}); } catch { /* Already closed or unavailable. */ }
}

/** One clock and one immutable physical patch, with buffered or direct-file capture. */
export function mountSpartialRecording({ audio, getPatch, onLockChange, doc = document, runtime = globalThis }) {
  return mountChannelRecording({ audio, getPatch, onLockChange, doc, runtime });
}

/** Shared by instruments with the same physical speaker patch and capture UI. */
export function mountChannelRecording({ audio, getPatch, onLockChange, doc = document, runtime = globalThis,
  instrumentName = 'SPARTIAL', namePrefix = 'spartial', labels = {}, Recorder = OutputRecorder }) {
  const $ = id => doc.getElementById(id);
  const row = $("multitrackControls");
  if (runtime.MorphazoidWAX) { row.hidden = true; return { locked: false, update() {}, stop() {}, destroy() {}, getStatus: () => ({ state: 'idle' }) }; }
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
  const fileOption = $("multitrackFileOption");
  const fileInput = $("multitrackToFile");
  const supported = typeof runtime.AudioWorkletNode === "function" && runtime.isSecureContext !== false;
  const canPick = supported && typeof runtime.showSaveFilePicker === "function";
  if (fileOption) fileOption.hidden = !canPick;
  let recorder = null, status = { state: "idle" }, metadata = null;
  let busy = false, picking = false, destroyed = false, exported = false, lastState = "idle", localError = "";
  let tracksPromise = null;
  const urls = new Map();
  const listeners = [];
  const listen = (target, event, handler) => { target.addEventListener(event, handler); listeners.push(() => target.removeEventListener(event, handler)); };
  const open = () => { if (!destroyed && !dialog.open) dialog.showModal(); };
  async function createWritable(handle) {
    if (typeof handle?.createWritable !== "function") throw new Error("The selected file does not support direct writing.");
    const schedule = (runtime.setTimeout ?? globalThis.setTimeout).bind(runtime);
    const cancel = (runtime.clearTimeout ?? globalThis.clearTimeout).bind(runtime);
    let settled = false, timer;
    const timeout = new Promise((resolve, reject) => {
      timer = schedule(() => reject(new Error("Opening the recording file timed out.")), 15_000);
    });
    const opening = Promise.resolve().then(() => handle.createWritable()).then(writable => {
      if (settled || destroyed) abortWritable(writable);
      return writable;
    });
    try {
      const writable = await Promise.race([opening, timeout]);
      if (typeof writable?.write !== "function" || typeof writable?.close !== "function") {
        abortWritable(writable);
        throw new Error("The selected file does not provide a writable stream.");
      }
      return writable;
    }
    finally { settled = true; cancel(timer); }
  }
  function update() {
    if (destroyed) return;
    const locked = picking || active(status.state);
    const ready = Boolean(status.blob || status.saved);
    const direct = (active(status.state) || ready) ? status.mode === "file" : canPick && Boolean(fileInput?.checked);
    const patch = getPatch();
    const count = spartialLayout(patch.layoutId).speakers.length;
    const maxSeconds = (active(status.state) || ready) && status.maxSeconds != null
      ? status.maxSeconds : wavFrameCapacity(direct ? MAX_FILE_BYTES : MAX_MEMORY_BYTES, count) / audio.recordingSampleRate();
    button.textContent = picking ? "Choosing file…" : status.state === "starting" ? "Cancel recording"
      : status.state === "stopping" ? "Finishing…" : active(status.state) ? labels.stop || "Stop multitrack"
        : status.saved ? "Saved multitrack" : ready ? labels.export || "Export multitrack" : labels.record || "Record multitrack";
    button.setAttribute("aria-pressed", String(active(status.state)));
    button.dataset.state = status.state;
    button.disabled = !supported || picking || status.state === "stopping" || busy || (!locked && !ready && !audio.canRecord());
    clock.textContent = time(status.seconds || 0);
    hint.textContent = !supported ? "Recording needs a browser with AudioWorklet support."
      : status.state === "error" ? status.error || "Recording could not start. Try again."
      : localError || (status.saved ? `${status.channelCount} tracks · saved to ${status.filename}`
      : ready ? `${status.channelCount} tracks · 24-bit WAV · take ready`
      : picking ? "Choose a WAV file before recording; speaker setup is locked."
      : active(status.state) ? `${status.channelCount} tracks · ${direct ? "writing to file" : "buffered"} · stops at ${time(maxSeconds)} · speaker setup locked`
      : !audio.canRecord() ? labels.unavailable || "Turn Audio on to record all speaker channels."
      : `${count} tracks · ${direct ? "direct to WAV file" : "buffered, folder / ZIP + WAV"} · up to ${time(maxSeconds)} at ${audio.recordingSampleRate().toLocaleString()} Hz`);
    if (fileInput) fileInput.disabled = !canPick || locked || ready || busy;
    folder.hidden = !status.blob || typeof runtime.showDirectoryPicker !== "function";
    zip.hidden = wav.hidden = Boolean(status.saved);
    discard.textContent = status.saved ? "New take" : "Discard take";
    for (const control of [folder, zip, wav, discard]) control.disabled = busy || !ready;
    onLockChange?.(locked);
  }
  function changed(next) {
    if (destroyed) return;
    status = next;
    update();
    if (next.state === "ready" && lastState !== "ready") {
      summary.textContent = `${next.channelCount} channels · ${time(next.seconds)} · ${next.sampleRate.toLocaleString()} Hz · 24-bit WAV`;
      $("multitrackChannelMap").textContent = metadata.speakers.map(speaker => `${speaker.channel}: ${speaker.label}${metadata.omitLfe && speaker.kind === "lfe" ? " (silent)" : ""}`).join(" · ");
      message.textContent = next.saved
        ? `${next.error ? `${next.error} Only the completed portion of ${next.filename} was saved.`
          : `${next.reason === "file-limit" ? "The WAV size limit was reached. " : ""}Saved ${next.filename} to the selected file.`} Choose New take to record again; the saved file stays on disk.`
        : next.error || (next.reason === "buffer-limit"
        ? "The buffered take reached its time limit. Both exports are ready."
        : "Save separate tracks together in a folder, or download one multichannel WAV. Both use the same channel order.");
      open();
    }
    lastState = next.state;
  }
  if (fileInput) listen(fileInput, "change", () => {
    localError = "";
    if (status.state === "error" && !status.blob && !status.saved) {
      recorder?.discard();
      metadata = null;
    }
    update();
  });
  listen(button, "click", async () => {
    if (picking || busy || destroyed) return;
    if (active(status.state)) { await recorder.stop(); return; }
    if (status.blob || status.saved) { open(); return; }
    if (!audio.canRecord()) { update(); return; }
    localError = "";
    // Musical controls may continue changing during a take. Capture plain
    // metadata now instead of retaining references to their mutable objects.
    const patch = JSON.parse(JSON.stringify(getPatch()));
    const layout = spartialLayout(patch.layoutId);
    const createdAt = new Date();
    metadata = { ...patch, instrumentName, namePrefix, layoutName: layout.name, speakers: layout.speakers.map(speaker => ({ ...speaker })), createdAt,
      name: `${namePrefix}-${createdAt.toISOString().replace(/[:.]/g, "-")}` };
    let filename = `${metadata.name}.wav`, writable, opened = false;
    if (canPick && fileInput?.checked) {
      picking = true; update();
      try {
        const handle = await runtime.showSaveFilePicker(pickerOptions(`${metadata.name}-multichannel.wav`));
        if (destroyed) return;
        writable = await createWritable(handle);
        if (destroyed) return;
        filename = handle.name || filename;
        if (!audio.canRecord()) throw new Error("Audio stopped before recording could start.");
        opened = true;
      } catch (error) {
        abortWritable(writable);
        metadata = null;
        if (error.name !== "AbortError") localError = `Could not open recording file: ${error.message} Choose another file or turn off direct recording.`;
        return;
      } finally { picking = false; if (!opened) update(); }
    }
    if (destroyed) { abortWritable(writable); return; }
    exported = false; tracksPromise = null;
    void recorder?.destroy();
    recorder = new Recorder({ manager: audio, channelCount: layout.speakers.length, runtime, onchange: changed });
    try { await recorder.start({ filename, writable }); }
    catch (error) { abortWritable(writable); if (!destroyed) { localError = error.message; update(); } }
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
  listen(folder, "click", () => {
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
  listen(zip, "click", () => void save(async () => {
    const take = await tracks();
    download(await createSpartialZip(take.files, take.name), `${take.name}.zip`);
    message.textContent = "Tracks ZIP download started. Extract it to get the take folder.";
  }));
  listen(wav, "click", () => void save(async () => {
    download(status.blob, `${metadata.name}-multichannel.wav`);
    message.textContent = "Multichannel WAV download started. Channels follow the numbered speaker patch; the tracks export includes a channel map.";
  }));
  listen(discard, "click", () => {
    if (busy) return;
    recorder.discard(); tracksPromise = null; metadata = null; exported = false; dialog.close();
  });
  listen($("multitrackClose"), "click", () => dialog.close());
  listen(dialog, "cancel", event => { if (busy) event.preventDefault(); });
  function beforeUnload(event) {
    if (picking || active(status.state) || (status.blob && status.frames > 0 && !exported) || busy) { event.preventDefault(); event.returnValue = ""; }
  }
  listen(runtime, "beforeunload", beforeUnload);
  update();
  return {
    get locked() { return picking || active(status.state); },
    getStatus() {
      const { blob, ...plain } = status;
      return { ...plain, hasTake: Boolean(blob || status.saved), metadata: metadata ? JSON.parse(JSON.stringify(metadata)) : null };
    },
    update,
    stop(reason = "interrupted") { return recorder?.stop(reason); },
    destroy() {
      if (destroyed) return;
      destroyed = true; for (const remove of listeners) remove();
      for (const [url, timer] of urls) { runtime.clearTimeout(timer); runtime.URL.revokeObjectURL(url); }
      urls.clear(); tracksPromise = null; void recorder?.destroy();
    },
  };
}
