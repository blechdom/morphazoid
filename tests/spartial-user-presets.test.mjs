import assert from "node:assert/strict";
import test from "node:test";
import {
  SPARTIAL_FULL_PRESETS, SPARTIAL_PRESET_FILE_LIMIT, SPARTIAL_USER_PRESET_LIMIT,
  captureSpartialPreset, emptySpartialPresetBank,
  mergeSpartialPresetBanks, parseSpartialPresetBank, removeSpartialUserPreset, saveSpartialUserPreset,
  spartialPresetMenuBank, spartialPresetName, stringifySpartialPresetBank,
} from "../src/instruments/spartial/full-presets.js";

const scene = index => SPARTIAL_FULL_PRESETS[index].snapshot;

test("saved scenes capture complete musical settings but never session/device state", () => {
  const source = structuredClone(scene(1));
  const captured = captureSpartialPreset({
    ...source, settings: { ...source.settings, level: 0.13, speakerCount: 12, rotation: .4,
      granularSource: "file", grainFreeze: true },
  });
  const first = saveSpartialUserPreset(emptySpartialPresetBank(), "  My   orbit  ", captured);
  assert.equal(first.id, "user-1");
  assert.equal(first.replaced, false);
  assert.equal(first.bank.presets[0].name, "My orbit");
  assert.deepEqual(first.bank.presets[0].snapshot, source);
  assert.equal(first.bank.presets[0].snapshot.settings.level, undefined);
  assert.equal(first.bank.presets[0].snapshot.settings.speakerCount, undefined);
  assert.equal(first.bank.presets[0].snapshot.settings.granularSource, undefined);
  assert.equal(first.bank.presets[0].snapshot.settings.grainFreeze, undefined);
  const menu = spartialPresetMenuBank(first.bank);
  assert.equal(menu.length, SPARTIAL_FULL_PRESETS.length + 1);
  assert.deepEqual(menu.at(-1), { id: "user-1", label: "My · My orbit", snapshot: source });
  assert.deepEqual(source, scene(1), "saving never mutates the source snapshot");
  const overwritten = saveSpartialUserPreset(first.bank, "my orbit", scene(2));
  assert.equal(overwritten.id, first.id);
  assert.equal(overwritten.replaced, true);
  assert.equal(overwritten.bank.nextId, 2);
  assert.deepEqual(first.bank.presets[0].snapshot, scene(1));
  const removed = removeSpartialUserPreset(overwritten.bank, first.id);
  assert.equal(removed.presets.length, 0);
  assert.equal(saveSpartialUserPreset(removed, "New", scene(3)).id, "user-2", "deleted IDs are not reused");
  assert.throws(() => removeSpartialUserPreset(removed, first.id), RangeError);
});

test("versioned download contains factory and saved scenes; storage contains only saved scenes", () => {
  const bank = saveSpartialUserPreset(emptySpartialPresetBank(), "Glass", scene(3)).bank;
  const stored = stringifySpartialPresetBank(bank);
  assert.equal(JSON.parse(stored).factoryPresets, undefined);
  assert.deepEqual(parseSpartialPresetBank(stored), bank);
  const download = stringifySpartialPresetBank(bank, { includeFactory: true });
  const json = JSON.parse(download);
  assert.equal(json.format, "morphazoid-spartial-presets");
  assert.equal(json.version, 1);
  assert.equal(json.factoryPresets.length, SPARTIAL_FULL_PRESETS.length);
  assert.equal(json.factoryPresets[0].id, SPARTIAL_FULL_PRESETS[0].id);
  assert.deepEqual(json.presets, bank.presets);
  assert.deepEqual(parseSpartialPresetBank(download), bank, "factory records cannot replace current built-ins");
});

