export const COMBO_GEOMETRIES = Object.freeze({
  shape: Object.freeze({ id: "shape", label: "Polygon", dimension: "2D", color: "#69f2bd" }),
  solid: Object.freeze({ id: "solid", label: "Polyhedra", dimension: "3D", color: "#78a7ff" }),
  hyper: Object.freeze({ id: "hyper", label: "Hyperpolyhedra", dimension: "4D", color: "#cb8fff" }),
});

export const COMBO_SOUNDS = Object.freeze({
  synth: Object.freeze({
    id: "synth",
    label: "Synth",
    systemLabel: "Voices",
    description: "geometry-owned pitched voices",
  }),
  drums: Object.freeze({
    id: "drums",
    label: "Drums",
    systemLabel: "Triggers",
    description: "region entry → 16-voice drum map",
  }),
});

const nativeInstrument = (geometry, sound, href, appModule) => Object.freeze({
  id: `${geometry}-${sound}`,
  geometry,
  sound,
  href,
  appModule,
  title: `${COMBO_GEOMETRIES[geometry].label} ${COMBO_SOUNDS[sound].label}`,
});

export const COMBO_NATIVE_INSTRUMENTS = Object.freeze({
  "shape-synth": nativeInstrument("shape", "synth", "shape.html", "app.js"),
  "shape-drums": nativeInstrument("shape", "drums", "shape-drums.html", "shape-drums-app.js"),
  "solid-synth": nativeInstrument("solid", "synth", "solid.html", "solid-app.js"),
  "solid-drums": nativeInstrument("solid", "drums", "solid-drums.html", "solid-drums-app.js"),
  "hyper-synth": nativeInstrument("hyper", "synth", "hyper.html", "hyper-app.js"),
  "hyper-drums": nativeInstrument("hyper", "drums", "hyper-drums.html", "hyper-drums-app.js"),
});

export function comboInstrumentFor(geometry = "shape", sound = "synth") {
  return COMBO_NATIVE_INSTRUMENTS[`${geometry}-${sound}`] ?? COMBO_NATIVE_INSTRUMENTS["shape-synth"];
}

export function sanitizeComboFocus(value) {
  return comboInstrumentFor(value?.geometry, value?.sound);
}
