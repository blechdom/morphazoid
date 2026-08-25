import {
  createShapesState,
  SHAPES_DIMENSIONS,
  SHAPES_PLAYING_MODES,
} from "./shapes-state.js";

// Compatibility exports for older links. Shapes now owns its runtime; these
// records describe in-app state routes, never external HTML pages.
export const COMBO_GEOMETRIES = Object.freeze(Object.fromEntries(
  Object.values(SHAPES_DIMENSIONS).map((dimension) => [
    dimension.geometry,
    Object.freeze({
      id: dimension.geometry,
      stateId: dimension.id,
      label: dimension.name,
      dimension: dimension.label,
      color: dimension.color,
    }),
  ]),
));

export const COMBO_PLAYING_MODES = SHAPES_PLAYING_MODES;

export const COMBO_SOUNDS = Object.freeze({
  synth: Object.freeze({ id: "synth", playingMode: "continuous", label: "Continuous" }),
  notes: Object.freeze({ id: "notes", playingMode: "notes", label: "Notes" }),
  drums: Object.freeze({ id: "drums", playingMode: "triggers", label: "Triggers" }),
});

export function comboSelectionFor(geometry = "shape", sound = "synth") {
  const playingMode = sound === "drums"
    ? "triggers"
    : sound === "notes" || sound === "triggers" || sound === "continuous"
      ? sound
      : "continuous";
  const state = createShapesState({
    geometry,
    sound,
    selection: { dimension: geometry, playingMode },
  });
  return Object.freeze({
    dimension: state.selection.dimension,
    playingMode: state.selection.playingMode,
  });
}

export function sanitizeComboFocus(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return comboSelectionFor(
    source.geometry ?? source.dimension,
    source.sound ?? source.playingMode,
  );
}
