import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";

export const HYPER_SYRINX_STAGES = Object.freeze(["air", "gate", "tissue", "apparatus", "trachea", "tract", "lips"]);
export const HYPER_SYRINX_SPECIES = Object.freeze(["elephant", "bird", "frog", "whale", "human", "machine", "hybrid"]);
const ROUTES = Object.freeze(["braid", "chain", "all"]);
const MAX_MODULES = 8;

const num = (value, lo, hi, fallback) => Math.min(hi, Math.max(lo, Number.isFinite(Number(value)) ? Number(value) : fallback));

export function captureHyperSyrinxPreset(source) {
  return {
    route: ROUTES.includes(source.route) ? source.route : "braid",
    metabolism: num(source.metabolism, 0, 1, .34),
    crossCoupling: num(source.crossCoupling, 0, 1, .58),
    breathTexture: num(source.breathTexture, 0, 1, .06),
    wetness: num(source.wetness, 0, 1, .27),
    modules: Object.fromEntries(HYPER_SYRINX_STAGES.map(stage => {
      const items = Array.isArray(source.modules?.[stage]) ? source.modules[stage].slice(0, MAX_MODULES) : [];
      const clean = items.map(item => ({
        species: HYPER_SYRINX_SPECIES.includes(item?.species) ? item.species : "hybrid", value: num(item?.value, 0, 1, .5),
      }));
      return [stage, clean.length ? clean : [{ species: "hybrid", value: .5 }]];
    })),
  };
}

export function validateHyperSyrinxPreset(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || presetStateKey(snapshot) !== presetStateKey(captureHyperSyrinxPreset(snapshot))
    || HYPER_SYRINX_STAGES.some(stage => !Array.isArray(snapshot.modules?.[stage]) || snapshot.modules[stage].length < 1)) {
    throw new TypeError("Invalid complete Hyper-Syrinx preset");
  }
  return snapshot;
}

export function hyperSyrinxEquation(snapshot) {
  const { air, tissue, lips } = snapshot.modules;
  return `${air.length} BREATH${air.length === 1 ? "" : "S"} + ${tissue.length} TISSUE${tissue.length === 1 ? "" : "S"} → ${lips.length} SHARED EXIT${lips.length === 1 ? "" : "S"}`;
}

const scene = (id, label, equation, route, [metabolism, crossCoupling, breathTexture, wetness], modules) => Object.freeze({
  id, label, equation,
  snapshot: Object.freeze(captureHyperSyrinxPreset({
    route, metabolism, crossCoupling, breathTexture, wetness,
    modules: Object.fromEntries(HYPER_SYRINX_STAGES.map(stage => [stage, modules[stage].map(([species, value]) => ({ species, value }))])),
  })),
});

