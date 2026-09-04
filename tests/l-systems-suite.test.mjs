import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import {
  L_SYSTEM_ANALOG_PARAMETERS,
  L_SYSTEM_CROSSOVER_PARAMETERS,
  L_SYSTEM_IDENTICAL_PARAMETERS,
  L_SYSTEM_PLAYING_MODES,
  L_SYSTEM_SUITE_MODES,
  L_SYSTEM_UNIQUE_PARAMETERS,
  lSystemPlayingModeFor,
  lSystemSuiteModeFor,
} from "../src/l-systems-suite.js";

const root = new URL("../", import.meta.url);

test("L-Systems suite modes describe the three source instruments", () => {
  assert.deepEqual(
    L_SYSTEM_SUITE_MODES.map(({ id, label, href }) => ({ id, label, href })),
    [
      { id: "synth", label: "Synth", href: "l-system.html" },
      { id: "drums", label: "Drums", href: "l-system-drums.html" },
      { id: "mic", label: "Mic", href: "l-mic.html" },
    ],
  );
  assert.equal(lSystemSuiteModeFor("drums").title, "L-System Drum Machine");
  assert.equal(lSystemSuiteModeFor("unknown").id, "synth");
  assert.deepEqual(
    L_SYSTEM_PLAYING_MODES.map(({ id, label, audioKind }) => ({ id, label, audioKind })),
    [
      { id: "continuous", label: "Continuous", audioKind: "synth" },
      { id: "notes", label: "Notes", audioKind: "synth" },
      { id: "triggers", label: "Triggers", audioKind: "drums" },
      { id: "mic", label: "Mic", audioKind: "mic" },
    ],
  );
  assert.equal(lSystemPlayingModeFor("notes").title, "L-System Notes");
  assert.equal(lSystemPlayingModeFor("unknown").id, "continuous");
});

test("L-Systems suite records shared, analog, unique, and crossover parameters", () => {
  const identical = new Map(L_SYSTEM_IDENTICAL_PARAMETERS.map((item) => [item.id, item]));
  for (const id of [
    "presetId",
    "iterations",
    "angle",
    "turnAsymmetry",
    "lengthScale",
    "position",
    "speed",
    "direction",
    "traversalBehavior",
    "structureMode",
  ]) {
    assert.deepEqual(identical.get(id)?.modes, ["continuous", "notes", "triggers", "mic"], `${id} should be shared by all modes`);
  }
  assert.deepEqual(identical.get("level")?.modes, ["continuous", "notes", "triggers", "mic"]);

  const analog = new Map(L_SYSTEM_ANALOG_PARAMETERS.map((item) => [item.id, item]));
  assert.deepEqual(analog.get("pitchRange")?.modes, ["continuous", "notes", "mic"]);
  assert.deepEqual(analog.get("branchDepth")?.modes, ["continuous", "notes", "triggers", "mic"]);
  assert.deepEqual(analog.get("stereoSpread")?.modes, ["continuous", "notes", "mic"]);

  assert.ok(L_SYSTEM_UNIQUE_PARAMETERS.continuous.some(({ id }) => id === "soundMode"));
  assert.ok(L_SYSTEM_UNIQUE_PARAMETERS.notes.some(({ id }) => id === "noteStrikes"));
  assert.ok(L_SYSTEM_UNIQUE_PARAMETERS.triggers.some(({ id }) => id === "mappingMode"));
  assert.ok(L_SYSTEM_UNIQUE_PARAMETERS.triggers.some(({ id }) => id === "subdivisions"));
  assert.ok(L_SYSTEM_UNIQUE_PARAMETERS.mic.some(({ id }) => id === "feedback"));
  assert.ok(L_SYSTEM_UNIQUE_PARAMETERS.mic.some(({ id }) => id === "interval"));
  assert.ok(L_SYSTEM_UNIQUE_PARAMETERS.mic.some(({ id }) => id === "timeRatio"));
  assert.ok(L_SYSTEM_UNIQUE_PARAMETERS.mic.some(({ id }) => id === "wet"));

  const crossovers = new Set(L_SYSTEM_CROSSOVER_PARAMETERS.map(({ id }) => id));
  for (const id of [
    "subdivisions-to-continuous-notes-mic",
    "pitch-source-to-notes-triggers-mic",
    "structure-mode-to-mic",
    "time-ratio-to-continuous-notes-triggers",
    "mix-presets-to-all-modes",
  ]) {
    assert.equal(crossovers.has(id), true, `${id} crossover should be tracked`);
  }
});

