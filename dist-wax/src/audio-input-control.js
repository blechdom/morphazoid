import { createAudioInputStrip } from "./ui/patterns/audio-input-strip.js";
import { createAudioInputMeter } from "./audio-input-meter.js";

const MOBILE_INPUT_QUERY = "(max-width: 720px), (max-width: 960px) and (max-height: 560px) and (orientation: landscape)";
const NATIVE_PRESETS = {
  "graphs.html": "#graphPatchSelect", "morphynx.html": "#voicePresetSelect",
  "simd-resonator.html": "#presetSelect", "simd-lab.html": "#presetSelect",
  "gesturama.html": "#preset-select", "tape-worm.html": "#preset",
  "loop-soup.html": "#preset", "hollowphonic.html": "#preset",
};
const PRESET_BANKS = {
  "sandy-syrup-delay.html": "#presetGrid", "candy-coil-delay.html": "#presetGrid",
  "micromorph.html": "#presetGrid", "slippery-resynthesis.html": "#presetGrid",
  "throatazoid.html": "#presetButtons", "alien-larynx.html": "#presetButtons",
};

/** Reparent the existing controls; layout changes never invoke audio callbacks. */
function placeAudioInput(root, container, doc, runtime, enabled) {
  const header = doc.querySelector?.(".masthead");
  if (!enabled || !header || doc.body?.classList.contains("io-page") || !runtime.matchMedia) return () => {};
  const mobile = runtime.matchMedia(MOBILE_INPUT_QUERY);
  const route = runtime.location?.pathname?.split("/").at(-1);
  const originNext = root.nextSibling;
  let row = null;
  let preset = null;
  let disposed = false;
  const move = (parent, before = null) => {
    if (root.parentNode === parent && root.nextSibling === before) return;
    const focused = root.contains(doc.activeElement) ? doc.activeElement : null;
    if (parent.moveBefore && root.isConnected && parent.isConnected) parent.moveBefore(root, before);
    else parent.insertBefore(root, before);
    focused?.focus?.({ preventScroll: true });
  };
  const unwrap = () => {
    if (!row) return;
    preset?.classList.remove("mz-input-native-preset");
    if (preset?.parentNode === row) row.parentNode?.insertBefore(preset, row);
    row.remove(); row = preset = null;
  };
  const reconcile = () => {
    if (disposed) return;
    if (!mobile.matches) {
      const output = header.querySelector(".header-output-meter-shell");
      const anchor = output ?? header.querySelector(".audio-strip, .header-actions, .audio-toggle");
      if (!anchor) return;
      move(anchor.parentNode, anchor);
      unwrap();
      root.setAttribute("data-input-placement", "header");
      root.repositionError();
      return;
    }
    const full = doc.querySelector(".instrument-preset-controls");
    const native = NATIVE_PRESETS[route] && doc.querySelector(NATIVE_PRESETS[route]);
    const target = full ?? native?.closest("label") ?? native;
    if (target) {
      if (preset !== target) {
        // A preset controller may replace its row while the input remains live.
        move(container, originNext?.parentNode === container ? originNext : null);
        if (row?.contains(target)) row.parentNode?.insertBefore(target, row);
        unwrap();
        preset = target;
        row = doc.createElement("div");
        row.className = "mz-input-preset-row";
        target.parentNode.insertBefore(row, target);
        row.append(target);
        if (native && !full) target.classList.add("mz-input-native-preset");
      }
      move(row, target);
      root.setAttribute("data-input-placement", "preset");
    } else {
      const bank = PRESET_BANKS[route] && doc.querySelector(PRESET_BANKS[route]);
      const parent = bank?.parentNode ?? container;
      move(parent, bank ?? (originNext?.parentNode === container ? originNext : null));
      unwrap();
      root.setAttribute("data-input-placement", "controls");
    }
    root.repositionError();
  };
  const anchors = ".header-output-meter-shell, .header-io-controls, .instrument-preset-controls";
  const observer = runtime.MutationObserver && doc.body ? new runtime.MutationObserver(records => {
    if (records.some(record => [...record.addedNodes, ...record.removedNodes].some(node =>
      node.nodeType === 1 && (node.matches?.(anchors) || node.querySelector?.(anchors))))) reconcile();
  }) : null;
  observer?.observe(doc.body, { childList: true, subtree: true });
  mobile.addEventListener?.("change", reconcile);
  reconcile();
  return () => {
    disposed = true;
    observer?.disconnect();
    mobile.removeEventListener?.("change", reconcile);
    move(container, originNext?.parentNode === container ? originNext : null);
    unwrap();
    root.removeAttribute("data-input-placement");
  };
}

