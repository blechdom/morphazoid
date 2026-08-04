import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { CHAOTIC_FM_PRESETS } from "../src/chaotic-fm.js";

const jsfxUrl = new URL(
  "../plugins/reaper/Morphazoid_Chaotic_FM.jsfx",
  import.meta.url,
);
const smokeUrl = new URL(
  "../plugins/reaper/smoke/create-chaotic-fm-smoke.lua",
  import.meta.url,
);

function presetBlock(source, index) {
  const startMarker = `selected_preset == ${index} ? (`;
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `missing JSFX preset block ${index}`);
  const bodyStart = start + startMarker.length;
  const end = source.indexOf("\n  );", bodyStart);
  assert.ok(end > bodyStart, `unterminated JSFX preset block ${index}`);
  return source.slice(bodyStart, end);
}

function assignment(block, name) {
  const match = block.match(new RegExp(`\\b${name}\\s*=\\s*([0-9.]+)\\s*;`));
  assert.ok(match, `missing ${name} assignment`);
  return Number(match[1]);
}

test("REAPER Chaotic FM JSFX exposes a stereo MIDI instrument", async () => {
  const source = await readFile(jsfxUrl, "utf8");

  assert.match(source, /^desc:Morphazoid: Chaotic FM$/m);
  assert.match(source, /^tags:.*\binstrument\b/m);
  assert.match(source, /^in_pin:none$/m);
  assert.match(source, /^out_pin:Left$/m);
  assert.match(source, /^out_pin:Right$/m);
  assert.equal(source.match(/^slider\d+:/gm)?.length, 19);
  assert.match(source, /^@init$/m);
  assert.match(source, /^@slider$/m);
  assert.match(source, /^@block$/m);
  assert.match(source, /^@sample$/m);
  assert.match(source, /^@gfx 920 620$/m);
  assert.doesNotMatch(
    source,
    /\b\d+(?:\.\d+)?[eE][+-]?\d+\b/,
    "REAPER EEL2 does not accept scientific-notation number literals",
  );
});

test("REAPER Chaotic FM presets match the browser tuples", async () => {
  const source = await readFile(jsfxUrl, "utf8");
  const jsfxNames = {
    depth: "depth",
    carrierHz: "carrier_hz",
    offsetHz: "offset_hz",
    modulationAmount: "modulation_amount",
    amountDivisor: "amount_divisor",
    nonlinearityHz: "nonlinearity_hz",
  };

  assert.equal(CHAOTIC_FM_PRESETS.length, 5);
  CHAOTIC_FM_PRESETS.forEach(({ settings }, index) => {
    const block = presetBlock(source, index);
    for (const [browserName, jsfxName] of Object.entries(jsfxNames)) {
      assert.equal(
        assignment(block, jsfxName),
        settings[browserName],
        `preset ${index} differs at ${browserName}`,
      );
    }
  });
});

