import { connectAudioOutput } from "./audio-output-manager.js";

/**
 * Route local HTML media playback through the shared output without replacing
 * its native seeking, rate, loop, volume or mute behavior. Call resume from the
 * page's existing Audio/Play gesture; construction does not arm Audio.
 */
export function createMediaElementOutput(elements, { runtime = globalThis } = {}) {
  const media = [...new Set(elements)];
  const sources = new Map();
  let context = null;
  let mix = null;
  let releaseOutput = null;
  let closed = false;

  return {
    get context() { return context; },
    async resume() {
      if (closed) throw new Error("The media output is closed.");
      if (!context) {
        const AudioContextClass = runtime.AudioContext ?? runtime.webkitAudioContext;
        if (!AudioContextClass) throw new Error("Web Audio is unavailable in this browser.");
        context = new AudioContextClass({ latencyHint: "interactive" });
        mix = context.createGain();
        releaseOutput = connectAudioOutput(context, mix, { runtime });
      }
      for (const element of media) {
        if (sources.has(element)) continue;
        const source = context.createMediaElementSource(element);
        sources.set(element, source);
        source.connect(mix);
      }
      if (context.state === "suspended") await context.resume();
      return context;
    },
    async suspend() {
      if (context?.state === "running") await context.suspend();
    },
    async close() {
      if (closed) return;
      closed = true;
      releaseOutput?.();
      releaseOutput = null;
      for (const source of sources.values()) source.disconnect();
      sources.clear();
      mix?.disconnect();
      if (context && context.state !== "closed") await context.close();
    },
  };
}
