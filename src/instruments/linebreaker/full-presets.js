import { choice, defineParamModel, range } from "../preset-kit/param-schema.js";

export const LINEBREAKER_MODEL = defineParamModel({
  preset: choice(["crossed-lines", "sierpinski-carpet", "cantor-dust"]),
  depth: range(2, 4, 1),
  angle: range(0, 179, 1),
  offset: range(-0.49, 0.49, 0.001),
  width: choice([1, 3, 5]),
  rootFrequency: range(45, 180, 1),
  scanRate: range(0.05, 0.8, 0.01),
}, { label: "Linebreaker" });

export const LINEBREAKER_PRESET_KEYS = LINEBREAKER_MODEL.keys;
export const captureLinebreakerPreset = state => LINEBREAKER_MODEL.sanitize({
  ...state, angle: Math.round(((state.angle % 180) + 180) % 180) % 180,
});
export const validateLinebreakerPreset = LINEBREAKER_MODEL.validate;
export const randomizeLinebreakerPreset = LINEBREAKER_MODEL.randomize;

const scene = (preset, depth, angle, offset, width, rootFrequency, scanRate) => (
  { preset, depth, angle, offset, width, rootFrequency, scanRate }
);

export const LINEBREAKER_FULL_PRESETS = LINEBREAKER_MODEL.bank([
  ["carpet-rail", "Carpet rail", scene("sierpinski-carpet", 3, 0, -0.481, 1, 73, 0.2)],
  ["carpet-diagonal", "Carpet diagonal", scene("sierpinski-carpet", 3, 45, 0, 1, 73, 0.2)],
  ["carpet-fine", "Fine carpet", scene("sierpinski-carpet", 4, 30, 0.12, 1, 55, 0.15)],
  ["carpet-coarse", "Coarse carpet", scene("sierpinski-carpet", 2, 90, -0.44, 3, 110, 0.35)],
  ["dust-broken-rail", "Dust breaks the rail", scene("cantor-dust", 3, 0, -0.481, 1, 73, 0.2)],
  ["dust-sweep", "Dust diagonal sweep", scene("cantor-dust", 4, 60, 0.2, 1, 90, 0.5)],
  ["dust-wide-probe", "Dust wide probe", scene("cantor-dust", 3, 120, 0, 5, 65, 0.3)],
  ["dust-deep-low", "Deep low dust", scene("cantor-dust", 4, 15, -0.3, 3, 48, 0.1)],
  ["crossed-rails", "Crossed rails", scene("crossed-lines", 3, 0, 0, 1, 73, 0.2)],
  ["crossed-diagonal", "Crossed diagonal", scene("crossed-lines", 3, 45, 0.1, 3, 120, 0.6)],
  ["crossed-fat", "Fat crossed probe", scene("crossed-lines", 2, 90, 0, 5, 60, 0.25)],
  ["carpet-high-drone", "Carpet high drone", scene("sierpinski-carpet", 3, 150, 0.35, 3, 160, 0.75)],
  ["dust-glacier", "Dust glacier", scene("cantor-dust", 4, 100, -0.15, 1, 45, 0.05)],
]);
