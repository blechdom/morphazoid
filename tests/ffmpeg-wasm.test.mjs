import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CHUNK_SECONDS,
  DEFAULT_SETTINGS,
  FFMPEG_CORE_VERSION,
  FFMPEG_WRAPPER_VERSION,
  MAX_QUEUED_CHUNKS,
  RECIPES,
  bytesToFloat32,
  createFfmpegCommand,
  createFilterGraph,
  downsampleWaveform,
  encodeMonoWav,
  float32ToBytes,
  pushBoundedQueue,
  sanitizeSettings,
} from "../src/ffmpeg-wasm.js";
import { instrumentMidiCapabilityForId } from "../src/instrument-midi-capabilities.js";

const root = new URL("../", import.meta.url);
const text = (path) => readFile(new URL(path, root), "utf8");

test("FFmpeg recipes and capture settings are fixed, finite, and bounded", () => {
  assert.deepEqual(CHUNK_SECONDS, [0.5, 1, 2]);
  assert.equal(MAX_QUEUED_CHUNKS, 2);
  assert.deepEqual(
    RECIPES.map(({ id }) => id),
    ["clean", "telephone", "tremolo", "crusher", "reverse"],
  );

  assert.deepEqual(
    sanitizeSettings({ recipe: "unknown", chunkSeconds: 99, outputLevel: Infinity }),
    { recipe: DEFAULT_SETTINGS.recipe, chunkSeconds: 2, outputLevel: DEFAULT_SETTINGS.outputLevel },
  );
  assert.deepEqual(
    sanitizeSettings({ recipe: "crusher", chunkSeconds: 1.8, outputLevel: 4 }),
    { recipe: "crusher", chunkSeconds: 2, outputLevel: 0.65 },
  );

  const graph = createFilterGraph({ recipe: "telephone", chunkSeconds: 0.5 });
  assert.match(graph, /^highpass=f=350,lowpass=f=3200,/);
  assert.match(graph, /atrim=duration=0\.5/);
  assert.match(graph, /alimiter=limit=0\.9$/);
  assert.equal(graph.includes(";"), false);
});

test("FFmpeg command construction accepts only virtual filenames and allowlisted graphs", () => {
  const command = createFfmpegCommand({
    inputName: "mic-3.f32",
    outputName: "processed-3.f32",
    sampleRate: 48_000,
    settings: { recipe: "clean", chunkSeconds: 1 },
  });

  assert.equal(Object.isFrozen(command), true);
  assert.deepEqual(command.slice(0, 11), [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "f32le",
    "-ar",
    "48000",
    "-ac",
    "1",
    "-i",
    "mic-3.f32",
  ]);
  assert.equal(command.at(-1), "processed-3.f32");
  assert.match(command[command.indexOf("-af") + 1], /^anull,/);
  assert.throws(() => createFfmpegCommand({
    inputName: "../escape.f32",
    outputName: "out.f32",
    sampleRate: 48_000,
    settings: DEFAULT_SETTINGS,
  }), /simple FFmpeg virtual filename/);
});

test("raw PCM conversion is little-endian, finite, clipped, and length-bounded", () => {
  const bytes = float32ToBytes(new Float32Array([-2, -0.25, Number.NaN, 2]));
  const view = new DataView(bytes.buffer);
  assert.equal(view.getFloat32(0, true), -1);
  assert.equal(view.getFloat32(4, true), -0.25);
  assert.equal(view.getFloat32(8, true), 0);
  assert.equal(view.getFloat32(12, true), 1);

  const roundTrip = bytesToFloat32(bytes, 3);
  assert.deepEqual([...roundTrip], [-1, -0.25, 0]);
  const malformedTail = new Uint8Array([...bytes, 1, 2, 3]);
  assert.equal(bytesToFloat32(malformedTail).length, 4);
});

