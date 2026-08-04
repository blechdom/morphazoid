import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const parametersUrl = new URL(
  "../contracts/chaotic-fm-parameters-v2.json",
  import.meta.url,
);
const performanceUrl = new URL(
  "../contracts/chaotic-fm-performance-v2.md",
  import.meta.url,
);

async function parameterContract() {
  return JSON.parse(await readFile(parametersUrl, "utf8"));
}

test("Chaotic FM v2 exposes stable synthesis and performance parameter IDs", async () => {
  const contract = await parameterContract();
  const ids = contract.parameters.map(({ id }) => id);
  const keys = contract.parameters.map(({ key }) => key);

  assert.equal(contract.schemaVersion, 2);
  assert.equal(contract.instrument, "morphazoid.chaotic-fm");
  assert.equal(new Set(ids).size, ids.length, "parameter IDs must be unique");
  assert.equal(new Set(keys).size, keys.length, "parameter keys must be unique");
  for (const id of [
    "synthesis.depth",
    "synthesis.carrierHz",
    "synthesis.offsetHz",
    "synthesis.modulationAmount",
    "synthesis.amountDivisor",
    "synthesis.nonlinearityHz",
    "performance.playMode",
    "performance.rootMidiNote",
    "performance.pitchBendRangeSemitones",
    "performance.ampAttackMs",
    "performance.ampDecayMs",
    "performance.ampSustainLevel",
    "performance.ampReleaseMs",
    "performance.glideTimeMs",
    "performance.glideMode",
    "output.level",
  ]) {
    assert.ok(ids.includes(id), `missing stable parameter ${id}`);
  }
});

test("Chaotic FM v2 freezes portable envelope and glide ranges", async () => {
  const contract = await parameterContract();
  const parameters = new Map(
    contract.parameters.map((parameter) => [parameter.id, parameter]),
  );

  assert.deepEqual(
    {
      minimum: parameters.get("performance.ampAttackMs")?.minimum,
      minimumNonzero:
        parameters.get("performance.ampAttackMs")?.minimumNonzero,
      maximum: parameters.get("performance.ampAttackMs")?.maximum,
      default: parameters.get("performance.ampAttackMs")?.default,
      curve: parameters.get("performance.ampAttackMs")?.curve,
    },
    {
      minimum: 0,
      minimumNonzero: 0.5,
      maximum: 5_000,
      default: 8,
      curve: "log-zero",
    },
  );
  assert.deepEqual(
    {
      minimum: parameters.get("performance.ampDecayMs")?.minimum,
      minimumNonzero:
        parameters.get("performance.ampDecayMs")?.minimumNonzero,
      maximum: parameters.get("performance.ampDecayMs")?.maximum,
      default: parameters.get("performance.ampDecayMs")?.default,
      curve: parameters.get("performance.ampDecayMs")?.curve,
    },
    {
      minimum: 0,
      minimumNonzero: 1,
      maximum: 5_000,
      default: 120,
      curve: "log-zero",
    },
  );
  assert.deepEqual(
    {
      minimum: parameters.get("performance.ampReleaseMs")?.minimum,
      maximum: parameters.get("performance.ampReleaseMs")?.maximum,
      default: parameters.get("performance.ampReleaseMs")?.default,
      curve: parameters.get("performance.ampReleaseMs")?.curve,
    },
    { minimum: 2, maximum: 10_000, default: 180, curve: "log" },
  );
  assert.deepEqual(
    {
      minimum: parameters.get("performance.glideTimeMs")?.minimum,
      minimumNonzero:
        parameters.get("performance.glideTimeMs")?.minimumNonzero,
      maximum: parameters.get("performance.glideTimeMs")?.maximum,
      default: parameters.get("performance.glideTimeMs")?.default,
      curve: parameters.get("performance.glideTimeMs")?.curve,
    },
    {
      minimum: 0,
      minimumNonzero: 10,
      maximum: 2_000,
      default: 0,
      curve: "log-zero",
    },
  );
});

test("Chaotic FM v2 factory MIDI uses standard performance controllers", async () => {
  const contract = await parameterContract();
  const mappings = new Map(contract.factoryMidi.map((mapping) => [mapping.cc, mapping]));

  assert.equal(mappings.get(5)?.target, "performance.glideTimeMs");
  assert.equal(mappings.get(11)?.target, "performance.expression");
  assert.equal(mappings.get(64)?.target, "performance.sustain");
  assert.equal(mappings.get(65)?.target, "performance.glideEnabled");
  assert.equal(mappings.get(72)?.target, "performance.ampReleaseMs");
  assert.equal(mappings.get(73)?.target, "performance.ampAttackMs");
  assert.equal(mappings.get(75)?.target, "performance.ampDecayMs");
  assert.equal(mappings.get(72)?.curve, "log");
  assert.equal(mappings.get(73)?.curve, "log-zero");
  assert.equal(mappings.get(75)?.curve, "log-zero");
  assert.equal(mappings.get(120)?.action, "allSoundOff");
  assert.equal(mappings.get(121)?.action, "resetAllControllers");
  assert.equal(mappings.get(123)?.action, "allNotesOff");

  for (const mapping of contract.factoryMidi) {
    if (mapping.cc >= 120 && mapping.cc <= 127) {
      assert.equal(
        mapping.learnable,
        false,
        `channel-mode CC${mapping.cc} must not be learnable`,
      );
    }
  }
});

test("Chaotic FM v2 freezes envelope, glide, and live-spectrum behavior", async () => {
  const contract = await readFile(performanceUrl, "utf8");

  assert.match(contract, /attack 8 ms, decay 120 ms, sustain 0\.72, release 180 ms/i);
  assert.match(contract, /linear interpolation in semitone space/i);
  assert.match(contract, /CC120 All Sound Off performs a dedicated 2 ms safety fade/);
  assert.match(contract, /CC123 All Notes Off.*normal\s+release segment/is);
  assert.match(contract, /non-scrolling live spectrum/i);
  assert.match(contract, /2048-point FFT/);
  assert.match(contract, /-90 to 0 dB/);
  assert.match(contract, /discrete vertical frequency bars/i);
  assert.match(contract, /oscilloscope is simultaneous with the spectrum/i);
  assert.match(contract, /waveform is painted\s+afterward/i);
});
