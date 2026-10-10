const MAXIMUM = 512;
export function sanitizeGraphDelayPerformance(source = {}) {
  const count = Number(source.voiceCeiling ?? 0);
  return { voiceCeiling: Number.isFinite(count) ? Math.max(0, Math.min(MAXIMUM, Math.round(count))) : 0,
    automatic: source.automatic !== false };
}

/** Total callback work protects the deadline. Recurring DSP work determines
 * recovery; allocation, scene preparation and control edits do not establish a
 * permanent device ceiling. A structural commit starts a fresh bounded scene. */
export function createGraphCapacityController() {
  let settings = sanitizeGraphDelayPerformance(), limit = MAXIMUM;
  let mean = null, peak = 0, elapsed = 0, lastCut = -Infinity, stable = 0;
  let restoreLimit = 0, measuredLimit = 0, trial = false, trialSeconds = 0, lastGood = 0;
  return {
    configure(source) {
      const previous = settings; settings = sanitizeGraphDelayPerformance(source); stable = 0;
      if (!previous.automatic && settings.automatic) limit = Math.max(limit, measuredLimit);
      return this.limit;
    },
    beginScene() {
      // The scene was explicitly prepared inside the fixed 512-route budget.
      // Restore its membership once; motion and coefficient edits never call
      // this. Retiring scenes remain covered by the next total-load sample.
      limit = MAXIMUM; mean = null; peak = 0; stable = 0; lastCut = -Infinity;
      restoreLimit = measuredLimit = 0; trial = false; trialSeconds = 0; lastGood = 0;
      return this.limit;
    },
    get settings() { return settings; },
    get limit() { return settings.automatic ? limit : MAXIMUM; },
    observe({ load, maintenanceLoad = 0, seconds, eligible = 0, retiringEligible = 0, processing = 0, target = 0, preparing = false }) {
      if (!(seconds > 0) || !Number.isFinite(seconds)) return this.limit;
      elapsed += seconds;
      if (!Number.isFinite(load) || load < 0) load = 2;
      const maintenance = Number.isFinite(maintenanceLoad) ? Math.max(0, Math.min(load, maintenanceLoad)) : 0;
      const recurring = Math.max(0, load - maintenance);
      const alpha = 1 - Math.exp(-seconds / .12);
      mean = mean === null ? recurring : mean + (recurring - mean) * alpha;
      peak = Math.max(recurring, peak * Math.exp(-seconds / .3));
      const ceiling = settings.voiceCeiling || MAXIMUM;
      const demand = Math.max(eligible, retiringEligible), actual = Math.min(this.limit, ceiling, demand);
      const releasing = processing > target;
      // Even an idle callback pays for timing, admission and the bounded
      // preparer check. Require real total headroom rather than exactly zero
      // maintenance, which a high-resolution clock almost never observes.
      const clean = !preparing && !retiringEligible && !releasing && load < .65;
      if (!settings.automatic) {
        if (clean && mean < .65 && peak < .85) measuredLimit = Math.max(measuredLimit, actual);
        stable = 0; return this.limit;
      }
      // Allow an outgoing fade to retire before judging the reduced target.
      const canCut = elapsed - lastCut >= (releasing ? .19 : .045);
      if (actual > 1 && canCut && (load > 1 || mean > .88)) {
        const transient = maintenance > 0 && recurring < .65 && mean < .7;
        const factor = Math.max(.5, Math.min(.85, .72 / Math.max(load, mean)));
        limit = trial && lastGood > 0 && load < 1.5 ? Math.min(actual - 1, lastGood) : Math.max(1, Math.floor(actual * factor));
        if (transient) restoreLimit = Math.max(restoreLimit, actual, measuredLimit);
        else { restoreLimit = 0; measuredLimit = Math.min(measuredLimit, limit); }
        lastCut = elapsed; stable = 0; trial = false; trialSeconds = 0;
      } else if (clean && mean < .65 && peak < .85) {
        if (trial) {
          trialSeconds += seconds;
          if (trialSeconds >= .18) { measuredLimit = Math.max(measuredLimit, actual); trial = false; stable = 0; }
        } else if (elapsed - lastCut >= (restoreLimit ? .19 : 1.5)) {
          stable += seconds;
          if (stable >= (restoreLimit ? .06 : .3)) {
            measuredLimit = Math.max(measuredLimit, actual);
            const maximum = Math.min(ceiling, demand);
            if (actual > 0 && limit < maximum) {
              const sizing = Math.max(.01, mean, recurring);
              const step = Math.max(1, Math.min(64, Math.floor(actual * .5), Math.floor(actual * Math.max(0, .72 - sizing) / sizing * .6)));
              lastGood = actual;
              limit = Math.min(maximum, restoreLimit > actual ? restoreLimit : actual + step);
              trial = true; trialSeconds = 0; restoreLimit = 0;
            }
            stable = 0;
          }
        }
      } else { stable = 0; trialSeconds = 0; }
      return this.limit;
    },
  };
}
