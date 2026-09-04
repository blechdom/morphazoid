const freezeList = (items) => Object.freeze(items.map((item) => Object.freeze(item)));

export const TILES_APP_MODES = freezeList([
  {
    id: "lattice",
    label: "Lattice",
    title: "Lattice Synth",
    href: "lattice.html",
    geometryKind: "lattice",
    audioKind: "synth",
    accent: "#67e9bd",
  },
  {
    id: "lattice-drums",
    label: "Lattice Drums",
    title: "Lattice Drum Machine",
    href: "lattice-drums.html",
    geometryKind: "lattice",
    audioKind: "drums",
    accent: "#ffb56f",
  },
  {
    id: "spiral",
    label: "Spiral",
    title: "Spiral Synth",
    href: "spiral.html",
    geometryKind: "spiral",
    audioKind: "synth",
    accent: "#78a7ff",
  },
  {
    id: "spiral-drums",
    label: "Spiral Drums",
    title: "Spiral Drum Machine",
    href: "spiral-drums.html",
    geometryKind: "spiral",
    audioKind: "drums",
    accent: "#d7ef7f",
  },
]);

const modeIds = new Set(TILES_APP_MODES.map(({ id }) => id));
const parameter = (id, label, modes, notes = "") => Object.freeze({
  id,
  label,
  modes: Object.freeze(modes.filter((mode) => modeIds.has(mode))),
  notes,
});

export const TILES_IDENTICAL_PARAMETERS = freezeList([
  parameter("tilingType", "Isohedral tile", ["lattice", "lattice-drums", "spiral", "spiral-drums"], "One TILING_TYPES selection feeds Euclidean lattice and log-polar spiral geometry."),
  parameter("parameters", "Tile parameters", ["lattice", "lattice-drums", "spiral", "spiral-drums"], "One parameter vector is passed to buildLattice() and buildSpiralTessellation()."),
  parameter("edgeCurves", "Edge curves", ["lattice", "lattice-drums", "spiral", "spiral-drums"], "One editable edge-bend set reshapes every mode."),
  parameter("density", "Tile density", ["lattice", "lattice-drums", "spiral", "spiral-drums"], "One density control sets Euclidean scale and spiral tile budget."),
  parameter("position", "Reader position", ["lattice", "lattice-drums", "spiral", "spiral-drums"], "One normalized reader phase survives switching modes."),
  parameter("speed", "Traversal speed", ["lattice", "lattice-drums", "spiral", "spiral-drums"], "One cycles-per-second transport rate."),
  parameter("direction", "Traversal direction", ["lattice", "lattice-drums", "spiral", "spiral-drums"], "One forward/reverse phase direction."),
  parameter("motionMode", "Traversal behavior", ["lattice", "lattice-drums", "spiral", "spiral-drums"], "One loop or ping-pong motion mode."),
  parameter("playing", "Transport play state", ["lattice", "lattice-drums", "spiral", "spiral-drums"], "One running state keeps visual and audio motion alive through mode changes."),
  parameter("audio", "Audio armed state", ["lattice", "lattice-drums", "spiral", "spiral-drums"], "One master audio flag prepares synth and drum engines without iframe handoff."),
  parameter("level", "Master level", ["lattice", "lattice-drums", "spiral", "spiral-drums"], "One output level feeds sustained synths and FM drums."),
]);

export const TILES_ANALOG_PARAMETERS = freezeList([
  parameter("readerShape", "Reader shape", ["lattice", "lattice-drums", "spiral", "spiral-drums"], "Lattice scans an angle-adjustable line; Spiral scans radius, angle, or spiral paths."),
  parameter("pitchSource", "Pitch data", ["lattice", "spiral"], "Lattice uses height, along, incidence, or orientation; Spiral adds radius, angle, and tile-shape identity."),
  parameter("mappingMode", "Drum mapping", ["lattice-drums", "spiral-drums"], "Both drum modes convert geometry contacts into a 4 x 4 FM voice grid."),
  parameter("contactLevel", "Contact level", ["lattice", "spiral"], "Both synth modes scale sustained crossing voices from reader contact energy."),
  parameter("stereoWidth", "Stereo width", ["lattice", "spiral"], "Both synth modes pan from visible contact position."),
]);

export const TILES_UNIQUE_PARAMETERS = Object.freeze({
  lattice: freezeList([
    parameter("lineAngle", "Scan line angle", ["lattice"]),
    parameter("patternAngle", "Pattern direction", ["lattice"]),
    parameter("voiceCap", "Continuous contact cap", ["lattice"]),
  ]),
  "lattice-drums": freezeList([
    parameter("lineAngle", "Scan line angle", ["lattice-drums"]),
    parameter("patternAngle", "Pattern direction", ["lattice-drums"]),
    parameter("latticeMappingMode", "Lattice drum source", ["lattice-drums"]),
    parameter("strikeLimit", "Strike limit", ["lattice-drums"]),
  ]),
  spiral: freezeList([
    parameter("timePath", "Reader path", ["spiral"]),
    parameter("readerTurns", "Reader turns", ["spiral"]),
    parameter("sizeCoupling", "Size-rate coupling", ["spiral"]),
    parameter("spiralA", "Spiral period A", ["spiral"]),
    parameter("spiralB", "Spiral period B", ["spiral"]),
    parameter("loopPhase", "Deep zoom phase", ["spiral"]),
  ]),
  "spiral-drums": freezeList([
    parameter("timePath", "Reader path", ["spiral-drums"]),
    parameter("readerTurns", "Reader turns", ["spiral-drums"]),
    parameter("sizeCoupling", "Size-rate coupling", ["spiral-drums"]),
    parameter("spiralMappingMode", "Spiral drum source", ["spiral-drums"]),
    parameter("strikeLimit", "Strike limit", ["spiral-drums"]),
  ]),
});

export const TILES_CROSSOVER_PARAMETERS = freezeList([
  {
    id: "shared-tile-form-to-all-modes",
    from: "lattice/spiral",
    parameter: "parameters",
    to: Object.freeze(["lattice-drums", "spiral-drums"]),
    recommendation: "Keep one tile form so drum and synth modes hear the same geometry instead of rebuilding on switch.",
  },
  {
    id: "lattice-line-angle-to-spiral-angle",
    from: "lattice",
    parameter: "lineAngle",
    to: Object.freeze(["spiral", "spiral-drums"]),
    recommendation: "Use the Euclidean scan angle as the default angular reader orientation for spiral modes.",
  },
  {
    id: "spiral-size-coupling-to-lattice-density",
    from: "spiral",
    parameter: "sizeCoupling",
    to: Object.freeze(["lattice", "lattice-drums"]),
    recommendation: "Treat visible tile size as musical rate and headroom, even on the flat lattice.",
  },
  {
    id: "synth-pitch-source-to-drum-character",
    from: "lattice/spiral",
    parameter: "pitchSource",
    to: Object.freeze(["lattice-drums", "spiral-drums"]),
    recommendation: "Let the synth pitch source drive drum tone and tuning depth in trigger modes.",
  },
  {
    id: "drum-mapping-to-synth-emphasis",
    from: "lattice-drums/spiral-drums",
    parameter: "mappingMode",
    to: Object.freeze(["lattice", "spiral"]),
    recommendation: "Expose the drum grid maps as alternate continuous voice grouping and accent sources.",
  },
]);

export function tilesModeFor(id = "lattice") {
  return TILES_APP_MODES.find((mode) => mode.id === id) ?? TILES_APP_MODES[0];
}
