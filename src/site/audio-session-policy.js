const installed = new WeakSet();

export function needsAutomaticAudioSession(capability) {
  // Gesturama captures microphone samples but is not a live-input WAX effect.
  // Do not change that independent host/MIDI classification to set a policy.
  return !capability || capability.audioInput !== false || capability.id === "gesturama";
}

/**
 * Opt playback-only pages into the media session on an explicit Audio click.
 * Capture-capable/unknown pages retain browser-managed routing. In particular,
 * never force a microphone into a playback-only AVAudioSession category.
 * No AudioContext, media element, permission request or sound is created here.
 */
export function initializeAudioSessionPolicy(doc, runtime = globalThis, { audioInput = true } = {}) {
  if (!doc?.addEventListener || installed.has(doc)) return;
  installed.add(doc);
  doc.addEventListener("click", event => {
    if (audioInput || runtime.MorphazoidWAX) return;
    const button = event.target?.closest?.(".audio-button, .audio-toggle");
    if (!button || button.disabled) return;
    const state = button.getAttribute("data-audio-state");
    if (button.getAttribute("aria-pressed") === "true" && state !== "interrupted") return;
    try {
      const session = runtime.navigator?.audioSession;
      if (!session || !["auto", "ambient", "playback"].includes(session.type)) return;
      if (session.type !== "playback") session.type = "playback";
    } catch {
      // Unsupported or host-controlled session policies must not block Audio.
    }
  }, true);
}
