import { connectAudioOutput } from '../../audio-output-manager.js';
import { spartialLayout, spartialSpeakers } from '../spartial/spartial-audio.js';
import { outputModeFor, speakerPan } from '../surround-field/surround-field.js';

export const RESONATOR_SURROUND_LAYOUTS = Object.freeze(['4-ring', '8-circle', '16-ring', '4-1', '7-1', '7-4-1', '8-cube']);
const FADE_SECONDS = 0.025;
const disconnect = (node, target) => { try { target ? node?.disconnect(target) : node?.disconnect(); } catch { /* Already released. */ } };

function normalize(value = {}, previous = {}) {
  const layoutId = value.layoutId ?? previous.layoutId ?? '8-circle';
  return {
    enabled: Boolean(value.enabled ?? previous.enabled ?? false),
    layoutId: RESONATOR_SURROUND_LAYOUTS.includes(layoutId) ? layoutId : '8-circle',
    forcePreview: Boolean(value.forcePreview ?? previous.forcePreview ?? false),
  };
}

/** Route already-mastered stereo and sixteen logical spatial buses. This owns
 * only monitor nodes; physical recording taps never pass through monitor fades.
 * Logical buses follow SPARTIAL's azimuth order, omitting LFE without renumbering
 * physical outputs. The disabled path is the original stereo signal at unity.
 */
