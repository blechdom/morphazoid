import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

import {
  SRTUSS_IMAGE_PROJECTS,
  SRTUSS_MAX_VOICES,
  SRTUSS_PENDING_SOUND_PROJECTS,
  SRTUSS_PLAYABLE_ORDER,
  SRTUSS_PROFILE_PROJECTS,
  SRTUSS_RUNTIME_DEFAULTS,
  SRTUSS_SOUND_PROJECTS,
  SRTUSS_TAPE_RATE_LIMITS,
  SRTUSS_VOICE_LIMITS,
  SRTUSS_WORKGROUP_SIZES,
  SrtussAudio,
  fadeSrtussHead,
  mixSrtussTransition,
  sanitizeSrtussRuntime,
  sanitizeSrtussVoices,
  srtussProjectById,
  srtussSupport,
  srtussVoiceMixSettings,
} from "../src/srtuss.js";
import {
  SRTUSS_MIX_PART_ID,
  SRTUSS_MASTER_FAMILIES,
  SRTUSS_MASTER_GLOBAL_DEFAULTS,
  SRTUSS_MASTER_PARAM_DEFAULTS,
  SRTUSS_MASTER_PARAM_LIMITS,
  SRTUSS_MASTER_PRESETS,
  SRTUSS_MASTER_PROJECT_IDS,
  SRTUSS_MASTER_STEM_DEFAULTS,
  sanitizeSrtussMasterPartId,
  sanitizeSrtussMasterParams,
  sanitizeSrtussMasterStems,
  srtussMasterPartIndex,
  srtussMasterParts,
} from "../src/srtuss-master.js";

const root = new URL("../", import.meta.url);

test("srtuss inventory keeps Sound and image projects explicit", () => {
  assert.equal(SRTUSS_PROFILE_PROJECTS.length, 27);
  assert.equal(SRTUSS_SOUND_PROJECTS.length, 10);
  assert.equal(SRTUSS_PENDING_SOUND_PROJECTS.length, 3);
  assert.equal(SRTUSS_IMAGE_PROJECTS.length, 14);
  assert.deepEqual(SRTUSS_SOUND_PROJECTS.map(({ id }) => id), SRTUSS_PLAYABLE_ORDER);
  assert.deepEqual(
    SRTUSS_PENDING_SOUND_PROJECTS.map(({ id }) => id),
    ["MdXXW2", "Xd2XDm", "4ddfWX"],
  );
  assert.equal(new Set(SRTUSS_PROFILE_PROJECTS.map(({ id }) => id)).size, 27);
  assert.ok(Object.isFrozen(SRTUSS_PROFILE_PROJECTS));
  assert.ok(Object.isFrozen(SRTUSS_SOUND_PROJECTS));
  assert.equal(srtussProjectById("MlBBRG"), null);
  assert.equal(srtussProjectById("MljSRt")?.title, "Chiptune (sound)");
});