test("REAPER Chaotic FM implements the shared MIDI and safety contract", async () => {
  const source = await readFile(jsfxUrl, "utf8");

  assert.match(source, /while \(midirecv\(/);
  assert.match(source, /midi_status == \$x90/);
  assert.match(source, /midi_status == \$x80/);
  assert.match(source, /midi_status == \$xE0/);
  for (const cc of [5, 11, 64, 65, 72, 73, 75, 120, 121, 123]) {
    assert.match(source, new RegExp(`midi_data_1 == ${cc}`));
  }
  assert.match(source, /midisend\(/);
  assert.match(source, /event_pointer\[0\] = min\([\s\S]*floor\(midi_offset\)/);
  assert.match(
    source,
    /event_queue\[event_index \* event_stride\] <= block_sample_index/,
  );
  assert.match(source, /block_sample_index \+= 1/);
  assert.match(source, /new_velocity \/ 127/);
  assert.match(
    source,
    /exp\(log\(2\) \* semitones \/ 12\)/,
  );
  assert.match(source, /current_carrier_hz \* safe_pitch_ratio/);
  assert.match(source, /entry_base_frequency \* safe_pitch_ratio/);
  assert.match(source, /recursive_base_frequency \* safe_pitch_ratio/);
  assert.doesNotMatch(
    source,
    /current_modulation_amount \* safe_pitch_ratio/,
  );
  assert.match(source, /frequency_ceiling = min\(20000, safe_sample_rate \* 0\.45\)/);
  assert.match(source, /function tanh_safe\(/);
  assert.doesNotMatch(source, /AudioContext|AudioWorklet/);
});

test("REAPER Chaotic FM implements expressive mono performance v2", async () => {
  const source = await readFile(jsfxUrl, "utf8");

  assert.match(source, /^slider12:attack_ms=8<0,5000,/m);
  assert.match(source, /^slider13:decay_ms=120<0,5000,/m);
  assert.match(source, /^slider14:sustain_level=0\.72<0,1,/m);
  assert.match(source, /^slider15:release_ms=180<2,10000,/m);
  assert.match(source, /^slider16:glide_time_ms=0<0,2000,/m);
  assert.match(source, /^slider17:glide_mode=0<0,2,1\{Off,Legato,Always\}>/m);
  assert.match(source, /^slider18:expression=1<0,1,/m);

  assert.match(source, /key_down\[note_index\]/);
  assert.match(source, /find_latest_physical_note\(\)/);
  assert.match(source, /sustain_down/);
  assert.match(source, /midi_glide_enabled/);
  assert.match(source, /glide_start_semitones = current_note_semitones/);
  assert.match(source, /glide_position \+=[\s\S]*glide_total_samples/);
  assert.match(source, /current_note_semitones = glide_start_semitones \+/);
  assert.match(source, /bend_start_semitones = current_bend_semitones/);
  assert.match(source, /0\.008 \* max\(8000, srate\)/);

  assert.match(source, /function begin_attack\(/);
  assert.match(source, /function begin_decay\(/);
  assert.match(source, /function begin_release\(/);
  assert.match(source, /envelope_curve = 1 - \(1 - envelope_position\)/);
  assert.match(source, /envelope_target \+ \(1 - envelope_target\) \* envelope_curve/);
  assert.match(source, /envelope_value = envelope_start \* envelope_curve/);
  assert.match(source, /floor\(0\.002 \* max\(8000, srate\)/);

  assert.match(source, /cc_log_zero\(cc_value, 10, 2000\)/);
  assert.match(source, /cc_log\(cc_value, 2, 10000\)/);
  assert.match(source, /cc_log_zero\(cc_value, 0\.5, 5000\)/);
  assert.match(source, /cc_log_zero\(cc_value, 1, 5000\)/);
  assert.match(source, /cc_number == 121 \? reset_controllers\(\)/);
  assert.match(source, /cc_number == 123 \?[\s\S]*begin_release\(\)/);
});

test("REAPER Chaotic FM has simultaneous layered live analyzers and backed UI", async () => {
  const source = await readFile(jsfxUrl, "utf8");

  assert.match(source, /fft_size = 2048/);
  assert.match(source, /analysis_history\[analysis_write_position\] = output_sample/);
  assert.match(source, /fft\(fft_workspace, fft_size\)/);
  assert.match(source, /fft_permute\(fft_workspace, fft_size\)/);
  assert.match(source, /spectrum_values\[fft_index\]/);
  assert.match(source, /display_maximum_frequency = min\(20000,/);
  assert.match(source, /log\(display_maximum_frequency \/ 20\)/);
  assert.match(source, /fft_db = min\(0, max\(-90, fft_db\)\)/);
  assert.match(
    source,
    /^slider19:analysis_view=.*\{Combined,Scope focus\}>Analyzer emphasis$/m,
  );
  assert.match(source, /spectrum_bar_count = 56/);
  assert.match(source, /spectrum_bar_alpha = analysis_view < 0\.5 \? 0\.30 : 0\.13/);
  assert.match(
    source,
    /spectrum_first_bin = max\([\s\S]*ceil\(spectrum_low_frequency \* fft_size/,
  );
  assert.match(
    source,
    /spectrum_last_bin = min\([\s\S]*floor\(spectrum_high_frequency \* fft_size/,
  );
  assert.match(source, /spectrum_first_bin > spectrum_last_bin \? \(/);
  assert.match(
    source,
    /loop\(spectrum_last_bin - spectrum_first_bin \+ 1,[\s\S]*spectrum_db = max\(spectrum_db, spectrum_values\[spectrum_band_bin\]\)/,
  );
  assert.match(source, /gfx_rect\([\s\S]*spectrum_bar_width,[\s\S]*spectrum_bar_height/);
  assert.match(source, /gfx_drawstr\("SPECTRUM \+ SCOPE"\)/);
  assert.match(source, /scope_samples = min\(2048, analysis_history_size\)/);
  assert.match(source, /set_color\(1\.00, 0\.82, 0\.38, 1\)/);
  assert.ok(
    source.indexOf("spectrum_bar_count =") < source.indexOf("scope_samples ="),
    "spectrum bars must be drawn before the foreground scope trace",
  );
  assert.doesNotMatch(source, /analysis_view < 0\.5 \? \(\s*display_maximum_frequency/);
  assert.match(source, /slider_automate\(attack_ms\)/);
  assert.match(source, /slider_automate\(glide_time_ms\)/);
  assert.match(source, /slider_automate\(analysis_view\)/);
  assert.doesNotMatch(source, /spectrogram|scrolling history/i);
});

test("REAPER smoke project exercises all factory performance MIDI", async () => {
  const source = await readFile(smokeUrl, "utf8");

  assert.match(source, /parameter_count < 19/);
  assert.match(source, /midi_note_count=/);
  for (const cc of [5, 11, 64, 65, 72, 73, 75, 120, 121, 123]) {
    assert.match(source, new RegExp(`control_change\\([^\\n]+, ${cc},`));
  }
  assert.equal(source.match(/MIDI_InsertCC/g)?.length, 4);
});
