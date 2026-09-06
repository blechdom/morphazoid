import {
  createAudioStrip,
  createButton,
  createChoiceSwitch,
  createControlSection,
  createMidiStatus,
  createRangeField,
  createSelectField,
  createStatusReadout,
} from "../src/ui/index.js";

const FIXTURES = {
  shape: {
    name: "Shape",
    accent: "#5fe8c4",
    readout: "1 POINT · 1 CONTACT · AUDIO OFF",
    formLabel: "Outline",
    formState: "4 sides",
    formValue: "polygon",
    forms: [
      { value: "polygon", label: "Polygon" },
      { value: "star", label: "Star" },
      { value: "rose", label: "Rose" },
    ],
    amountLabel: "Sides",
    amountMin: 3,
    amountMax: 12,
    amountStep: 1,
    amountValue: 4,
    amountFormat: (value) => Math.round(Number(value)) + " sides",
    voiceValue: "sine",
    voices: [
      { value: "sine", label: "Sine · contact envelope" },
      { value: "percussion", label: "Percussion · new contacts" },
      { value: "fm", label: "FM · incidence index" },
    ],
    frequency: 110,
  },
  solid: {
    name: "Solid",
    accent: "#7db4ff",
    readout: "CUBE · 0 CONTACTS · AUDIO OFF",
    formLabel: "Wireframe solid",
    formState: "Cube",
    formValue: "cube",
    forms: [
      { value: "cube", label: "Cube" },
      { value: "octahedron", label: "Octahedron" },
      { value: "torus", label: "Torus" },
    ],
    amountLabel: "Projection depth",
    amountMin: 0,
    amountMax: 1,
    amountStep: 0.01,
    amountValue: 0.62,
    amountFormat: (value) => Math.round(Number(value) * 100) + "%",
    voiceValue: "sine",
    voices: [
      { value: "sine", label: "Sine · corner envelope" },
      { value: "fm", label: "FM · intersection index" },
      { value: "percussion", label: "Percussion · vertex strikes" },
    ],
    frequency: 92,
  },
  hyper: {
    name: "Hyper",
    accent: "#c79bff",
    readout: "TESSERACT · 0 CONTACTS · AUDIO OFF",
    formLabel: "4D wireframe",
    formState: "Tesseract",
    formValue: "tesseract",
    forms: [
      { value: "tesseract", label: "Tesseract" },
      { value: "hypersphere", label: "Hypersphere" },
      { value: "hyperpyramid", label: "Hyperpyramid" },
    ],
    amountLabel: "W depth",
    amountMin: -1,
    amountMax: 1,
    amountStep: 0.01,
    amountValue: 0.28,
    amountFormat: (value) => Number(value).toFixed(2),
    voiceValue: "sine",
    voices: [
      { value: "sine", label: "Sine · edge envelope" },
      { value: "fm", label: "FM · W-depth index" },
      { value: "pm", label: "PM · W-depth phase" },
    ],
    frequency: 74,
  },
};

function strokeEdges(context, points, edges, color, width, alpha) {
  context.save();
  context.globalAlpha = alpha;
  context.strokeStyle = color;
  context.lineWidth = width;
  context.beginPath();
  for (const [from, to] of edges) {
    context.moveTo(points[from][0], points[from][1]);
    context.lineTo(points[to][0], points[to][1]);
  }
  context.stroke();
  context.restore();
}