test("import merges atomically by name, preserving existing IDs and unrelated saves", () => {
  let current = saveSpartialUserPreset(emptySpartialPresetBank(), "Halo", scene(1)).bank;
  current = saveSpartialUserPreset(current, "Local", scene(2)).bank;
  let incoming = saveSpartialUserPreset(emptySpartialPresetBank(), "halo", scene(4)).bank;
  incoming = saveSpartialUserPreset(incoming, "Remote", scene(5)).bank;
  const before = structuredClone(current);
  const { bank, added, updated } = mergeSpartialPresetBanks(current, parseSpartialPresetBank(stringifySpartialPresetBank(incoming)));
  assert.equal(added, 1);
  assert.equal(updated, 1);
  assert.deepEqual(current, before);
  assert.equal(bank.presets.find(item => item.name === "halo").id, "user-1");
  assert.deepEqual(bank.presets.find(item => item.name === "halo").snapshot, scene(4));
  assert.deepEqual(bank.presets.find(item => item.name === "Local").snapshot, scene(2));
  assert.equal(bank.presets.find(item => item.name === "Remote").id, "user-3", "colliding imported IDs must not overwrite local entries");
  assert.equal(bank.nextId, 4);
  const repeated = mergeSpartialPresetBanks(bank, incoming);
  assert.equal(repeated.added, 0);
  assert.equal(repeated.updated, 0);
  assert.deepEqual(repeated.bank, bank);
  const fresh = mergeSpartialPresetBanks(emptySpartialPresetBank(), incoming).bank;
  assert.deepEqual(fresh, incoming, "restoring an export into an empty bank retains its IDs and next ID");
});

test("malformed, incompatible, unsafe and oversized imports cannot change a bank", () => {
  const bank = saveSpartialUserPreset(emptySpartialPresetBank(), "One", scene(0)).bank;
  const before = structuredClone(bank);
  const valid = JSON.parse(stringifySpartialPresetBank(bank));
  const invalid = [
    { ...valid, version: 2 },
    { ...valid, format: "another-instrument" },
    { ...valid, nextId: 1 },
    { ...valid, presets: [...valid.presets, valid.presets[0]] },
    { ...valid, presets: [...valid.presets, { ...valid.presets[0], id: "user-2", name: "one" }] },
    { ...valid, presets: [{ ...valid.presets[0], name: " " }] },
    { ...valid, presets: [{ ...valid.presets[0], id: "still" }] },
    { ...valid, presets: [{ ...valid.presets[0], snapshot: { ...scene(0), chord: "unrecognized" } }] },
    { ...valid, presets: [{ ...valid.presets[0], snapshot: {
      ...scene(0), settings: { ...scene(0).settings, drive: 3 },
    } }] },
  ];
  for (const item of invalid) assert.throws(() => parseSpartialPresetBank(JSON.stringify(item)));
  for (const text of ["{", "null", "x".repeat(SPARTIAL_PRESET_FILE_LIMIT + 1)]) {
    assert.throws(() => parseSpartialPresetBank(text));
  }
  assert.throws(() => spartialPresetName("   "), RangeError);
  assert.throws(() => spartialPresetName("a".repeat(65)), RangeError);
  assert.throws(() => saveSpartialUserPreset(bank, "New", { ...scene(0), settings: { ...scene(0).settings, attack: -1 } }), TypeError);
  assert.deepEqual(bank, before);
});

test("a full saved bank refuses new saves or overflowing merges without partial changes", () => {
  let bank = emptySpartialPresetBank();
  for (let i = 0; i < SPARTIAL_USER_PRESET_LIMIT; i++) {
    bank = saveSpartialUserPreset(bank, `Scene ${i}`, scene(0)).bank;
  }
  const before = structuredClone(bank);
  assert.throws(() => saveSpartialUserPreset(bank, "Overflow", scene(1)), RangeError);
  const incoming = saveSpartialUserPreset(emptySpartialPresetBank(), "Overflow", scene(1)).bank;
  assert.throws(() => mergeSpartialPresetBanks(bank, incoming), RangeError);
  assert.deepEqual(bank, before);
  assert.equal(parseSpartialPresetBank(stringifySpartialPresetBank(bank)).presets.length, SPARTIAL_USER_PRESET_LIMIT);
});