test("WAV export and waveform summaries remain client-side and bounded", () => {
  const wav = encodeMonoWav(new Float32Array([-1, 0, 1]), 48_000);
  assert.equal(Buffer.from(wav.subarray(0, 4)).toString("ascii"), "RIFF");
  assert.equal(Buffer.from(wav.subarray(8, 12)).toString("ascii"), "WAVE");
  assert.equal(new DataView(wav.buffer).getUint32(24, true), 48_000);
  assert.equal(new DataView(wav.buffer).getUint32(40, true), 6);

  const summary = downsampleWaveform(new Float32Array([0.1, -0.8, 0.2, 0.6]), 2);
  assert.deepEqual([...summary], [-0.800000011920929, 0.6000000238418579]);
});

test("queue policy retains the newest two windows and reports stale drops", () => {
  const first = pushBoundedQueue([], "one");
  const second = pushBoundedQueue(first.queue, "two");
  const third = pushBoundedQueue(second.queue, "three");
  assert.deepEqual([...third.queue], ["two", "three"]);
  assert.deepEqual([...third.dropped], ["one"]);
  assert.equal(Object.isFrozen(third.queue), true);
});

test("capture worklet emits exact overlapping mono windows and never monitors dry input", async () => {
  const previous = {
    AudioWorkletProcessor: globalThis.AudioWorkletProcessor,
    registerProcessor: globalThis.registerProcessor,
    sampleRate: globalThis.sampleRate,
  };
  let processorName = "";
  let ProcessorConstructor = null;

  class FakeAudioWorkletProcessor {
    constructor() {
      this.port = {
        sent: [],
        closed: false,
        onmessage: null,
        close: () => { this.port.closed = true; },
        postMessage: (data, transfer) => {
          this.port.sent.push({ data, transfer });
        },
      };
    }
  }

  globalThis.AudioWorkletProcessor = FakeAudioWorkletProcessor;
  globalThis.sampleRate = 1_000;
  globalThis.registerProcessor = (name, constructor) => {
    processorName = name;
    ProcessorConstructor = constructor;
  };

  try {
    await import(`../src/ffmpeg-wasm-capture-processor.js?test=${Date.now()}`);
    assert.equal(processorName, "morphazoid-ffmpeg-wasm-capture");
    const processor = new ProcessorConstructor();
    processor.port.onmessage({
      data: { type: "start", chunkFrames: 128, overlapFrames: 8 },
    });

    const left = Float32Array.from({ length: 128 }, (_, index) => index / 128);
    const right = new Float32Array(128);
    const output = new Float32Array(128).fill(1);
    assert.equal(processor.process([[left, right]], [[output]]), true);
    assert.equal(output.every((sample) => sample === 0), true);
    assert.equal(processor.port.sent.length, 1);

    const first = processor.port.sent[0];
    assert.equal(first.data.samples.length, 128);
    assert.equal(first.data.samples[64], 0.25);
    assert.deepEqual(first.transfer, [first.data.samples.buffer]);

    processor.process([[new Float32Array(120).fill(0.5)]], [[new Float32Array(120)]]);
    assert.equal(processor.port.sent.length, 2);
    assert.deepEqual(
      [...processor.port.sent[1].data.samples.subarray(0, 8)],
      [...first.data.samples.subarray(120)],
    );

    const boundaryProcessor = new ProcessorConstructor();
    boundaryProcessor.port.onmessage({
      data: { type: "start", chunkFrames: 130, overlapFrames: 2 },
    });
    const firstRamp = Float32Array.from({ length: 128 }, (_, index) => index);
    const secondRamp = Float32Array.from({ length: 128 }, (_, index) => index + 128);
    const thirdRamp = Float32Array.from({ length: 128 }, (_, index) => index + 256);
    boundaryProcessor.process([[firstRamp]], [[new Float32Array(128)]]);
    assert.equal(boundaryProcessor.port.sent.length, 0);
    boundaryProcessor.process([[secondRamp]], [[new Float32Array(128)]]);
    assert.equal(boundaryProcessor.port.sent.length, 1);
    boundaryProcessor.process([[thirdRamp]], [[new Float32Array(128)]]);
    assert.equal(boundaryProcessor.port.sent.length, 2);
    assert.deepEqual(
      [...boundaryProcessor.port.sent[0].data.samples],
      Array.from({ length: 130 }, (_, index) => index),
    );
    assert.deepEqual(
      [...boundaryProcessor.port.sent[1].data.samples],
      Array.from({ length: 130 }, (_, index) => index + 128),
    );
    processor.port.onmessage({ data: { type: "stop" } });
    processor.process([[new Float32Array(128).fill(1)]], [[new Float32Array(128)]]);
    assert.equal(processor.port.sent.length, 2);
    processor.port.onmessage({ data: { type: "dispose" } });
    assert.equal(processor.process([], []), false);
    assert.equal(processor.port.closed, true);
  } finally {
    globalThis.AudioWorkletProcessor = previous.AudioWorkletProcessor;
    globalThis.registerProcessor = previous.registerProcessor;
    globalThis.sampleRate = previous.sampleRate;
  }
});