function drawNodes(context, points, color, radius) {
  context.save();
  context.fillStyle = color;
  for (const [x, y] of points) {
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}

function drawShape(context, accent) {
  const points = [
    [-156, -156],
    [156, -156],
    [156, 156],
    [-156, 156],
  ];
  const edges = points.map((_, index) => [index, (index + 1) % points.length]);
  strokeEdges(context, points, edges, accent, 3, 0.92);
  context.save();
  context.globalAlpha = 0.36;
  context.strokeStyle = accent;
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(0, -214);
  context.lineTo(0, 214);
  context.stroke();
  context.restore();
  drawNodes(context, [[0, -156]], accent, 6);
}

function drawSolid(context, accent) {
  const front = [
    [-150, -128],
    [104, -128],
    [104, 126],
    [-150, 126],
  ];
  const back = front.map(([x, y]) => [x + 76, y - 66]);
  const points = [...front, ...back];
  const edges = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  strokeEdges(context, points, edges, accent, 2.4, 0.88);
  drawNodes(context, points, accent, 4.5);
}

function drawHyper(context, accent) {
  const outer = [
    [-178, -148],
    [142, -148],
    [142, 150],
    [-178, 150],
  ];
  const middle = outer.map(([x, y]) => [x + 72, y - 54]);
  const inner = [
    [-90, -72],
    [64, -72],
    [64, 72],
    [-90, 72],
  ];
  const deep = inner.map(([x, y]) => [x + 43, y - 34]);
  const points = [...outer, ...middle, ...inner, ...deep];
  const loopEdges = (offset) => [
    [offset, offset + 1],
    [offset + 1, offset + 2],
    [offset + 2, offset + 3],
    [offset + 3, offset],
  ];
  const bridgeEdges = (from, to) => [0, 1, 2, 3].map((index) => [from + index, to + index]);
  const edges = [
    ...loopEdges(0),
    ...loopEdges(4),
    ...loopEdges(8),
    ...loopEdges(12),
    ...bridgeEdges(0, 4),
    ...bridgeEdges(0, 8),
    ...bridgeEdges(4, 12),
    ...bridgeEdges(8, 12),
  ];
  strokeEdges(context, points, edges, accent, 2, 0.82);
  drawNodes(context, points, accent, 3.8);
}

function drawCanvas(canvas, kind, accent) {
  const context = canvas.getContext("2d");
  if (!context) return;

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#07100f";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.save();
  context.translate(canvas.width / 2, canvas.height / 2);
  context.lineCap = "round";
  context.lineJoin = "round";
  context.shadowColor = accent;
  context.shadowBlur = 14;

  if (kind === "shape") drawShape(context, accent);
  if (kind === "solid") drawSolid(context, accent);
  if (kind === "hyper") drawHyper(context, accent);

  context.restore();
}

function createStage(config, kind, doc) {
  const stage = doc.createElement("section");
  stage.className = "stage";
  stage.setAttribute("aria-label", config.name + " stage");

  const stageWrap = doc.createElement("div");
  stageWrap.className = "stage-wrap";
  const canvas = doc.createElement("canvas");
  canvas.className = "mz-instrument-shell-fixture__canvas";
  canvas.width = 960;
  canvas.height = 640;
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", config.name + " instrument canvas");
  canvas.textContent = "Static " + config.name + " geometry preview.";

  const meta = doc.createElement("div");
  meta.className = "stage-meta";
  meta.setAttribute("aria-hidden", "true");
  const readout = doc.createElement("span");
  readout.textContent = config.readout;
  meta.append(readout);

  stageWrap.append(canvas, meta);
  stage.append(stageWrap);
  drawCanvas(canvas, kind, config.accent);
  return stage;
}

function createPanel(config, kind, doc) {
  const panel = doc.createElement("aside");
  panel.className = "panel";
  panel.setAttribute("aria-label", config.name + " controls");

  const playRow = doc.createElement("div");
  playRow.className = "mz-instrument-shell-fixture__play-row";
  playRow.append(
    createButton({
      label: "Play",
      variant: "play",
      size: "square",
      disabled: true,
      ariaLabel: "Playback unavailable in this static layout preview",
    }, doc),
    createStatusReadout({
      label: "State",
      value: "Paused",
      tone: "muted",
    }, doc),
  );

  const playControls = doc.createElement("div");
  playControls.className = "mz-instrument-shell-fixture__control-stack";
  playControls.append(
    playRow,
    createChoiceSwitch({
      label: "Motion",
      value: "still",
      choices: [
        { value: "still", label: "Still" },
        { value: "turn", label: "Turn" },
      ],
    }, doc),
  );

  const formControls = doc.createElement("div");
  formControls.className = "mz-instrument-shell-fixture__control-stack";
  formControls.append(
    createSelectField({
      id: "fixture-" + kind + "-form",
      name: "fixture-" + kind + "-form",
      label: config.formLabel,
      value: config.formValue,
      options: config.forms,
    }, doc),
    createRangeField({
      id: "fixture-" + kind + "-amount",
      name: "fixture-" + kind + "-amount",
      label: config.amountLabel,
      min: config.amountMin,
      max: config.amountMax,
      step: config.amountStep,
      value: config.amountValue,
      formatValue: config.amountFormat,
    }, doc),
  );

  const soundControls = doc.createElement("div");
  soundControls.className = "mz-instrument-shell-fixture__control-stack";
  soundControls.append(
    createSelectField({
      id: "fixture-" + kind + "-voice",
      name: "fixture-" + kind + "-voice",
      label: "Voice",
      value: config.voiceValue,
      options: config.voices,
    }, doc),
    createRangeField({
      id: "fixture-" + kind + "-frequency",
      name: "fixture-" + kind + "-frequency",
      label: "Base frequency",
      min: 20,
      max: 440,
      step: 1,
      value: config.frequency,
      formatValue: (value) => Math.round(Number(value)) + " Hz",
    }, doc),
  );

  const outputControls = doc.createElement("div");
  outputControls.className = "mz-instrument-shell-fixture__control-stack";
  outputControls.append(
    createAudioStrip({
      audioState: "off",
      audioDisabled: true,
      level: 0.56,
      levelLabel: "Master",
      ariaLabel: config.name + " audio controls",
    }, doc),
    createMidiStatus({
      state: "off",
      interactive: false,
      disabled: true,
      ariaLabel: config.name + " MIDI status",
    }, doc),
  );

  panel.append(
    createControlSection({
      title: "Play",
      state: "Paused",
      section: "play",
      open: true,
      children: playControls,
    }, doc),
    createControlSection({
      title: "Form",
      state: config.formState,
      section: "form",
      open: true,
      children: formControls,
    }, doc),
    createControlSection({
      title: "Sound",
      state: config.voices[0].label,
      section: "sound",
      open: true,
      children: soundControls,
    }, doc),
    createControlSection({
      title: "Output",
      state: "Audio off · MIDI off",
      section: "output",
      open: true,
      children: outputControls,
    }, doc),
  );
  return panel;
}

export function createInstrumentShellFixture(kind, doc = globalThis.document) {
  const config = FIXTURES[kind];
  if (!config) throw new TypeError("Unknown instrument shell fixture: " + kind);

  const page = doc.createElement("div");
  page.className = "mz-instrument-shell-fixture";
  page.setAttribute("data-instrument", kind);
  page.style.setProperty("--mz-shell-accent", config.accent);

  const shell = doc.createElement("main");
  shell.className = "shell";
  shell.id = "fixture-" + kind;
  shell.append(
    createStage(config, kind, doc),
    createPanel(config, kind, doc),
  );

  page.append(shell);
  return page;
}