/** Bind the shared strip to an instrument's existing capture/file lifecycle. */
export function mountAudioInputControl(options = {}) {
  const container = options.container;
  const doc = container?.ownerDocument ?? globalThis.document;
  const runtime = options.runtime ?? doc?.defaultView ?? globalThis;
  if (!container) throw new TypeError("Audio input needs a control container");
  // Preserve the insertion point before adopted controls leave their old parent.
  const marker = doc.createElement("span");
  marker.hidden = true;
  container.insertBefore(marker, options.before ?? null);
  const root = createAudioInputStrip(options, doc);
  container.insertBefore(root, marker);
  marker.remove();
  for (const old of (options.hide ?? []).filter(Boolean)) {
    if (old !== root && !old.contains(root)) old.classList.add("mz-input-legacy");
  }
  const releasePlacement = placeAudioInput(root, container, doc, runtime, options.placement !== false);
  // Custom page themes also receive the shared control's foundations.
  if (!doc.querySelector('link[data-mz-input-styles]')) {
    const link = doc.createElement("link");
    link.rel = "stylesheet";
    link.href = new URL("./ui/index.css", import.meta.url).href;
    link.setAttribute("data-mz-input-styles", "");
    doc.head?.append(link);
  }
  let disposed = false;
  let requested = false;
  let pending = false;
  let generation = 0;
  let error = "";
  let meter = null;
  let frame = null;
  let previousPaint = -Infinity;
  const gains = new Set();
  const state = () => options.getState?.() ?? {};
  const readGain = () => Number(root.gainInput.value);
  const onGain = () => {
    const value = readGain();
    options.onGainInput?.(value);
    for (const node of gains) {
      if (node.context.state === "closed") { gains.delete(node); continue; }
      node.gain.setTargetAtTime(value, node.context.currentTime, 0.015);
    }
  };
  const releaseMeter = () => { meter?.destroy(); meter = null; };
  const refresh = () => {
    if (disposed) return;
    const current = state();
    const active = Boolean(current.active);
    const busy = Boolean((pending && !active) || current.pending);
    if (current.source !== undefined) root.setSource(current.source);
    else if (root.sourceSelect) root.setSource(root.sourceSelect.value);
    root.setInputState({ active, pending: busy, supported: current.supported !== false });
    root.setError(busy ? "" : current.error || error);
    const signal = active ? options.getSignal?.() : null;
    const node = signal?.node;
    const reported = signal?.stream?.getAudioTracks?.()[0]?.getSettings?.().channelCount;
    const channels = Number(signal?.channels ?? reported ?? current.channels ?? 1) === 2 ? 2 : 1;
    root.setChannels(channels);
    if (!node || node.context?.state === "closed" || !active) {
      releaseMeter();
      root.setLevels(active && signal?.levels ? signal.levels : { left: 0, right: 0 });
    }
    else {
      if (meter?.node !== node || meter?.channels !== channels) {
        releaseMeter();
        meter = createAudioInputMeter(node, { channels });
      }
      if (meter) root.setLevels(meter.read(signal.multiplier ?? options.gainMultiplier?.() ?? 1));
      else if (signal.levels) root.setLevels(signal.levels);
    }
  };
  const stop = async () => {
    generation += 1;
    requested = false;
    pending = false;
    error = "";
    releaseMeter();
    try { await options.onStop?.(); }
    catch (failure) { if (!disposed) error = failure?.message ?? String(failure); }
    refresh();
  };
  const start = async () => {
    const token = ++generation;
    requested = true;
    pending = true;
    error = "";
    refresh();
    try {
      await options.onStart?.();
      if (disposed || token !== generation || !requested) return;
    } catch (failure) {
      if (token === generation && !disposed) error = failure?.message ?? String(failure);
    } finally {
      if (token === generation) { pending = false; refresh(); }
    }
  };
  const toggle = () => {
    const current = state();
    if (current.supported === false) return;
    if (current.active || current.pending || pending) void stop();
    else void start();
  };
  const sourceChange = () => {
    generation += 1;
    requested = false;
    pending = false;
    releaseMeter();
    root.setSource(root.sourceSelect.value);
    error = "";
    options.onSourceChange?.(root.sourceSelect.value);
    refresh();
  };
  const hidden = () => {
    if (doc.hidden && root.getAttribute("data-input-source") !== "file" && (state().active || pending || state().pending)) void stop();
  };
  const animate = (time) => {
    if (disposed) return;
    if (!doc.hidden && time - previousPaint >= 33) { refresh(); previousPaint = time; }
    frame = runtime.requestAnimationFrame?.(animate) ?? null;
  };
  root.button.addEventListener("click", toggle);
  root.gainInput.addEventListener("input", onGain);
  root.sourceSelect?.addEventListener("change", sourceChange);
  doc.addEventListener("visibilitychange", hidden);
  const destroy = () => {
    if (disposed) return;
    void stop();
    disposed = true;
    if (frame !== null) runtime.cancelAnimationFrame?.(frame);
    releaseMeter();
    for (const node of gains) { try { node.disconnect(); } catch { /* owner already closed */ } }
    gains.clear();
    root.button.removeEventListener("click", toggle);
    root.gainInput.removeEventListener("input", onGain);
    root.sourceSelect?.removeEventListener("change", sourceChange);
    doc.removeEventListener("visibilitychange", hidden);
    runtime.removeEventListener?.("pagehide", pageHide);
    releasePlacement();
    root.destroy();
  };
  const pageHide = event => { if (event.persisted) void stop(); else destroy(); };
  runtime.addEventListener?.("pagehide", pageHide);
  refresh();
  frame = runtime.requestAnimationFrame?.(animate) ?? null;
  return {
    root, button: root.button, gainInput: root.gainInput, gainOutput: root.gainOutput,
    refresh, destroy,
    createGain(context) {
      let node;
      for (const gain of gains) {
        if (gain.context.state === "closed") gains.delete(gain);
        else if (gain.context === context) node = gain;
      }
      // One input route per context; mic toggles reconnect the same owned node.
      node ??= context.createGain();
      node.gain.cancelScheduledValues?.(context.currentTime);
      if (node.gain.setValueAtTime) node.gain.setValueAtTime(readGain(), context.currentTime);
      else node.gain.value = readGain();
      gains.add(node);
      return node;
    },
  };
}
