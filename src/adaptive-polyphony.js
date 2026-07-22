const MODES = Object.freeze(["sine", "fm", "pm", "shepard"]);

export const ADAPTIVE_POLYPHONY_HARD_LIMITS = Object.freeze({
  sine: 4096,
  fm: 2048,
  pm: 2048,
  shepard: 512,
});

function finiteNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function integer(value, fallback = 0) {
  return Math.floor(finiteNumber(value, fallback));
}

function modeName(mode) {
  return MODES.includes(mode) ? mode : "sine";
}

function roundDown(value, quantum = 8) {
  const step = Math.max(1, integer(quantum, 8));
  return Math.floor(Math.max(0, value) / step) * step;
}

function roundUp(value, quantum = 8) {
  const step = Math.max(1, integer(quantum, 8));
  return Math.ceil(Math.max(0, value) / step) * step;
}

function boundedInteger(value, low, high) {
  return Math.min(high, Math.max(low, integer(value, low)));
}

function createProfile(initial, hardLimit) {
  const limit = Math.min(initial, hardLimit);
  return {
    limit,
    stableLimit: limit,
    hardLimit,
    demand: 0,
    activeVoices: 0,
    averageLoad: null,
    peakLoad: null,
    underrunRatio: 0,
    safeWindows: 0,
    highWindows: 0,
    cooldownWindows: 0,
    status: "warming",
    source: "pending",
  };
}

/**
 * Demand-driven polyphony calibration. It never generates probe tones: a mode
 * grows only when the current musical structure asks for more voices and the
 * audio renderer has sustained headroom.
 */
export class AdaptivePolyphonyController {
  constructor({
    initialVoices = 128,
    minVoices = 16,
    hardLimits = ADAPTIVE_POLYPHONY_HARD_LIMITS,
    growBelow = 0.45,
    growPeakBelow = 0.7,
    targetLoad = 0.55,
    shrinkAbove = 0.65,
    shrinkPeakAbove = 0.85,
    emergencyPeak = 1,
    growAfter = 3,
    shrinkAfter = 2,
    growthFactor = 1.25,
    cooldownWindows = 20,
  } = {}) {
    this.minVoices = Math.max(1, integer(minVoices, 16));
    this.initialVoices = Math.max(this.minVoices, integer(initialVoices, 128));
    this.growBelow = Math.max(0, finiteNumber(growBelow, 0.45));
    this.growPeakBelow = Math.max(this.growBelow, finiteNumber(growPeakBelow, 0.7));
    this.targetLoad = Math.max(0.05, finiteNumber(targetLoad, 0.55));
    this.shrinkAbove = Math.max(this.growBelow, finiteNumber(shrinkAbove, 0.65));
    this.shrinkPeakAbove = Math.max(
      this.growPeakBelow,
      finiteNumber(shrinkPeakAbove, 0.85),
    );
    this.emergencyPeak = Math.max(
      this.shrinkPeakAbove,
      finiteNumber(emergencyPeak, 1),
    );
    this.growAfter = Math.max(1, integer(growAfter, 3));
    this.shrinkAfter = Math.max(1, integer(shrinkAfter, 2));
    this.growthFactor = Math.max(1.05, finiteNumber(growthFactor, 1.25));
    this.cooldownAfterShrink = Math.max(1, integer(cooldownWindows, 20));
    this.telemetry = "pending";
    this.profiles = new Map(MODES.map((mode) => {
      const requestedHardLimit = hardLimits?.[mode]
        ?? ADAPTIVE_POLYPHONY_HARD_LIMITS[mode];
      const hardLimit = Math.max(
        this.minVoices,
        integer(requestedHardLimit, ADAPTIVE_POLYPHONY_HARD_LIMITS[mode]),
      );
      return [mode, createProfile(this.initialVoices, hardLimit)];
    }));
  }

  profile(mode) {
    return this.profiles.get(modeName(mode));
  }

  setTelemetryUnavailable(source = "fallback") {
    this.telemetry = "unavailable";
    for (const profile of this.profiles.values()) {
      profile.limit = Math.min(this.initialVoices, profile.hardLimit);
      profile.stableLimit = profile.limit;
      profile.status = "fallback";
      profile.source = source;
      profile.safeWindows = 0;
      profile.highWindows = 0;
      profile.cooldownWindows = 0;
    }
  }

  setDemand(mode, demand) {
    const profile = this.profile(mode);
    profile.demand = Math.max(0, integer(demand, 0));
    if (this.telemetry === "unavailable") profile.status = "fallback";
    else if (profile.demand <= profile.limit && !["probing", "capped"].includes(profile.status)) {
      profile.status = this.telemetry === "pending" ? "warming" : "demand-limited";
    }
    return this.decision(mode);
  }

  limitFor(mode) {
    return this.profile(mode).limit;
  }

