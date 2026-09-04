import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

const experimentPages = [
  ["moire-organ.html", "moire", "RISSET-MOIRE", "moire-organ"],
  ["chladni-plate.html", "chladni", "Chladni Plate", "chladni-plate"],
  ["spring-choir.html", "springs", "Spring Choir", "spring-choir"],
  ["gear-ratio-drums.html", "gears", "Gear Ratio Drums", "gear-ratio-drums"],
  ["automatapoeia.html", "automata", "Automatapoeia", "cellular-automata"],
  ["prime-sieve.html", "primes", "Prime Sieve", "prime-sieve"],
  ["lissajous-orbits.html", "lissajous", "Lissajous Orbits", "lissajous-orbits"],
  ["pendulum-wave.html", "pendulums", "Pendulum Wave", "pendulum-wave"],
  ["double-pendulum.html", "doublependulum", "Double Pendulum", "double-pendulum"],
  ["reaction-diffusion.html", "reaction", "Reaction-Diffusion", "reaction-diffusion"],
  ["atomic-orbitals.html", "orbitals", "Atomic Orbitals", "atomic-orbitals"],
  ["dna-translator.html", "dna", "DNA Translator", "dna-translator"],
  ["neural-pulse.html", "neural", "Neural Pulse", "neural-pulse"],
  ["fourier-epicycles.html", "fourier", "Fourier Epicycles", "fourier-epicycles"],
  ["gravity-lens.html", "lensing", "Gravity Lens", "gravity-lens"],
  ["orbital-ferris.html", "orbitalFerris", "Feral Fairy Ferris Ferry", "orbital-ferris"],
];

