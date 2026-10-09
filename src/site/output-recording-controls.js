import { getSharedAudioOutputManager } from "../audio-output-manager.js";
import { OutputRecorder, MAX_MEMORY_BYTES, MAX_FILE_BYTES, BYTES_PER_FRAME, WAV_HEADER_BYTES } from "../output-recorder.js";
import { createButton } from "../ui/primitives/button.js";

const controllers = new WeakMap();
const MODE_KEY = "morphazoid.output-recording-mode.v1";

export function recordingTime(seconds = 0) {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function recordingFilename(instrument = "instrument", date = new Date()) {
  const pad = value => String(value).padStart(2, "0");
  return `morphazoid-${instrument}-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}.wav`;
}

export function safeRecordingFilename(value) {
  const name = String(value).replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, "-")
    .replace(/\.wav$/i, "").replace(/^[.\s]+|[.\s]+$/g, "").slice(0, 160);
  return `${name || "morphazoid-recording"}.wav`;
}

function element(doc, tag, className, text) {
  const node = doc.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const pickerOptions = name => ({
  suggestedName: name,
  types: [{ description: "Stereo WAV audio", accept: { "audio/wav": [".wav"] } }],
});

/** Site-owned recording lifecycle; shared UI primitives never own audio. */
export function initializeOutputRecording(doc = globalThis.document, runtime = globalThis, { routeId } = {}) {
  if (!doc?.body || !routeId || runtime.MorphazoidWAX) return null;
  if (controllers.has(doc)) return controllers.get(doc);
  const hosts = [...doc.querySelectorAll(".masthead")].map(header => {
    const existing = header.querySelector(".header-io-controls");
    if (existing) return existing;
    // Some owners create Audio after navigation, inside a stable host. Group
    // that host with the already-mounted meters/settings without cloning it.
    const host = element(doc, "div", "header-io-controls");
    host.setAttribute("role", "group");
    host.setAttribute("aria-label", "Audio and settings controls");
    for (const selector of [".header-output-meter-shell", "#audioHost, .audio-strip", ".header-settings-menu"]) {
      const control = header.querySelector(selector);
      if (control) host.append(control);
    }
    header.append(host);
    return host;
  });
  if (!hosts.length) return null;
  const manager = getSharedAudioOutputManager(runtime);
  const recorder = new OutputRecorder({ manager, runtime });
  const supported = typeof runtime.AudioWorkletNode === "function"
    && typeof (runtime.AudioContext ?? runtime.webkitAudioContext) === "function"
    && runtime.isSecureContext !== false;
  const canPick = typeof runtime.showSaveFilePicker === "function";
  let mode = "memory";
  try { if (canPick && runtime.localStorage?.getItem(MODE_KEY) === "file") mode = "file"; } catch { /* Optional preference. */ }
  let status = recorder.getStatus();
  let picking = false;
  let saving = false;
  let savedConfirmed = false;
  let destroyed = false;
  let lastState = status.state;
  let wakeLock = null;
  let wakeLockPending = false;
  let localMessage = "";
  const strips = [];
  const options = [];
  const objectUrls = new Set();

  function abortFile(writable) {
    try { Promise.resolve(writable?.abort?.()).catch(() => {}); } catch { /* Best effort, including a stalled disk. */ }
  }
  async function fileOperation(operation, onLateResult = () => {}) {
    let settled = false;
    let timer;
    const timeout = new Promise((resolve, reject) => {
      timer = runtime.setTimeout(() => reject(new Error("Saving the recording file timed out")), 15_000);
    });
    const result = Promise.resolve().then(operation).then(value => {
      if (settled) onLateResult(value);
      return value;
    });
    try { return await Promise.race([result, timeout]); }
    finally { settled = true; runtime.clearTimeout(timer); }
  }

  function audioArmed() {
    const buttons = [...doc.querySelectorAll(".masthead .audio-button, .masthead .audio-toggle")];
    // Audition-only pages have no Audio switch; their existing explicit Play
    // gesture creates the registered output, which is sufficient there.
    return !buttons.length || buttons.some(button => button.getAttribute("aria-pressed") === "true");
  }

  const dialog = element(doc, "dialog", "output-recording-dialog");
  dialog.setAttribute("aria-labelledby", "outputRecordingTitle");
  const heading = element(doc, "h2", "", "Recording");
  heading.id = "outputRecordingTitle";
  const summary = element(doc, "p", "output-recording-summary");
  const message = element(doc, "p", "output-recording-message");
  message.setAttribute("role", "status");
  const nameLabel = element(doc, "label", "output-recording-name-label", "Filename");
  const name = element(doc, "input", "output-recording-name");
  name.id = "outputRecordingName";
  name.type = "text";
  name.maxLength = 180;
  name.autocomplete = "off";
  nameLabel.htmlFor = name.id;
  const actions = element(doc, "div", "output-recording-actions");
  const save = createButton({ label: "Save WAV", variant: "primary" }, doc);
  const download = createButton({ label: "Download WAV" }, doc);
  const next = createButton({ label: "New recording" }, doc);
  const keep = createButton({ label: "Keep for later", variant: "quiet" }, doc);
  actions.append(save, download, next, keep);
  dialog.append(heading, summary, message, nameLabel, name, actions);
  doc.body.append(dialog);

  function showDialog() {
    if (destroyed || dialog.open) return;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }
  function closeDialog() {
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  }
  function report(error) {
    localMessage = error?.message || String(error);
    render();
    showDialog();
  }
  function releaseWakeLock() {
    const lock = wakeLock;
    wakeLock = null;
    lock?.release?.().catch(() => {});
  }
  async function requestWakeLock() {
    if (wakeLock || wakeLockPending || doc.hidden || status.state !== "recording") return;
    wakeLockPending = true;
    try {
      const lock = await runtime.navigator?.wakeLock?.request("screen");
      if (lock && !destroyed && status.state === "recording" && !doc.hidden) {
        wakeLock = lock;
        lock.addEventListener("release", () => { if (wakeLock === lock) wakeLock = null; }, { once: true });
      } else await lock?.release?.();
    } catch { /* Recording still works when a screen wake lock is unavailable. */ }
    finally { wakeLockPending = false; }
  }
  function limitSeconds() {
    return Math.floor(((mode === "file" ? MAX_FILE_BYTES : MAX_MEMORY_BYTES) - WAV_HEADER_BYTES)
      / BYTES_PER_FRAME / manager.recordingSampleRate());
  }
  function resultMessage() {
    if (status.error) return `${status.error}${status.blob ? " The captured audio is available to save." : status.saved ? ` The captured portion was saved to ${status.filename}.` : ""}`;
    if (status.reason === "buffer-limit") return "The buffered take reached its limit. Save this take; choose Record to file in Settings for longer sessions.";
    if (status.reason === "file-limit") return "This take reached the WAV file size limit. Start another recording to continue.";
    if (status.reason === "backpressure") return "Recording stopped because audio could not be saved fast enough. The captured portion is available.";
    if (status.reason === "interrupted") return "Recording was interrupted. Save the captured portion before starting again.";
    return status.saved ? `Saved ${status.filename}.` : "Your take stays here until you save it or start a new recording.";
  }
  function render() {
    const busy = picking || saving || ["starting", "stopping"].includes(status.state);
    const active = status.state === "recording";
    const ready = status.state === "ready";
    for (const { button, clock, strip } of strips) {
      button.disabled = busy || (!active && !ready && (!supported || !manager.canRecord() || !audioArmed()));
      button.setAttribute("aria-label", active ? "Stop recording" : ready ? "Save recording" : "Record stereo output");
      button.setAttribute("aria-pressed", String(active));
      button.dataset.recordingState = busy ? "busy" : status.state;
      button.title = !supported ? "Stereo recording needs a browser with AudioWorklet support."
        : active ? "Stop recording stereo WAV"
        : ready ? "Open your recording"
        : !manager.canRecord() || !audioArmed() ? "Turn Audio on before recording"
        : `Record stereo WAV · up to ${recordingTime(limitSeconds())} · ${mode === "file" ? "choose a file first" : "save after Stop"}`;
      clock.hidden = !active && !["starting", "stopping"].includes(status.state);
      clock.textContent = recordingTime(status.seconds);
      clock.title = `Recorded ${recordingTime(status.seconds)} of ${recordingTime(status.maxSeconds || limitSeconds())}`;
      strip.classList.toggle("is-recording", active);
    }
    for (const { select, help } of options) {
      select.value = mode;
      select.disabled = busy || active || ready;
      help.textContent = `Stereo 24-bit WAV · up to ${recordingTime(limitSeconds())} per take at ${manager.recordingSampleRate() / 1000} kHz. ${mode === "file" ? "Choose a destination before recording; the file is finalized on Stop." : "Record immediately, then name and save after Stop."} Turn Audio on first.`;
    }
    heading.textContent = status.error ? "Recording interrupted"
      : ready ? status.saved || savedConfirmed ? "Recording saved" : "Recording ready" : "Recording";
    summary.textContent = ready ? `${recordingTime(status.seconds)} · stereo · 24-bit WAV · ${status.sampleRate / 1000} kHz` : "Record the instrument’s main stereo output.";
    message.textContent = localMessage || (ready || status.state === "error" ? resultMessage() : "");
    message.hidden = !message.textContent;
    name.hidden = nameLabel.hidden = !status.blob;
    save.hidden = !status.blob;
    save.disabled = saving;
    download.hidden = !status.blob || !canPick;
    download.disabled = saving;
    name.disabled = saving;
    next.hidden = !ready && status.state !== "error";
    next.disabled = busy;
    keep.disabled = saving;
    keep.labelElement.textContent = ready ? "Keep for later" : "Close";
    if (active) requestWakeLock();
    else releaseWakeLock();
  }
  async function toggle() {
    if (picking || saving || ["starting", "stopping"].includes(status.state)) return;
    if (status.state === "recording") { await recorder.stop(); return; }
    if (status.state === "ready") { showDialog(); return; }
    localMessage = "";
    savedConfirmed = false;
    const filename = recordingFilename(routeId);
    let writable;
    try {
      if (!manager.canRecord() || !audioArmed()) throw new Error("Turn Audio on before recording.");
      if (mode === "file") {
        picking = true;
        render();
        // Must be called in the click gesture, before any other await.
        const handle = await runtime.showSaveFilePicker(pickerOptions(filename));
        if (destroyed) return;
        writable = await fileOperation(() => handle.createWritable(), abortFile);
        if (destroyed) { abortFile(writable); return; }
        await recorder.start({ filename: handle.name || filename, writable });
      } else await recorder.start({ filename });
    } catch (error) {
      if (error.name !== "AbortError") report(error);
    } finally { picking = false; render(); }
  }
  async function saveTake() {
    if (!status.blob || saving) return;
    const filename = safeRecordingFilename(name.value);
    name.value = filename;
    saving = true;
    localMessage = "";
    render();
    let writable;
    try {
      if (canPick) {
        const handle = await runtime.showSaveFilePicker(pickerOptions(filename));
        if (destroyed) return;
        writable = await fileOperation(() => handle.createWritable(), abortFile);
        if (destroyed) { abortFile(writable); return; }
        await fileOperation(() => writable.write(status.blob));
        await fileOperation(() => writable.close());
        savedConfirmed = true;
        localMessage = `Saved ${handle.name || filename}.`;
      } else {
        downloadBlob(filename);
      }
    } catch (error) {
      abortFile(writable);
      if (["NotAllowedError", "SecurityError"].includes(error.name)) {
        localMessage = "The browser did not allow writing to this file. Choose another name or folder, or use Download WAV. Your take is still available.";
      } else if (error.name !== "AbortError") {
        localMessage = `Could not save: ${error.message}. Use Download WAV or choose another file. Your take is still available.`;
      }
    } finally { saving = false; render(); }
  }
  function downloadBlob(filename) {
    const url = runtime.URL.createObjectURL(status.blob);
    objectUrls.add(url);
    const link = element(doc, "a", "");
    link.href = url;
    link.download = filename;
    doc.body.append(link);
    link.click();
    link.remove();
    // A picker can exist in an embedded browser without permission to write.
    // This separate click uses the download mechanism with fresh activation.
    // A download does not confirm saving; retain the take and its existing guard.
    localMessage = "Download started. Your take stays here until you start a new recording.";
    runtime.setTimeout(() => { runtime.URL.revokeObjectURL(url); objectUrls.delete(url); }, 60_000);
  }
  function downloadTake() {
    if (!status.blob || saving || destroyed) return;
    name.value = safeRecordingFilename(name.value);
    try { downloadBlob(name.value); }
    catch (error) { localMessage = `Could not download: ${error.message}. Your take is still available.`; }
    render();
  }
  function newTake() {
    if (status.blob && !savedConfirmed && !runtime.confirm("Start a new recording and discard this take? Save it first if you want to keep it.")) return;
    recorder.discard();
    savedConfirmed = false;
    localMessage = "";
    closeDialog();
    render();
  }

  for (const [index, host] of hosts.entries()) {
    const strip = element(doc, "div", "output-recording-control");
    const button = createButton({ label: "Record", ariaLabel: "Record stereo output", className: "output-recording-button", variant: "danger", icon: "" }, doc);
    const clock = element(doc, "output", "output-recording-clock", "00:00");
    clock.setAttribute("aria-label", "Recording duration");
    clock.setAttribute("aria-live", "off");
    strip.append(clock, button);
    const meters = host.querySelector(":scope > .header-output-meter-shell, :scope > .mz-stereo-meter");
    host.insertBefore(strip, meters ?? host.firstChild);
    button.addEventListener("click", toggle);
    strips.push({ host, strip, button, clock });
    const panel = host.querySelector(".header-settings-panel");
    if (panel) {
      const section = element(doc, "section", "output-recording-settings");
      const label = element(doc, "label", "", "Recording");
      const select = element(doc, "select", "output-recording-mode");
      select.id = `outputRecordingMode${index || ""}`;
      label.htmlFor = select.id;
      for (const [value, text] of [["memory", "Save after Stop"], ["file", "Record to file"]]) {
        const option = element(doc, "option", "", text);
        option.value = value;
        option.disabled = value === "file" && !canPick;
        select.append(option);
      }
      const help = element(doc, "p", "output-recording-help");
      help.id = `${select.id}Help`;
      select.setAttribute("aria-describedby", help.id);
      select.addEventListener("change", () => {
        mode = canPick && select.value === "file" ? "file" : "memory";
        try { runtime.localStorage?.setItem(MODE_KEY, mode); } catch { /* Optional preference. */ }
        render();
      });
      section.append(label, select, help);
      if (!canPick) section.append(element(doc, "p", "output-recording-help", "Direct file recording is unavailable in this browser. Use Save after Stop."));
      panel.append(section);
      options.push({ select, help });
    }
  }
  save.addEventListener("click", saveTake);
  download.addEventListener("click", downloadTake);
  next.addEventListener("click", newTake);
  keep.addEventListener("click", closeDialog);
  dialog.addEventListener("cancel", event => { if (saving) event.preventDefault(); });
  const unsubscribe = recorder.subscribe(nextStatus => {
    status = nextStatus;
    const showResult = ["ready", "error"].includes(status.state) && lastState !== status.state;
    if (status.state === "ready" && lastState !== "ready") {
      name.value = status.filename;
      localMessage = "";
      savedConfirmed = Boolean(status.saved);
    }
    lastState = status.state;
    render();
    if (showResult) {
      showDialog();
      if (status.blob) { name.focus(); name.select(); }
    }
  });
  let previousOutputKey;
  const unsubscribeOutput = manager.subscribe(() => {
    const key = `${manager.canRecord()}:${manager.recordingSampleRate()}`;
    if (key !== previousOutputKey) { previousOutputKey = key; render(); }
  });
  const protectTake = event => {
    if (picking || saving || ["starting", "recording", "stopping"].includes(status.state)
      || (status.blob && !savedConfirmed)) {
      event.preventDefault();
      event.returnValue = "";
    }
  };
  const visibility = () => requestWakeLock();
  const audioObserver = runtime.MutationObserver ? new runtime.MutationObserver(records => {
    if (records.some(record => record.type === "childList" && hosts.includes(record.target))) {
      // Mic controls move into the header after startup and on resize. Keep
      // Record beside the output meters, after the independent input group.
      for (const { host, strip } of strips) {
        const meters = host.querySelector(":scope > .header-output-meter-shell, :scope > .mz-stereo-meter");
        if (meters && strip.nextElementSibling !== meters) {
          const focused = strip.contains(doc.activeElement) ? doc.activeElement : null;
          host.insertBefore(strip, meters);
          focused?.focus({ preventScroll: true });
        }
      }
    }
    if (records.some(record => record.type === "childList"
      ? [...record.addedNodes, ...record.removedNodes].some(node => node.matches?.(".audio-button, .audio-toggle")
        || node.querySelector?.(".audio-button, .audio-toggle"))
      : record.target.matches?.(".audio-button, .audio-toggle"))) render();
  }) : null;
  for (const host of hosts) audioObserver?.observe(host, {
    subtree: true, childList: true, attributes: true, attributeFilter: ["aria-pressed"],
  });
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    unsubscribe();
    unsubscribeOutput();
    recorder.destroy().catch(() => {});
    releaseWakeLock();
    runtime.removeEventListener("beforeunload", protectTake);
    runtime.removeEventListener("pagehide", pagehide);
    doc.removeEventListener("visibilitychange", visibility);
    audioObserver?.disconnect();
    for (const url of objectUrls) runtime.URL.revokeObjectURL(url);
    for (const { button, strip } of strips) { button.destroy(); strip.remove(); }
    for (const button of [save, download, next, keep]) button.destroy();
    for (const { select } of options) select.parentElement.remove();
    dialog.remove();
    controllers.delete(doc);
  };
  const pagehide = event => {
    if (event.persisted) recorder.stop("interrupted").catch(() => {});
    else destroy();
  };
  runtime.addEventListener("beforeunload", protectTake);
  runtime.addEventListener("pagehide", pagehide);
  doc.addEventListener("visibilitychange", visibility);
  const controller = Object.freeze({ recorder, destroy });
  controllers.set(doc, controller);
  render();
  return controller;
}