test("every playable project carries exact-source provenance and one WGSL audio contract", () => {
  for (const project of SRTUSS_SOUND_PROJECTS) {
    assert.ok(Object.isFrozen(project), project.id + " metadata must be frozen");
    assert.equal(project.sourceUrl, "https://www.shadertoy.com/view/" + project.id);
    assert.match(project.sourceMirrorUrl, /^https:\/\//);
    assert.match(project.sourceDate, /^20\d\d(?:-\d\d-\d\d(?:T\d\d:\d\d:\d\dZ)?)?$/);
    assert.equal(project.license, "CC BY-NC-SA 3.0");
    assert.equal(project.licenseUrl, "https://creativecommons.org/licenses/by-nc-sa/3.0/");
    assert.ok(project.sourceCodeLength > 1000);
    assert.match(project.sourceSha256, /^[a-f0-9]{64}$/);
    assert.match(project.wgsl, /override WORKGROUP_SIZE: u32/);
    assert.match(project.wgsl, /override SAMPLE_RATE: f32/);
    assert.match(project.wgsl, /time_rate: f32/);
    assert.match(project.wgsl, /source_fraction: f32/);
    assert.match(project.wgsl, /f32\(local_sample\)\s*\*\s*\w+\.time_rate/);
    assert.match(project.wgsl, /\+\s*\w+\.source_fraction/);
    assert.match(project.wgsl, /source_duration\s*=\s*SAMPLE_RATE\s*\*\s*60\.0/);
    assert.match(project.wgsl, /floor\(unwrapped_source_position\s*\/\s*source_duration\)/);
    assert.match(project.wgsl, /fade_samples\s*=\s*max\(1\.0,\s*SAMPLE_RATE\s*\*\s*0\.01\s*\*\s*\w+\.time_rate\)/);
    assert.match(project.wgsl, /head_gain/);
    assert.match(project.wgsl, /tail_gain/);
    for (const binding of [0, 1, 2, 3]) {
      assert.match(project.wgsl, new RegExp("@group\\(0\\) @binding\\(" + binding + "\\)"));
    }
    assert.match(project.wgsl, /fn sourceMainSound\(\w+: i32,\s*\w+: f32\) -> vec2<f32>/);
    assert.match(project.wgsl, /@compute\s+@workgroup_size\(WORKGROUP_SIZE\)/);
    assert.match(project.wgsl, /fn synthesize/);
    assert.match(project.wgsl, /-0\.88/);
    assert.match(project.wgsl, /0\.88/);
    assert.doesNotMatch(project.wgsl, /fn mainImage/);
  }
  assert.deepEqual(
    SRTUSS_SOUND_PROJECTS.filter(({ usesTexture0 }) => usesTexture0).map(({ id }) => id),
    ["lldGDM", "ltKSRc", "4tdSDB"],
  );
  assert.match(srtussProjectById("ldfSW2").corroboratingSourceUrl, /audiojs\/audio-shader/);
  assert.match(srtussProjectById("ldfSW2").corroboratingSourceSha256, /^[a-f0-9]{64}$/);
});

test("runtime controls and support are explicit and bounded", () => {
  assert.deepEqual(SRTUSS_WORKGROUP_SIZES, [32, 64, 128, 256]);
  assert.deepEqual(SRTUSS_VOICE_LIMITS.timeRate, [0.125, 8]);
  assert.deepEqual(SRTUSS_TAPE_RATE_LIMITS, [0.5, 2]);
  assert.deepEqual(
    sanitizeSrtussRuntime({
      chunkDuration: 99,
      workgroupSize: 7,
      output: -5,
      pipelineCacheSize: 80,
    }),
    {
      chunkDuration: 0.25,
      workgroupSize: SRTUSS_RUNTIME_DEFAULTS.workgroupSize,
      output: 0,
      pipelineCacheSize: 24,
    },
  );
  assert.deepEqual(srtussSupport({}), { audio: false, webgpu: false, supported: false });
  assert.deepEqual(
    srtussSupport({
      AudioContext() {},
      navigator: { gpu: { requestAdapter() {} } },
    }),
    { audio: true, webgpu: true, supported: true },
  );
});

test("Pebbles texture upload preserves the source flip and completes before bitmap release", async () => {
  const events = [];
  const sourcePixels = new Uint8ClampedArray([
    1, 2, 3, 255, 5, 6, 7, 255,
    21, 22, 23, 255, 25, 26, 27, 255,
    41, 42, 43, 255, 45, 46, 47, 255,
  ]);
  const bitmap = {
    width: 2,
    height: 3,
    close() {
      events.push("close");
    },
  };
  const imageBlob = {};
  class FakeOffscreenCanvas {
    constructor(width, height) {
      assert.equal(width, bitmap.width);
      assert.equal(height, bitmap.height);
      events.push("canvas");
    }

    getContext(kind, options) {
      assert.equal(kind, "2d");
      assert.deepEqual(options, { alpha: true, willReadFrequently: true });
      return {
        drawImage(image, x, y, width, height) {
          assert.equal(image, bitmap);
          assert.deepEqual([x, y, width, height], [0, 0, bitmap.width, bitmap.height]);
          events.push("draw");
        },
        getImageData(x, y, width, height) {
          assert.deepEqual([x, y, width, height], [0, 0, bitmap.width, bitmap.height]);
          return { data: sourcePixels };
        },
      };
    }
  }
  const runtime = {
    async fetch(url) {
      assert.equal(url.pathname.endsWith("/assets/srtuss/pebbles.png"), true);
      events.push("fetch");
      return {
        ok: true,
        async blob() {
          return imageBlob;
        },
      };
    },
    async createImageBitmap(blob, options) {
      assert.equal(blob, imageBlob);
      assert.deepEqual(options, {
        colorSpaceConversion: "none",
        premultiplyAlpha: "none",
      });
      events.push("bitmap");
      return bitmap;
    },
    OffscreenCanvas: FakeOffscreenCanvas,
  };
  const channelTexture = {};
  let upload = null;
  const device = {
    queue: {
      copyExternalImageToTexture() {
        assert.fail("the known-zero external-image upload path must not be used");
      },
      writeTexture(destination, pixels, layout, size) {
        events.push("write");
        upload = {
          destination,
          pixels: Array.from(pixels),
          layout,
          size,
        };
      },
      async onSubmittedWorkDone() {
        events.push("complete");
      },
    },
  };
  const audio = new SrtussAudio(runtime);
  audio.device = device;
  audio.channelTexture = channelTexture;
  audio.lifecycleEpoch = 7;

  await audio.loadPebblesTexture(device, 7);

  assert.deepEqual(upload, {
    destination: { texture: channelTexture },
    pixels: [
      41, 42, 43, 255, 45, 46, 47, 255,
      21, 22, 23, 255, 25, 26, 27, 255,
      1, 2, 3, 255, 5, 6, 7, 255,
    ],
    layout: { bytesPerRow: 8, rowsPerImage: 3 },
    size: [2, 3, 1],
  });
  assert.deepEqual(events, [
    "fetch", "bitmap", "canvas", "draw", "write", "complete", "close",
  ]);
});

test("voice configuration is bounded, immutable, and defaults to one neutral layer", () => {
  const defaults = sanitizeSrtussVoices();
  assert.deepEqual(defaults, [{
    id: "voice-1",
    projectId: "MljSRt",
    mode: "original",
    partId: SRTUSS_MIX_PART_ID,
    groupId: "voice-1",
    enabled: true,
    solo: false,
    timeRate: 1,
    level: 1,
    pan: 0,
    width: 1,
    params: SRTUSS_MASTER_PARAM_DEFAULTS,
    stems: SRTUSS_MASTER_STEM_DEFAULTS,
  }]);
  assert.ok(Object.isFrozen(defaults));
  assert.ok(Object.isFrozen(defaults[0]));
  assert.equal(sanitizeSrtussVoices([null, 42], "XdSGz1").length, 2);
  assert.ok(sanitizeSrtussVoices([null], "XdSGz1")[0].projectId === "XdSGz1");

  const voices = sanitizeSrtussVoices([
    {
      id: "lead",
      projectId: "XdSGz1",
      enabled: false,
      timeRate: 99,
      level: -4,
      pan: 8,
      mode: "master",
      solo: true,
      width: 99,
      params: { tune: 999, drive: -999 },
      stems: { tone: 99, bass: -2 },
    },
    {
      id: "lead",
      projectId: "not-a-sound",
      timeRate: 0,
      level: 4,
      pan: -8,
    },
    ...Array.from({ length: SRTUSS_MAX_VOICES + 4 }, () => ({})),
  ], "Xd2GW3");
  assert.equal(voices.length, SRTUSS_MAX_VOICES);
  assert.equal(voices[0].id, "lead");
  assert.equal(voices[1].id, "lead-2");
  assert.equal(voices[1].projectId, "Xd2GW3");
  assert.equal(voices[0].timeRate, SRTUSS_VOICE_LIMITS.timeRate[1]);
  assert.equal(voices[1].timeRate, SRTUSS_VOICE_LIMITS.timeRate[0]);
  assert.equal(voices[0].level, 0);
  assert.equal(voices[1].level, 1);
  assert.equal(voices[0].pan, 1);
  assert.equal(voices[1].pan, -1);
  assert.equal(voices[0].mode, "master");
  assert.equal(voices[0].solo, true);
  assert.equal(voices[0].width, 1.5);
  assert.equal(voices[0].params.tune, 24);
  assert.equal(voices[0].params.drive, -1);
  assert.equal(voices[0].stems.tone, 1.25);
  assert.equal(voices[0].stems.bass, 0);
});

test("voice mixer preserves a neutral solo layer and adds deterministic headroom", () => {
  const solo = srtussVoiceMixSettings([{ projectId: "MljSRt" }]);
  assert.equal(solo[0].mixLevel, 1);
  assert.equal(solo[0].pan, 0);

  const layered = srtussVoiceMixSettings([
    { id: "a", projectId: "MljSRt", level: 0.75 },
    { id: "b", projectId: "XdSGz1", level: 0.75 },
    { id: "c", projectId: "Xd2GW3", enabled: false, level: 1 },
  ]);
  assert.equal(layered[0].mixLevel, 0.5);
  assert.equal(layered[1].mixLevel, 0.5);
  assert.equal(layered[2].mixLevel, 0);
  assert.ok(Object.isFrozen(layered));
  assert.ok(Object.isFrozen(layered[0]));

  const soloed = srtussVoiceMixSettings([
    { id: "a", projectId: "XdSGz1", level: 1 },
    { id: "b", projectId: "Xd2GW3", level: 0.5, solo: true },
  ]);
  assert.equal(soloed[0].mixLevel, 0);
  assert.equal(soloed[1].mixLevel, 0.5);
});

test("decomposed sibling parts share one song-sized headroom group", () => {
  const parts = srtussVoiceMixSettings([
    {
      id: "melody",
      groupId: "noir",
      projectId: "XdSGz1",
      mode: "master",
      partId: "melody",
    },
    {
      id: "bass",
      groupId: "noir",
      projectId: "XdSGz1",
      mode: "master",
      partId: "bass",
    },
  ]);
  assert.deepEqual(parts.map(({ mixLevel }) => mixLevel), [1, 1]);
});

test("stale or duplicate groups cannot bypass mixer headroom", () => {
  const shared = { groupId: "stale", projectId: "XdSGz1", mode: "master" };
  for (const voices of [
    [
      { ...shared, id: "mix", partId: SRTUSS_MIX_PART_ID },
      { ...shared, id: "melody", partId: "melody" },
    ],
    [
      { ...shared, id: "melody-a", partId: "melody" },
      { ...shared, id: "melody-b", partId: "melody" },
    ],
  ]) {
    const mixed = srtussVoiceMixSettings(voices);
    assert.deepEqual(mixed.map(({ mixLevel }) => mixLevel), [0.5, 0.5]);
  }
  const withSilent = srtussVoiceMixSettings([
    { id: "audible", projectId: "XdSGz1", level: 1 },
    { id: "silent", projectId: "Xd2GW3", level: 0 },
  ]);
  assert.deepEqual(withSilent.map(({ mixLevel }) => mixLevel), [1, 0]);
});

test("master schema covers eight decomposed families and full rack presets", () => {
  assert.deepEqual(SRTUSS_MASTER_PROJECT_IDS, [
    "XdSGz1", "Xd2GW3", "ldlfRS", "4tsGD8",
    "lldGDM", "ltKSRc", "4tdSDB", "MslBR4",
  ]);
  assert.equal(SRTUSS_MASTER_PRESETS.length, 28);
  assert.equal(SRTUSS_MASTER_GLOBAL_DEFAULTS.maxVoices, SRTUSS_MAX_VOICES);
  assert.equal(SRTUSS_MASTER_PRESETS.filter(({ mode }) => mode === "original").length, 8);
  const masterPresets = SRTUSS_MASTER_PRESETS.filter(({ mode }) => mode === "master");
  const partPresets = masterPresets.filter(({ kind }) => kind === "parts");
  assert.equal(masterPresets.length, 20);
  assert.equal(partPresets.length, 8);
  assert.equal(
    new Set(SRTUSS_MASTER_PRESETS.map(({ id }) => id)).size,
    SRTUSS_MASTER_PRESETS.length,
  );
  assert.ok(SRTUSS_MASTER_PRESETS.every(({ voices }) => voices.length <= SRTUSS_MAX_VOICES));
  assert.ok(masterPresets.some(({ voices }) => voices.length === 9));
  for (const projectId of SRTUSS_MASTER_PROJECT_IDS) {
    assert.ok(masterPresets.some(({ voices }) => voices[0]?.projectId === projectId));
  }
  for (const projectId of SRTUSS_MASTER_PROJECT_IDS) {
    assert.match(srtussProjectById(projectId).masterWgsl, /fn mzMasterFinish/);
  }
  assert.equal(srtussProjectById("MljSRt").masterWgsl, undefined);
  assert.equal(srtussProjectById("ldfSW2").masterWgsl, undefined);
  assert.ok(SRTUSS_MASTER_FAMILIES.every(({ supportedMacros }) => (
    supportedMacros.includes("drive")
  )));
  for (const projectId of ["Xd2GW3", "lldGDM", "ltKSRc"]) {
    const family = SRTUSS_MASTER_FAMILIES.find((candidate) => (
      candidate.projectId === projectId
    ));
    assert.ok(family.supportedStems.includes("bass"), projectId + " exposes its bass bus");
    assert.ok(family.supportedStems.includes("fx"), projectId + " exposes its effects bus");
  }
  assert.ok(
    SRTUSS_MASTER_FAMILIES.find(({ projectId }) => projectId === "ltKSRc")
      .supportedMacros.includes("space"),
  );
  for (const preset of masterPresets) {
    for (const voice of preset.voices) {
      for (const key of ["tune", "space", "drive"]) {
        const effective = preset.globals[key] + voice.params[key];
        const { min, max } = SRTUSS_MASTER_PARAM_LIMITS[key];
        assert.ok(
          effective > min && effective < max,
          preset.id + "/" + voice.id + " " + key + " starts at a clamp edge",
        );
      }
    }
  }
  assert.deepEqual(sanitizeSrtussMasterParams({ tune: Infinity }), SRTUSS_MASTER_PARAM_DEFAULTS);
  assert.deepEqual(sanitizeSrtussMasterStems({ tone: -9 }), {
    ...SRTUSS_MASTER_STEM_DEFAULTS,
    tone: 0,
  });
});

test("decomposed families expose stable selectors and synchronized part presets", () => {
  const partPresets = SRTUSS_MASTER_PRESETS.filter(({ kind }) => kind === "parts");
  for (const family of SRTUSS_MASTER_FAMILIES) {
    const parts = srtussMasterParts(family.projectId);
    const preset = partPresets.find(({ voices }) => voices[0]?.projectId === family.projectId);
    assert.ok(Object.isFrozen(parts), family.projectId + " parts must be immutable");
    assert.ok(parts.length >= 3 && parts.length <= SRTUSS_MAX_VOICES);
    assert.deepEqual(parts.map(({ index }) => index), (
      Array.from({ length: parts.length }, (_, index) => index + 1)
    ));
    assert.equal(new Set(parts.map(({ id }) => id)).size, parts.length);
    assert.ok(["step", "beat", "free"].includes(family.clockKind));
    assert.ok(preset, family.projectId + " needs a decomposed preset");
    assert.deepEqual(
      preset.voices.map(({ partId }) => partId),
      parts.map(({ id }) => id),
    );
    assert.equal(new Set(preset.voices.map(({ groupId }) => groupId)).size, 1);

    const masterWgsl = srtussProjectById(family.projectId).masterWgsl;
    assert.match(masterWgsl, /fn mzMasterPartSelection/);
    assert.doesNotMatch(srtussProjectById(family.projectId).wgsl, /fn mzMasterPartSelection/);
    for (const part of parts) {
      assert.equal(
        sanitizeSrtussMasterPartId(family.projectId, part.id, "master"),
        part.id,
      );
      assert.equal(srtussMasterPartIndex(family.projectId, part.id, "master"), part.index);
      assert.match(masterWgsl, new RegExp("mzMasterPart(?:Or|Not)?\\([^\\n]*" + part.index + "\\.0"));
    }
  }
  assert.equal(sanitizeSrtussMasterPartId("XdSGz1", "bogus", "master"), SRTUSS_MIX_PART_ID);
  assert.equal(sanitizeSrtussMasterPartId("XdSGz1", "melody", "original"), SRTUSS_MIX_PART_ID);
});

test("fractional voice positions survive rate scaling and uniform encoding", () => {
  const audio = new SrtussAudio({});
  audio.sampleRate = 44_100;

  const voice = {
    anchorTransportSample: 0,
    anchorSourceSample: 0,
    timeRate: 0.75,
  };

  assert.equal(audio.voiceSourcePosition(voice, 4_410), 3_307.5);

  const writes = [];
  audio.device = {
    queue: {
      writeBuffer(buffer, offset, bytes) {
        writes.push({ buffer, offset, bytes: bytes.slice(0) });
      },
    },
  };
  const uniformBuffer = {};

  audio.writeVoiceTime(uniformBuffer, 3_307.5, 0.75, {
    projectId: "ldlfRS",
    mode: "master",
    partId: "kick",
    params: { tune: 7, shape: -0.25, drive: 0.5 },
    stems: { tone: 0.4, bass: 0.5, percussion: 0.6, texture: 0.7, fx: 0.8 },
    width: 1.2,
  });
  let integers = new Uint32Array(writes.at(-1).bytes);
  let floats = new Float32Array(writes.at(-1).bytes);
  assert.equal(integers[0], 3_307);
  assert.equal(integers[1], 0);
  assert.equal(floats[2], 0.75);
  assert.equal(floats[3], 0.5);
  assert.equal(floats[4], 7);
  assert.equal(floats[5], -0.25);
  assert.equal(floats[12], 0.5);
  assert.ok(Math.abs(floats[13] - 0.4) < 1e-6);
  assert.ok(Math.abs(floats[17] - 0.8) < 1e-6);
  assert.ok(Math.abs(floats[18] - 1.2) < 1e-6);
  assert.equal(floats[19], 4);

  audio.writeVoiceTime(uniformBuffer, 44_100 * 60 + 123.25, 1);
  integers = new Uint32Array(writes.at(-1).bytes);
  floats = new Float32Array(writes.at(-1).bytes);
  assert.equal(integers[0], 123);
  assert.equal(integers[1], 0);
  assert.equal(floats[2], 1);
  assert.equal(floats[3], 0.25);
  assert.equal(floats[19], 0);
});

test("startup failure closes its owned AudioContext and clears the graph", async () => {
  let closed = 0;
  class FakeAudioContext {
    constructor() {
      this.state = "running";
      this.sampleRate = 48000;
      this.currentTime = 0;
      this.destination = null;
    }

    createGain() {
      return {
        gain: {
          value: 1,
          setTargetAtTime() {},
          cancelScheduledValues() {},
          setValueAtTime() {},
          linearRampToValueAtTime() {},
        },
        connect() {},
        disconnect() {},
      };
    }

    async close() {
      this.state = "closed";
      closed += 1;
    }
  }
  const runtime = {
    AudioContext: FakeAudioContext,
    GPUBufferUsage: { UNIFORM: 1, COPY_DST: 2, STORAGE: 4, COPY_SRC: 8, MAP_READ: 16 },
    GPUTextureUsage: { TEXTURE_BINDING: 1, COPY_DST: 2 },
    GPUMapMode: { READ: 1 },
    navigator: { gpu: { async requestAdapter() { return null; } } },
  };
  const audio = new SrtussAudio(runtime);
  await assert.rejects(audio.start(), /No WebGPU adapter/);
  assert.equal(closed, 1);
  assert.equal(audio.context, null);
  assert.equal(audio.master, null);
  assert.equal(audio.device, null);
});

test("playback gain is separately armed and reaches a scheduled zero", async () => {
  const events = [];
  const audio = new SrtussAudio({}, { output: 0.4 });
  audio.context = { currentTime: 3 };
  audio.master = {
    gain: {
      value: 0.4,
      setTargetAtTime(value, time, constant) {
        events.push({ type: "target", value, time, constant });
      },
      cancelScheduledValues(time) {
        events.push({ type: "cancel", time });
      },
      setValueAtTime(value, time) {
        events.push({ type: "set", value, time });
      },
      linearRampToValueAtTime(value, time) {
        events.push({ type: "linear", value, time });
      },
    },
  };
  audio.ready = true;
  await audio.setPlaybackEnabled(true);
  await audio.setPlaybackEnabled(false);
  assert.ok(events.some(({ type, value }) => type === "target" && value === 0.4));
  assert.ok(events.some(({ type, value }) => type === "linear" && value === 0));
  assert.equal(audio.playbackEnabled, false);
});

test("a stale Play resume cannot restart the timeline after Pause", async () => {
  let releaseResume;
  const audio = new SrtussAudio({});
  audio.ready = true;
  audio.context = {
    currentTime: 0,
    state: "suspended",
    resume() {
      return new Promise((resolve) => { releaseResume = resolve; });
    },
  };
  audio.input = {};
  audio.activeRenderer = {};
  audio.master = { gain: { value: 0 } };
  const stalePlay = audio.setPlaybackEnabled(true);
  await audio.setPlaybackEnabled(false);
  audio.context.state = "running";
  releaseResume();
  await stalePlay;
  assert.equal(audio.playbackEnabled, false);
  assert.equal(audio.running, false);
});

test("selection is transactional and reselecting active cancels stale pending audio", async () => {
  const a = srtussProjectById("MljSRt");
  const b = srtussProjectById("XdSGz1");
  const audio = new SrtussAudio({});
  audio.device = {};
  audio.ready = true;
  audio.running = true;
  const renderers = new Map([
    [a.id, { project: a, device: audio.device }],
    [b.id, { project: b, device: audio.device }],
  ]);
  audio.activeRenderer = renderers.get(a.id);
  audio.ensureRenderer = async (id) => renderers.get(id);
  await audio.selectProject(b.id);
  assert.equal(audio.pendingRenderer?.project.id, b.id);
  await audio.selectProject(a.id);
  assert.equal(audio.selectedProjectId, a.id);
  assert.equal(audio.pendingRenderer, null);
});

test("live voice additions preserve transport and commit together at a chunk boundary", async () => {
  const audio = new SrtussAudio({});
  audio.device = {};
  audio.ready = true;
  audio.running = true;
  audio.sampleRate = 48_000;
  audio.renderTransportSample = 48_000;
  audio.renderSampleOffset = 48_000;
  audio.timelineGeneration = 7;
  const renderers = new Map(SRTUSS_SOUND_PROJECTS.map((project) => [
    project.id,
    {
      project,
      device: audio.device,
      epoch: audio.lifecycleEpoch,
    },
  ]));
  let delaySecondary = false;
  let releaseSecondary;
  const secondaryReady = new Promise((resolve) => { releaseSecondary = resolve; });
  audio.ensureRenderer = async (id) => {
    if (delaySecondary && id === "XdSGz1") await secondaryReady;
    return renderers.get(id);
  };
  audio.activeVoices = await audio.ensureVoiceRenderers([{
    id: "voice-1",
    projectId: "MljSRt",
  }], audio.lifecycleEpoch, {
    anchorTransportSample: 0,
    preserveFrom: [],
  });
  audio.activeRenderer = audio.activeVoices[0].renderer;
  audio.voiceConfig = sanitizeSrtussVoices(audio.activeVoices);
  const source = {};
  audio.sources.add(source);
  audio.scheduledChunks = [{ source, offset: 47_000, startAt: 0, endAt: 2 }];

  delaySecondary = true;
  const update = audio.setVoices([
    {
      id: "voice-1",
      projectId: "MljSRt",
      timeRate: 1.2,
    },
    {
      id: "voice-2",
      projectId: "XdSGz1",
      level: 0.7,
      pan: 0.35,
    },
  ], { restart: false });
  await Promise.resolve();
  audio.renderTransportSample = 48_500;
  audio.renderSampleOffset = 48_500;
  releaseSecondary();
  await update;

  assert.equal(audio.running, true);
  assert.equal(audio.timelineGeneration, 7);
  assert.equal(audio.renderTransportSample, 48_500);
  assert.equal(audio.sources.size, 1);
  assert.equal(audio.pendingVoices.length, 2);
  assert.equal(audio.pendingStartOffset, null);
  assert.equal(audio.pendingVoices[0].anchorTransportSample, 48_500);
  assert.equal(audio.pendingVoices[0].anchorSourceSample, 48_500);
  assert.equal(audio.voiceSourcePosition(audio.pendingVoices[0], 48_600), 48_620);

  let renderCount = 0;
  audio.chunkNumSamples = 8;
  audio.renderTimelineChunk = async () => {
    renderCount += 1;
    return new Float32Array(8).fill(renderCount === 1 ? 0.2 : 0.4);
  };
  const rendered = await audio.renderActiveChunk(48_500, 7);
  assert.equal(rendered.offset, 48_500);
  assert.equal(audio.activeVoices.length, 2);
  assert.equal(audio.pendingVoices, null);
  assert.equal(audio.running, true);
  assert.equal(audio.sources.size, 1);
  assert.ok(Array.from(rendered.data).every(Number.isFinite));
  assert.ok(Array.from(rendered.data).every((value) => Math.abs(value) <= 0.88));
});

test("exploded part renderers clone the source phase without restarting", async () => {
  const audio = new SrtussAudio({});
  audio.device = {};
  audio.sampleRate = 48_000;
  audio.renderTransportSample = 96_000;
  const project = srtussProjectById("XdSGz1");
  const renderer = {
    project,
    mode: "master",
    device: audio.device,
    epoch: audio.lifecycleEpoch,
  };
  audio.ensureRenderer = async () => renderer;
  const previous = Object.freeze({
    ...sanitizeSrtussVoices([{
      id: "noir-mix",
      projectId: project.id,
      mode: "master",
      partId: SRTUSS_MIX_PART_ID,
      timeRate: 0.75,
    }], project.id)[0],
    renderer,
    anchorTransportSample: 12_000,
    anchorSourceSample: 3_456.5,
  });
  const voices = await audio.ensureVoiceRenderers([
    {
      id: "noir-melody",
      groupId: "noir-parts",
      projectId: project.id,
      mode: "master",
      partId: "melody",
      timeRate: 0.75,
    },
    {
      id: "noir-bass",
      groupId: "noir-parts",
      projectId: project.id,
      mode: "master",
      partId: "bass",
      timeRate: 0.75,
    },
  ], audio.lifecycleEpoch, {
    anchorTransportSample: 96_000,
    preserveFrom: [previous],
    phaseSources: {
      "noir-melody": previous.id,
      "noir-bass": previous.id,
    },
  });
  const expectedSourceSample = audio.voiceSourcePosition(previous, 96_000);
  assert.deepEqual(voices.map(({ partId }) => partId), ["melody", "bass"]);
  assert.deepEqual(voices.map(({ anchorTransportSample }) => anchorTransportSample), [96_000, 96_000]);
  assert.deepEqual(voices.map(({ anchorSourceSample }) => anchorSourceSample), [
    expectedSourceSample,
    expectedSourceSample,
  ]);
});

test("a voice update completed during an in-flight chunk rebases at the actual transition boundary", async () => {
  const project = srtussProjectById("MljSRt");
  const audio = new SrtussAudio({});
  audio.sampleRate = 1_000;
  audio.chunkNumSamples = 8;
  audio.ready = true;
  audio.running = true;
  audio.timelineGeneration = 9;
  audio.renderTransportSample = 1_000;
  audio.device = {};

  const renderer = { project, device: audio.device, epoch: audio.lifecycleEpoch };
  const [initialConfig] = sanitizeSrtussVoices([{
    id: "voice-a",
    projectId: project.id,
    timeRate: 1,
  }]);
  audio.voiceConfig = Object.freeze([initialConfig]);
  audio.activeVoices = Object.freeze([Object.freeze({
    ...initialConfig,
    renderer,
    anchorTransportSample: 0,
    anchorSourceSample: 0,
  })]);
  audio.activeRenderer = renderer;
  audio.ensureRenderer = async () => renderer;

  let releaseFirstRender;
  audio.renderTimelineChunk = () => new Promise((resolve) => {
    releaseFirstRender = resolve;
  });
  const inFlightChunk = audio.renderActiveChunk(1_000, audio.timelineGeneration);

  await audio.setVoices([{
    id: "voice-a",
    projectId: project.id,
    timeRate: 2,
  }], { restart: false });
  assert.equal(audio.pendingVoices[0].anchorTransportSample, 1_000);
  assert.equal(audio.pendingVoices[0].anchorSourceSample, 1_000);

  releaseFirstRender(new Float32Array(8).fill(0.5));
  await inFlightChunk;
  assert.ok(audio.pendingVoices);

  audio.renderTransportSample = 1_100;
  const renderStarts = [];
  audio.renderTimelineChunk = async (voices, sampleOffset) => {
    renderStarts.push({
      rate: voices[0].timeRate,
      sourcePosition: audio.voiceSourcePosition(voices[0], sampleOffset),
    });
    return new Float32Array(8).fill(0.5);
  };

  const transitioned = await audio.renderActiveChunk(1_100, audio.timelineGeneration);

  assert.deepEqual(renderStarts, [
    { rate: 1, sourcePosition: 1_100 },
    { rate: 2, sourcePosition: 1_100 },
  ]);
  assert.equal(audio.activeVoices[0].anchorTransportSample, 1_100);
  assert.equal(audio.activeVoices[0].anchorSourceSample, 1_100);
  assert.equal(audio.voiceSourcePosition(audio.activeVoices[0], 1_200), 1_300);
  assert.equal(audio.pendingVoices, null);
  assert.ok(Array.from(transitioned.data).every((sample) => Math.abs(sample - 0.5) < 1e-7));
});

test("restart reanchors both active and pending voice clocks without changing their rates", async () => {
  const activeProject = srtussProjectById("MljSRt");
  const pendingProject = srtussProjectById("XdSGz1");
  const audio = new SrtussAudio({});
  audio.sampleRate = 48_000;
  audio.ready = true;
  audio.renderTransportSample = 96_000;
  audio.renderSampleOffset = 96_000;

  const activeRenderer = { project: activeProject };
  const pendingRenderer = { project: pendingProject };
  const [activeConfig] = sanitizeSrtussVoices([{
    id: "active",
    projectId: activeProject.id,
    timeRate: 1.25,
  }]);
  const [pendingConfig] = sanitizeSrtussVoices([{
    id: "pending",
    projectId: pendingProject.id,
    timeRate: 0.75,
  }]);
  audio.activeVoices = Object.freeze([Object.freeze({
    ...activeConfig,
    renderer: activeRenderer,
    anchorTransportSample: 24_000,
    anchorSourceSample: 12_000,
  })]);
  audio.pendingVoices = Object.freeze([Object.freeze({
    ...pendingConfig,
    renderer: pendingRenderer,
    anchorTransportSample: 72_000,
    anchorSourceSample: 36_000,
  })]);
  audio.activeRenderer = activeRenderer;
  audio.pendingRenderer = pendingRenderer;

  await audio.restart(0);

  assert.equal(audio.renderTransportSample, 0);
  assert.equal(audio.renderSampleOffset, 0);
  assert.equal(audio.activeVoices[0].anchorTransportSample, 0);
  assert.equal(audio.activeVoices[0].anchorSourceSample, 0);
  assert.equal(audio.activeVoices[0].timeRate, 1.25);
  assert.equal(audio.pendingVoices[0].anchorTransportSample, 0);
  assert.equal(audio.pendingVoices[0].anchorSourceSample, 0);
  assert.equal(audio.pendingVoices[0].timeRate, 0.75);
  assert.equal(audio.voiceSourcePosition(audio.activeVoices[0], 100), 125);
  assert.equal(audio.voiceSourcePosition(audio.pendingVoices[0], 100), 75);
});

test("stopped transport alignment advances every saved voice phase without resetting it", () => {
  const project = srtussProjectById("XdSGz1");
  const audio = new SrtussAudio({});
  audio.sampleRate = 1_000;
  audio.ready = true;
  const renderer = { project };
  audio.activeVoices = Object.freeze([Object.freeze({
    ...sanitizeSrtussVoices([{
      id: "voice-a",
      projectId: project.id,
      mode: "master",
      timeRate: 2,
    }])[0],
    renderer,
    anchorTransportSample: 500,
    anchorSourceSample: 200,
  })]);
  audio.activeRenderer = renderer;
  audio.renderTransportSample = 1_000;
  audio.renderSampleOffset = 1_000;

  const aligned = audio.alignStoppedTransport(1.5);

  assert.equal(aligned, 1_500);
  assert.equal(audio.renderTransportSample, 1_500);
  assert.equal(audio.renderSampleOffset, 1_500);
  assert.equal(audio.activeVoices[0].anchorTransportSample, 1_500);
  assert.equal(audio.activeVoices[0].anchorSourceSample, 2_200);
  assert.equal(audio.voiceSourcePosition(audio.activeVoices[0], 1_600), 2_400);
});

test("voice phase snapshots restore through public start across sample-rate changes", async () => {
  const project = srtussProjectById("MljSRt");
  const audio = new SrtussAudio({});
  audio.sampleRate = 10;
  audio.device = {};
  const renderer = { project, device: audio.device, epoch: audio.lifecycleEpoch };
  audio.ensureRenderer = async () => renderer;

  const config = sanitizeSrtussVoices([{
    id: "voice-a",
    projectId: project.id,
    timeRate: 1.25,
  }]);
  audio.activeVoices = await audio.ensureVoiceRenderers(config, audio.lifecycleEpoch, {
    anchorTransportSample: 0,
    preserveFrom: [],
  });
  audio.activeRenderer = renderer;

  const transportSample = 750;
  const phases = audio.snapshotVoicePhases(transportSample);
  assert.deepEqual(phases, [{
    id: "voice-a",
    projectId: project.id,
    sourceSeconds: 33.75,
  }]);
  assert.ok(Object.isFrozen(phases));
  assert.ok(Object.isFrozen(phases[0]));

  const runtime = {
    navigator: { gpu: { requestAdapter() {} } },
  };
  const restoredAudio = new SrtussAudio(runtime, { voices: config });
  restoredAudio.initGpu = async () => {
    restoredAudio.device = { destroy() {} };
  };
  restoredAudio.ensureRenderer = async () => ({
    project,
    device: restoredAudio.device,
    epoch: restoredAudio.lifecycleEpoch,
  });
  const gainParam = {
    value: 0,
    cancelAndHoldAtTime() {},
    cancelScheduledValues() {},
    linearRampToValueAtTime() {},
    setTargetAtTime() {},
    setValueAtTime() {},
  };
  const context = {
    currentTime: 0,
    sampleRate: 20,
    state: "running",
    createGain() {
      return {
        gain: { ...gainParam },
        connect() {},
        disconnect() {},
      };
    },
  };

  await restoredAudio.start({
    autoStart: false,
    context,
    destination: {},
    transportSeconds: transportSample / audio.sampleRate,
    voicePhases: phases,
  });
  const restored = restoredAudio.activeVoices;

  assert.equal(restoredAudio.renderTransportSample, 1_500);
  assert.equal(restoredAudio.renderSampleOffset, 300);
  assert.equal(restored[0].anchorTransportSample, 1_500);
  assert.equal(restored[0].anchorSourceSample, 675);
  assert.equal(restoredAudio.voiceSourcePosition(restored[0], 1_500), 675);
  assert.equal(restoredAudio.voiceSourcePosition(restored[0], 1_520), 700);
  await restoredAudio.stop({ fade: false });
});

test("a stale shader compilation failure becomes an abort instead of a UI-facing error", async () => {
  const audio = new SrtussAudio({});
  audio.device = {};
  audio.ready = true;
  let rejectFirst;
  audio.ensureRenderer = (id) => {
    if (id === "XdSGz1") {
      return new Promise((_resolve, reject) => { rejectFirst = reject; });
    }
    return Promise.resolve({ project: srtussProjectById(id), device: audio.device });
  };
  const stale = audio.selectProject("XdSGz1");
  await audio.selectProject("Xd2GW3");
  rejectFirst(new Error("old compiler failure"));
  await assert.rejects(stale, { name: "AbortError" });
  assert.equal(audio.selectedProjectId, "Xd2GW3");
});

test("60-second boundary rendering wraps inside the chunk without skipping intro samples", async () => {
  const audio = new SrtussAudio({});
  audio.sampleRate = 10;
  audio.chunkNumSamplesPerChannel = 4;
  audio.chunkNumSamples = 8;
  audio.renderGpuChunk = async (_renderer, offset) => {
    const data = new Float32Array(8);
    for (let frame = 0; frame < 4; frame += 1) {
      data[frame * 2] = offset + frame;
      data[frame * 2 + 1] = offset + frame;
    }
    return data;
  };
  const result = await audio.renderTimelineChunk({}, 598);
  assert.deepEqual(
    [result[0], result[2], result[4], result[6]],
    [598, 599, 0, 1],
  );
});

test("shutdown is idempotent and rejects late public render work", async () => {
  const audio = new SrtussAudio({});
  audio.ready = true;
  audio.context = { currentTime: 0, state: "running" };
  audio.master = { gain: { value: 0 } };
  let releases = 0;
  audio.releaseAudioOutput = () => { releases += 1; };
  const first = audio.stop({ fade: false });
  const second = audio.stop({ fade: false });
  assert.equal(first, second);
  assert.equal(audio.ready, false);
  await assert.rejects(audio.renderProjectChunk("MljSRt"), { name: "AbortError" });
  await Promise.all([first, second]);
  assert.equal(releases, 1);
  assert.equal(audio.stopPromise, null);
});

test("shutdown stops voices and destroys every per-voice GPU resource exactly once", async () => {
  const audio = new SrtussAudio({});
  const destroyCounts = new Map();
  const resourceNames = [];
  const makeResource = (name) => {
    resourceNames.push(name);
    return {
      destroy() {
        destroyCounts.set(name, (destroyCounts.get(name) || 0) + 1);
      },
    };
  };

  const timeBuffers = Array.from(
    { length: SRTUSS_MAX_VOICES },
    (_, index) => makeResource("time-" + index),
  );
  audio.voiceTimeBuffers = timeBuffers;
  audio.timeInfoBuffer = timeBuffers[0];
  audio.voiceChunkBuffer = makeResource("voice-scratch-arena");
  audio.voiceChunkStride = 1024;
  audio.voiceMixBuffer = makeResource("voice-mix");
  audio.chunkBuffer = makeResource("chunk");
  audio.chunkMapBuffer = makeResource("chunk-map");
  audio.channelTexture = makeResource("channel-texture");
  audio.channelSampler = {};
  audio.device = makeResource("device");
  audio.voiceMixPipeline = {};
  audio.voiceMixBindGroup = {};
  audio.pipelineCache.set("cached", {});
  audio.pipelinePromises.set("pending", Promise.resolve());

  const stoppedAt = [];
  const sourceA = { stop: (when) => stoppedAt.push(when) };
  const sourceB = { stop: (when) => stoppedAt.push(when) };
  audio.sources.add(sourceA);
  audio.sources.add(sourceB);
  audio.scheduledChunks = [
    { source: sourceA, offset: 0, startAt: 0, endAt: 1, duration: 1 },
    { source: sourceB, offset: 1_000, startAt: 0.25, endAt: 1.25, duration: 1 },
  ];
  audio.activeVoices = Object.freeze([{ id: "active" }]);
  audio.pendingVoices = Object.freeze([{ id: "pending" }]);
  audio.activeRenderer = {};
  audio.pendingRenderer = {};
  audio.ready = true;
  audio.context = { currentTime: 0.5, state: "running" };
  audio.master = { gain: { value: 0 } };
  let released = 0;
  audio.releaseAudioOutput = () => { released += 1; };

  await audio.stop({ fade: false });

  assert.deepEqual(stoppedAt, [0.5, 0.5]);
  assert.equal(audio.sources.size, 0);
  assert.deepEqual(audio.scheduledChunks, []);
  for (const name of resourceNames) {
    assert.equal(destroyCounts.get(name), 1, name + " should be destroyed once");
  }
  assert.equal(released, 1);
  assert.deepEqual(audio.voiceTimeBuffers, []);
  assert.equal(audio.timeInfoBuffer, null);
  assert.equal(audio.voiceChunkBuffer, null);
  assert.equal(audio.voiceChunkStride, 0);
  assert.equal(audio.voiceMixBuffer, null);
  assert.equal(audio.chunkBuffer, null);
  assert.equal(audio.chunkMapBuffer, null);
  assert.equal(audio.channelTexture, null);
  assert.equal(audio.channelSampler, null);
  assert.equal(audio.device, null);
  assert.equal(audio.voiceMixPipeline, null);
  assert.equal(audio.voiceMixBindGroup, null);
  assert.equal(audio.pipelineCache.size, 0);
  assert.equal(audio.pipelinePromises.size, 0);
  assert.deepEqual(audio.activeVoices, []);
  assert.equal(audio.pendingVoices, null);
  assert.equal(audio.activeRenderer, null);
  assert.equal(audio.pendingRenderer, null);
});

test("sound changes use a finite bounded equal-power transition", () => {
  const previous = new Float32Array([1, -1, 0.75, -0.75, Number.NaN, Infinity]);
  const next = new Float32Array([-1, 1, -0.75, 0.75, 0.5, -0.5]);
  const mixed = mixSrtussTransition(previous, next, 100, 0.03);
  assert.equal(mixed.length, previous.length);
  assert.ok(Array.from(mixed).every(Number.isFinite));
  assert.ok(Array.from(mixed).every((value) => Math.abs(value) <= 0.88));
  assert.ok(mixed[0] > 0);
  assert.ok(mixed[4] > 0);
});

test("linear parameter transitions preserve steady amplitude without a gain bump", () => {
  const steadyAmplitude = 0.7;
  const previous = new Float32Array(8).fill(steadyAmplitude);
  const next = new Float32Array(8).fill(steadyAmplitude);

  const mixed = mixSrtussTransition(previous, next, 100, 0.04, "linear");

  assert.ok(Array.from(mixed).every(Number.isFinite));
  assert.ok(Array.from(mixed).every((sample) => Math.abs(sample - steadyAmplitude) < 1e-7));
  assert.ok(Array.from(mixed).every((sample) => sample <= steadyAmplitude + 1e-7));
});

test("neutral original-to-master swaps use the correlated-source transition", () => {
  const audio = new SrtussAudio({});
  const exact = [{
    id: "voice-a",
    projectId: "XdSGz1",
    mode: "original",
    timeRate: 1,
  }];
  const mapped = [{
    id: "voice-a",
    projectId: "XdSGz1",
    mode: "master",
    timeRate: 1,
    width: 1,
    params: SRTUSS_MASTER_PARAM_DEFAULTS,
    stems: SRTUSS_MASTER_STEM_DEFAULTS,
  }];
  assert.equal(audio.sameVoiceSources(exact, mapped), true);
  assert.equal(
    audio.sameVoiceSources(exact, [{
      ...mapped[0],
      params: { ...SRTUSS_MASTER_PARAM_DEFAULTS, tune: 7 },
    }]),
    false,
  );
  assert.equal(
    audio.sameVoiceSources(exact, [{
      ...mapped[0],
      partId: "melody",
    }]),
    false,
  );
  assert.equal(
    audio.sameVoiceSources(exact, [{ ...mapped[0], width: 1.25 }]),
    false,
  );
  assert.equal(
    audio.sameVoiceSources(exact, [{ ...mapped[0], timeRate: 1.5 }]),
    false,
  );
  assert.equal(
    audio.sameVoiceSources(exact, [{ id: "voice-a", projectId: "Xd2GW3", mode: "master" }]),
    false,
  );
});

test("underrun recovery fades a nonzero chunk in from silence", () => {
  const samples = new Float32Array(20).fill(0.8);
  assert.equal(fadeSrtussHead(samples, 100, 0.05), samples);
  assert.equal(samples[0], 0);
  assert.equal(samples[1], 0);
  assert.ok(samples[8] > 0.79);
  assert.ok(Array.from(samples).every(Number.isFinite));
});

test("page is a control-forward explicit-audio master synth with no shader viewport", async () => {
  const [html, app, css, notices] = await Promise.all([
    readFile(new URL("srtuss.html", root), "utf8"),
    readFile(new URL("srtuss-app.js", root), "utf8"),
    readFile(new URL("srtuss.css", root), "utf8"),
    readFile(new URL("THIRD_PARTY_NOTICES.md", root), "utf8"),
  ]);

  assert.match(html, /sound only · no image shader/);
  assert.match(html, /class="shell srtuss-shell"/);
  assert.match(html, /class="stage srtuss-workbench"/);
  assert.match(html, /class="panel srtuss-editor"/);
  const workbenchStart = html.indexOf('class="stage srtuss-workbench"');
  const editorStart = html.indexOf('class="panel srtuss-editor"');
  const transportStart = html.indexOf('class="srtuss-transport"');
  const selectedPartStart = html.indexOf("srtuss-selected-voice");
  assert.ok(
    workbenchStart < editorStart && editorStart < transportStart && transportStart < selectedPartStart,
    "primary transport should be the first session control in the right editor pane",
  );
  assert.match(html, /id="synthPlayLabel"/);
  assert.match(html, /id="synthPlayState"/);
  assert.match(html, /class="group control-section srtuss-section/);
  const appVersion = html.match(/srtuss-app\.js\?v=([^"]+)/)?.[1];
  assert.ok(appVersion, "the SRTUSS app should have a cache version");
  assert.match(app, new RegExp('from "\\.\\/src\\/srtuss\\.js\\?v=' + appVersion + '"'));
  assert.match(app, new RegExp('from "\\.\\/src\\/srtuss-master\\.js\\?v=' + appVersion + '"'));
  assert.match(html, /Local server required/);
  assert.match(html, /npm run dev/);
  assert.match(html, /id="masterControls"/);
  assert.match(html, /id="rackControls"/);
  for (const id of [
    "previousVoice", "macroVoiceSelect", "nextVoice",
    "macroTargetName", "macroControlCount",
  ]) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  for (const id of ["globalClock", "globalTune", "globalWidth", "globalSpace", "globalDrive"]) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  assert.ok(
    html.indexOf('id="rackControls"') < html.indexOf('id="voiceDeck"')
      && html.indexOf('id="voiceDeck"') < html.indexOf('id="masterControls"'),
    "rack globals, selectable parts, and their knobs should appear in causal order",
  );
  assert.match(html, /id="presetButtons"/);
  assert.match(html, /id="selectedVoicePart"/);
  assert.match(html, /id="explodeSelectedVoice"/);
  assert.match(html, /id="addVoice"[^>]*disabled/);
  assert.match(html, /id="voiceDeck"/);
  assert.match(html, /id="selectedVoiceMode"/);
  assert.doesNotMatch(html, /id="nativeControls"/);
  assert.doesNotMatch(html, /id="selectedVoiceEnabled"|id="selectedVoiceSolo"/);
  assert.doesNotMatch(html, /id="macroTargetFocus"/);
  assert.match(app, /button\.dataset\.voiceAction = action/);
  assert.match(html, /Add another voice to combine any sound source and internal part/);
  assert.match(html, /id="stemControls"/);
  assert.match(html, /id="originalButtons"/);
  assert.match(html, /7\/16 parts/);
  assert.ok(
    html.indexOf('id="audioButton"') < html.indexOf('id="output"')
      && html.indexOf('id="output"') < html.indexOf('id="synthPlayButton"'),
    "Audio and output should remain in the masthead before the instrument transport",
  );
  assert.match(html, /data-primary-transport/);
  assert.match(html, /3 source-pending sounds/);
  assert.match(html, /13<\/b>\s*authored Sound passes/);
  assert.match(html, /14<\/b>\s*image-only works excluded/);
  assert.match(html, /renders no image passes/);
  assert.doesNotMatch(html, /<canvas/i);
  assert.doesNotMatch(html, /<video/i);
  assert.doesNotMatch(html, /id="nextProject"|id="voiceRack"/);

  assert.match(app, /autoStart: false/);
  assert.match(app, /setText\("synthPlayLabel"/);
  assert.match(app, /setText\("synthPlayState"/);
  assert.match(app, /state\.audioStatus === "on" && engine\?\.sampleRate/);
  assert.match(app, /nextEngine\.alignStoppedTransport\(joinSeconds\)/);
  assert.match(app, /resolvedRuntimeVoices/);
  assert.match(app, /partId,/);
  assert.match(app, /groupId: voice\.groupId/);
  assert.match(app, /stems: masterMode && partId === SRTUSS_MIX_PART_ID/);
  assert.match(app, /function explodeSelectedVoice/);
  assert.match(app, /targetEngine\.setVoices\(resolvedRuntimeVoices\(snapshot\), \{\s*restart: false,\s*phaseSources,/);
  assert.match(app, /mode: masterMode \? "master" : "original"/);
  assert.match(app, /markRuntimeReady\(\)/);
  assert.match(app, /scheduleSceneCommit/);
  assert.match(app, /function updateRackGlobal/);
  assert.match(app, /audioStopPromise/);
  assert.match(app, /setAudioStatus\("stopping"\)/);
  assert.match(app, /addEventListener\("pagehide", handlePageHide\)/);
  assert.match(app, /addEventListener\("pageshow", handlePageShow\)/);
  assert.match(app, /randomizeSelectedVoice/);
  assert.match(app, /mutateSelectedVoice/);
  assert.match(app, /SRTUSS_MAX_VOICES/);
  assert.doesNotMatch(app, /createOscillator/);

  assert.match(css, /\.srtuss-page \.srtuss-knob-shelf/);
  assert.match(css, /\.srtuss-page \.srtuss-transport \{[\s\S]*position: sticky/);
  assert.match(css, /\.srtuss-page \.srtuss-rack-controls/);
  assert.match(css, /\.srtuss-page \.srtuss-voice-deck/);
  assert.match(css, /\.srtuss-page \.srtuss-native-controls/);
  assert.match(css, /\.srtuss-page \.srtuss-stem-controls/);
  assert.doesNotMatch(css, /font-size: clamp\(3\.5rem, 7\.5vw, 8rem\)/);
  assert.match(css, /@media \(pointer: coarse\)/);
  assert.match(css, /\.srtuss-page \.audio-button,/);
  assert.match(notices, /srtuss WebGPU master synth and Sound archive/);
});

test("pinned Pebbles channel asset is exact", async () => {
  const asset = new URL("assets/srtuss/pebbles.png", root);
  const bytes = await readFile(asset);
  const details = await stat(asset);
  assert.equal(details.size, 101929);
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    "4d0c9886f97a362824c1e21d26ff40a16469564c4ad7e0ce73aab5b392541b04",
  );
});
