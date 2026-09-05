import { expect, test } from "@playwright/test";

import { INSTRUMENTS } from "../src/instrument-catalog.js";
import {
  INSTRUMENT_MIDI_CAPABILITIES,
  NATIVE_INSTRUMENT_MIDI_IDS,
} from "../src/instrument-midi-capabilities.js";
import {
  MIDI_BYTES,
  enableFakeMidi,
  installFakeMidi,
  midiClockSequence,
  sendMidi,
  sendMidiSequence,
} from "./helpers/fake-midi.mjs";

test("the MIDI requirement declaration accounts for all 128 catalogue instruments", async ({}, testInfo) => {
  testInfo.annotations.push({
    type: "scope",
    description: "This registry declares required route-level MIDI availability and mapping ownership. It does not prove that each route currently satisfies the requirement.",
  });

  const instrumentsById = new Map(INSTRUMENTS.map((instrument) => [instrument.id, instrument]));
  const capabilitiesById = new Map(
    INSTRUMENT_MIDI_CAPABILITIES.map((capability) => [capability.id, capability]),
  );
  const matrix = INSTRUMENTS.map((instrument) => ({
    id: instrument.id,
    label: instrument.label,
    href: instrument.href,
    ...capabilitiesById.get(instrument.id),
  }));

  await testInfo.attach("midi-requirement-matrix.json", {
    body: JSON.stringify(matrix, null, 2),
    contentType: "application/json",
  });

  expect(INSTRUMENTS).toHaveLength(128);
  expect(INSTRUMENT_MIDI_CAPABILITIES).toHaveLength(128);
  expect(capabilitiesById.size).toBe(128);
  expect([...capabilitiesById.keys()].sort()).toEqual([...instrumentsById.keys()].sort());
  expect(
    INSTRUMENT_MIDI_CAPABILITIES.filter(({ midiInputMode }) => midiInputMode === "native")
      .map(({ id }) => id)
      .sort(),
  ).toEqual([...NATIVE_INSTRUMENT_MIDI_IDS].sort());

  for (const capability of INSTRUMENT_MIDI_CAPABILITIES) {
    expect(capability.midiInput, `${capability.id} must explicitly declare MIDI input`).toBe(true);
    expect(["native", "universal-control"], `${capability.id} has an unknown input owner`)
      .toContain(capability.midiInputMode);
    expect(["processor", "drums", "pitched", "sequence"], `${capability.id} lacks a note policy`)
      .toContain(capability.noteMode);
    expect(["midi", "page", "none"], `${capability.id} lacks a keyboard ownership policy`)
      .toContain(capability.computerKeyboardMode);
    expect(typeof capability.midiOutput, `${capability.id} must explicitly classify MIDI output`)
      .toBe("boolean");
    expect(instrumentsById.get(capability.id)?.href, `${capability.id} needs a routable page`)
      .toMatch(/(?:\.html|\/)$/);
  }
});

test("native MIDI receives note-on, note-off, and a standard CC on Recursive FM", async ({ page }, testInfo) => {
  testInfo.annotations.push({
    type: "scope",
    description: "The test keeps audio off and observes the native MIDI monitor and parameter state; audible output is covered by the Web Audio suite.",
  });
  await installFakeMidi(page);
  await page.goto("recursive-fm.html", { waitUntil: "load" });

  const snapshot = await enableFakeMidi(page);
  expect(snapshot.requests).toEqual([{ sysex: false, software: false }]);
  expect(snapshot.inputs).toEqual([
    expect.objectContaining({ state: "connected", listenerCount: 1 }),
  ]);
  await expect(page.locator("#sharedMidiToggle")).toHaveAttribute("aria-pressed", "true");

  await sendMidi(page, MIDI_BYTES.noteOn(60, 96));
  await expect(page.locator("#midiActivity")).toContainText("C4 · velocity 96");

  await sendMidi(page, MIDI_BYTES.noteOff(60));
  await expect(page.locator("#midiActivity")).toContainText("C4 released");

  const releaseBefore = await page.locator("#ampReleaseMs").inputValue();
  await sendMidi(page, MIDI_BYTES.controlChange(72, 127));
  await expect(page.locator("#midiActivity")).toHaveText("CC72 · 127");
  await expect(page.locator("#ampReleaseMs")).not.toHaveValue(releaseBefore);
  await expect(page.locator("#ampReleaseMsOut")).toHaveText("10 s");
});

test("the universal adapter handles an exact note, semantic CC, clock, and transport", async ({ page }, testInfo) => {
  testInfo.annotations.push({
    type: "coverage",
    description: "Graph Synth represents universal-control pages: notes use its exact public-event hook, while CC, 24-PPQN clock, Start, and Stop use shared fallbacks.",
  });
  testInfo.annotations.push({
    type: "intentional",
    description: "Graph pulses are one-shots, so note-off has no page-level gate to assert here; native note-off is asserted on Recursive FM.",
  });
  await installFakeMidi(page);
  await page.goto("graph-synth.html", { waitUntil: "load" });
  await enableFakeMidi(page);

  await sendMidi(page, MIDI_BYTES.noteOn(69, 100));
  await expect(page.locator("#liveStatus")).toContainText("Graph pulse launched");

  await sendMidi(page, MIDI_BYTES.controlChange(7, 127));
  await expect(page.locator("#output")).toHaveValue("0.9");
  await expect(page.locator("#outputOut")).toHaveText("90%");

  await sendMidi(page, MIDI_BYTES.start);
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");

  await sendMidiSequence(page, midiClockSequence({ bpm: 120, pulses: 32, startAt: 1000 }));
  await expect(page.locator("#tempo")).toHaveValue("120");
  await expect(page.locator("#tempoOut")).toHaveText("120 BPM");

  await sendMidi(page, MIDI_BYTES.stop);
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "false");
});