test("experiment pages are native Morphazoid pages with shared controls", async () => {
  for (const [file, mode, title, toolId] of experimentPages) {
    const html = await readFile(new URL(file, root), "utf8");
    assert.match(html, new RegExp(`<body[^>]*data-experiment="${mode}"`));
    assert.match(html, new RegExp(`<h1>${title}`));
    assert.match(html, /<link rel="stylesheet" href="style\.css"/);
    assert.match(html, /<link rel="stylesheet" href="experiments\.css"/);
    assert.match(html, /<script type="module" src="nav\.js"><\/script>/);
    assert.match(html, /<script type="module" src="experiments-app\.js"><\/script>/);
    assert.match(html, /id="audioButton"/);
    assert.match(html, /id="level"/);
    assert.match(html, /id="stageReadout"/);
    assert.match(html, /id="metricPrimary"/);
    assert.match(html, /id="metricSecondary"/);
    assert.match(html, /data-reset-all>Reset all parameters<\/button>/);
    assert.match(html, new RegExp(`href="${file}" aria-current="page"`));
    assert.match(html, new RegExp(`value="${file}" selected`));
    assert.match(html, new RegExp(toolId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
    assert.equal(new Set(ids).size, ids.length, `${file} contains a duplicate id`);
  }
});

test("experiment runtime contains each simulation and audio mapping", async () => {
  const [app, css] = await Promise.all([
    readFile(new URL("experiments-app.js", root), "utf8"),
    readFile(new URL("experiments.css", root), "utf8"),
  ]);
  for (const key of [
    "moire",
    "chladni",
    "springs",
    "gears",
    "automata",
    "primes",
    "lissajous",
    "pendulums",
    "doublependulum",
    "reaction",
    "orbitals",
    "dna",
    "neural",
    "fourier",
    "lensing",
    "orbitalFerris",
  ]) {
    assert.match(app, new RegExp(`${key}: \\{`));
  }
  for (const name of [
    "moireShepardVoices",
    "moireSpectralWindow",
    "moireAudibleFrequency",
    "moireAngleRate",
    "moireLineIntersection",
    "moireScene",
    "chladniValue",
    "springModeAmplitudes",
    "drawGear",
    "stepAutomataRow",
    "stepPrimeSieve",
    "drawLissajous",
    "pendulumCoherence",
    "doublePendulumAcceleration",
    "stepReactionGrid",
    "associatedLaguerre",
    "codonAmino",
    "fireNeuralInput",
    "fourierCoefficient",
    "lensGeometry",
    "drawOrbitalGesture",
    "drawOrbitalFerris",
  ]) {
    assert.match(app, new RegExp(name));
  }
  assert.match(app, /class ExperimentAudio/);
  assert.match(app, /triggerRowScan\(cells, options = \{\}\)/);
  assert.match(app, /audio\.triggerRowScan\(row, \{/);
  assert.doesNotMatch(app, /const degree = PENTATONIC\[Math\.floor\(\(index \/ row\.length\)/);
  assert.doesNotMatch(app, /frequency: 68 \+ density \* 260/);
  assert.doesNotMatch(app, /pan: \(index \/ \(row\.length - 1\)\) \* 2 - 1/);
  assert.match(app, /createDynamicsCompressor/);
  assert.match(app, /pagehide/);
  assert.match(css, /\.experiment-title/);
  assert.match(css, /\.experiment-meter-grid/);
});

test("Automatapoeia presents exact binary evolution before optional queued mono sound", async () => {
  const [html, legacy, app, sonification] = await Promise.all([
    readFile(new URL("automatapoeia.html", root), "utf8"),
    readFile(new URL("automatopoeia.html", root), "utf8"),
    readFile(new URL("experiments-app.js", root), "utf8"),
    readFile(new URL("src/automatapoeia.js", root), "utf8"),
  ]);
  assert.match(legacy, /url=automatapoeia\.html/);
  assert.match(legacy, /href="automatapoeia\.html">Automatapoeia/);
  assert.match(html, /NKS Open Problems/);
  assert.match(html, /https:\/\/www\.wolframscience\.com\/openproblems\/NKSOpenProblems\.pdf/);
  assert.match(html, /Domain walls/);
  assert.match(html, /id="caBoundary"/);
  assert.match(html, /value="fixed" selected>Fixed zero/);
  assert.match(html, /value="periodic">Periodic wrap/);
  assert.match(html, /Neighborhood/);
  assert.match(html, /111.*110.*101.*100.*011.*010.*001.*000/);
  assert.match(html, /id="caWidth"[^>]*step="2"[^>]*value="73"/);
  assert.match(html, /id="caDensity"[^>]*value="0"/);
  assert.match(html, /one centered cell/);
  assert.match(html, /id="randomizeAutomata"[^>]*disabled>Reseed random initial row/);
  assert.match(html, /Optional sonification/);
  assert.match(html, /id="caRulePicker"/);
  assert.match(html, /id="caRuleCurrentPreview"/);
  assert.match(html, /id="previousAutomataRule"[^>]*aria-keyshortcuts="ArrowLeft"/);
  assert.match(html, /id="nextAutomataRule"[^>]*aria-keyshortcuts="ArrowRight"/);
  assert.doesNotMatch(html, /data-ca-rule=/);
  assert.doesNotMatch(html, /id="browseAutomataRules"/);
  assert.doesNotMatch(html, /<dialog[^>]*automata-rule-atlas/);
  assert.match(html, /All 256 rules/);
  assert.match(html, /88 symmetry representatives/);
  assert.match(html, /Rule number or 8-bit code/);
  const liveControls = html.indexOf("Live evolution");
  const rulePicker = html.indexOf('id="caRulePicker"');
  const ruleSlider = html.indexOf('id="caRule"');
  const boundary = html.indexOf('id="caBoundary"');
  const rate = html.indexOf('id="caRate"');
  const restartOnly = html.indexOf("Initial setup · restart only");
  const width = html.indexOf('id="caWidth"');
  const density = html.indexOf('id="caDensity"');
  const restart = html.indexOf('id="seedAutomata"');
  assert.ok(liveControls < rulePicker && rulePicker < ruleSlider);
  assert.ok(ruleSlider < boundary && boundary < rate && rate < restartOnly);
  assert.ok(restartOnly < width && width < density && density < restart);
  assert.match(html, /id="caPolarity"/);
  assert.match(html, /<option value="one"[^>]*>[^<]*(?:state\s*)?1/i);
  assert.match(html, /<option value="zero"[^>]*>[^<]*(?:state\s*)?0/i);
  assert.match(html, /id="caObjectMode"/);
  assert.match(html, /<option value="runs"/);
  assert.match(html, /<option value="connected"/);
  assert.match(html, /id="caStructureSummary"/);
  assert.ok(html.indexOf('id="caPolarity"') < html.indexOf('id="caVoice"'));
  assert.ok(html.indexOf('id="caObjectMode"') < html.indexOf('id="caVoice"'));
  assert.match(html, /id="caVoice"/);
  assert.match(html, /value="rattlesnake" selected>Rattlesnake × Carpet/);
  assert.match(html, /value="karplus-carpet">Karplus Carpet/);
  assert.match(html, /value="ouroboros">Ouroboros Coil/);
  assert.match(html, /value="modal-fm">Modal-FM Strike/);
  assert.match(html, /value="cascade-pm">Cascading PM/);
  assert.match(html, /value="glass-lattice">Glass Lattice/);
  assert.match(html, /value="wavefold-ribbon">Wavefold Ribbon/);
  assert.match(html, /value="formant-dust">Formant Dust/);
  assert.match(html, /id="caFrequencyMin"[^>]*value="70"/);
  assert.match(html, /id="caFrequencyMax"[^>]*value="6400"/);
  assert.match(html, /id="caPitchCurve"/);
  assert.match(html, /id="caPitchTrace"/);
  assert.match(html, /id="caTimbreSource"/);
  assert.match(html, /value="persistence">Vertical persistence/);
  assert.match(html, /value="edge-flux">Edge flux/);
  assert.match(html, /id="caContourSource"/);
  assert.match(html, /id="caContourAmount"/);
  assert.match(html, /id="caPhraseShape"/);
  assert.match(html, /value="bands"[^>]*>Object spans/);
  assert.match(html, /value="centers"[^>]*>Object centers/);
  assert.match(html, /id="caRhythmDetail"[^>]*max="16"/);
  assert.match(html, /id="caRhythmDetailOut"[^>]*>\s*\d+ objects\s*</);
  assert.match(html, /id="caTimeSpread"/);
  assert.match(html, /id="caSwing"[^>]*min="-0.42"[^>]*max="0.42"/);
  assert.match(html, /id="caStrikeLength"[^>]*max="2"/);
  assert.match(html, /id="caAttack"/);
  assert.match(html, /id="caDecay"/);
  assert.match(html, /id="caSustain"/);
  assert.match(html, /id="caRelease"/);
  assert.match(html, /Width and seed density wait for Restart or Reseed/);
  assert.match(html, /id="caEvolutionSummary"/);
  const rowScan = app.slice(app.indexOf("triggerRowScan(cells"), app.indexOf("\n  silence()"));
  assert.match(rowScan, /this\.rowScanCursor/);
  assert.match(rowScan, /automatapoeiaSwingInterval/);
  assert.match(rowScan, /renderAutomatapoeiaRow/);
  assert.match(rowScan, /createBuffer\(1, scan\.samples\.length, scan\.sampleRate\)/);
  assert.match(rowScan, /createBufferSource\(\)/);
  assert.match(rowScan, /source\.stop\(startTime \+ scan\.renderDuration\)/);
  assert.doesNotMatch(rowScan, /cells\?\.some\(Boolean\)/);
  assert.doesNotMatch(rowScan, /PENTATONIC|createOscillator|createStereoPanner|\.pan/);
  assert.match(sonification, /linearDrumFrequencyAtPosition/);
  assert.match(sonification, /linearDrumKarplusStrongSettings/);
  assert.match(sonification, /generateKarplusStrongSamples/);
  assert.match(sonification, /createKarplusCarpetRandom/);
  assert.match(sonification, /ouroborosWindow/);
  assert.match(sonification, /mixModalFmStrike/);
  assert.match(sonification, /mixCascadingPm/);
  assert.match(sonification, /mixFilteredRattle/);
  assert.match(sonification, /mixGlassLattice/);
  assert.match(sonification, /mixWavefoldRibbon/);
  assert.match(sonification, /mixFormantDust/);
  assert.match(sonification, /automatapoeiaContourStats/);
  assert.match(sonification, /automatapoeiaEnvelopeAmplitude/);
  assert.match(sonification, /automatapoeiaSwingInterval/);
  assert.match(sonification, /bufferFrameCount/);
  assert.match(sonification, /renderDuration/);
  assert.match(sonification, /AUTOMATAPOEIA_RULES/);
  assert.match(sonification, /automatapoeiaRowsPath/);
  assert.match(sonification, /sanitizeAutomatapoeiaPolarity/);
  assert.match(sonification, /sanitizeAutomatapoeiaObjectMode/);
  assert.match(sonification, /automatapoeiaConnectedForms/);
  assert.match(sonification, /automatapoeia(?:Connected)?SoundUnits/);
  assert.match(sonification, /automatapoeia(?:Connected|Connection|Sound|Structure)\w*Paths?/);
  assert.match(sonification, /runs\.push\(\{/);
  assert.match(sonification, /runs\.map\(\(run\) => Object\.freeze\(run\)\)/);
  assert.doesNotMatch(sonification, /createStereoPanner|\.pan|PENTATONIC/);
  assert.match(app, /automatapoeiaNextRow\(previous, state\.caRule, state\.caBoundary\)/);
  assert.match(app, /automatapoeiaContourStats\(/);
  assert.match(app, /automatapoeiaRetimedAccumulator\(/);
  assert.match(app, /state\.caGeneration \+= 1/);
  assert.match(app, /"caStrikeLength",\s*"caStrikeLength",\s*\(value\) => `\$\{Math\.round\(value \* 100\)\}%`/);
  const automataDrawing = app.slice(app.indexOf("function drawAutomata()"), app.indexOf("function resetPrimeSieve()"));
  assert.match(app, /createImageData/);
  assert.match(app, /putImageData/);
  assert.match(automataDrawing, /imageSmoothingEnabled = false/);
  assert.match(automataDrawing, /ctx\.drawImage\(raster/);
  assert.match(automataDrawing, /caObjectMode/);
  assert.match(app, /automatapoeia(?:Connected|Connection|Sound|Structure)\w*Paths?/);
  assert.match(automataDrawing, /getAutomataTopology\(\)/);
  assert.match(automataDrawing, /islandPath2d/);
  assert.match(automataDrawing, /linkPath2d/);
  assert.match(automataDrawing, /ctx\.(?:moveTo|lineTo|fill|stroke)\(/);
  assert.doesNotMatch(automataDrawing, /hueMix|103, 226, 208|240, 203, 118/);
  assert.match(app, /audio\.triggerRowScan\(row, \{/);
  assert.match(app, /caRowBoundaries:\s*\[\]/);
  assert.match(app, /state\.caRowBoundaries\.push\(state\.caBoundary\)/);
  assert.match(app, /state\.caRowBoundaries\.shift\(\)/);
  const automataSound = app.slice(
    app.indexOf("function soundAutomataRow("),
    app.indexOf("\nfunction stepAutomata("),
  );
  const automataTopology = app.slice(
    app.indexOf("function getAutomataTopology("),
    app.indexOf("\nfunction recordAutomataEvolutionSegment("),
  );
  assert.match(automataTopology, /automatapoeiaConnectedForms\(state\.caRows/);
  assert.match(automataTopology, /state\.caRowBoundaries/);
  assert.match(automataSound, /automatapoeiaConnectedSoundUnits/);
  assert.match(automataSound, /state\.caPolarity/);
  assert.match(automataSound, /state\.caObjectMode/);

  const genericRangeBinding = app.slice(
    app.indexOf("function bindRange("),
    app.indexOf("\nfunction setText("),
  );
  assert.doesNotMatch(genericRangeBinding, /seedAutomata/);
  assert.match(genericRangeBinding, /recordAutomataEvolutionSegment/);
  const boundaryBinding = app.slice(
    app.indexOf("const syncBoundary ="),
    app.indexOf("boundaryControl.addEventListener"),
  );
  assert.doesNotMatch(boundaryBinding, /seedAutomata/);
  assert.match(boundaryBinding, /recordAutomataEvolutionSegment/);
  assert.match(boundaryBinding, /updateCaStats/);
  const audioSelectBinding = app.slice(
    app.indexOf("const voiceControl ="),
    app.indexOf("populateAutomataRuleAtlas();"),
  );
  assert.doesNotMatch(audioSelectBinding, /audio\.silence/);
  assert.doesNotMatch(audioSelectBinding, /seedAutomata/);
  assert.match(audioSelectBinding, /caPolarity[\s\S]*sanitizeAutomatapoeiaPolarity/);
  assert.match(audioSelectBinding, /caObjectMode[\s\S]*sanitizeAutomatapoeiaObjectMode/);
  const ruleSelection = app.slice(
    app.indexOf("function selectAutomataRule("),
    app.indexOf("\nfunction populateAutomataRuleAtlas("),
  );
  assert.doesNotMatch(ruleSelection, /seedAutomata/);
  assert.match(ruleSelection, /recordAutomataEvolutionSegment/);
  const ruleStepping = app.slice(
    app.indexOf("function stepAutomataRule("),
    app.indexOf("\nfunction populateAutomataRuleAtlas("),
  );
  assert.match(ruleStepping, /% ruleCount \+ ruleCount\) % ruleCount/);
  assert.match(ruleStepping, /ArrowLeft/);
  assert.match(ruleStepping, /ArrowRight/);
  assert.match(ruleStepping, /event\.key === "Escape"/);
  assert.match(ruleStepping, /input, select, textarea, \[contenteditable\]/);
  assert.match(ruleStepping, /visibleTiles/);
  assert.match(ruleStepping, /nextTile\.focus\(\)/);
  assert.doesNotMatch(ruleStepping, /seedAutomata/);
  assert.match(app, /button\.tabIndex = -1/);
  assert.match(app, /setAutomataRuleTabStop/);
  assert.match(app, /setText\("caRulePickerLabel", `Rule \$\{rule\}`\)/);
  assert.match(app, /automatapoeiaRowsPath\(automatapoeiaPreviewRows\(rule/);
  assert.match(app, /startGeneration: state\.caGeneration \+ 1/);
  assert.match(app, /audio\.silence\(\);\s*seedAutomata\(\);/);
  assert.match(app, /audio\.silence\(\);\s*seedAutomata\(\{ rebuildInitial: true, randomize: true \}\);/);
  assert.doesNotMatch(app, /if \(!state\.caInitialRow\.some\(Boolean\)\)/);
  assert.match(app, /tails bounded at/);
});

test("RISSET-MOIRE pairs every line with a counter-moving Shepard oscillator", async () => {
  const [html, app] = await Promise.all([
    readFile(new URL("moire-organ.html", root), "utf8"),
    readFile(new URL("experiments-app.js", root), "utf8"),
  ]);

  assert.match(html, /id="moireInterval"[^>]*min="0\.1"[^>]*max="2"[^>]*step="0\.01"[^>]*value="1"/);
  assert.match(html, /id="moireVoices"[^>]*min="4"[^>]*max="12"[^>]*value="8"/);
  assert.match(html, /id="moireSecondPair" type="checkbox"/);
  assert.match(html, /id="moireLayerOffset"[^>]*max="4"/);
  assert.match(html, /id="moireUpAngle"[^>]*min="0"[^>]*max="30"[^>]*value="4"/);
  assert.match(html, /id="moireDownAngle"[^>]*min="0"[^>]*max="30"[^>]*value="4"/);
  assert.match(html, /id="moireOverlap"[^>]*max="2"/);
  assert.doesNotMatch(html, /id="moireDrift"/);
  assert.match(html, /Green rising and pink falling Shepard voices/);
  assert.match(html, /Each line is one Shepard oscillator/);
  assert.match(app, /const MAX_CONTINUOUS_VOICES = 48;/);
  assert.match(app, /const MOIRE_DEFAULT_VOICES = 8;/);
  assert.match(app, /const MOIRE_OCTAVES_PER_DEGREE_SECOND = 0\.045;/);
  assert.match(app, /const layerCount = state\.moireSecondPair \? 2 : 1;/);
  assert.match(app, /for \(let slot = 0; slot < voiceCount; slot \+= 1\)/);
  assert.match(app, /for \(const direction of \[1, -1\]\)/);
  assert.match(app, /return moireScene\(\)\.voices\.map/);
  assert.match(app, /voice\.gain = bankGain \* voice\.amplitude \* normalization/);
  assert.match(app, /crossing\.strength \* state\.moireOverlap/);
  assert.match(app, /state\.moireUpPhase \+ moireAngleRate\(state\.moireUpAngle\)/);
  assert.match(app, /state\.moireDownPhase - moireAngleRate\(state\.moireDownAngle\)/);
  assert.match(app, /createLinearGradient/);
});
