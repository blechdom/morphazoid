import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const app = fs.readFileSync(new URL("../acoustic-manifold-app.js", import.meta.url), "utf8");

test("the Acoustic Manifold controller connects every source path to the shared analysis", () => {
  assert.match(app, /ACOUSTIC_BUILT_IN_SOURCES/);
  assert.match(app, /ACOUSTIC_PROFILE_GROUPS/);
  assert.match(app, /ACOUSTIC_PROFILES/);
  assert.match(app, /createAcousticDemo/);
  assert.match(app, /analyzeAcousticSequence/);
  assert.match(app, /renderAcousticModelSegment/);
  assert.match(app, /acousticManifoldExport/);
  assert.match(app, /file\.arrayBuffer\(\)/, "uploads should be read directly by the browser");
  assert.match(app, /decodePcmWav\(bytes\)/, "PCM WAV should bypass browser resampling");
  assert.match(app, /originalSampleRatePreserved:\s*true/);
  assert.match(app, /source-rate PCM WAV/);
  assert.match(app, /MAX_FILE_BYTES = 32 \* 1024 \* 1024/);
  assert.match(app, /MAX_FILE_DURATION_SECONDS = 120/);
  assert.match(app, /inspectAudioFileDuration\(file\)/);
  assert.match(app, /new URL\(source\.assetPath, document\.baseURI\)/);
  assert.match(app, /assetUrl\.origin !== window\.location\.origin/);
  assert.match(app, /credentials:\s*"same-origin"/);
});

test("the controller builds the grouped research-profile selector and coverage briefing", () => {
  assert.match(app, /function populateProfileSelect\(\)/);
  assert.match(app, /for \(const group of ACOUSTIC_PROFILE_GROUPS\)/);
  assert.match(app, /Object\.keys\(ACOUSTIC_PROFILES\)\.length/);
  assert.match(app, /function renderProfileEvidence\(profile\)/);
  assert.match(app, /profile\.expectedFocus/);
  assert.match(app, /profile\.recording\.sourceRateNote/);
  assert.match(app, /function updateSourceCompatibility\(\)/);
  assert.match(app, /dataset\.coverage/);
  assert.match(app, /cannot capture this ultrasonic profile faithfully/i);
});

test("analysis-profile tuning invalidates stale maps and applies one normalized parameter set", () => {
  assert.match(app, /ACOUSTIC_ANALYSIS_LIMITS/);
  assert.match(app, /normalizeAcousticAnalysisParameters/);
  assert.match(app, /function analysisParameters\(/);
  assert.match(app, /function analysisParameterKey\(/);
  assert.match(app, /function analysisParameterIssue\(/);
  assert.match(app, /maximumFrameCount/);
  assert.match(app, /maximumFftWorkUnits/);
  assert.match(app, /setAttribute\("aria-invalid", "true"\)/);
  assert.match(app, /partial-tail threshold cannot exceed half the fixed-window length/i);
  assert.match(app, /analyzedParameterKey === analysisParameterKey/);
  assert.match(app, /taskVersion \+= 1;\s*clearAnalysisState\(\)/);
  assert.match(app, /CUSTOM · REANALYZE/);
  assert.match(app, /Listener-tuned prior; research citations describe the reset defaults/);
  assert.match(app, /reset-analysis-parameters[^\n]+addEventListener\("click"/);
  assert.match(app, /Analysis-rate limit/);
  assert.match(app, /feature band/);
});

test("the controller exposes occurrence amplitude, active-run detail, and explicit order", () => {
  assert.match(app, /function updateRecordingTimeline\(/);
  assert.match(app, /function renderSelectedSignalGlyph\(/);
  assert.match(app, /relativeRmsLevel/);
  assert.match(app, /analysis\.tones/);
  assert.match(app, /recording-order/);
  assert.match(app, /selected-frame-beads/);
  assert.match(app, /active-run candidate/);
  assert.match(app, /activeRouteRule = "chronology"/);
  assert.match(app, /Route settings changed; build a new playback route/);
});

test("live capture is bounded, permission is click-driven, and completion maps once stopped", () => {
  assert.match(app, /new AcousticLiveCapture/);
  assert.match(app, /start-live-input[^\n]+startLiveInput/);
  assert.match(app, /capture-live-input[^\n]+stopOrCancelLive/);
  assert.match(app, /Cancel request/);
  assert.match(app, /normalizeCaptureDuration\(\$\("live-window-seconds"\)\.value\)/);
  assert.match(app, /capture\.finished\.then/);
  assert.match(app, /finishLiveCapture/);
  assert.match(app, /populateInputDevices/);
  assert.match(app, /pagehide/);
  assert.match(app, /pageshow/);
  assert.match(app, /cancelLiveCapture/);
  assert.match(app, /lastLiveAnnouncementAt < 250/);
  assert.doesNotMatch(
    app.slice(app.lastIndexOf("window.addEventListener(\"pagehide\"")),
    /startLiveInput\(\)/,
    "page setup must not request microphone access",
  );
});

test("playback and exports preserve sample/model and graph-semantics boundaries", () => {
  assert.match(app, /assembleStropheRoute/);
  assert.match(app, /assembleAudioSegments/);
  assert.match(app, /sample-free/);
  assert.match(app, /does not recover anatomy/);
  assert.match(app, /profile prior/);
  assert.match(app, /not a classification/);
  assert.match(app, /activeRouteRule/);
  assert.match(app, /gapSeconds:\s*ROUTE_GAP_SECONDS/);
  assert.match(app, /timeline:\s*rendered\.timeline/);
  assert.match(app, /fallbackCount/);
  assert.match(app, /cancelPending/);
  assert.match(app, /Render superseded/);
  assert.match(
    app,
    /catch \(error\) \{\s*if \(version !== taskVersion \|\| error\?\.message === "Render superseded"\) return;/,
  );
  assert.match(app, /data-acoustic-manifold-ready/);
});

test("resynthesis controls drive transform-aware renders, exports, and route order", () => {
  assert.match(app, /ACOUSTIC_RESYNTHESIS_LIMITS/);
  assert.match(app, /normalizeAcousticResynthesis/);
  assert.match(app, /acousticResynthesisForOccurrence/);
  assert.match(app, /function resynthesisSettings\(\)/);
  assert.match(app, /function resynthesisKey\(/);
  assert.match(app, /resynthesisKey\(eventResynthesis\)/);
  assert.match(app, /resynthesis:\s*eventResynthesis/);
  assert.match(app, /gapSeconds:\s*controls\.gapSeconds/);
  assert.match(app, /gapSeconds:\s*resynthesisSettings\(\)\.gapSeconds/);
  assert.match(app, /resynthesis:\s*resynthesisSettings\(\)/);
  assert.match(app, /routeAudio\.playbackRate = mode === "recording"/);
  assert.match(app, /routeAudio\.preservesPitch = true/);
  assert.match(app, /resynthesis-preset[^\n]+addEventListener\("change"/);
  assert.match(app, /reset-resynthesis[^\n]+addEventListener\("click"/);
  assert.match(app, /reverse-route[^\n]+addEventListener\("click"/);
  assert.match(app, /EXTRAPOLATED MODEL/);
  assert.match(app, /PCA mappings are artistic, not measured physiological limits/);
});
