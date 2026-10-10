const MAXIMUM = 512;
export function sanitizeGraphDelayPerformance(source = {}) {
  const count = Number(source.voiceCeiling ?? 0);
  return { voiceCeiling: Number.isFinite(count) ? Math.max(0, Math.min(MAXIMUM, Math.round(count))) : 0,
    automatic: source.automatic !== false };
}

/** Per-scene admission uses the measured cost of BOTH rendering scenes. A
 * retiring route remains processing work until its smooth release finishes. */
export function createGraphCapacityController() {
  let settings = sanitizeGraphDelayPerformance(), limit = MAXIMUM;
  let mean = null, peak = 0, elapsed = 0, lastCut = -Infinity, stable = 0;
  return {
    configure(source) { settings = sanitizeGraphDelayPerformance(source); stable = 0; return this.limit; },
    get settings() { return settings; },
    get limit() { return settings.automatic ? limit : MAXIMUM; },
    observe({ load, seconds, eligible = 0, retiringEligible = 0, processing = 0, target = 0, preparing = false }) {
      if (!(seconds > 0) || !Number.isFinite(seconds)) return this.limit;
      elapsed += seconds;
      if (!Number.isFinite(load) || load < 0) load = 2;
      const alpha = 1 - Math.exp(-seconds / .12);
      mean = mean === null ? load : mean + (load - mean) * alpha;
      peak = Math.max(load, peak * Math.exp(-seconds / .3));
      if (!settings.automatic) { stable = 0; return this.limit; }
      const ceiling = settings.voiceCeiling || MAXIMUM;
      const demand = Math.max(eligible, retiringEligible), actual = Math.min(limit, ceiling, demand);
      const releasing = processing > target;
      // Wait for a release to reduce cost before applying another reduction.
      // An extreme new spike can still trigger a bounded emergency cut.
      const canCut = elapsed - lastCut >= (releasing ? .19 : .045);
      if (actual > 1 && canCut && (load > 1 || mean > .88)) {
        const factor = Math.max(.5, Math.min(.85, .72 / Math.max(load, mean)));
        limit = Math.max(1, Math.floor(actual * factor)); lastCut = elapsed; stable = 0;
      } else if (!preparing && !retiringEligible && !releasing && elapsed - lastCut > 1.5
        && mean < .6 && peak < .75 && actual > 0 && limit < Math.min(ceiling, demand)) {
        stable += seconds;
        if (stable >= 3) { limit = Math.min(ceiling, demand, limit + Math.max(1, Math.min(16, Math.floor(limit * .05)))); stable = 0; }
      } else stable = 0;
      return this.limit;
    },
  };
}