test("page, runtime, catalogue, build, and provenance describe the POC truthfully", async () => {
  const [
    html,
    css,
    app,
    model,
    build,
    navigation,
    catalogue,
    notices,
    wrapperLicense,
    coreReadme,
  ] = await Promise.all([
    text("ffmpeg-wasm.html"),
    text("ffmpeg-wasm.css"),
    text("ffmpeg-wasm-app.js"),
    text("src/ffmpeg-wasm.js"),
    text("scripts/build-site.sh"),
    text("nav.js"),
    text("src/instrument-catalog.js"),
    text("THIRD_PARTY_NOTICES.md"),
    text("vendor/ffmpeg-wasm/LICENSE"),
    text("vendor/ffmpeg-wasm/core/README.md"),
  ]);

  assert.doesNotMatch(html, /experiment 001/i);
  assert.doesNotMatch(html, /in the loop/i);
  assert.doesNotMatch(css, /--accent:\s*var\(--accent\)/);
  assert.match(css, /\.ffmpeg-run\[data-section="play"\][\s\S]*?--accent:\s*#b7ff4a/);
  assert.match(html, /<h2 class="group-title">Microphone<\/h2>/);
  assert.match(html, /id="micButtonLabel">Turn on microphone<\/b>/);
  assert.match(html, /id="micButtonHint">First turn on Audio above<\/small>/);
  assert.match(html, /0\.5&ndash;2 s windows/i);
  assert.doesNotMatch(html, /class="group control-section ffmpeg-filter"[^>]*\sopen/);
  assert.doesNotMatch(html, /class="group control-section ffmpeg-window"[^>]*\sopen/);
  assert.match(app, /micButtonLabel/);
  assert.match(app, /micButtonHint/);
  assert.match(app, /Browser asks permission/);
  assert.match(html, /data-primary-transport/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /role="alert"/);
  assert.match(html, /id="signalCanvas"[\s\S]*role="img"/);
  assert.doesNotMatch(html.match(/<canvas[\s\S]*?<\/canvas>/)?.[0] ?? "", /tabindex=/);
  assert.match(html, /showwaves/);
  assert.match(html, /showspectrum/);
  assert.match(html, /not active/i);
  assert.match(html, /unpkg/i);
  assert.match(html, /checksum verified/i);
  assert.match(html, /THIRD_PARTY_NOTICES\.md/);
  assert.equal(html.includes("wax-host-bootstrap"), false);

  assert.match(
    app,
    /https:\/\/unpkg\.com\/@ffmpeg\/core@\$\{FFMPEG_CORE_VERSION\}\/dist\/esm/,
  );
  assert.match(app, /bytes: 111_804/);
  assert.match(app, /bytes: 32_232_419/);
  assert.match(app, /67a48f11645f85439f3fde4f2119042c16b374b910206b7a7a24f342e28dcae3/);
  assert.match(app, /9f57947a5bd530d8f00c5b3f2cb2a3492faa7e5d823315342d6a8656d0a6b7b7/);
  assert.match(app, /crypto\.subtle\.digest\("SHA-256"/);
  assert.match(app, /redirect: "error"/);
  assert.match(app, /bytes\.byteLength !== asset\.bytes/);
  assert.match(app, /candidate\.load\(candidateCoreObjectUrls\)/);
  assert.doesNotMatch(app, /new URL\("\.\/vendor\/ffmpeg-wasm\/core\//);
  assert.match(app, /connectAudioOutput\(audioContext, outputAnalyser\)/);
  assert.match(app, /echoCancellation: false/);
  assert.match(app, /noiseSuppression: false/);
  assert.match(app, /autoGainControl: false/);
  assert.match(app, /Audio is off \\u2014 turn it on to hear playback/);
  assert.match(app, /candidate\.terminate\(\)/);
  assert.match(app, /URL\.revokeObjectURL/);
  assert.match(app, /track\.stop\(\)/);
  assert.match(app, /deleteVirtualFile/);
  assert.match(model, new RegExp(`FFMPEG_CORE_VERSION = "${FFMPEG_CORE_VERSION}"`));
  assert.match(model, new RegExp(`FFMPEG_WRAPPER_VERSION = "${FFMPEG_WRAPPER_VERSION}"`));
  assert.match(app, /const pendingStreams = new Map\(\)/);
  assert.match(app, /pendingStreams\.clear\(\)/);
  assert.match(app, /ENGINE_LOAD_TIMEOUT_MS/);
  assert.match(app, /PROCESS_WATCHDOG_MS/);
  assert.match(app, /unlockAudioContext\(context\)/);
  assert.match(app, /type: "dispose"/);
  assert.match(app, /fadeSeconds: 0\.025/);
  assert.match(app, /cancelAndHoldAtTime/);
  assert.match(
    app,
    /audioEnabled = false;[\s\S]*?lifecycleGeneration \+= 1;[\s\S]*?queue = \[\];[\s\S]*?configureCaptureWorklet\("stop"\)/,
  );
  assert.match(
    app,
    /pendingStreams\.delete\(requestGeneration\);\s*if \(requestGeneration === lifecycleGeneration && !disposed\) \{\s*disposeMicNodes\(\)/,
  );
  assert.match(app, /pagehide[\s\S]*?event\.persisted[\s\S]*?pageshow/);

  await assert.rejects(
    readFile(new URL("vendor/ffmpeg-wasm/core/ffmpeg-core.js", root)),
    /ENOENT/,
  );
  await assert.rejects(
    readFile(new URL("vendor/ffmpeg-wasm/core/ffmpeg-core.wasm", root)),
    /ENOENT/,
  );
  assert.match(wrapperLicense, /MIT License/);
  assert.match(coreReadme, /GPL-2\.0-or-later/);
  assert.match(coreReadme, /does not store or publish/i);
  for (const requiredPath of [
    "ffmpeg-wasm.html",
    "src/ffmpeg-wasm-capture-processor.js",
    "vendor/ffmpeg-wasm/ffmpeg/index.js",
    "vendor/ffmpeg-wasm/core/COPYING.GPLv2",
    "vendor/ffmpeg-wasm/core/README.md",
  ]) {
    assert.ok(build.includes(requiredPath), `build is missing ${requiredPath}`);
  }
  assert.equal(build.includes("vendor/ffmpeg-wasm/core/ffmpeg-core.js"), false);
  assert.equal(build.includes("vendor/ffmpeg-wasm/core/ffmpeg-core.wasm"), false);
  assert.match(notices, /## ffmpeg\.wasm/);
  assert.match(notices, /do not contain those core object\s+files/i);

  assert.match(navigation, /id: "ffmpeg-wasm", label: "FFmpeg Wasm", href: "ffmpeg-wasm\.html"/);
  assert.match(catalogue, /"ffmpeg-wasm": define\(/);
  assert.match(catalogue, /"FFmpeg window processor"/);
  assert.match(catalogue, /Turn on Audio, then turn on the microphone\. Preloading is optional\./);
  assert.match(catalogue, /\["Mic input", "FFmpeg\/Wasm", "Chunked processing", "Audio export"\]/);

  const capability = instrumentMidiCapabilityForId("ffmpeg-wasm");
  assert.equal(capability?.noteMode, "processor");
  assert.equal(capability?.audioInput, true);
  assert.equal(capability?.startsAudio, false);
  assert.equal(capability?.computerKeyboardMode, "none");
  assert.equal(capability?.midiOutput, false);
});
