import { writeFile } from "node:fs/promises";
import { STARTING_INSTRUMENTS } from "../src/families/starting-instruments/catalog.js";
import { INSTRUMENT_HELP, formatParameter } from "../src/families/starting-instruments/help.js";
import { withSocialPreview } from "./social-preview.mjs";
const escape = (s) => String(s).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
const root = new URL("../", import.meta.url);
for (const [id, spec] of Object.entries(STARTING_INSTRUMENTS)) {
  const help = INSTRUMENT_HELP[id];
  const network = ["tape-worm", "loop-soup"].includes(id);
  const links = Object.entries(STARTING_INSTRUMENTS).map(([slug, item]) =>
    `<a href="${slug}.html"${slug === id ? ' aria-current="page"' : ""}>${escape(item.title)}</a>`).join("\n");
  const ranges = spec.controls.map((c) => `<label class="control" for="${c.key}">
    <span><b>${escape(c.label)}</b><output id="${c.key}Out" for="${c.key}">${escape(formatParameter(id, c, spec.defaults[c.key]))}</output></span>
    <input id="${c.key}" type="range" min="${c.min}" max="${c.max}" step="${c.step}" value="${spec.defaults[c.key]}" aria-describedby="${c.key}Help" title="${escape(help.controls[c.key])}" />
  </label>`).join("\n");
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="description" content="${escape(spec.description)}" />
  <meta name="theme-color" content="#080e16" />
  <title>${escape(spec.title)} · Morphazoid</title>
  <link rel="icon" href="favicon.svg" type="image/svg+xml" />
  <link rel="stylesheet" href="style.css" />
  <link rel="stylesheet" href="src/families/starting-instruments/starting-instruments.css" />${network ? '\n  <link rel="stylesheet" href="src/families/starting-instruments/loop-network.css" />' : ""}
</head>
<body class="starting-instrument${network ? " loop-network-page" : ""}" data-starting-instrument="${id}" style="--accent:${spec.accent}">
  <header class="masthead">
    <a class="wordmark" href="./" aria-label="Morphazoid home"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span><span>morphazoid</span></a>
    <nav class="tabs" aria-label="Instrument"><a class="tab active" href="${id}.html" aria-current="page">${escape(spec.title)}</a><a class="tab" href="lumber.html">Lumber Loops</a></nav>
    <label class="mobile-instrument-nav"><span class="sr-only">Instrument</span><select class="mobile-instrument-select" aria-label="Instrument"><option value="${id}.html" selected>${escape(spec.title)}</option><option value="lumber.html">Lumber Loops</option></select></label>
    <div id="audioSlot" class="audio-strip" aria-label="Audio controls"><button id="audioButton" class="audio-button" type="button" aria-pressed="false" disabled>Audio off · enable JavaScript</button></div>
  </header>
  <main class="starting-shell">
    <section class="starting-stage${network ? " network-stage" : ""}" aria-label="${escape(spec.title)} instrument">
      <header class="starting-title"><h1>${escape(spec.title)}</h1><p>${escape(spec.subtitle)}</p></header>
      ${network ? `<div class="network-viewport" id="networkViewport" tabindex="0" role="region" aria-label="Scrollable loop network" aria-describedby="canvasInstructions"><div id="stage"><div id="networkSurface" class="network-surface"></div></div></div>` : `<div class="stage-wrap" id="stageWrap"><canvas id="stage" role="img" tabindex="0" aria-label="${escape(spec.description)}" aria-describedby="canvasInstructions modelStatus">Use the labelled controls below to play this instrument.</canvas></div>`}
      <p class="starting-hint" id="canvasInstructions">${escape(spec.hint)} <a href="#howItWorks">How to play / keys</a></p>
    </section>
    <aside class="starting-controls" aria-label="${escape(spec.title)} controls">
      <section class="group">
        <div class="transport-row"><button id="playButton" type="button" aria-pressed="false" data-primary-transport>Play</button><button id="resetButton" class="mini-action" type="button" data-reset-all data-reset-in-place>Reset controls</button></div>
        <label class="field-label" for="preset">Starting point<select id="preset" aria-label="Starting point"></select></label>
        <p id="presetHint" class="starting-note">${escape(help.presets[Object.keys(spec.presets)[0]])}</p>
        <div id="modelStatus" role="status">Ready · Audio off</div>
        <p id="liveStatus" role="status" aria-live="polite">Turn Audio on, then Play. No microphone is required for the demo.</p>
        <p id="actionStatus" class="starting-note">${id === "tape-worm" || id === "loop-soup" ? "Temporary audio: leaving or reloading this page discards it." : "Recordings and graph generation are not part of this demo."}</p>
        <p id="audioError" role="alert" hidden></p>
      </section>
      <section class="group" aria-label="Instrument parameters">${ranges}</section>
      <section class="group" aria-label="Direct actions"><div class="starting-selectors" id="selectors" role="group" aria-label="Selected object"></div><div class="starting-tools" id="instrumentTools"></div></section>
      <details class="starting-guide" id="howItWorks">
        <summary>How it works / listening exercise</summary>
        <h2>Try this first</h2><p>${escape(help.start)}</p>
        <h2>What you hear</h2><p>${escape(help.hear)}</p>
        <h2>What the picture means</h2><p>${escape(help.visual)}</p>
        <h2>The mechanism</h2><p>${escape(help.mechanism)}</p>
        <h2>Controls</h2><dl>${spec.controls.map((c) => `<dt>${escape(c.label)}</dt><dd id="${c.key}Help">${escape(help.controls[c.key])}</dd>`).join("")}</dl>
        <h2>Pause, reset, and memory</h2><p>${escape(help.memory)}</p>
        <p>Audio Off is mute, not Pause. It closes owned microphone tracks but retains transport. Monitor can pass live microphone audio while paused until you turn it off.</p>
        <h2>Keyboard</h2><p>${escape(help.keyboard)}</p>
        <h2>What this demo does not do</h2><p class="starting-limit">${escape(help.limits)}</p>
      </details>
      <details><summary>About this starting instrument</summary><p>${escape(spec.disclaimer)}</p><p>Presets change parameters, not capabilities. Reset controls keeps recordings and learned routes. Demo material is synthesized locally.</p><a href="docs/starting-instruments.md">Model and limitations</a></details>
      <nav class="starting-family" aria-label="Other starting instruments">${links}</nav>
      <noscript><p>This instrument needs JavaScript. Audio and microphone start off.</p></noscript>
    </aside>
  </main>
  <script type="module" src="${network ? "src/families/starting-instruments/loop-network-app.js" : "src/families/starting-instruments/starting-instruments-app.js"}"></script>
  <script type="module" src="nav.js"></script>
</body>
</html>`;
  await writeFile(new URL(`${id}.html`, root), withSocialPreview(html, `${id}.html`));
  console.log(`Built ${id}.html`);
}
