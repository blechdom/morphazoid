import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import {
  TILES_ANALOG_PARAMETERS,
  TILES_APP_MODES,
  TILES_CROSSOVER_PARAMETERS,
  TILES_IDENTICAL_PARAMETERS,
  TILES_UNIQUE_PARAMETERS,
  tilesModeFor,
} from "../src/tiles-suite.js";

const root = new URL("../", import.meta.url);

test("Tiles app modes describe the four source instruments", () => {
  assert.deepEqual(
    TILES_APP_MODES.map(({ id, label, href, geometryKind, audioKind }) => ({
      id,
      label,
      href,
      geometryKind,
      audioKind,
    })),
    [
      { id: "lattice", label: "Lattice", href: "lattice.html", geometryKind: "lattice", audioKind: "synth" },
      { id: "lattice-drums", label: "Lattice Drums", href: "lattice-drums.html", geometryKind: "lattice", audioKind: "drums" },
      { id: "spiral", label: "Spiral", href: "spiral.html", geometryKind: "spiral", audioKind: "synth" },
      { id: "spiral-drums", label: "Spiral Drums", href: "spiral-drums.html", geometryKind: "spiral", audioKind: "drums" },
    ],
  );
  assert.equal(tilesModeFor("spiral-drums").title, "Spiral Drum Machine");
  assert.equal(tilesModeFor("unknown").id, "lattice");
});

test("Tiles app records shared, analog, unique, and crossover parameters", () => {
  const allModes = ["lattice", "lattice-drums", "spiral", "spiral-drums"];
  const identical = new Map(TILES_IDENTICAL_PARAMETERS.map((item) => [item.id, item]));
  for (const id of [
    "tilingType",
    "parameters",
    "edgeCurves",
    "density",
    "position",
    "speed",
    "direction",
    "motionMode",
    "playing",
    "audio",
    "level",
  ]) {
    assert.deepEqual(identical.get(id)?.modes, allModes, `${id} should be shared by every mode`);
  }

  const analog = new Map(TILES_ANALOG_PARAMETERS.map((item) => [item.id, item]));
  assert.deepEqual(analog.get("readerShape")?.modes, allModes);
  assert.deepEqual(analog.get("pitchSource")?.modes, ["lattice", "spiral"]);
  assert.deepEqual(analog.get("mappingMode")?.modes, ["lattice-drums", "spiral-drums"]);

  assert.ok(TILES_UNIQUE_PARAMETERS.lattice.some(({ id }) => id === "lineAngle"));
  assert.ok(TILES_UNIQUE_PARAMETERS["lattice-drums"].some(({ id }) => id === "latticeMappingMode"));
  assert.ok(TILES_UNIQUE_PARAMETERS.spiral.some(({ id }) => id === "timePath"));
  assert.ok(TILES_UNIQUE_PARAMETERS.spiral.some(({ id }) => id === "sizeCoupling"));
  assert.ok(TILES_UNIQUE_PARAMETERS["spiral-drums"].some(({ id }) => id === "spiralMappingMode"));

  const crossovers = new Set(TILES_CROSSOVER_PARAMETERS.map(({ id }) => id));
  for (const id of [
    "shared-tile-form-to-all-modes",
    "lattice-line-angle-to-spiral-angle",
    "spiral-size-coupling-to-lattice-density",
    "synth-pitch-source-to-drum-character",
    "drum-mapping-to-synth-emphasis",
  ]) {
    assert.equal(crossovers.has(id), true, `${id} crossover should be tracked`);
  }
});

