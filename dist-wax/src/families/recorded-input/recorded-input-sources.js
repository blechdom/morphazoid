import { RECORDED_INPUT_SOURCES, createRecordedInputCore, normalizeInputSource } from './recorded-input-core.js';

/** File and bundled-sample inputs for an instrument that already owns a mic path.
 * The host supplies the entry node the microphone source feeds, plus arming and
 * availability; this module never touches getUserMedia or output arming. */
export function createRecordedInput({ prepare, getContext, getTarget, isArmed, isAvailable, onActiveChange, onChange, onError, doc }) {
  const input = createRecordedInputCore({
    prepare, getContext, targets: () => [getTarget()], isArmed, isAvailable, onActiveChange, onChange, onError, doc,
    fileInputId: 'recordedFileInput',
  });
  return Object.assign(input, { mountBefore(reference) { reference?.parentNode?.insertBefore?.(input.element, reference); } });
}

/** Adds the Mic / File / Samples source select to an audio-input strip option set
 * without altering how the microphone path starts, stops or reports. `onLeave`
 * runs with the source being left, before anything is stopped. */
export function withRecordedInput(options, input, { onLeave } = {}) {
  const mic = () => input.source === 'mic';
  return {
    ...options,
    sources: RECORDED_INPUT_SOURCES, sourceValue: input.source, fileInput: input.fileInput,
    onSourceChange: value => {
      const next = normalizeInputSource(value);
      if (next === input.source) return;
      onLeave?.(input.source);
      if (mic()) { try { Promise.resolve(options.onStop?.()).catch(() => {}); } catch { /* mic already stopped */ } }
      input.setSource(next);
    },
    getState: () => {
      input.reconcile();
      const base = options.getState?.() ?? {};
      if (mic()) return { ...base, source: 'mic' };
      const { playing, pending } = input.snapshot();
      return { ...base, active: playing, pending, source: input.source, error: input.error };
    },
    getSignal: () => {
      const base = options.getSignal?.() ?? {};
      return mic() ? base : { ...base, node: input.signal() ?? base.node, stream: null, channels: 2 };
    },
    onStart: () => (mic() ? options.onStart?.() : input.start()),
    onStop: () => { input.stop(); return mic() ? options.onStop?.() : undefined; },
  };
}