export const HYPER_SYRINX_FULL_PRESETS = Object.freeze([
  scene("elephant-bird", "Elephant × Bird", "ELEPHANT BREATH + BIRD LABIA → 1 SHARED LIP", "braid", [.34, .58, .06, .27], {
    air: [["elephant", .82], ["bird", .54]], gate: [["hybrid", .64]], tissue: [["bird", .58], ["elephant", .58]],
    apparatus: [["hybrid", .61]], trachea: [["elephant", .78], ["bird", .28]], tract: [["elephant", .73], ["bird", .38]], lips: [["hybrid", .57]],
  }),
  scene("murmuration", "Murmuration", "3 AIR SACS + 6 LABIA → 2 FLOCK MOUTHS", "all", [.62, .74, .12, .14], {
    air: [["bird", .55], ["bird", .63], ["bird", .7]], gate: [["bird", .52], ["bird", .74]],
    tissue: [["bird", .82], ["bird", .7], ["bird", .61], ["bird", .88], ["bird", .76], ["bird", .67]],
    apparatus: [["bird", .36], ["bird", .64]], trachea: [["bird", .24], ["bird", .34], ["bird", .45]],
    tract: [["bird", .28], ["bird", .43], ["bird", .58]], lips: [["bird", .4], ["bird", .66]],
  }),
  scene("hydra", "Hydra throat", "2 LUNGS × 4 MEMBRANES × 3 TRACTS → 3 ARGUMENTS", "braid", [.48, .86, .09, .42], {
    air: [["frog", .78], ["elephant", .68]], gate: [["frog", .62], ["human", .52]],
    tissue: [["frog", .34], ["human", .46], ["elephant", .22], ["bird", .72]], apparatus: [["frog", .57], ["hybrid", .77]],
    trachea: [["frog", .23], ["human", .48]], tract: [["frog", .64], ["human", .45], ["elephant", .76]],
    lips: [["frog", .72], ["human", .38], ["hybrid", .55]],
  }),
  scene("soft-machine", "Soft machine", "WHALE LUNG + SILICONE REEDS → HUMAN + SPEAKER MOUTHS", "chain", [.22, .46, .03, .65], {
    air: [["whale", .75], ["machine", .42]], gate: [["machine", .58], ["human", .38]],
    tissue: [["whale", .31], ["machine", .64], ["human", .48]], apparatus: [["machine", .72], ["hybrid", .48]],
    trachea: [["machine", .83], ["human", .42]], tract: [["whale", .78], ["machine", .56]], lips: [["human", .48], ["machine", .68]],
  }),
  scene("whale-choir", "Whale choir", "", "chain", [.18, .4, .02, .8], {
    air: [["whale", .85], ["whale", .7]], gate: [["whale", .45]], tissue: [["whale", .2], ["whale", .35], ["whale", .5]],
    apparatus: [["whale", .6]], trachea: [["whale", .9], ["whale", .75]], tract: [["whale", .88], ["whale", .7]], lips: [["whale", .5]],
  }),
  scene("frog-sac", "Frog sac chorus", "", "all", [.7, .65, .1, .9], {
    air: [["frog", .6]], gate: [["frog", .5], ["frog", .7]], tissue: [["frog", .3], ["frog", .4], ["frog", .55], ["frog", .25]],
    apparatus: [["frog", .5]], trachea: [["frog", .2]], tract: [["frog", .8], ["frog", .6]], lips: [["frog", .75], ["frog", .5]],
  }),
  scene("human-machine", "Human at the bellows", "", "braid", [.3, .5, .08, .35], {
    air: [["machine", .7]], gate: [["human", .55]], tissue: [["human", .5], ["human", .62]],
    apparatus: [["human", .5], ["machine", .55]], trachea: [["human", .5]], tract: [["human", .5], ["human", .35]], lips: [["human", .45]],
  }),
  scene("elephant-organ", "Elephant organ", "", "chain", [.12, .3, .04, .5], {
    air: [["elephant", .9], ["elephant", .8]], gate: [["elephant", .6]], tissue: [["elephant", .15], ["elephant", .3]],
    apparatus: [["elephant", .7]], trachea: [["elephant", .95]], tract: [["elephant", .9]], lips: [["elephant", .6]],
  }),
  scene("bird-glass", "Bird glass", "", "braid", [.55, .35, .03, .08], {
    air: [["bird", .4]], gate: [["bird", .3]], tissue: [["bird", .95], ["bird", .85], ["bird", .78]],
    apparatus: [["bird", .3]], trachea: [["bird", .1]], tract: [["bird", .15]], lips: [["bird", .25]],
  }),
  scene("chimera-reed", "Chimera reed", "", "all", [.8, .9, .2, .3], {
    air: [["machine", .6], ["bird", .4], ["whale", .8]], gate: [["hybrid", .5], ["frog", .6]],
    tissue: [["machine", .9], ["elephant", .3], ["human", .7], ["bird", .5]], apparatus: [["hybrid", .8], ["machine", .3]],
    trachea: [["human", .2], ["whale", .6], ["elephant", .5]], tract: [["hybrid", .6], ["machine", .4]], lips: [["hybrid", .7], ["frog", .3]],
  }),
  scene("slow-metabolism", "Slow metabolism", "", "chain", [.05, .2, .0, .6], {
    air: [["whale", .6], ["elephant", .5]], gate: [["human", .4]], tissue: [["whale", .25], ["elephant", .2]],
    apparatus: [["hybrid", .4]], trachea: [["whale", .7]], tract: [["elephant", .6]], lips: [["human", .35]],
  }),
  scene("hiss-engine", "Hiss engine", "", "all", [.9, .8, .32, .05], {
    air: [["machine", .9], ["machine", .7]], gate: [["machine", .8], ["machine", .3]], tissue: [["machine", .85], ["machine", .6], ["bird", .9]],
    apparatus: [["machine", .9]], trachea: [["machine", .3], ["machine", .5]], tract: [["machine", .2]], lips: [["machine", .9], ["machine", .55]],
  }),
  scene("wet-hybrid", "Wet hybrid", "", "braid", [.4, .7, .1, .95], {
    air: [["hybrid", .5], ["frog", .5]], gate: [["hybrid", .6]], tissue: [["hybrid", .5], ["human", .4], ["frog", .6]],
    apparatus: [["hybrid", .5]], trachea: [["hybrid", .5], ["human", .3]], tract: [["hybrid", .5], ["frog", .7]], lips: [["hybrid", .5]],
  }),
]);

export function hyperSyrinxEntryForSnapshot(snapshot) {
  const key = presetStateKey(snapshot);
  return HYPER_SYRINX_FULL_PRESETS.find(preset => presetStateKey(preset.snapshot) === key) ?? null;
}

export function randomizeHyperSyrinxPreset(current, random = Math.random) {
  validateHyperSyrinxPreset(current);
  const rng = presetRandom(random);
  const family = rng.pick([null, "elephant", "bird", "frog", "whale", "human", "machine"]);
  return validateHyperSyrinxPreset(captureHyperSyrinxPreset({
    route: rng.pick(ROUTES),
    metabolism: rng.between(0, 1), crossCoupling: rng.between(.1, 1), breathTexture: rng.between(0, .35), wetness: rng.between(0, 1),
    modules: Object.fromEntries(HYPER_SYRINX_STAGES.map(stage => [stage, Array.from({ length: rng.pick([1, 1, 2, 2, 3, 4, 5, 6]) }, () => ({
      species: family && rng.unit() < .6 ? family : rng.pick(HYPER_SYRINX_SPECIES), value: rng.between(.06, .94),
    }))])),
  }));
}
