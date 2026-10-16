import { BELL_STATES } from "./entanglement-dance.js";
import { choice, defineParamModel, range } from "../preset-kit/param-schema.js";

export const ENTANGLEMENT_DANCE_MODEL = defineParamModel({
  bellState: choice(BELL_STATES),
  dephasing: range(0, 1, 0.01, [0, 0.85]),
  tempo: range(0.3, 8, 0.1, [0.4, 6.5]),
  aliceRoot: range(110, 440, 1),
  bobRoot: range(55, 220, 1),
  scaleSpread: range(2, 14, 1),
}, { label: "Entanglement Dance" });

export const ENTANGLEMENT_DANCE_PRESET_KEYS = ENTANGLEMENT_DANCE_MODEL.keys;
export const captureEntanglementDancePreset = state => ENTANGLEMENT_DANCE_MODEL.sanitize(state);
export const validateEntanglementDancePreset = ENTANGLEMENT_DANCE_MODEL.validate;
export const randomizeEntanglementDancePreset = ENTANGLEMENT_DANCE_MODEL.randomize;

const dance = (bellState, dephasing, tempo, aliceRoot, bobRoot, scaleSpread) => (
  { bellState, dephasing, tempo, aliceRoot, bobRoot, scaleSpread }
);

export const ENTANGLEMENT_DANCE_FULL_PRESETS = ENTANGLEMENT_DANCE_MODEL.bank([
  ["classic-phi-plus", "Classic Φ+ promenade", dance("phi-plus", 0, 2, 220, 110, 7)],
  ["anti-phase-waltz", "Anti-phase waltz", dance("phi-minus", 0.1, 1.5, 196, 98, 9)],
  ["mirror-reel", "Mirror Ψ+ reel", dance("psi-plus", 0.05, 3.5, 262, 131, 12)],
  ["singlet-lullaby", "Singlet lullaby", dance("psi-minus", 0, 0.6, 165, 82, 5)],
  ["decohering-ballroom", "Decohering ballroom", dance("phi-plus", 0.55, 2.4, 220, 110, 7)],
  ["deep-drone-pair", "Deep drone pair", dance("phi-plus", 0, 0.4, 110, 55, 3)],
  ["high-glass-duet", "High glass duet", dance("psi-minus", 0.15, 4.5, 440, 220, 14)],
  ["fifths-in-unison", "Fifths in unison", dance("phi-minus", 0, 2, 220, 147, 8)],
  ["fast-hoedown", "Fast hoedown", dance("psi-plus", 0.25, 7, 330, 165, 10)],
  ["fading-singlet", "Fading singlet", dance("psi-minus", 0.8, 1.2, 247, 123, 6)],
  ["open-prairie", "Wide-open prairie", dance("phi-plus", 0.2, 1, 131, 65, 14)],
  ["tight-tangle", "Tight tangle", dance("psi-plus", 0, 5.5, 294, 98, 2)],
  ["mist-and-static", "Mist and static", dance("phi-minus", 0.9, 0.8, 185, 92, 11)],
]);