test("L-Systems page is a native combined app, not a frame host", async () => {
  const [html, css] = await Promise.all([
    readFile(new URL("l-systems.html", root), "utf8"),
    readFile(new URL("l-systems.css", root), "utf8"),
  ]);

  assert.match(html, /<body class="l-systems-app-page">/);
  assert.match(html, /id="lSystemsApp" data-playing-mode="continuous"/);
  assert.match(html, /<canvas id="stage"/);
  assert.doesNotMatch(html, /l-systems-stage-title/);
  assert.doesNotMatch(html, /id="(?:modeReadout|stageTitle|panelTitle)"/);
  assert.match(html, /id="playingMode" role="tablist" aria-label="L-System playing mode"/);
  assert.match(html, /data-playing-mode="continuous"/);
  assert.match(html, /data-playing-mode="notes"/);
  assert.match(html, /data-playing-mode="triggers"/);
  assert.match(html, /data-playing-mode="mic"/);
  assert.match(html, /id="mixPreset"/);
  assert.match(html, /id="continuousLevel"/);
  assert.match(html, /id="noteLevel"/);
  assert.match(html, /id="triggerLevel"/);
  assert.match(html, /id="micLevel"/);
  assert.doesNotMatch(html, /<header><span>\d\d<\/span>/);
  assert.doesNotMatch(html, /id="(?:play|system|structure|mix|mapping|drumMapping|mic)Summary"/);
  assert.match(html, /class="l-systems-transport-button" id="playButton"[\s\S]*class="sr-only" id="playButtonLabel"/);
  assert.match(html, /class="l-systems-motion-bank" id="playheadMotion" role="group" aria-label="Traversal direction and movement"/);
  assert.match(html, /id="traversalDirection"[\s\S]*aria-label="Traversal direction: forward"/);
  assert.match(html, /id="loopMotion"[\s\S]*aria-label="Loop movement"/);
  assert.match(html, /id="pingPongMotion"[\s\S]*aria-label="Ping-pong movement"/);
  assert.match(html, /id="synthBank"/);
  assert.match(html, /id="drumsBank"/);
  assert.match(html, /id="micBank"/);
  assert.match(html, /id="micBank"[\s\S]*id="mixRackTitle"[\s\S]*id="settingsRackTitle"/);
  assert.match(html, /class="l-systems-midi-dock" data-midi-output-monitor-host/);
  assert.match(html, /id="preset"/);
  assert.match(html, /id="iterations"/);
  assert.match(html, /id="angle"/);
  assert.match(html, /id="lengthScale"/);
  assert.match(html, /id="position"/);
  assert.match(html, /id="speed"/);
  assert.match(html, /id="structureMode"/);
  assert.match(html, /src="l-systems-app\.js"/);
  assert.doesNotMatch(html, /<iframe\b/i);
  assert.doesNotMatch(html, /Open original/i);
  assert.doesNotMatch(html, /l-systems-embed\.css/);

  assert.match(css, /\.l-systems-app\s*\{/);
  assert.match(css, /\.l-systems-app\[data-playing-mode="notes"\]/);
  assert.match(css, /\.l-systems-app\[data-playing-mode="triggers"\]/);
  assert.match(css, /\.l-systems-mode-switch\s*\{/);
  assert.doesNotMatch(css, /\.l-systems-stage-title/);
  assert.doesNotMatch(css, /\.l-systems-rack > header > span/);
  assert.match(css, /\.l-systems-rack\s*\{[\s\S]*border-top: 1px solid/);
  assert.match(css, /\.l-systems-midi-dock:empty\s*\{\s*display: none;/);
  assert.match(css, /\.l-systems-transport-button\s*\{[\s\S]*border-radius: 50%;/);
  assert.match(css, /\.l-systems-motion-bank\s*\{[\s\S]*grid-template-columns: repeat\(3, 36px\);/);
  assert.match(css, /\.l-systems-icon-toggle\s*\{[\s\S]*width: 36px;/);
  assert.match(css, /\.l-system-drum-map\s*\{/);
  assert.match(css, /\.l-systems-mode-bank\[hidden\]\s*\{\s*display:\s*none;/);
  assert.doesNotMatch(css, /\.l-systems-frame/);
  assert.doesNotMatch(css, /iframe/i);
});

test("L-Systems app owns the audio engines and preserves shared state while switching modes", async () => {
  const app = await readFile(new URL("l-systems-app.js", root), "utf8");

  assert.match(app, /new VoicePool\(128, \{ adaptive: true, maxVoices: 4096 \}\)/);
  assert.match(app, /new FmDrumAudio\(globalThis\)/);
  assert.match(app, /new MicBranchEngine\(128, \{ adaptive: true, maxVoices: 4096 \}\)/);
  assert.match(app, /const MIX_PRESETS = Object\.freeze/);
  assert.match(app, /id: "balanced"/);
  assert.match(app, /id: "percussive-grid"/);
  assert.match(app, /traceLSystem/);
  assert.match(app, /advanceLSystemTraversal/);
  assert.match(app, /advanceLSystemDrumTraversal/);
  assert.match(app, /lSystemDrumEventsForTraversal/);
  assert.match(app, /micBranchPlaybackRate/);
  assert.match(app, /lSystemPlayingModeFor/);
  assert.match(app, /async function setMode\(modeId\)/);
  assert.match(app, /if \(state\.audio\) \{\s*try \{\s*await prepareActiveAudio\(\);/);
  assert.match(app, /function silenceAudioRoutes\(rampMilliseconds = 45\)/);
  assert.match(app, /clearError\(\);\s*\/\/ Mute the outgoing route[\s\S]*?silenceAudioRoutes\(\);\s*if \(activeAudioKind\(\) === "synth"\) \{\s*await synthPool\.enable\(\);/);
  assert.match(app, /const previousMode = state\.mode;\s*state\.mode = nextMode/);
  assert.match(app, /catch \(error\) \{\s*state\.mode = previousMode;[\s\S]*?restored = await prepareActiveAudio\(\);[\s\S]*?showError\(error\);/);
  assert.match(app, /state\.mode = nextMode/);
  assert.match(app, /state\.presetId/);
  assert.match(app, /state\.iterations/);
  assert.match(app, /state\.angle/);
  assert.match(app, /state\.lengthScale/);
  assert.match(app, /state\.position/);
  assert.match(app, /state\.structureMode/);
  assert.match(app, /for \(const bank of document\.querySelectorAll\("\[data-mode-bank\]"\)\)/);
  assert.match(app, /for \(const button of \$\("playingMode"\)\.querySelectorAll\("\[data-playing-mode\]"\)\)/);
  assert.match(app, /triggerNoteEvents\(sweptEvents\.events, 40\)/);
  assert.match(app, /eventIntervalSeconds\(eventCount\) \* state\.mic\.interval/);
  assert.match(app, /state\.level \* state\.mic\.inputTrim \* modeGain\("mic"\)/);
  assert.doesNotMatch(app, /\biframe\b/i);
  assert.doesNotMatch(app, /contentDocument/);
  assert.doesNotMatch(app, /l-systems-embed/);

  const setModeBody = app.match(/async function setMode\(modeId\) \{(?<body>[\s\S]*?)\n\}/)?.groups.body ?? "";
  assert.doesNotMatch(setModeBody, /state\.audio\s*=\s*false/);
  assert.doesNotMatch(setModeBody, /\.close\(/);
  assert.doesNotMatch(setModeBody, /\.disable\(/);
  assert.doesNotMatch(setModeBody, /presetId\s*=/);
  assert.doesNotMatch(setModeBody, /iterations\s*=/);
  assert.doesNotMatch(setModeBody, /angle\s*=/);
  assert.doesNotMatch(setModeBody, /lengthScale\s*=/);
  assert.doesNotMatch(setModeBody, /position\s*=/);
  assert.doesNotMatch(setModeBody, /structureMode\s*=/);
});

test("L-Systems lives in the Morphazoid Apps section", async () => {
  const [nav, catalog, midi] = await Promise.all([
    readFile(new URL("nav.js", root), "utf8"),
    readFile(new URL("src/instrument-catalog.js", root), "utf8"),
    readFile(new URL("src/instrument-midi-capabilities.js", root), "utf8"),
    access(new URL("assets/instruments/l-systems.webp", root)),
  ]);

  assert.match(nav, /freezeGroup\("apps", "Apps", \[[\s\S]*id: "l-systems", label: "L-Systems", href: "l-systems\.html"/);
  assert.match(catalog, /"l-systems": define\(/);
  assert.match(catalog, /Continuous, Notes, Triggers, and Mic playing modes/);
  assert.match(catalog, /"l-systems": Object\.freeze\(\["fractals-recursion", "geometry-drums", "mic-fx"\]\)/);
  assert.match(midi, /sequence: Object\.freeze\(\[\s*"l-systems"/);
  assert.match(midi, /const audioInputIds = new Set\(\[\s*"l-systems"/);
});
