import { MidiMixerEngine } from './midi-mixer-engine.js';
import { GM_PROGRAM_NAMES, defaultDeckConfig } from './midi-mixer-model.js';
import { MidiMixerRenderer, mixerVoiceColor } from './midi-mixer-renderer.js';
import { registerHeaderPresets } from '../../site/header-presets.js';
import { MIDI_MIXER_PRESETS, captureMixerPreset, applyMixerPreset, randomizeMixerPreset } from './midi-mixer-presets.js';
import { mountMixerPerformance } from './midi-mixer-performance.js';
import { mountMidiParameterEditor, mountMidiSynthEffectEditor } from './midi-mixer-midi-editor.js';

const asset = path => new URL(`../../../assets/midiphoria/${path}`, import.meta.url).href;
const time = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const noteName = note => note === null ? '—' : `${['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'][note % 12]}${Math.floor(note / 12) - 1}`;
const labelFor = song => `${song.artist || song.composer || ''}${song.artist || song.composer ? ' · ' : ''}${song.title}`;
export function mountMidiMixer(host, { onState = () => {}, onOriginal, getDrawing } = {}) {
  host.classList.add('mixer-shell');
  host.innerHTML = `<div class="mixer-main-row">
    <div class="mixer-transport">
      <button id="mixerPlay" type="button" class="play-button" aria-label="Play MIDI mix" aria-pressed="false" disabled><svg viewBox="0 0 24 24" aria-hidden="true"><path class="transport-play" d="M7 4 21 12 7 20Z"/><path class="transport-pause" d="M8 4v16M16 4v16"/></svg></button>
      <button id="mixerStop" class="mini-action" type="button" aria-label="Stop MIDI mix">Stop</button>
      <label class="control mixer-tempo"><span><b>Shared tempo</b><output id="masterTempoOut" for="masterTempo">120 BPM</output></span><input id="masterTempo" name="tempo" type="range" min="30" max="300" step=".1" value="120"></label>
    </div>
    <div class="mixer-scenes" id="mixerPresetHost"></div>
  </div>
  <div class="mixer-mix-row"><button id="tempoFromA" class="mini-action" type="button" disabled>Use A tempo</button><label class="control mixer-crossfade"><span><b><span class="deck-a-ink">A</span> · Balance · <span class="deck-b-ink">B</span></b><output id="crossfadeOut" for="mixerCrossfade">A + B</output></span><input id="mixerCrossfade" name="balance" type="range" min="-1" max="1" step=".01" value="0"></label><button id="tempoFromB" class="mini-action" type="button" disabled>Use B tempo</button></div>
  <div class="mixer-readout"><output id="mixerPosition">Beat 1</output><span id="mixerFontName">TimGM6mb</span><button id="mixerReset" class="mini-action" type="button">Reset mix</button></div>
  <p class="mixer-status" id="mixerStatus" role="status"></p>
  <div id="mixerPerformanceHost"></div>
  <div id="mixerDeckHost" class="mixer-decks"></div>
  <details class="mixer-effects"><summary>SoundFont & live effects</summary><div class="mixer-effects-controls">
    <label class="deck-file">Open SoundFont<input id="mixerSoundFont" type="file" accept=".sf2,.sf3" aria-label="Open mixer SoundFont"></label><button id="mixerDefaultFont" class="mini-action" type="button">TimGM6mb</button>
    <label class="control"><span><b>Low-pass filter</b><output id="mixerFilterOut">Open</output></span><input id="mixerFilter" type="range" min="1.7781512504" max="4.30103" step=".01" value="4.30103" aria-label="Mixer low-pass filter"><input id="mixerFilterExact" type="number" min="60" max="20000" step="1" value="20000" aria-label="Mixer filter frequency in Hz"></label>
    <label class="control"><span><b>Echo</b><output id="mixerEchoOut">0%</output></span><input id="mixerEcho" type="range" min="0" max=".75" step=".01" value="0" aria-label="Mixer echo mix"></label>
    <label class="control"><span><b>Echo time</b></span><select id="mixerEchoTime"><option value="0.125">⅛ beat</option><option value="0.25">¼ beat</option><option value="0.5" selected>½ beat</option><option value="0.75">¾ beat</option><option value="1">1 beat</option><option value="1.5">1½ beats</option><option value="2">2 beats</option><option value="4">4 beats</option></select><input id="mixerEchoExact" type="number" min=".125" max="4" step=".001" value=".5" aria-label="Mixer exact echo time in beats"></label>
    <label class="control"><span><b>Feedback</b><output id="mixerFeedbackOut">30%</output></span><input id="mixerFeedback" type="range" min="0" max=".8" step=".01" value=".3" aria-label="Mixer echo feedback"></label>
  </div><div id="mixerSynthEffects"></div></details>
  <details class="mixer-guide"><summary>Mixing & file details</summary><p>Each map spans the entire arrangement. Taller marks mean more note attacks, not higher pitches. Click to jump; drag a region to loop it. Arrow keys move one beat, Shift + arrows four beats. Choose Drums on one deck and Melody on the other, then use Solo to keep a particular voice. Grey rows are muted. Voices with no notes are listed in the inspector.</p><p>Both decks follow one beat clock. Tempo ratio lets A run at double time while B runs at half time. Slip advances or delays a score without moving that clock; pitch shifts leave General MIDI drums unchanged. Bar slips use each file’s initial time signature. SoundFonts stay in this browser. This is MIDI seeking and looping, rather than vinyl-style reversed audio scratching.</p><p><a href="docs/midi-mixer.md" target="_blank" rel="noopener">Mixer details ↗</a> · <a href="assets/midiphoria/SOURCE.md" target="_blank" rel="noopener">MIDI collection & SoundFont credits ↗</a></p></details>`;
  host.insertBefore(host.querySelector('.mixer-effects'), host.querySelector('#mixerDeckHost'));
  const $ = id => host.querySelector(`#${id}`);
  const events = new AbortController(), requests = [null, null], serial = [0, 0], selectedIds = ['', ''], originals = [null, null];
  const on = (node, type, fn, options = {}) => node.addEventListener(type, fn, { ...options, signal: events.signal });
  let disposed = false, active = false, frame = null, lastFrame = 0, collection = [], loading = [false, false], error = '', pendingPlay = false, initialized = false;
  const deckUIs = [], renderers = [];
  let engine, performanceView, presetController, synthEffectEditor, fontSerial = 0, fontRequest = null, originalBusy = false;
  function custom() { queueMicrotask(() => presetController?.refresh()); }
  function attempt(fn) { try { const result = fn(); if (result?.catch) result.catch(fail); return result; } catch (cause) { fail(cause); } }
  function fail(cause) { if (!disposed && cause?.name !== 'AbortError') { error = cause.message || String(cause); reflect(); } }
  function field(node, value) { if (document.activeElement !== node && node.value !== String(value)) node.value = String(value); }
  for (let index = 0; index < 2; index++) {
    const letter = index ? 'B' : 'A', section = document.createElement('section');
    section.className = 'mixer-deck'; section.dataset.deck = String(index); section.setAttribute('aria-label', `MIDI deck ${letter}`);
    section.innerHTML = `<div class="deck-heading"><h2>Deck ${letter}</h2><output id="deckPosition${index}">—</output></div>
      <div class="deck-song"><select id="deckSong${index}" aria-label="Deck ${letter} MIDI file"><option value="">Choose a MIDI file</option></select><button id="deckRandom${index}" class="mini-action" type="button" aria-label="Random MIDI for deck ${letter}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" aria-hidden="true"><path d="M3 3h18v18H3Z"/><path d="M7 7h1v1H7ZM16 7h1v1h-1ZM11.5 11.5h1v1h-1ZM7 16h1v1H7ZM16 16h1v1h-1Z"/></svg></button><button id="deckNext${index}" class="mini-action" type="button" aria-label="Next MIDI for deck ${letter}">→</button></div>
      <div class="deck-source-actions"><label class="deck-file">Open MIDI<input id="deckFile${index}" type="file" accept=".mid,.midi" aria-label="Open MIDI on deck ${letter}"></label><button id="deckOriginal${index}" class="mini-action deck-original" type="button" aria-label="Play deck ${letter} original MIDI" title="Play this file alone with its original timing and instruments" disabled>Play original</button></div><p id="deckCredit${index}" class="deck-credit"></p>
      <dl id="deckInfo${index}" class="deck-info"></dl>
      <div class="mixer-deck-map"><canvas id="deckMap${index}" tabindex="0" role="slider" aria-label="Deck ${letter} voice activity map" aria-valuemin="0" aria-valuemax="1" aria-valuenow="0" ></canvas></div>
      <p class="deck-map-help">Click to jump · drag to loop · grey = muted</p>
      <div class="deck-parameters">
        <label class="control"><span><b>Tempo ratio</b><output id="deckRateOut${index}">120 BPM</output></span><select id="deckRate${index}" aria-label="Deck ${letter} tempo ratio"><option value="0.25">¼× · quarter time</option><option value="0.5">½× · half time</option><option value="1" selected>1× · shared tempo</option><option value="2">2× · double time</option><option value="4">4× · quadruple time</option><option value="8">8× · eight times</option></select></label>
        <label class="control"><span><b>Level</b><output id="deckGainOut${index}">100%</output></span><input id="deckGain${index}" aria-label="Deck ${letter} level" type="range" min="0" max="2" step=".01" value="1"></label>
        <label class="control"><span><b>Pitch</b><output id="deckPitchOut${index}">0 st</output></span><input id="deckPitch${index}" aria-label="Deck ${letter} pitch" type="range" min="-24" max="24" step="1" value="0"></label>
        <div class="control"><label for="deckOffset${index}">Slip · beats</label><div class="deck-slip"><button type="button" class="mini-action" id="deckBack${index}" aria-label="Slip deck ${letter} back one bar">−bar</button><input id="deckOffset${index}" type="number" min="-4000000" max="4000000" step=".25" value="0"><button type="button" class="mini-action" id="deckForward${index}" aria-label="Slip deck ${letter} forward one bar">+bar</button></div></div>
        <div class="control"><label for="deckScrub${index}">Position · beats</label><input id="deckScrub${index}" type="range" min="0" max="1" step=".25" value="0"></div>
      </div>
      <details class="deck-midi-editor"><summary>MIDI · all voices</summary><label class="control deck-exact-ratio">Exact tempo ratio<input id="deckExactRate${index}" aria-label="Deck ${letter} exact tempo ratio" type="number" min=".25" max="8" step=".001" value="1"></label><div id="deckMidi${index}"></div></details>
      <div class="deck-loop-region"><label>Loop from<input id="deckLoopStart${index}" aria-label="Deck ${letter} loop start" type="number" min="0" max="1000000" step=".03125" value="0"></label><label>to<input id="deckLoopEnd${index}" aria-label="Deck ${letter} loop end" type="number" min="0" max="1000000" step=".03125" value="0"></label><button id="deckFullLoop${index}" type="button" class="mini-action">Whole file</button></div>
      <div class="deck-switches"><label><input id="deckLoop${index}" type="checkbox" checked>Loop</label><label><input id="deckMute${index}" type="checkbox">Mute deck</label><button id="deckMatch${index}" class="mini-action" type="button" disabled>Match ${index ? 'A' : 'B'} key</button></div>
      <div class="deck-channel-heading"><h3>Voices</h3><div class="deck-channel-actions"><button id="deckAll${index}" type="button" class="mini-action">All</button><button id="deckDrums${index}" type="button" class="mini-action">Drums</button><button id="deckMelody${index}" type="button" class="mini-action">Melody</button></div></div>
      <div id="deckChannels${index}" class="deck-channels"></div>
      <details class="deck-inspector"><summary>Inspect MIDI · tracks, notes & timing</summary><div id="deckInspect${index}"></div></details>`;
    $('mixerDeckHost').append(section);
    const ui = { section, analysis: null, rows: new Map(), letter, channelEvents: new AbortController(), midiEditor: null }; deckUIs.push(ui);
    on(section.querySelector('.deck-midi-editor'), 'toggle', event => {
      if (!event.target.open || !engine) return;
      ui.midiEditor ??= mountMidiParameterEditor($(`deckMidi${index}`), {
        label: `Deck ${letter} MIDI`, getValue: () => engine.state.decks[index].config.midi,
        onChange: midi => { custom(); engine.configureDeck(index, { midi }); },
        onAction: action => midiAction(index, null, action),
      });
      ui.midiEditor.refresh();
    });
    renderers.push(new MidiMixerRenderer($(`deckMap${index}`), index, {
      onSeek: beat => { custom(); attempt(() => engine.seekDeck(index, beat)); },
      onLoop: (start, end) => { custom(); engine.configureDeck(index, { loopStartBeats: start, loopEndBeats: end, loop: true }); engine.seekDeck(index, start); },
    }));
    on($(`deckSong${index}`), 'change', () => void choose(index, $(`deckSong${index}`).value));
    on($(`deckRandom${index}`), 'click', () => { if (collection.length) void choose(index, collection[Math.floor(Math.random() * collection.length)].id); });
    on($(`deckNext${index}`), 'click', () => { if (collection.length) void choose(index, collection[(collection.findIndex(song => song.id === $(`deckSong${index}`).value) + 1) % collection.length].id); });
    on($(`deckFile${index}`), 'change', async event => {
      const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
      const ticket = ++serial[index]; requests[index]?.abort(); loading[index] = true; error = ''; reflect();
      try {
        if (file.size > 10 * 1024 * 1024) throw new Error('MIDI files must be 10 MB or smaller.');
        const buffer = await file.arrayBuffer(); if (disposed || ticket !== serial[index]) return;
        await engine.loadDeck(index, buffer, file.name); selectedIds[index] = 'local';
        originals[index] = { buffer, title: file.name, attribution: 'Your MIDI · kept in this browser.' };
        $(`deckSong${index}`).querySelector('[value="local"]')?.remove(); $(`deckSong${index}`).append(new Option(file.name, 'local')); $(`deckSong${index}`).value = 'local';
        $(`deckCredit${index}`).textContent = 'Local MIDI · kept in this browser.';
      } catch (cause) { if (ticket === serial[index]) { $(`deckSong${index}`).value = selectedIds[index]; fail(cause); } }
      finally { if (ticket === serial[index] && !disposed) { loading[index] = false; resumePending(); reflect(); } }
    });
    on($(`deckOriginal${index}`), 'click', async () => {
      if (!onOriginal || !originals[index] || loading[index] || originalBusy) return;
      originalBusy = true; error = ''; reflect();
      try { await onOriginal({ ...originals[index], buffer: originals[index].buffer.slice(0), index }); }
      catch (cause) { fail(cause); }
      finally { originalBusy = false; if (!disposed) reflect(); }
    });
    for (const [id, key] of [['Gain', 'gain'], ['Pitch', 'transpose'], ['Offset', 'offsetBeats']]) on($(`deck${id}${index}`), 'input', event => { custom(); engine.configureDeck(index, { [key]: Number(event.target.value) }); });
    on($(`deckRate${index}`), 'change', event => { custom(); engine.configureDeck(index, { rate: Number(event.target.value) }); });
    on($(`deckExactRate${index}`), 'change', event => { if (!event.target.validity.valid) return; custom(); engine.configureDeck(index, { rate: Number(event.target.value) }); });
    for (const [id, key] of [['Loop', 'loop'], ['Mute', 'mute']]) on($(`deck${id}${index}`), 'change', event => { custom(); engine.configureDeck(index, { [key]: event.target.checked }); });
    for (const [id, direction] of [['Back', -1], ['Forward', 1]]) on($(`deck${id}${index}`), 'click', () => {
      const deck = engine.state.decks[index], meter = deck.analysis?.meterMap[0], bar = meter ? meter.numerator * 4 / meter.denominator : 4;
      custom(); engine.configureDeck(index, { offsetBeats: deck.config.offsetBeats + direction * bar });
    });
    on($(`deckScrub${index}`), 'input', event => { custom(); engine.seekDeck(index, Number(event.target.value)); });
    for (const id of ['Start', 'End']) on($(`deckLoop${id}${index}`), 'change', () => {
      custom(); engine.configureDeck(index, { loopStartBeats: Number($(`deckLoopStart${index}`).value), loopEndBeats: Number($(`deckLoopEnd${index}`).value), loop: true });
    });
    on($(`deckFullLoop${index}`), 'click', () => { custom(); engine.configureDeck(index, { loopStartBeats: 0, loopEndBeats: null }); });
    for (const mode of ['All', 'Drums', 'Melody']) on($(`deck${mode}${index}`), 'click', () => {
      custom(); for (const channel of engine.state.decks[index].analysis?.channels ?? []) engine.configureChannel(index, channel.channel, { mute: mode === 'Drums' ? !channel.drums : mode === 'Melody' ? channel.drums : false, solo: false });
    });
    on($(`deckMatch${index}`), 'click', () => {
      const state = engine.state, from = keyRoot(state.decks[index].analysis?.key), to = keyRoot(state.decks[1 - index].analysis?.key);
      if (from === null || to === null) return;
      const shift = ((to + state.decks[1 - index].config.transpose - from + 18) % 12 + 12) % 12 - 6;
      custom(); engine.configureDeck(index, { transpose: shift });
    });
  }
  function midiAction(index, channel, action) {
    return attempt(() => action.kind === 'parameter'
      ? engine.sendChannelParameter(index, channel, action)
      : engine.sendChannelController(index, channel, action.controller, action.value));
  }
  function keyRoot(key) {
    const match = key?.label?.match(/^([A-G])([♭♯]?)/); if (!match) return null;
    return ({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[match[1]] + (match[2] === '♯' ? 1 : match[2] === '♭' ? -1 : 0) + 12) % 12;
  }
  function makeInfo(index, analysis) {
    const ui = deckUIs[index]; ui.channelEvents.abort(); ui.channelEvents = new AbortController(); ui.analysis = analysis; for (const row of ui.rows.values()) row.editor?.destroy(); ui.rows.clear(); $(`deckInfo${index}`).replaceChildren(); $(`deckChannels${index}`).replaceChildren(); $(`deckInspect${index}`).replaceChildren();
    if (!analysis) return;
    const meter = analysis.meterMap[0], key = analysis.key;
    for (const [title, value] of [['Source tempo', `${analysis.initialTempo.toFixed(1)} BPM`], ['Original time', time(analysis.durationSeconds)], ['Meter', `${meter.numerator}/${meter.denominator}`], ['Key', `${key.label}${key.source === 'estimated' ? ' · estimated' : key.source === 'embedded' ? ' · MIDI' : ''}`]]) {
      const div = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = title; dd.textContent = value; div.append(dt, dd); $(`deckInfo${index}`).append(div);
    }
    for (const channel of analysis.channels.filter(item => item.noteCount > 0)) {
      const row = document.createElement('div'); row.className = 'channel-row'; row.dataset.channel = String(channel.channel);
      const label = document.createElement('label'); label.className = 'channel-label'; label.htmlFor = `deckProgram${index}_${channel.channel}`;
      const swatch = document.createElement('span'); swatch.className = 'channel-swatch'; swatch.style.background = mixerVoiceColor(index, channel.channel);
      const info = document.createElement('span'), small = document.createElement('small'); info.textContent = `${channel.port ? `P${channel.port + 1} · ` : ''}Ch ${channel.channel % 16 + 1}`; small.textContent = `${channel.noteCount.toLocaleString()} notes`; info.append(small); label.append(swatch, info);
      const select = document.createElement('select'); select.id = label.htmlFor; select.setAttribute('aria-label', `Deck ${ui.letter} channel ${channel.channel + 1} instrument`);
      select.append(new Option(`Original · ${channel.instrument}`, '')); GM_PROGRAM_NAMES.forEach((name, program) => select.append(new Option(`${program + 1} · ${name}`, String(program))));
      if (channel.drums) { select.replaceChildren(new Option('Original drum kit', '')); for (let program = 0; program < 128; program++) select.append(new Option(`Kit ${program + 1} · SoundFont`, String(program))); }
      const mute = document.createElement('button'), solo = document.createElement('button'); mute.type = solo.type = 'button'; mute.textContent = 'M'; solo.textContent = 'S';
      mute.setAttribute('aria-label', `Mute deck ${ui.letter} channel ${channel.channel + 1}`); solo.setAttribute('aria-label', `Solo deck ${ui.letter} channel ${channel.channel + 1}`);
      mute.setAttribute('aria-pressed', 'false'); solo.setAttribute('aria-pressed', 'false'); mute.disabled = solo.disabled = !channel.noteCount;
      select.addEventListener('change', () => { custom(); engine.configureChannel(index, channel.channel, { program: select.value === '' ? null : Number(select.value) }); }, { signal: ui.channelEvents.signal });
      for (const [button, key] of [[mute, 'mute'], [solo, 'solo']]) button.addEventListener('click', () => { custom(); const setting = engine.state.decks[index].channels.find(item => item.channel === channel.channel); engine.configureChannel(index, channel.channel, { [key]: !setting[key] }); }, { signal: ui.channelEvents.signal });
      const details = document.createElement('details'), summary = document.createElement('summary'), editorHost = document.createElement('div');
      details.className = 'channel-midi-editor'; summary.textContent = 'Edit voice'; details.append(summary, editorHost);
      const entry = { row, select, mute, solo, details, editor: null, silent: !channel.noteCount };
      details.addEventListener('toggle', () => {
        if (!details.open) return;
        entry.editor ??= mountMidiParameterEditor(editorHost, {
          label: `Deck ${ui.letter} channel ${channel.channel + 1}`, followLabel: 'Follow deck / file', excludeFields: ['program'],
          getValue: () => engine.state.decks[index].channels.find(item => item.channel === channel.channel)?.midi,
          onChange: midi => { custom(); engine.configureChannel(index, channel.channel, { midi }); },
          onAction: action => midiAction(index, channel.channel, action),
        });
        entry.editor.refresh();
      }, { signal: ui.channelEvents.signal });
      row.append(label, select, mute, solo, details); $(`deckChannels${index}`).append(row); ui.rows.set(channel.channel, entry);
    }
    const paragraph = document.createElement('p'); paragraph.textContent = `Format ${analysis.format} · ${analysis.trackCount} tracks · ${analysis.ppq} ticks/quarter · ${analysis.noteCount.toLocaleString()} notes · ${analysis.durationBeats.toFixed(2)} beats`; $(`deckInspect${index}`).append(paragraph);
    const table = document.createElement('table');
    for (const cells of [['Channel / instrument', 'Notes', 'Range', 'Tracks'], ...analysis.channels.map(channel => [`${channel.channel + 1} · ${channel.instrument}${channel.programs.length > 1 ? ` (${channel.programs.length} programs)` : ''}`, channel.noteCount.toLocaleString(), `${noteName(channel.minNote)} – ${noteName(channel.maxNote)}`, channel.tracks.map(track => track + 1).join(', ')])]) {
      const tr = document.createElement('tr'); for (const value of cells) { const td = document.createElement(table.rows.length ? 'td' : 'th'); td.textContent = value; tr.append(td); } table.append(tr);
    }
    $(`deckInspect${index}`).append(table);
    for (const content of [
      `Tracks: ${analysis.tracks.map(track => `${track.index + 1}: ${track.name}`).join(' · ')}`,
      `Tempo map: ${analysis.tempoMap.slice(0, 100).map(item => `beat ${item.beat.toFixed(1)} → ${item.bpm.toFixed(1)} BPM`).join(' · ')}${analysis.tempoMap.length > 100 ? ' · …' : ''}`,
      `Meter map: ${analysis.meterMap.slice(0, 100).map(item => `beat ${item.beat.toFixed(1)} → ${item.numerator}/${item.denominator}`).join(' · ')}`,
      ...analysis.warnings,
    ]) { const p = document.createElement('p'); p.textContent = content; $(`deckInspect${index}`).append(p); }
  }
  function reflect() {
    if (!engine || disposed) return;
    const state = engine.state;
    $('mixerPlay').disabled = !state.decks.some(deck => deck.analysis); $('mixerPlay').setAttribute('aria-pressed', String(state.playing)); $('mixerPlay').setAttribute('aria-label', state.playing ? 'Pause MIDI mix' : 'Play MIDI mix');
    field($('masterTempo'), state.tempo); $('masterTempoOut').value = `${state.tempo.toFixed(1)} BPM`; field($('mixerCrossfade'), state.crossfade);
    $('crossfadeOut').value = state.crossfade === 0 ? 'A + B' : `${Math.round(Math.abs(state.crossfade) * 100)}% ${state.crossfade < 0 ? 'A' : 'B'}`;
    $('mixerStatus').textContent = error || state.error || (loading.some(Boolean) ? 'Loading MIDI…' : state.loading ? 'Loading SoundFont…' : state.skippedEvents ? `${state.skippedEvents.toLocaleString()} dense-score events skipped to keep audio running.` : '');
    $('mixerFontName').textContent = state.soundfontName || 'TimGM6mb';
    const effects = state.effects;
    if (effects) {
      const echoMenu = $('mixerEchoTime'); let customEcho = echoMenu.querySelector('[data-custom-time]');
      if (![.125, .25, .5, .75, 1, 1.5, 2, 4].includes(effects.delayBeats)) { if (!customEcho) { customEcho = new Option(); customEcho.dataset.customTime = ''; echoMenu.append(customEcho); } customEcho.value = String(effects.delayBeats); customEcho.textContent = `${effects.delayBeats.toFixed(3)} beats`; } else customEcho?.remove();
      field($('mixerFilter'), Math.log10(effects.filterHz)); field($('mixerEcho'), effects.delayMix); field($('mixerEchoTime'), effects.delayBeats); field($('mixerFeedback'), effects.feedback);
      field($('mixerFilterExact'), Math.round(effects.filterHz)); field($('mixerEchoExact'), effects.delayBeats);
      $('mixerFilterOut').value = effects.filterHz >= 19000 ? 'Open' : `${Math.round(effects.filterHz)} Hz`; $('mixerEchoOut').value = `${Math.round(effects.delayMix * 100)}%`; $('mixerFeedbackOut').value = `${Math.round(effects.feedback * 100)}%`;
    }
    synthEffectEditor?.refresh();
    state.decks.forEach((deck, index) => {
      $(`deckOriginal${index}`).disabled = !onOriginal || !originals[index] || loading[index] || originalBusy;
      const ui = deckUIs[index]; if (ui.analysis !== deck.analysis) makeInfo(index, deck.analysis);
      const config = deck.config, rateSelect = $(`deckRate${index}`), rate = config.rate ?? 1;
      let customRate = rateSelect.querySelector('[data-custom-rate]');
      if (![.25, .5, 1, 2, 4, 8].includes(rate)) { if (!customRate) { customRate = new Option(); customRate.dataset.customRate = ''; rateSelect.append(customRate); } customRate.value = String(rate); customRate.textContent = `${rate.toFixed(3)}× · custom`; } else customRate?.remove();
      field(rateSelect, rate); field($(`deckExactRate${index}`), rate); $(`deckRateOut${index}`).value = `${(state.tempo * rate).toFixed(1)} BPM`; field($(`deckGain${index}`), config.gain); field($(`deckPitch${index}`), config.transpose); field($(`deckOffset${index}`), config.offsetBeats);
      if (ui.section.querySelector('.deck-midi-editor').open) ui.midiEditor?.refresh();
      field($(`deckLoopStart${index}`), config.loopStartBeats || 0); field($(`deckLoopEnd${index}`), deck.loopEndBeats ?? deck.loopBeats);
      $('tempoFrom' + ui.letter).disabled = !deck.analysis; $(`deckGainOut${index}`).value = `${Math.round(config.gain * 100)}%`; $(`deckPitchOut${index}`).value = `${config.transpose > 0 ? '+' : ''}${config.transpose} st`;
      $(`deckLoop${index}`).checked = config.loop; $(`deckMute${index}`).checked = config.mute;
      $(`deckScrub${index}`).max = String(deck.analysis?.durationBeats || 1); $(`deckScrub${index}`).disabled = !deck.analysis;
      $(`deckMatch${index}`).disabled = keyRoot(deck.analysis?.key) === null || keyRoot(state.decks[1 - index].analysis?.key) === null;
      $(`deckMatch${index}`).title = 'Match tonic pitch; major/minor and uncertain estimated keys may still clash.';
      const solo = deck.channels.some(channel => channel.solo);
      for (const channel of deck.channels) {
        const row = ui.rows.get(channel.channel); if (!row) continue;
        row.mute.setAttribute('aria-pressed', String(channel.mute)); row.solo.setAttribute('aria-pressed', String(channel.solo));
        row.row.classList.toggle('is-muted', row.silent || config.mute || channel.mute || (solo && !channel.solo)); field(row.select, channel.program ?? '');
        if (row.details.open) row.editor?.refresh();
      }
    });
    onState({ ...state, ready: state.decks.some(deck => deck.analysis) });
  }
  engine = new MidiMixerEngine({ onState: reflect });
  performanceView = mountMixerPerformance($('mixerPerformanceHost'), { engine, getDrawing });
  synthEffectEditor = mountMidiSynthEffectEditor($('mixerSynthEffects'), {
    label: 'SoundFont effects', getValue: () => engine.state.effects.synth,
    onChange: synth => { custom(); engine.configureEffects({ synth }); },
  });
  async function editMidi({ buffer, title = 'Your MIDI', time: seconds = 0, rate = 1, loop = false, ...metadata }) {
    const index = 0, ticket = ++serial[index]; requests[index]?.abort(); loading[index] = true; error = ''; reflect();
    try {
      const loaded = await engine.loadDeck(index, buffer, title); if (disposed || ticket !== serial[index]) return false;
      engine.configureDeck(index, { ...defaultDeckConfig(), rate, loop, midi: null });
      for (const channel of loaded.analysis.channels) engine.configureChannel(index, channel.channel, { mute: false, solo: false, program: null, midi: null });
      engine.setTempo(loaded.analysis.initialTempo); engine.setCrossfade(-1);
      let remaining = Math.max(0, Number(seconds) || 0), beat = 0;
      for (let i = 0; i < loaded.analysis.tempoMap.length; i++) {
        const entry = loaded.analysis.tempoMap[i], end = loaded.analysis.tempoMap[i + 1]?.beat ?? loaded.analysis.durationBeats;
        const span = Math.max(0, end - entry.beat) * 60 / entry.bpm;
        if (remaining <= span) { beat = entry.beat + remaining * entry.bpm / 60; break; }
        remaining -= span; beat = end;
      }
      engine.seekDeck(index, beat);
      originals[index] = { ...metadata, buffer: buffer.slice(0), title }; selectedIds[index] = 'editable';
      const menu = $(`deckSong${index}`); menu.querySelector('[value="editable"]')?.remove(); menu.append(new Option(title, 'editable')); menu.value = 'editable';
      $(`deckCredit${index}`).textContent = metadata.attribution || 'Your MIDI · source preserved.';
      const disclosure = deckUIs[index].section.querySelector('.deck-midi-editor'); disclosure.open = true;
      custom(); return true;
    } catch (cause) { fail(cause); throw cause; }
    finally { if (!disposed && ticket === serial[index]) { loading[index] = false; resumePending(); reflect(); } }
  }
  async function choose(index, id) {
    const song = collection.find(song => song.id === id); if (!song) return;
    const ticket = ++serial[index]; requests[index]?.abort(); const request = new AbortController(); requests[index] = request;
    loading[index] = true; error = ''; reflect();
    try {
      const response = await fetch(asset(song.file), { signal: request.signal }); if (!response.ok) throw new Error(`Could not load MIDI (${response.status}).`);
      const buffer = await response.arrayBuffer(); if (disposed || ticket !== serial[index]) return;
      await engine.loadDeck(index, buffer, labelFor(song)); $(`deckSong${index}`).value = song.id; selectedIds[index] = song.id;
      originals[index] = { ...song, buffer, title: labelFor(song) };
      const credit = $(`deckCredit${index}`); credit.textContent = song.attribution || labelFor(song);
      if (song.sourceUrl?.startsWith('https://')) { const a = document.createElement('a'); a.href = song.sourceUrl; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = ' Source ↗'; credit.append(a); }
    } catch (cause) { if (ticket === serial[index]) { $(`deckSong${index}`).value = selectedIds[index]; fail(cause); } }
    finally { if (!disposed && ticket === serial[index]) { loading[index] = false; resumePending(); reflect(); } }
  }
  function resumePending() { if (pendingPlay && active && engine.state.decks.some(deck => deck.analysis)) { pendingPlay = false; engine.play(); } }
  async function initialize() {
    if (initialized) return; initialized = true;
    try {
      const response = await fetch(asset('collection.json'), { signal: events.signal }); if (!response.ok) throw new Error('Could not load the MIDI collection. Open a local MIDI to mix.');
      collection = await response.json(); if (disposed) return;
      performanceView.setCollection(collection);
      for (const index of [0, 1]) {
        const groups = new Map(), select = $(`deckSong${index}`);
        for (const song of collection) {
          const name = song.collection || 'Patterns'; let group = groups.get(name);
          if (!group) { group = document.createElement('optgroup'); group.label = name; groups.set(name, group); select.append(group); }
          group.append(new Option(labelFor(song), song.id));
        }
      }
      const a = collection.find(song => song.id === 'new-order-blue-monday') || collection[0];
      const b = collection.find(song => /enjoy.*silence/.test(song.id)) || collection[1];
      await Promise.all([!engine.state.decks[0].analysis && !loading[0] && a && choose(0, a.id), !engine.state.decks[1].analysis && !loading[1] && b && choose(1, b.id)]);
    } catch (cause) { fail(cause); }
  }
  function play() { pendingPlay = true; resumePending(); }
  function pause() { pendingPlay = false; performanceView.cancelPending(); engine.pause(); }
  function reset() { pendingPlay = false; error = ''; performanceView.cancelPending(); engine.stop(); applyMixerPreset(engine, MIDI_MIXER_PRESETS[0].snapshot); presetController?.refresh(); }
  on($('mixerPlay'), 'click', () => engine.state.playing ? pause() : play());
  on($('mixerStop'), 'click', () => { pendingPlay = false; performanceView.cancelPending(); engine.stop(); }); on($('mixerReset'), 'click', reset);
  on($('masterTempo'), 'input', event => { custom(); engine.setTempo(Number(event.target.value)); });
  on($('mixerCrossfade'), 'input', event => { custom(); engine.setCrossfade(Number(event.target.value)); });
  for (const index of [0, 1]) on($('tempoFrom' + (index ? 'B' : 'A')), 'click', () => { custom(); engine.setTempo(engine.state.decks[index].analysis?.initialTempo ?? 120); });
  function mountPresets() {
    presetController = registerHeaderPresets({ id: 'midiphoria-mixer', host: $('mixerPresetHost'), presets: MIDI_MIXER_PRESETS,
      capture: () => captureMixerPreset(engine.state), apply: snapshot => applyMixerPreset(engine, snapshot),
      randomize: (_snapshot, random) => randomizeMixerPreset(engine.state, random) });
  }
  for (const [id, key, transform] of [['mixerFilter', 'filterHz', value => 10 ** value], ['mixerEcho', 'delayMix', Number], ['mixerEchoTime', 'delayBeats', Number], ['mixerFeedback', 'feedback', Number]]) on($(id), id === 'mixerEchoTime' ? 'change' : 'input', event => { custom(); engine.configureEffects({ [key]: transform(Number(event.target.value)) }); });
  for (const [id, key] of [['mixerFilterExact', 'filterHz'], ['mixerEchoExact', 'delayBeats']]) on($(id), 'change', event => { if (!event.target.validity.valid) return; custom(); engine.configureEffects({ [key]: Number(event.target.value) }); });
  on($('mixerSoundFont'), 'change', async event => {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
    const ticket = ++fontSerial; fontRequest?.abort(); error = '';
    try {
      if (file.size > 32 * 1024 * 1024) throw new Error('SoundFonts must be 32 MB or smaller.');
      const buffer = await file.arrayBuffer(); if (disposed || ticket !== fontSerial) return;
      await engine.loadSoundFont(buffer, file.name); if (ticket === fontSerial) reflect();
    } catch (cause) { if (ticket === fontSerial) fail(cause); }
  });
  on($('mixerDefaultFont'), 'click', async () => {
    const ticket = ++fontSerial; fontRequest?.abort(); fontRequest = new AbortController(); error = '';
    try {
      const response = await fetch(asset('soundfont/TimGM6mb.sf2'), { signal: fontRequest.signal });
      if (!response.ok) throw new Error('Could not load TimGM6mb.');
      const buffer = await response.arrayBuffer(); if (disposed || ticket !== fontSerial) return;
      await engine.loadSoundFont(buffer, 'TimGM6mb'); if (ticket === fontSerial) reflect();
    } catch (cause) { if (ticket === fontSerial) fail(cause); }
  });
  function draw(now) {
    frame = null; if (!active || disposed || document.hidden) return;
    if (now - lastFrame >= 40) {
      lastFrame = now; const state = engine.state; renderers.forEach(renderer => renderer.draw(state));
      $('mixerPosition').value = `Beat ${(state.beat + 1).toFixed(1)} · ${state.audioEnabled ? 'Audio on' : 'Audio off'}`;
      state.decks.forEach((deck, index) => { $(`deckPosition${index}`).value = deck.analysis ? `Beat ${deck.positionBeats.toFixed(1)} / ${Math.ceil(deck.analysis.durationBeats)}` : '—'; field($(`deckScrub${index}`), deck.positionBeats); });
    }
    frame = requestAnimationFrame(draw);
  }
  on(document, 'visibilitychange', () => { if (!document.hidden && active && frame === null) frame = requestAnimationFrame(draw); });
  reflect();
  return {
    get state() { const state = engine.state; return { ...state, ready: state.decks.some(deck => deck.analysis), playing: state.playing || pendingPlay }; },
    setActive(value) { const next = Boolean(value); if (next !== active) {
      if (next) mountPresets(); else { presetController?.destroy(); presetController = null; }
    } active = next; performanceView.setActive(active); if (active) { if (engine.context?.state === 'suspended') void engine.context.resume().catch(fail); void initialize(); resumePending(); if (frame === null) frame = requestAnimationFrame(draw); } else { cancelAnimationFrame(frame); frame = null; } },
    async setAudioEnabled(value) { error = ''; if (value) return engine.enableAudio(); performanceView.cancelPending(); return engine.setAudioEnabled(false); },
    setVolume(value) { engine.setVolume(value); },
    suspendAudio() { return engine.context?.suspend().catch(() => {}); }, play, pause, reset, editMidi,
    dispose() { if (disposed) return; disposed = true; pendingPlay = false; performanceView.dispose(); synthEffectEditor?.destroy(); presetController?.destroy(); events.abort(); fontRequest?.abort(); requests.forEach(request => request?.abort()); cancelAnimationFrame(frame); renderers.forEach(renderer => renderer.dispose()); deckUIs.forEach(ui => { ui.channelEvents.abort(); ui.midiEditor?.destroy(); for (const row of ui.rows.values()) row.editor?.destroy(); }); originals.fill(null); void engine.dispose(); host.replaceChildren(); },
  };
}