  decision(mode) {
    const selectedMode = modeName(mode);
    const profile = this.profile(selectedMode);
    return Object.freeze({
      mode: selectedMode,
      limit: profile.limit,
      stableLimit: profile.stableLimit,
      hardLimit: profile.hardLimit,
      demand: profile.demand,
      activeVoices: profile.activeVoices,
      averageLoad: profile.averageLoad,
      peakLoad: profile.peakLoad,
      underrunRatio: profile.underrunRatio,
      status: profile.status,
      source: profile.source,
      telemetry: this.telemetry,
    });
  }

  shrink(profile, observedLoad, emergency) {
    const rollingBackProbe = profile.status === "probing" && !emergency;
    const active = Math.max(this.minVoices, profile.activeVoices || profile.limit);
    const proportional = roundDown(
      active * this.targetLoad / Math.max(0.01, observedLoad),
    );
    const stepped = emergency
      ? roundDown(profile.limit * 0.75)
      : roundDown(profile.limit * 0.875);
    const estimatedNext = boundedInteger(
      Math.min(profile.stableLimit, proportional || stepped, stepped),
      this.minVoices,
      profile.hardLimit,
    );
    const next = rollingBackProbe ? profile.stableLimit : estimatedNext;
    profile.limit = Math.min(profile.limit, next);
    profile.stableLimit = Math.min(profile.stableLimit, profile.limit);
    profile.status = "capped";
    profile.safeWindows = 0;
    profile.highWindows = 0;
    profile.cooldownWindows = this.cooldownAfterShrink;
  }

  observe({
    mode = "sine",
    averageLoad,
    peakLoad,
    underrunRatio = 0,
    activeVoices = 0,
    requestedVoices,
    source = "renderer",
    valid = true,
  } = {}) {
    const selectedMode = modeName(mode);
    const profile = this.profile(selectedMode);
    const average = finiteNumber(averageLoad, Number.NaN);
    const peak = finiteNumber(peakLoad, Number.NaN);
    const underruns = Math.max(0, finiteNumber(underrunRatio, 0));
    if (!valid || !Number.isFinite(average) || !Number.isFinite(peak)) {
      return this.decision(selectedMode);
    }

    this.telemetry = "available";
    profile.source = source;
    profile.averageLoad = Math.max(0, average);
    profile.peakLoad = Math.max(0, peak);
    profile.underrunRatio = underruns;
    profile.activeVoices = Math.max(0, integer(activeVoices, 0));
    if (requestedVoices !== undefined) {
      profile.demand = Math.max(0, integer(requestedVoices, 0));
    }
    if (profile.cooldownWindows > 0) profile.cooldownWindows -= 1;

    if (profile.activeVoices <= 0) {
      profile.safeWindows = 0;
      profile.highWindows = 0;
      if (profile.status === "warming") profile.status = "demand-limited";
      return this.decision(selectedMode);
    }

    const emergency = underruns > 0 || profile.peakLoad >= this.emergencyPeak;
    const tooHigh = emergency
      || profile.averageLoad > this.shrinkAbove
      || profile.peakLoad > this.shrinkPeakAbove;
    if (tooHigh) {
      profile.highWindows += 1;
      profile.safeWindows = 0;
      if (emergency || profile.highWindows >= this.shrinkAfter) {
        const observedLoad = Math.max(
          profile.averageLoad,
          profile.peakLoad * 0.75,
          underruns > 0 ? 1 : 0,
        );
        this.shrink(profile, observedLoad, emergency);
      }
      return this.decision(selectedMode);
    }

    profile.highWindows = 0;
    profile.safeWindows += 1;
    const saturated = profile.activeVoices >= Math.max(
      1,
      Math.min(profile.limit, profile.demand) * 0.9,
    );
    const hasHeadroom = profile.averageLoad < this.growBelow
      && profile.peakLoad < this.growPeakBelow;
    const needsMore = profile.demand > profile.limit;

    if (profile.safeWindows >= this.growAfter) {
      profile.stableLimit = profile.limit;
      if (saturated && needsMore && hasHeadroom && profile.cooldownWindows === 0) {
        const proportional = roundDown(
          profile.activeVoices * this.targetLoad / Math.max(0.05, profile.averageLoad),
        );
        const step = roundUp(profile.limit * this.growthFactor);
        const estimated = Math.max(profile.limit, proportional);
        const next = boundedInteger(
          Math.min(profile.demand, profile.hardLimit, step, estimated),
          this.minVoices,
          profile.hardLimit,
        );
        if (next > profile.limit) {
          profile.limit = next;
          profile.status = "probing";
          profile.safeWindows = 0;
          return this.decision(selectedMode);
        }
      }
      profile.status = needsMore ? "capped" : "demand-limited";
      profile.safeWindows = 0;
    } else if (profile.status !== "probing") {
      profile.status = needsMore ? "warming" : "demand-limited";
    }
    return this.decision(selectedMode);
  }
}
