import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { TOOL_GROUPS, resolveActiveTool } from "../nav.js";
import { instrumentById } from "../src/instrument-catalog.js";
import {
  PAGE_KEYBOARD_INSTRUMENT_IDS,
  instrumentMidiCapabilityForId,
} from "../src/instrument-midi-capabilities.js";

const root = new URL("../", import.meta.url);

test("Throat Singing ships one research-labelled physical-model page", async () => {
  const [html, css, app, build, research, icon] = await Promise.all([
    readFile(new URL("throat-singing.html", root), "utf8"),
    readFile(new URL("throat-singing.css", root), "utf8"),
    readFile(new URL("throat-singing-app.js", root), "utf8"),
    readFile(new URL("scripts/build-site.sh", root), "utf8"),
    readFile(new URL("THROAT_SINGING_RESEARCH.md", root), "utf8"),
    readFile(new URL("assets/instruments/throat-singing.webp", root)),
  ]);

  assert.match(html, /<h1 class="sr-only">Throat Singing physical-model synthesizer<\/h1>/);
  assert.match(html, /id="stage"[\s\S]*aria-describedby="canvasInstructions liveStatus"/);
  assert.match(html, /id="singButton"[\s\S]*data-primary-transport/);
  assert.match(html, /id="singButton"[\s\S]*aria-keyshortcuts="Space"/);
  assert.match(html, /id="inhaleAudibility"/);
  assert.match(html, /voiceless filtered breath[\s\S]*not inspiratory phonation/i);
  assert.match(html, /id="styleMorphPanel"[\s\S]*id="styleMorphFrom"[\s\S]*id="styleMorph"[\s\S]*id="styleMorphTo"/);
  assert.match(html, /Interior positions are exploratory synthesis, not named singing traditions/);
  assert.match(html, /Beyond anatomy[\s\S]*Speculative sound lab/);
  assert.match(html, /id="phantomAirways"[\s\S]*id="impossibleFocus"[\s\S]*id="sourceInstability"/);
  assert.match(html, /id="resetButton"[\s\S]*data-reset-in-place/);
  assert.match(html, /A model of acoustics, not a model of a culture/);
  assert.match(html, /Inuit katajjaq:[\s\S]*intentionally not reduced to a preset/);
  assert.match(html, /https:\/\/elifesciences\.org\/articles\/50476/);
  assert.match(html, /https:\/\/ich\.unesco\.org\/en\/RL\/mongolian-traditional-art-of-khoomei-00396/);

  assert.match(css, /@media \(max-width: 650px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /:focus-visible/);

  assert.match(app, /new globalThis\.AudioWorkletNode\(audio, "throatazoid-tract"/);
  assert.match(app, /postMessage\(\{ type: "configure", state: tractState \}\)/);
  assert.match(app, /glottalHarmonics/);
  assert.match(app, /dividerOscillator\.frequency/);
  assert.match(app, /ventricularFoldSupercycle/);
  assert.match(app, /dividerOscillator\.setPeriodicWave/);
  assert.match(app, /interpolateThroatSingingStates/);
  assert.match(app, /glottalOscillators/);
  assert.match(app, /crossfadeWaveGains/);
  assert.match(app, /sourceWaveMuted/);
  assert.doesNotMatch(app, /dividerOscillator\.type\s*=\s*"square"/);
  assert.match(app, /connect\(inhaleGain, mix\)/);
  assert.match(app, /setValueCurveAtTime/);
  assert.match(app, /key === "i"/);
  assert.match(app, /dualFocusTargets/);
  assert.doesNotMatch(app, /\bfetch\s*\(/);
  assert.doesNotMatch([html, css, app].join("\n"), /\.(?:wav|mp3|ogg|flac|aiff?)\b/i);

  for (const path of [
    "throat-singing.html",
    "throat-singing.css",
    "throat-singing-app.js",
    "src/throat-singing.js",
    "THROAT_SINGING_RESEARCH.md",
    "assets/instruments/throat-singing.webp",
  ]) {
    assert.match(build, new RegExp(path.replaceAll(".", "\\.")));
  }
  assert.equal(icon.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(icon.subarray(8, 12).toString("ascii"), "WEBP");
  assert.ok(icon.length > 1_000);

  assert.match(research, /44-section bidirectional travelling-wave tract/);
  assert.match(research, /Kargyraa is not an unrelated octave-down oscillator/);
  assert.match(research, /Katajjaq remains out of scope/);
  assert.match(research, /Tongue, whistle-like percept, and actual whistles/);
  assert.match(research, /Breath intake versus inspiratory phonation/);
  assert.match(research, /Source-filter coupling and speculative extensions/);
});

test("Throat Singing is adjacent to its tract lineage and owns its keyboard", () => {
  const voiceTools = TOOL_GROUPS.find(({ id }) => id === "voice-synths")?.tools ?? [];
  const throatIndex = voiceTools.findIndex(({ id }) => id === "throat-singing");
  assert.equal(voiceTools[throatIndex - 1]?.id, "pink-trombonazoid");
  assert.deepEqual(voiceTools[throatIndex], {
    id: "throat-singing",
    label: "Throat Singing",
    href: "throat-singing.html",
  });
  assert.equal(resolveActiveTool(new URL("throat-singing.html", root).href)?.id, "throat-singing");

  const catalogue = instrumentById("throat-singing");
  assert.equal(catalogue?.kind, "Physical overtone voice");
  assert.match(catalogue?.description ?? "", /one 44-section airway/);
  for (const feature of ["Built-in source", "Pointer", "Computer keys", "Physical-model DSP", "MIDI"]) {
    assert.ok(catalogue?.features.includes(feature), `catalogue needs ${feature}`);
  }

  const midi = instrumentMidiCapabilityForId("throat-singing");
  assert.equal(midi?.noteMode, "pitched");
  assert.equal(midi?.computerKeyboardMode, "page");
  assert.ok(PAGE_KEYBOARD_INSTRUMENT_IDS.includes("throat-singing"));
});
