import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readProjectFile = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("the production stylesheet consumes the shared design tokens and controls", async () => {
  const [
    style,
    entrypoint,
    foundations,
    buttons,
    choices,
    selects,
    midiStatus,
    fmDrums,
    morphazoidical,
  ] = await Promise.all([
    readProjectFile("style.css"),
    readProjectFile("src/ui/index.css"),
    readProjectFile("src/ui/foundations/foundations.css"),
    readProjectFile("src/ui/primitives/button.css"),
    readProjectFile("src/ui/primitives/choice-switch.css"),
    readProjectFile("src/ui/primitives/select-field.css"),
    readProjectFile("src/ui/patterns/midi-status.css"),
    readProjectFile("fm-drums.css"),
    readProjectFile("morphazoidical/style.css"),
  ]);

  assert.match(style, /^@import url\("\.\/src\/ui\/index\.css"\);/);
  assert.match(style, /--bg: var\(--mz-color-bg\);/);
  assert.match(style, /--ink: var\(--mz-color-ink\);/);
  assert.match(style, /--mono: var\(--mz-font-mono\);/);
  assert.match(entrypoint, /foundations\/tokens\.css/);
  assert.match(entrypoint, /primitives\/field\.css/);
  assert.match(entrypoint, /primitives\/range-field\.css/);
  assert.match(entrypoint, /patterns\/audio-strip\.css/);
  assert.match(entrypoint, /patterns\/amplitude-control\.css/);
  assert.match(entrypoint, /primitives\/option-card-group\.css/);
  assert.match(entrypoint, /primitives\/number-stepper\.css/);
  assert.match(entrypoint, /primitives\/step-button\.css/);
  assert.match(entrypoint, /patterns\/midi-status\.css/);
  assert.match(entrypoint, /patterns\/level-meter\.css/);
  assert.match(entrypoint, /patterns\/signal-monitor\.css/);
  assert.match(foundations, /prefers-reduced-motion:[\s\S]*animation: none !important;/);
  assert.doesNotMatch(
    style,
    /\.audio-button,\s*\.play-button,\s*\.direction-toggle,[\s\S]*?\.mini-action\s*\{/,
    "late legacy rules must not override shared button geometry",
  );
  assert.match(buttons, /\.mini-action,\s*\.mz-button--mini\s*\{/);
  assert.match(buttons, /\.reset-all-button,\s*\.mz-button--reset\s*\{/);
  assert.match(
    buttons,
    /\.mz-button--primary:hover:not\(:disabled\),\s*\.mz-button--primary:focus-visible\s*\{[^}]*color: var\(--mz-color-bg-deep\);/s,
    "primary hover and keyboard focus must retain dark text on the bright accent surface",
  );
  assert.match(
    fmDrums,
    /\.fm-bank-actions \.is-primary:hover,\s*\.fm-bank-actions \.is-primary:focus-visible\s*\{[^}]*color: var\(--bg-deep\);/s,
    "legacy FM primary actions must retain dark hover text",
  );
  assert.match(
    style,
    /\.plugin-download-callout-actions \.plugin-download-callout-primary:hover,[\s\S]*?\{[^}]*color: var\(--bg-deep\);/s,
    "the primary plug-in download must retain dark hover text",
  );
  assert.match(buttons, /@media \(pointer: coarse\)[\s\S]*--audio-control-width: 48px;/);
  assert.match(choices, /\.choice-switch\.compact button,[\s\S]*?font-size: var\(--mz-font-size-xs\);/);
  assert.doesNotMatch(choices, /\.choice-switch\.compact[^{]*\{[^}]*min-height:/s);
  assert.match(selects, /@supports \(appearance: base-select\)/);
  assert.match(
    selects,
    /\.mz-select-field__select,\s*\.select-shell > select\s*\{[^}]*align-items: center;/s,
    "customizable selects must vertically center their closed value like the instrument menu",
  );
  assert.match(
    midiStatus,
    /\.mz-midi-status\.is-receiving[^{]*\{[^}]*background: var\(--mz-color-danger\);/s,
    "MIDI receive activity must remain distinct from the green active surface",
  );
  assert.match(
    morphazoidical,
    /\.session-state \.midi-toolbar\.is-receiving \.midi-activity-light \{[^}]*background: var\(--danger\);/s,
    "the independently themed Morphazoidical toolbar uses its red receiving state",
  );
  assert.match(
    selects,
    /\.mz-select-field__select option:checked,[^{]*\.select-shell > select option:checked\s*\{[^}]*color: var\(--mz-color-bg-deep\);[^}]*background: var\(--mz-active-accent\);/s,
    "customizable select options must use the component accent for their selected highlight",
  );
});

test("the physics instrument family renders controls with shared factories", async () => {
  const source = await readProjectFile("physics-app.js");

  assert.match(source, /from "\.\/src\/ui\/index\.js";/);
  assert.match(source, /return createRangeField\(\{/);
  assert.match(source, /return createSelectField\(\{/);
  assert.match(source, /return createChoiceSwitch\(\{/);
  assert.doesNotMatch(source, /document\.createElement\("select"\)/);
});