export function createResonatorSurroundOutput({
  context, stereoSource, spatialSource, getAudioOn = () => false, onRoute,
  settings = {}, runtime = globalThis,
}) {
  if (!context || !stereoSource || !spatialSource) throw new TypeError('Surround routing needs a context and both mastered sources.');
  let patch = normalize(settings), monitor = null, timer = null, disposed = false, locked = false;
  let info = null;
  const captures = new Set();
  const schedule = runtime.setTimeout?.bind(runtime) ?? setTimeout;
  const cancel = runtime.clearTimeout?.bind(runtime) ?? clearTimeout;
  const gainNode = (count, interpretation = 'discrete') => {
    const node = context.createGain();
    node.channelCount = count; node.channelCountMode = 'explicit'; node.channelInterpretation = interpretation;
    return node;
  };
  function ramp(node, value, seconds = FADE_SECONDS) {
    const now = context.currentTime, param = node.gain;
    if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(now);
    else { const held = param.value; param.cancelScheduledValues(now); param.setValueAtTime(held, now); }
    param.linearRampToValueAtTime(value, now + seconds);
  }
  function describe() {
    const layout = spartialLayout(patch.layoutId), speakers = spartialSpeakers(layout, true);
    const capacity = Math.max(1, context.destination.maxChannelCount || 2);
    const mode = patch.enabled ? outputModeFor(capacity, layout.speakers.length, patch.forcePreview) : 'stereo';
    return { ...patch, mode, capacity, layout, speakers, channelCount: layout.speakers.length, omitLfe: true };
  }
  function releaseMonitor(old) {
    if (!old) return;
    old.release();
    disconnect(old.source, old.entry);
    for (const node of old.nodes) disconnect(node);
  }
  function buildMonitor(level = 1) {
    const next = describe();
    // Initial stereo leaves the destination's original configuration untouched.
    // Returning from discrete surround restores ordinary stereo speaker mixing.
    if (next.enabled || info?.mode === 'discrete') {
      try {
        context.destination.channelCount = next.mode === 'discrete' ? next.channelCount : Math.min(2, next.capacity);
        context.destination.channelInterpretation = next.mode === 'discrete' ? 'discrete' : 'speakers';
      } catch {
        next.mode = next.enabled ? 'preview' : 'stereo';
        try { context.destination.channelCount = Math.min(2, next.capacity); context.destination.channelInterpretation = 'speakers'; } catch { /* Device owns its channel configuration. */ }
      }
    }
    const nodes = [], fades = [];
    let source, entry, output, stereo;
    if (!next.enabled) {
      output = gainNode(2, 'speakers'); output.gain.value = level;
      source = stereoSource; entry = output; stereo = output;
      source.connect(entry); nodes.push(output); fades.push(output);
    } else {
      const splitter = context.createChannelSplitter(16);
      const physical = context.createChannelMerger(next.channelCount);
      physical.channelInterpretation = 'discrete';
      const sum = gainNode(2, 'speakers'); sum.gain.value = 0.7;
      stereo = gainNode(2, 'speakers'); stereo.gain.value = level; sum.connect(stereo);
      source = spatialSource; entry = splitter; source.connect(entry);
      nodes.push(splitter, physical, sum, stereo); fades.push(stereo);
      next.speakers.forEach((speaker, index) => {
        splitter.connect(physical, index, speaker.channel - 1);
        const panner = context.createStereoPanner(); panner.pan.value = speakerPan(speaker);
        splitter.connect(panner, index); panner.connect(sum); nodes.push(panner);
      });
      if (next.mode === 'discrete') {
        output = gainNode(next.channelCount); output.gain.value = level; physical.connect(output);
        nodes.push(output); fades.push(output);
      } else output = stereo;
    }
    const release = connectAudioOutput(context, output, { runtime, stereoSource: stereo });
    const old = monitor;
    monitor = { source, entry, nodes, fades, release };
    // Attach the replacement first: ordinary stereo Record keeps the same
    // shared meter bus throughout a monitor/speaker-layout change.
    releaseMonitor(old);
    info = next;
    onRoute?.(snapshot());
  }
  function rebuild() {
    timer = null;
    if (disposed) return;
    buildMonitor(context.state === 'running' ? 0 : 1);
    if (context.state === 'running') for (const node of monitor.fades) ramp(node, 1);
  }
  function scheduleRebuild() {
    if (disposed) return;
    if (timer !== null) cancel(timer);
    if (!monitor || context.state !== 'running') { rebuild(); return; }
    for (const node of monitor.fades) ramp(node, 0);
    timer = schedule(rebuild, Math.ceil(FADE_SECONDS * 1000) + 10);
  }
  function snapshot() { return { ...info, ...patch, pending: timer !== null }; }
  function route(value) {
    if (disposed) return false;
    const next = normalize(value, patch);
    if ((locked || captures.size) && (next.enabled !== patch.enabled || next.layoutId !== patch.layoutId)) return false;
    if (next.enabled === patch.enabled && next.layoutId === patch.layoutId && next.forcePreview === patch.forcePreview) return true;
    patch = next; scheduleRebuild(); return true;
  }
  function canRecord() {
    return !disposed && patch.enabled && Boolean(getAudioOn()) && context.state === 'running'
      && info?.enabled === patch.enabled && info?.layoutId === patch.layoutId;
  }
  function tapInto(recordingContext, target, { onerror } = {}) {
    if (recordingContext !== context || !canRecord()) throw new Error('Enable Surround and Audio before recording channels.');
    const layout = spartialLayout(patch.layoutId), speakers = spartialSpeakers(layout, true);
    const splitter = context.createChannelSplitter(16), merger = context.createChannelMerger(layout.speakers.length);
    merger.channelInterpretation = 'discrete';
    let released = false;
    const capture = { onerror, release() {
      if (released) return;
      released = true; captures.delete(capture);
      disconnect(spatialSource, splitter); disconnect(splitter); disconnect(merger);
    } };
    try {
      for (const [index, speaker] of speakers.entries()) splitter.connect(merger, index, speaker.channel - 1);
      spatialSource.connect(splitter); merger.connect(target); captures.add(capture);
    } catch (error) { capture.release(); throw error; }
    return capture.release;
  }
  function destroy() {
    if (disposed) return;
    disposed = true; if (timer !== null) cancel(timer); timer = null;
    context.removeEventListener?.('sinkchange', scheduleRebuild);
    for (const capture of [...captures]) {
      try { capture.onerror?.(new Error('Audio closed. The captured part of the take is available.')); } catch { /* A recorder cannot prevent graph cleanup. */ }
      capture.release();
    }
    releaseMonitor(monitor); monitor = null;
  }
  context.addEventListener?.('sinkchange', scheduleRebuild);
  buildMonitor();
  return { route, snapshot, setLocked(value) { locked = Boolean(value); }, canRecord,
    recordingContext: () => canRecord() ? context : null, recordingSampleRate: () => context.sampleRate || 48000,
    tapInto, destroy };
}