test("Tiles page is a native combined app, not a frame host", async () => {
  const [html, css] = await Promise.all([
    readFile(new URL("tiles.html", root), "utf8"),
    readFile(new URL("tiles.css", root), "utf8"),
  ]);

  assert.match(html, /<body class="tiles-app-page">/);
  assert.match(html, /id="tilesApp" data-tiles-mode="lattice"/);
  assert.match(html, /<canvas id="stage"/);
  assert.match(html, /id="tilesMode" role="tablist" aria-label="Tiles mode"/);
  assert.match(html, /data-tiles-mode="lattice"/);
  assert.match(html, /data-tiles-mode="lattice-drums"/);
  assert.match(html, /data-tiles-mode="spiral"/);
  assert.match(html, /data-tiles-mode="spiral-drums"/);
  assert.match(html, /id="tilingType"/);
  assert.match(html, /id="parameterControls"/);
  assert.match(html, /id="edgeControls"/);
  assert.match(html, /id="latticeBank"/);
  assert.match(html, /id="spiralBank"/);
  assert.match(html, /id="synthBank"/);
  assert.match(html, /id="drumsBank"/);
  assert.match(html, /class="tiles-transport-button" id="playButton"/);
  assert.match(html, /class="tiles-motion-bank" id="playheadMotion" role="group" aria-label="Reader direction and movement"/);
  assert.match(html, /id="traversalDirection"[\s\S]*aria-label="Reader direction: forward"/);
  assert.match(html, /id="loopMotion"[\s\S]*aria-label="Loop movement"/);
  assert.match(html, /id="pingPongMotion"[\s\S]*aria-label="Ping-pong movement"/);
  assert.match(html, /class="tiles-midi-dock" data-midi-output-monitor-host/);
  assert.match(html, /src="tiles-app\.js"/);
  assert.doesNotMatch(html, /<iframe\b/i);
  assert.doesNotMatch(html, /Open original/i);
  assert.doesNotMatch(html, /choose/i);
  assert.doesNotMatch(html, /<header><span>\d\d<\/span>/);

  assert.match(css, /\.tiles-app\s*\{/);
  assert.match(css, /\.tiles-app\[data-tiles-mode="lattice-drums"\]/);
  assert.match(css, /\.tiles-app\[data-tiles-mode="spiral"\]/);
  assert.match(css, /\.tiles-mode-switch\s*\{/);
  assert.match(css, /\.tiles-rack\s*\{[\s\S]*border-top: 1px solid/);
  assert.match(css, /\.tiles-transport-button\s*\{[\s\S]*border-radius: 50%;/);
  assert.match(css, /\.tiles-motion-bank\s*\{[\s\S]*grid-template-columns: repeat\(3, 36px\);/);
  assert.match(css, /\.tiles-icon-toggle\s*\{[\s\S]*width: 36px;/);
  assert.match(css, /\.tiles-mode-bank\[hidden\][\s\S]*display:\s*none;/);
  assert.match(css, /\.tiles-midi-dock:empty\s*\{\s*display: none;/);
  assert.doesNotMatch(css, /iframe/i);
});

test("Tiles app owns geometry and audio engines while preserving shared state on mode switch", async () => {
  const app = await readFile(new URL("tiles-app.js", root), "utf8");

  assert.match(app, /new VoicePool\(128, \{ adaptive: true, maxVoices: 4096 \}\)/);
  assert.match(app, /new FmDrumAudio\(globalThis\)/);
  assert.match(app, /buildLattice/);
  assert.match(app, /buildSpiralTessellation/);
  assert.match(app, /contactsForLine/);
  assert.match(app, /contactsForSpiralReader/);
  assert.match(app, /latticeDrumVoiceIndex/);
  assert.match(app, /spiralDrumVoiceIndex/);
  assert.match(app, /mappedLatticeDrumVoice/);
  assert.match(app, /mappedSpiralDrumVoice/);
  assert.match(app, /emitMidiOutputPreview/);
  assert.match(app, /async function setMode\(modeId\)/);
  assert.match(app, /const previousMode = state\.mode;\s*state\.mode = nextMode/);
  assert.match(app, /if \(state\.audio\) await prepareActiveAudio\(\);/);
  assert.match(app, /function silenceAudioRoutes\(rampMilliseconds = 45\)/);
  assert.match(app, /for \(const bank of document\.querySelectorAll\("\[data-mode-bank\]"\)\)/);
  assert.match(app, /for \(const bank of document\.querySelectorAll\("\[data-geometry-bank\]"\)\)/);
  assert.match(app, /state\.parameters/);
  assert.match(app, /state\.edgeCurves/);
  assert.match(app, /state\.density/);
  assert.match(app, /state\.position/);
  assert.match(app, /state\.continuousPosition/);
  assert.match(app, /DRUM_REENTRY_MS = 75/);
  assert.doesNotMatch(app, /\biframe\b/i);
  assert.doesNotMatch(app, /contentDocument/);

  const setModeBody = app.match(/async function setMode\(modeId\) \{(?<body>[\s\S]*?)\n\}/)?.groups.body ?? "";
  assert.doesNotMatch(setModeBody, /state\.audio\s*=\s*false/);
  assert.doesNotMatch(setModeBody, /\.close\(/);
  assert.doesNotMatch(setModeBody, /\.disable\(/);
  assert.doesNotMatch(setModeBody, /tilingType\s*=/);
  assert.doesNotMatch(setModeBody, /parameters\s*=/);
  assert.doesNotMatch(setModeBody, /edgeCurves\s*=/);
  assert.doesNotMatch(setModeBody, /density\s*=/);
  assert.doesNotMatch(setModeBody, /position\s*=/);
});

test("Tiles lives in the Morphazoid Apps section", async () => {
  const [nav, catalog, midi] = await Promise.all([
    readFile(new URL("nav.js", root), "utf8"),
    readFile(new URL("src/instrument-catalog.js", root), "utf8"),
    readFile(new URL("src/instrument-midi-capabilities.js", root), "utf8"),
    access(new URL("assets/instruments/tiles-app.webp", root)),
  ]);

  assert.match(nav, /freezeGroup\("apps", "Apps", \[[\s\S]*id: "tiles-app", label: "Tiles", href: "tiles\.html"/);
  assert.match(catalog, /"tiles-app": define\(/);
  assert.match(catalog, /Lattice, Lattice Drums, Spiral, or Spiral Drums/);
  assert.match(midi, /sequence: Object\.freeze\(\[\s*"l-systems",\s*"tiles-app"/);
});
