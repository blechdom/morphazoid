import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  loadUtauBankFiles,
  utauBankAliases,
  vocalzoidAcceptedBankFiles,
} from "../src/vocalzoid-bank.js";
import {
  VOCALZOID_MAX_BANK_BYTES,
  VOCALZOID_MAX_BANK_FILES,
} from "../src/vocalzoid-audio.js";
import {
  VOCALZOID_OPEN_BANKS,
  vocalzoidOpenBank,
  vocalzoidOpenBankCoverage,
  vocalzoidOpenBankRecipe,
} from "../src/vocalzoid-open-banks.js";

const encoder = new TextEncoder();

function bytesOf(value) {
  if (typeof value === "string") return encoder.encode(value);
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return new Uint8Array();
}

function fakeFile(path, contents = "", { size } = {}) {
  const bytes = bytesOf(contents);
  return {
    name: path.replaceAll("\\", "/").split("/").at(-1),
    webkitRelativePath: path,
    size: size ?? bytes.byteLength,
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

function frqAtMidi(midi, hopSize = 256) {
  const bytes = new Uint8Array(20);
  bytes.set(encoder.encode("FREQ0003"));
  const view = new DataView(bytes.buffer);
  view.setInt32(8, hopSize, true);
  view.setFloat64(12, 440 * (2 ** ((midi - 69) / 12)), true);
  return bytes;
}

function waveChunks(buffer) {
  assert.ok(buffer.length >= 12, "WAV has a complete RIFF preamble");
  const chunks = new Map();
  let cursor = 12;
  while (cursor + 8 <= buffer.length) {
    const id = buffer.toString("ascii", cursor, cursor + 4);
    const size = buffer.readUInt32LE(cursor + 4);
    const dataOffset = cursor + 8;
    assert.ok(dataOffset + size <= buffer.length, `${id} chunk stays inside the file`);
    chunks.set(id, { dataOffset, size });
    cursor = dataOffset + size + (size % 2);
  }
  return chunks;
}

test("folder import combines nested OTO files, character metadata, and FRQ pitch data", async () => {
  const files = [
    fakeFile("Velvet Voice/character.txt", `\uFEFFname=Velvet Voice\n
author=Synth Gardener\n
voice=Fallback Author\n
web=https://example.test/velvet\n
name=Ignored duplicate\n`),
    fakeFile("Velvet Voice/oto.ini", `
Samples\\VO.WAV=V O,12,95,-18,42,8
Samples/missing.wav=missing,0,0,0,0,0
`),
    fakeFile("Velvet Voice/Sub/OTO.INI", "Alt.WAV=ah,5,80,-120,25,4\n"),
    fakeFile("Velvet Voice/Samples/vo.wav", Uint8Array.of(1, 2, 3, 4)),
    fakeFile("Velvet Voice/Sub/alt.WAV", Uint8Array.of(5, 6, 7, 8)),
    fakeFile("Velvet Voice/Samples/VO_wav.frq", frqAtMidi(57)),
    fakeFile("Velvet Voice/Sub/ALT_wav.frq", frqAtMidi(69)),
  ];

  const bank = await loadUtauBankFiles(files);

  assert.equal(bank.name, "Velvet Voice");
  assert.equal(bank.author, "Synth Gardener");
  assert.equal(bank.web, "https://example.test/velvet");
  assert.deepEqual(bank.entries.map(({ filename, path, alias }) => ({ filename, path, alias })), [
    {
      filename: "Samples/VO.WAV",
      path: "velvet voice/Samples/VO.WAV",
      alias: "V O",
    },
    {
      filename: "Alt.WAV",
      path: "velvet voice/sub/Alt.WAV",
      alias: "ah",
    },
  ]);
  assert.deepEqual([...bank.files.keys()], [
    "velvet voice/samples/vo.wav",
    "velvet voice/sub/alt.wav",
  ]);
  assert.deepEqual([...bank.sourceMidiByPath.keys()], [
    "velvet voice/samples/vo.wav",
    "velvet voice/sub/alt.wav",
  ]);
  assert.ok(Math.abs(bank.sourceMidiByPath.get("velvet voice/samples/vo.wav") - 57) < 1e-9);
  assert.ok(Math.abs(bank.sourceMidiByPath.get("velvet voice/sub/alt.wav") - 69) < 1e-9);
  assert.ok(Math.abs(bank.rootMidi - 63) < 1e-9, "the bank root is the median FRQ pitch");
  assert.deepEqual(bank.stats, {
    selectedFiles: 7,
    audioFiles: 2,
    otoFiles: 2,
    entries: 2,
    missingEntries: 1,
    frqFiles: 2,
    bytes: files.reduce((sum, file) => sum + file.size, 0),
  });
  assert.deepEqual(
    utauBankAliases(bank),
    ["V O", "ah"].sort((left, right) => left.localeCompare(right)),
  );
  assert.ok(Object.isFrozen(bank));
  assert.ok(Object.isFrozen(bank.stats));
});

test("folder import falls back to bank-folder identity and middle-C without metadata or valid FRQ", async () => {
  const bank = await loadUtauBankFiles([
    fakeFile("Plain Bank/oto.ini", "tone.wav=tone,0,80,-100,25,5\n"),
    fakeFile("Plain Bank/tone.wav", Uint8Array.of(1, 2)),
    fakeFile("Plain Bank/tone_wav.frq", "not a frequency table"),
  ]);

  assert.equal(bank.name, "plain bank");
  assert.equal(bank.author, "Unknown voice author");
  assert.equal(bank.web, "");
  assert.equal(bank.rootMidi, 60);
  assert.equal(bank.sourceMidiByPath.size, 0);
  assert.equal(bank.stats.frqFiles, 0);
});

test("accepted bank files include supported audio and UTAU sidecars but exclude unsafe paths", () => {
  const accepted = [
    fakeFile("Bank/a.wav"),
    fakeFile("Bank/a.WAVE"),
    fakeFile("Bank/a.aif"),
    fakeFile("Bank/a.AIFF"),
    fakeFile("Bank/a.flac"),
    fakeFile("Bank/a.OGG"),
    fakeFile("Bank/oto.ini"),
    fakeFile("Bank/Sub/OTO.INI"),
    fakeFile("Bank/character.txt"),
    fakeFile("Bank/a_wav.frq"),
  ];
  const rejected = [
    fakeFile("Bank/readme.txt"),
    fakeFile("Bank/icon.png"),
    fakeFile("Bank/../escape.wav"),
    fakeFile("../escape/oto.ini"),
  ];

  assert.deepEqual(vocalzoidAcceptedBankFiles([...accepted, ...rejected]), accepted);
  assert.deepEqual(vocalzoidAcceptedBankFiles(null), []);
});

test("folder import rejects unsafe, incomplete, oversized, and unreadable banks", async (context) => {
  const cases = [
    {
      name: "empty selection",
      files: [],
      message: /Choose an extracted UTAU bank folder/,
    },
    {
      name: "only path-traversing files",
      files: [fakeFile("Bank/../oto.ini", "tone.wav=tone,0,0,0,0,0")],
      message: /Choose an extracted UTAU bank folder/,
    },
    {
      name: "missing oto.ini",
      files: [fakeFile("Bank/tone.wav")],
      message: /No oto\.ini/,
    },
    {
      name: "missing audio",
      files: [fakeFile("Bank/oto.ini", "tone.wav=tone,0,0,0,0,0")],
      message: /No WAV or compatible audio samples/,
    },
    {
      name: "OTO without readable entries",
      files: [fakeFile("Bank/oto.ini", "not an oto line\n"), fakeFile("Bank/tone.wav")],
      message: /no readable sample entries/,
    },
    {
      name: "OTO whose samples are absent",
      files: [
        fakeFile("Bank/oto.ini", "missing.wav=missing,0,0,0,0,0\n"),
        fakeFile("Bank/present.wav"),
      ],
      message: /do not point to any selected audio samples/,
    },
    {
      name: "bank over the byte limit",
      files: [fakeFile("Bank/oto.ini", "", { size: VOCALZOID_MAX_BANK_BYTES + 1 })],
      message: /512 MB browser safety limit/,
    },
    {
      name: "unreadable metadata file",
      files: [
        {
          name: "oto.ini",
          webkitRelativePath: "Bank/oto.ini",
          size: 1,
        },
        fakeFile("Bank/tone.wav"),
      ],
      message: /Cannot read oto\.ini/,
    },
  ];

  for (const item of cases) {
    await context.test(item.name, async () => {
      await assert.rejects(loadUtauBankFiles(item.files), item.message);
    });
  }

  await context.test("bank over the file-count limit", async () => {
    const files = Array.from(
      { length: VOCALZOID_MAX_BANK_FILES + 1 },
      (_, index) => fakeFile(`Bank/sample-${index}.wav`),
    );
    await assert.rejects(
      loadUtauBankFiles(files),
      new RegExp(`more than ${VOCALZOID_MAX_BANK_FILES.toLocaleString()} files`),
    );
  });
});

test("open-bank manifests expose eight immutable demo voices and complete clip sets", () => {
  const expected = {
    air: {
      name: "OddVoices · Air",
      description: "Soft, breathy alto",
      rootMidi: 62,
      filename: "vocalzoid-oddvoices-air.wav",
    },
    cicada: {
      name: "OddVoices · Cicada",
      description: "Bright, buzzy baritone",
      rootMidi: 55,
      filename: "vocalzoid-oddvoices-cicada.wav",
    },
    quake: {
      name: "OddVoices · Quake",
      description: "Deep, dark bass",
      rootMidi: 44,
      filename: "vocalzoid-oddvoices-quake.wav",
      license: "CC0 1.0",
      sourceHref: "https://gitlab.com/oddvoices/oddvoices/-/tree/33a248af8df88edf5166593bf36b7e24e7bc1f94/voices/quake",
    },
    bdl: {
      name: "CMU ARCTIC · BDL",
      description: "Warm North Midland US male",
      rootMidi: 49,
      filename: "vocalzoid-cmu-arctic-bdl.wav",
    },
    clb: {
      name: "CMU ARCTIC · CLB",
      description: "Clear US female",
      rootMidi: 54,
      filename: "vocalzoid-cmu-arctic-clb.wav",
    },
    jmk: {
      name: "CMU ARCTIC · JMK",
      description: "Resonant Ontario Canadian male",
      rootMidi: 46,
      filename: "vocalzoid-cmu-arctic-jmk.wav",
    },
    ksp: {
      name: "CMU ARCTIC · KSP",
      description: "Focused Indian English male",
      rootMidi: 50,
      filename: "vocalzoid-cmu-arctic-ksp.wav",
    },
    slt: {
      name: "CMU ARCTIC · SLT",
      description: "Light North Midland US female",
      rootMidi: 54,
      filename: "vocalzoid-cmu-arctic-slt.wav",
    },
  };
  for (const [id, value] of Object.entries(expected)) {
    if (["air", "cicada"].includes(id)) {
      value.license = "CC0 1.0";
      value.sourceHref = `https://gitlab.com/oddvoices/oddvoices/-/tree/33a248af8df88edf5166593bf36b7e24e7bc1f94/voices/${id}`;
    } else if (!["quake"].includes(id)) {
      value.license = "CMU ARCTIC permissive";
      value.sourceHref = `http://festvox.org/cmu_arctic/cmu_arctic/cmu_us_${id}_arctic/`;
    }
  }
  const clipNames = ["voU", "oU", "k@", "@", "@l", "z_", "OI", "OId"];

  assert.deepEqual(Object.keys(VOCALZOID_OPEN_BANKS), Object.keys(expected));
  assert.ok(Object.isFrozen(VOCALZOID_OPEN_BANKS));
  for (const [id, manifest] of Object.entries(VOCALZOID_OPEN_BANKS)) {
    assert.equal(vocalzoidOpenBank(id), manifest);
    assert.equal(manifest.id, id);
    assert.equal(manifest.name, expected[id].name);
    assert.equal(manifest.description, expected[id].description);
    assert.equal(manifest.rootMidi, expected[id].rootMidi);
    assert.equal(basename(fileURLToPath(manifest.url)), expected[id].filename);
    assert.equal(manifest.license, expected[id].license);
    assert.equal(manifest.sourceHref, expected[id].sourceHref);
    assert.deepEqual(Object.keys(manifest.clips), clipNames);
    assert.ok(Object.isFrozen(manifest));
    assert.ok(Object.isFrozen(manifest.clips));
    assert.ok(Object.values(manifest.clips).every(Object.isFrozen));
  }
  assert.equal(vocalzoidOpenBank("missing"), null);
  assert.equal(vocalzoidOpenBank(), null);
});

test("open-bank recipes cover the default three syllables and reference every required clip", () => {
  const notes = [
    { phones: ["V", "OW"] },
    { phones: ["K", "AH", "L"] },
    { phones: ["Z", "OY", "D"] },
  ];
  const recipes = notes.map(vocalzoidOpenBankRecipe);

  assert.deepEqual(recipes, [
    { onset: "voU", sustain: "oU", release: null },
    { onset: "k@", sustain: "@", release: "@l" },
    { onset: "z_", sustain: "OI", release: "OId" },
  ]);
  assert.deepEqual([
    vocalzoidOpenBankRecipe({ phones: ["OW"] }),
    vocalzoidOpenBankRecipe({ phones: ["K", "AH"] }),
    vocalzoidOpenBankRecipe({ phones: ["AH", "L"] }),
    vocalzoidOpenBankRecipe({ phones: ["Z", "OY"] }),
    vocalzoidOpenBankRecipe({ phones: ["OY", "D"] }),
  ], [
    { onset: null, sustain: "oU", release: null },
    { onset: "k@", sustain: "@", release: null },
    { onset: null, sustain: "@", release: "@l" },
    { onset: "z_", sustain: "OI", release: null },
    { onset: null, sustain: "OI", release: "OId" },
  ]);
  assert.ok(recipes.every(Object.isFrozen));
  for (const bank of Object.values(VOCALZOID_OPEN_BANKS)) {
    for (const recipe of recipes) {
      for (const key of [recipe.onset, recipe.sustain, recipe.release].filter(Boolean)) {
        assert.ok(bank.clips[key], `${bank.id} supplies recipe clip ${key}`);
      }
    }
  }

  assert.equal(vocalzoidOpenBankRecipe({ phones: ["V", "AH"] }), null);
  assert.equal(vocalzoidOpenBankRecipe({}), null);
  assert.deepEqual(vocalzoidOpenBankCoverage([...notes, { phones: ["V", "AH"] }]), {
    matched: 3,
    total: 4,
    ratio: 0.75,
  });
  const emptyCoverage = vocalzoidOpenBankCoverage();
  assert.deepEqual(emptyCoverage, { matched: 0, total: 0, ratio: 0 });
  assert.ok(Object.isFrozen(emptyCoverage));
});

test("shipped demo sprites are mono PCM WAVs whose manifests and loops stay in bounds", async () => {
  const loopingClips = new Set(["oU", "@", "OI"]);
  const arcticIds = new Set(["bdl", "clb", "jmk", "ksp", "slt"]);

  for (const bank of Object.values(VOCALZOID_OPEN_BANKS)) {
    const path = fileURLToPath(bank.url);
    const wav = await readFile(path);
    assert.equal(wav.toString("ascii", 0, 4), "RIFF", `${bank.id} has a RIFF header`);
    assert.equal(wav.toString("ascii", 8, 12), "WAVE", `${bank.id} is a WAVE file`);
    assert.equal(wav.readUInt32LE(4) + 8, wav.length, `${bank.id} RIFF size matches its file`);

    const chunks = waveChunks(wav);
    const format = chunks.get("fmt ");
    const data = chunks.get("data");
    assert.ok(format, `${bank.id} has a format chunk`);
    assert.ok(data, `${bank.id} has an audio-data chunk`);
    assert.ok(format.size >= 16, `${bank.id} has a complete PCM format chunk`);

    const channels = wav.readUInt16LE(format.dataOffset + 2);
    const sampleRate = wav.readUInt32LE(format.dataOffset + 4);
    const byteRate = wav.readUInt32LE(format.dataOffset + 8);
    const blockAlign = wav.readUInt16LE(format.dataOffset + 12);
    const bitsPerSample = wav.readUInt16LE(format.dataOffset + 14);
    assert.equal(wav.readUInt16LE(format.dataOffset), 1, `${bank.id} uses integer PCM`);
    assert.equal(channels, 1, `${bank.id} is mono`);
    assert.equal(sampleRate, arcticIds.has(bank.id) ? 16_000 : 48_000, `${bank.id} uses its generator sample rate`);
    assert.equal(bitsPerSample, 16, `${bank.id} uses signed 16-bit samples`);
    assert.equal(blockAlign, channels * bitsPerSample / 8);
    assert.equal(byteRate, sampleRate * blockAlign);
    assert.equal(data.size % blockAlign, 0);

    const duration = data.size / byteRate;
    const frameTolerance = 1.5 / sampleRate;
    const clips = Object.entries(bank.clips).sort(
      ([, left], [, right]) => left.offset - right.offset,
    );
    let previousEnd = 0;
    for (const [name, clip] of clips) {
      assert.ok(Number.isFinite(clip.offset) && clip.offset >= 0, `${bank.id}/${name} offset`);
      assert.ok(Number.isFinite(clip.duration) && clip.duration > 0, `${bank.id}/${name} duration`);
      assert.ok(
        clip.offset + clip.duration <= duration + frameTolerance,
        `${bank.id}/${name} stays inside its WAV`,
      );
      assert.ok(clip.offset >= previousEnd - frameTolerance, `${bank.id}/${name} does not overlap`);
      assert.ok(
        clip.offset - previousEnd >= 0.021,
        `${bank.id}/${name} retains the generated silence separator`,
      );

      if (loopingClips.has(name)) {
        assert.ok(clip.loopStart >= 0, `${bank.id}/${name} loop starts in the clip`);
        assert.ok(clip.loopEnd <= clip.duration, `${bank.id}/${name} loop ends in the clip`);
        assert.ok(clip.loopEnd - clip.loopStart >= 0.06, `${bank.id}/${name} has a useful loop`);
      } else {
        assert.equal(clip.loopStart, 0, `${bank.id}/${name} does not declare a loop`);
        assert.equal(clip.loopEnd, 0, `${bank.id}/${name} does not declare a loop`);
      }
      previousEnd = clip.offset + clip.duration;
    }
    assert.ok(Math.abs(previousEnd - duration) <= frameTolerance, `${bank.id} final clip reaches EOF`);

    const pcm = wav.subarray(data.dataOffset, data.dataOffset + data.size);
    assert.ok(pcm.some((byte) => byte !== 0), `${bank.id} contains non-silent PCM`);
  }
});
