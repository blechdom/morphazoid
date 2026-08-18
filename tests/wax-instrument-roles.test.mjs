import assert from "node:assert/strict";
import test from "node:test";

import { filterWaxSupport } from "../wax-page.js";
import { INSTRUMENTS } from "../src/instrument-catalog.js";
import {
  WAX_INSTRUMENT_SUPPORT,
  WAX_ROLE_DEFINITIONS,
  WAX_ROLE_IDS,
  waxSupportForId,
} from "../src/wax-instrument-roles.js";

const validRoleIds = new Set(Object.values(WAX_ROLE_IDS));

test("every catalog instrument has exactly one complete WAX support record", () => {
  assert.equal(WAX_INSTRUMENT_SUPPORT.length, INSTRUMENTS.length);
  assert.deepEqual(
    WAX_INSTRUMENT_SUPPORT.map(({ id }) => id),
    INSTRUMENTS.map(({ id }) => id),
  );
  assert.equal(
    new Set(WAX_INSTRUMENT_SUPPORT.map(({ id }) => id)).size,
    WAX_INSTRUMENT_SUPPORT.length,
  );

  for (const support of WAX_INSTRUMENT_SUPPORT) {
    assert.equal(waxSupportForId(support.id), support);
    assert.ok(validRoleIds.has(support.recommended), `${support.id} has an invalid recommendation`);
    assert.ok(support.roles.includes(support.recommended), `${support.id} omits its recommendation`);
    assert.equal(new Set(support.roles).size, support.roles.length, `${support.id} repeats a role`);
    assert.equal(
      support.roles.every((roleId) => validRoleIds.has(roleId)),
      true,
      `${support.id} has an unknown role`,
    );
    assert.equal(typeof support.audioInput, "boolean");
    assert.equal(typeof support.midiInput, "boolean");
    assert.ok(["native", "universal-control"].includes(support.midiInputMode));
    assert.ok(["midi", "page", "none"].includes(support.computerKeyboardMode));
    assert.equal(typeof support.midiOutput, "boolean");
    assert.equal(typeof support.hostSync, "boolean");
    assert.ok(["pitched", "drums", "sequence", "processor"].includes(support.noteMode));
    assert.ok(support.summary.length >= 45, `${support.id} needs a useful summary`);
    assert.equal(support.midiOutput, support.roles.includes(WAX_ROLE_IDS.midiFx));
    assert.equal(support.hostSync && !support.midiOutput, false);
  }
  assert.equal(waxSupportForId("not-an-instrument"), null);
});

test("the three WAX roles define fixed DAW inputs and outputs", () => {
  assert.deepEqual(Object.keys(WAX_ROLE_DEFINITIONS), ["instrument", "audio-fx", "midi-fx"]);
  assert.deepEqual(
    Object.values(WAX_ROLE_DEFINITIONS).map(({ label }) => label),
    ["WAX Instrument", "WAX Audio FX", "WAX MIDI FX"],
  );
  assert.equal(WAX_ROLE_DEFINITIONS.instrument.output, "Audio");
  assert.equal(WAX_ROLE_DEFINITIONS["audio-fx"].input, "Track audio");
  assert.equal(WAX_ROLE_DEFINITIONS["midi-fx"].output, "MIDI");
});

test("input processors are conservative previews and musical generators expose useful alternatives", () => {
  for (const id of [
    "lumber",
    "micmic",
    "graph-delay",
    "sandy-syrup-delay",
    "striped-sludge-delay",
    "candy-coil-delay",
    "recursion",
  ]) {
    const support = waxSupportForId(id);
    assert.equal(support.recommended, WAX_ROLE_IDS.audioFx);
    assert.match(support.caveat, /Preview.*DAW track-input capture/i);
  }

  assert.deepEqual(waxSupportForId("chaotic-fm").roles, [WAX_ROLE_IDS.instrument]);
  assert.equal(waxSupportForId("chaotic-fm").midiInputMode, "native");
  assert.equal(waxSupportForId("cascading-fm").midiInputMode, "universal-control");
  assert.deepEqual(
    waxSupportForId("rubix").roles,
    [WAX_ROLE_IDS.instrument, WAX_ROLE_IDS.midiFx],
  );
  assert.equal(waxSupportForId("rubix").hostSync, true);
  assert.equal(waxSupportForId("throatazoid").roles.includes(WAX_ROLE_IDS.audioFx), true);
  assert.match(waxSupportForId("webgpu-303").caveat, /WebGPU support/i);
});

test("the role catalog search and role filters use the central support records", () => {
  const graphMatches = filterWaxSupport({ query: "Graph Delay" });
  assert.deepEqual(graphMatches.map(({ id }) => id), ["graph-delay"]);

  const midiMatches = filterWaxSupport({ role: WAX_ROLE_IDS.midiFx });
  assert.ok(midiMatches.length > 20);
  assert.equal(midiMatches.every(({ midiOutput }) => midiOutput), true);

  const drumMidiMatches = filterWaxSupport({ query: "drum", role: WAX_ROLE_IDS.midiFx });
  assert.ok(drumMidiMatches.some(({ id }) => id === "rubix"));
  assert.equal(drumMidiMatches.every(({ roles }) => roles.includes(WAX_ROLE_IDS.midiFx)), true);
});
