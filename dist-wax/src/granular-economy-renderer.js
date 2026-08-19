export const GRANULAR_ECONOMY_PITCH_CLASSES = 24;

const DEFAULT_MAX_VOICES = 48;
const MINIMUM_AUDIBLE_GAIN = 0.000001;

function clamp(value, low, high, fallback = low) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(high, Math.max(low, number)) : fallback;
}

function semitonesForVoice(voice) {
  return Math.round(
    12 * Math.log2(clamp(voice?.rate, 0.125, 8, 1)) * 100,
  ) / 100;
}

function pitchKey(semitones) {
  return Math.abs(semitones) < 0.005 ? "0" : semitones.toFixed(2);
}

/**
 * Maps an arbitrary L-system voice set onto 24 audible pitch classes, then
 * delegates every branch to L-system Delay's single raw-history granular worklet.
 *
 * Unlike a bank of pre-pitched delay histories, every branch reads the raw
 * microphone history at its current delay and rate. A pitch gesture therefore
 * cannot replay audio left behind by the previous pitch assigned to a lane.
 */
export class GranularEconomyRenderer {
  constructor(node, {
    maxPitchSources = GRANULAR_ECONOMY_PITCH_CLASSES,
    maxVoices = DEFAULT_MAX_VOICES,
    onPitchDetail = null,
  } = {}) {
    if (!node?.port?.postMessage) {
      throw new Error("The granular economy renderer requires an AudioWorklet node.");
    }
    this.node = node;
    this.maxPitchSources = Math.max(1, Math.min(
      GRANULAR_ECONOMY_PITCH_CLASSES,
      Math.round(clamp(
        maxPitchSources,
        1,
        GRANULAR_ECONOMY_PITCH_CLASSES,
        GRANULAR_ECONOMY_PITCH_CLASSES,
      )),
    ));
    this.maxVoices = Math.max(1, Math.min(
      1024,
      Math.round(clamp(maxVoices, 1, 1024, DEFAULT_MAX_VOICES)),
    ));
    this.onPitchDetail = typeof onPitchDetail === "function"
      ? onPitchDetail
      : null;
  }

  selectedPitchKeys(voices) {
    const power = new Map();
    for (const voice of voices) {
      if (voice.pitchKey === "0" || voice.gain <= MINIMUM_AUDIBLE_GAIN) continue;
      power.set(
        voice.pitchKey,
        (power.get(voice.pitchKey) ?? 0) + voice.gain ** 2,
      );
    }
    return [...power]
      .sort((first, second) => second[1] - first[1])
      .slice(0, this.maxPitchSources)
      .map(([key]) => key);
  }

  nearestPitchKey(semitones, availableKeys) {
    if (!availableKeys.length || Math.abs(semitones) < 0.005) return "0";
    return availableKeys.reduce((best, key) => (
      Math.abs(Number(key) - semitones) < Math.abs(Number(best) - semitones)
        ? key
        : best
    ), availableKeys[0]);
  }

  setVoices(voices, { requestedVoiceCount, voiceLimit } = {}) {
    const requestedLimit = Number(voiceLimit);
    const runtimeLimit = Number.isFinite(requestedLimit)
      ? Math.max(0, Math.min(this.maxVoices, Math.floor(requestedLimit)))
      : this.maxVoices;
    const desired = (Array.isArray(voices) ? voices : [])
      .slice(0, runtimeLimit)
      .map((voice) => {
        const semitones = semitonesForVoice(voice);
        return {
          voice,
          semitones,
          pitchKey: pitchKey(semitones),
          gain: clamp(voice?.gain, 0, 1, 0),
        };
      });
    const selectedKeys = this.selectedPitchKeys(desired);
    const selectedSet = new Set(selectedKeys);
    const mappedVoices = desired.map((candidate) => {
      const renderedKey = (
        candidate.pitchKey === "0"
        || selectedSet.has(candidate.pitchKey)
      )
        ? candidate.pitchKey
        : this.nearestPitchKey(candidate.semitones, selectedKeys);
      return {
        ...candidate.voice,
        rate: renderedKey === "0" ? 1 : 2 ** (Number(renderedKey) / 12),
      };
    });
    this.node.port.postMessage({
      type: "voices",
      voices: mappedVoices,
      requestedVoiceCount: Math.max(
        0,
        Math.floor(Number(requestedVoiceCount) || mappedVoices.length),
      ),
      voiceLimit: runtimeLimit,
    });

    const audibleVoices = desired.filter(
      (voice) => voice.gain > MINIMUM_AUDIBLE_GAIN,
    );
    const shiftedVoices = audibleVoices.filter(
      (voice) => voice.pitchKey !== "0",
    );
    const requestedShiftedKeys = new Set(
      shiftedVoices.map((voice) => voice.pitchKey),
    );
    const exactShiftedKeys = new Set(
      [...requestedShiftedKeys].filter((key) => selectedSet.has(key)),
    );
    const unisonVoices = audibleVoices.length - shiftedVoices.length;
    const report = Object.freeze({
      pitchSourceLimit: this.maxPitchSources,
      requestedShiftedPitches: requestedShiftedKeys.size,
      exactShiftedPitches: exactShiftedKeys.size,
      mergedShiftedPitches: Math.max(
        0,
        requestedShiftedKeys.size - exactShiftedKeys.size,
      ),
      requestedPitchClasses: requestedShiftedKeys.size + (unisonVoices > 0 ? 1 : 0),
      renderedPitchClasses: exactShiftedKeys.size + (unisonVoices > 0 ? 1 : 0),
      unisonActive: unisonVoices > 0,
      unisonVoices,
      exactShiftedVoices: shiftedVoices.filter(
        (voice) => selectedSet.has(voice.pitchKey),
      ).length,
      mergedShiftedVoices: shiftedVoices.filter(
        (voice) => !selectedSet.has(voice.pitchKey),
      ).length,
    });
    try {
      this.onPitchDetail?.(report);
    } catch {
      // Pitch-detail presentation must never interrupt audio rendering.
    }
  }

  silence(voiceLimit = this.maxVoices) {
    this.setVoices([], { requestedVoiceCount: 0, voiceLimit });
  }
}
