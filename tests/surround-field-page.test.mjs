import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = await readFile(path.join(repositoryRoot, "surround-field.html"), "utf8");
const app = await readFile(path.join(repositoryRoot, "surround-field-app.js"), "utf8");
const css = await readFile(path.join(repositoryRoot, "surround-field.css"), "utf8");

test("the stage uses a compact, single-line Surround for Safety title", () => {
  const identity = html.match(/<header class="surround-identity">([\s\S]*?)<\/header>/)?.[1] ?? "";
  assert.match(identity, /^\s*<h1 id="sceneTitle">SURROUND FOR SAFETY<\/h1>\s*$/);
  assert.doesNotMatch(identity, /MULTICHANNEL SPATIAL INSTRUMENT|PLACE THE SOUND|HEAR THE ARRAY|<br\s*\/?\s*>|<i>/i);
  assert.match(css, /\.surround-identity h1\s*\{[\s\S]*?font-family: Arial, Helvetica, sans-serif;[\s\S]*?font-size: clamp\(20px, 2\.2vw, 38px\);[\s\S]*?white-space: nowrap;/);
});

test("Surround for Safety exposes every requested array and the custom 32-channel ring", () => {
  for (const layout of ["7-4-1", "4-1", "8-circle", "8-cube"]) {
    assert.match(html, new RegExp(`data-layout="${layout}"`));
  }
  assert.match(html, /id="speakerCount"[^>]+min="2" max="32"/);
  assert.match(html, /7 bed · 4 height · 1 LFE/i);
  assert.match(html, /4 lower · 4 upper/i);
  assert.match(html, /commonly written 7\.1\.4/);
});

test("output capability copy distinguishes graph channels from physical outputs", () => {
  assert.match(html, /GRAPH[\s\S]+demo ceiling[\s\S]+PATCH[\s\S]+virtual speakers[\s\S]+DEVICE[\s\S]+reported outputs/);
  assert.match(html, /destination\.maxChannelCount/);
  assert.match(html, /at least 32 channels/);
  assert.match(html, /Stereo preview/);
  assert.match(html, /webAudio-fact|web-audio-fact/);
});

test("audio routing has real discrete and explicit stereo-preview paths", () => {
  assert.match(app, /createChannelMerger\(layout\.speakers\.length\)/);
  assert.match(app, /channelInterpretation = "discrete"/);
  assert.match(app, /channelBus\.connect\(virtualBus, 0, targetIndex\)/);
  assert.match(app, /speaker\.channel - 1/);
  assert.match(app, /createStereoPanner\(\)/);
  assert.match(app, /connectAudioOutput\(context, this\.outputNode\)/);
  assert.match(app, /limiter\.threshold\.value = -3/);
  assert.match(app, /speaker\.kind === "lfe"/);
  assert.match(app, /lowpass\.frequency\.value = 120/);
  assert.match(app, /createAnalyser\(\)/);
  assert.match(app, /analyser\.fftSize = 2048/);
  assert.match(app, /analyser\.channelCount = 1[\s\S]*?channelCountMode = "explicit"[\s\S]*?channelInterpretation = "discrete"/);
  assert.match(app, /channelBus\.connect\(analyser\)/);
  assert.doesNotMatch(app, /analyser\.connect\(virtualBus|analyser\.connect\(panner/);
});

test("speaker tests expose calibrated sources and tappable channel controls", () => {
  for (const signal of ["pink", "tone", "chirp"]) {
    assert.match(html, new RegExp(`data-test-signal="${signal}"`));
  }
  assert.match(html, /Pink noise[\s\S]+−20 dBFS RMS/);
  assert.match(html, /1 kHz tone[\s\S]+−18 dBFS PEAK/);
  assert.match(html, /id="testTrim"[^>]+min="-24" max="6"/);
  assert.match(html, /id="level"[^>]+max="1"[^>]+value="0\.55"/);
  assert.match(app, /level: 0\.55/);
  assert.match(html, /OS volume, interface, amplifier, and room determine the resulting SPL/);
  assert.match(app, /document\.createElement\("button"\)[\s\S]+className = "channel-meter"/);
  assert.match(app, /createLfePinkNoiseSamples/);
  assert.match(app, /source\.connect\(gain\)\.connect\(route\.testTarget\)/);
  assert.match(app, /getFloatTimeDomainData\(route\.meterSamples\)/);
  assert.match(app, /amplitudeToDbfs\(peak\)/);
  assert.match(app, /dbfsToMeterFill\(dbfs\)/);
  assert.match(app, /programLevelToGain\(this\.level\)/);
  assert.match(app, /voiceInput\.gain\.value = PROGRAM_GAIN\.voiceInput/);
  assert.match(app, /velocity \* PROGRAM_GAIN\.envelopePeak/);
  assert.doesNotMatch(app, /gain \* audio\.activity \* 1\.4 \+ state\.testEnergy/);
  assert.match(html, /Channel output<\/b><span>Peak dBFS/);
  assert.match(app, /<output aria-hidden="true">−∞<\/output>/);
  assert.match(css, /\.channel-meter:[\s\S]*?focus-visible/);
});

test("local audio can enter at unity and synchronized stems can be captured", () => {
  for (const id of ["patchFile", "filePlayButton", "recordButton", "downloadRecording", "recordStatus"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /enters at unity/);
  assert.match(html, /synchronized mono WAV stems/);
  assert.match(app, /source\.connect\(this\.patchInput\)/);
  assert.match(app, /await audio\.startRecording/);
  assert.match(app, /buildStemArchive\(capture/);
  assert.match(app, /URL\.createObjectURL/);
  assert.match(app, /MAX_RECORDING_SECONDS \* 1000 - 150/);
});

test("Play leads the right-hand controls and exposes audio timing priority", () => {
  const panelStart = html.indexOf('<aside class="panel surround-panel"');
  const panelEnd = html.indexOf("</aside>", panelStart);
  const play = html.indexOf('id="sequenceButton"');
  const output = html.indexOf('id="outputConsole"');
  const deckStart = html.indexOf('<section class="performance-deck"');
  assert.ok(panelStart >= 0 && panelStart < play && play < output && output < panelEnd);
  assert.equal((html.match(/id="sequenceButton"/g) ?? []).length, 1);
  assert.doesNotMatch(html.slice(deckStart, panelStart), /id="sequenceButton"/);
  assert.match(html, /AUDIO TIMING PRIORITY/);
  assert.match(html, /id="timingDetail">25 ms scheduler · 160 ms lookahead/);
  assert.match(css, /\.panel-transport\s*\{[\s\S]*?position: sticky/);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*?\.panel-transport\s*\{[\s\S]*?position: fixed[\s\S]*?top: auto/);
});

test("audio clock schedules sound while animation remains visual-only", () => {
  const schedulerStart = app.indexOf("function scheduleAudioTimeline()");
  const schedulerEnd = app.indexOf("function stopAudioScheduler()", schedulerStart);
  const scheduler = app.slice(schedulerStart, schedulerEnd);
  const animateStart = app.indexOf("function animate(timestamp)");
  const animateEnd = app.indexOf("function exposeDebugState()", animateStart);
  const animation = app.slice(animateStart, animateEnd);
  assert.match(scheduler, /audio\.context\.currentTime/);
  assert.match(scheduler, /planAudioEvents\(\{ nextAt: state\.nextPhraseAt, now \}\)/);
  assert.match(scheduler, /audio\.trigger\(midi,[\s\S]*?when, "sequence"\)/);
  assert.match(app, /window\.setInterval\(scheduleAudioTimeline, AUDIO_TIMING\.schedulerIntervalMs\)/);
  assert.doesNotMatch(animation, /triggerNote|nextPhraseAt|PHRASE/);
  assert.match(animation, /updateSpatialDisplay\(\{ updateAudio: false \}\)/);

  const transportStart = app.indexOf("async function toggleSequence()");
  const transportEnd = app.indexOf("function announce", transportStart);
  const transport = app.slice(transportStart, transportEnd);
  assert.ok(transport.indexOf("await ensureAudio()") < transport.indexOf("state.sequenceOn = true"));
  assert.match(transport, /audio\.cancelScheduledVoices\("sequence"\)/);
  assert.match(app, /audio\.testSpeaker\(index, when, "sweep", state\.testSignal, state\.testTrimDb\)/);
});

test("the room stays playable on pointer, keyboard, and mobile", () => {
  assert.match(html, /aria-label="Sound position\. Drag to move; use arrow keys/);
  assert.match(html, /click pads or use A S D F G H J K/);
  assert.match(app, /KEY_NOTES/);
  assert.match(app, /morphazoid:midi-input/);
  assert.match(app, /event\.preventDefault\(\)/);
  assert.match(app, /setPointerCapture/);
  assert.match(css, /@media \(max-width: 650px\)/);
  assert.match(css, /\.sound-emitter\s*\{[\s\S]*?touch-action: none/);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*?html\s*\{[\s\S]*?overflow-y: auto/);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*?body\.surround-field-page\s*\{[\s\S]*?overflow: visible/);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*?\.surround-shell\s*\{[\s\S]*?overflow: visible[\s\S]*?flex: 0 0 auto/);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*?\.surround-stage\s*\{[\s\S]*?position: relative/);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*?\.surround-stage-wrap\s*\{[\s\S]*?touch-action: pan-y pinch-zoom/);
});
