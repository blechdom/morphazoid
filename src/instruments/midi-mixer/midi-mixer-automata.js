import { automatapoeiaNextRow, automatapoeiaTransformRow } from '../cellular-automata/automatapoeia.js';
import { sanitizeAutomataMidiSettings, automataMidiSeedRow } from '../midiphoria/midiphoria-automata-midi.js';
import { parseMidi, clamp } from './midi-mixer-model.js';

export const AUTOMATA_SOURCE = 6;
export const AUTOMATA_HISTORY_BEATS = 16;
export const AUTOMATA_HISTORY_ROWS = 1024;
const EPSILON = 1e-9;
const settingsFor = (partial, previous = {}) => ({
  ...sanitizeAutomataMidiSettings({ ...previous, ...partial }),
  program: Math.round(clamp(partial.program ?? previous.program ?? 0, 0, 127)),
  gain: clamp(partial.gain ?? previous.gain ?? .8, 0, 1),
});

/** A persistent source, independent of deck transport and the four clip slots.
 * The worklet advances it by rendered audio frames. The browser uses this same
 * model before Audio is armed; no row creates a clip, node, timer, or context.
 */
export class MidiAutomataClock {
  constructor({ emit = () => {}, release = () => {}, configure = () => {} } = {}) {
    this.emit = emit; this.release = release; this.configureSource = configure;
    this.settings = settingsFor({}); this.playing = false; this.serial = 0;
    this.restart();
  }
  configure(partial = {}) { this.settings = settingsFor(partial, this.settings); return this.settings; }
  restart() {
    this.release(); this.beat = 0; this.generation = -1; this.row = [];
    this.rowStart = 0; this.rowLength = this.settings.rowBeats; this.rowSettings = { ...this.settings };
    this.history = []; this.notes = []; this.tempos = []; this.active = new Map(); this.noteChanges = new Map();
    if (this.playing) this._next(0);
  }
  setPlaying(value) {
    value = Boolean(value); if (value === this.playing) return;
    this.playing = value;
    if (!value) { this._releaseNotes(0); this.release(); }
    else if (this.generation < 0) this._next(0);
    else if (this.rowStart + this.rowLength <= this.beat + EPSILON) this._next(0);
    else this._soundRow(0, false);
  }
  _close(note, frame) {
    note.endBeat = this.beat;
    this.noteChanges.set(note.id, note);
    this.emit({ kind: 8, channel: 0, a: note.note, b: 0, beat: this.beat, noteId: note.id, generation: this.generation }, frame);
    this.active.delete(note.note);
  }
  _releaseNotes(frame) { for (const note of [...this.active.values()]) this._close(note, frame); }
  _soundRow(frame, hold) {
    const config = this.rowSettings, wanted = new Set(this.row.flatMap((cell, column) => cell ? [config.lowestNote + column] : []));
    for (const note of [...this.active.values()]) if (!hold || !wanted.has(note.note)) this._close(note, frame);
    this.configureSource(config, frame);
    for (const pitch of wanted) if (!this.active.has(pitch)) {
      const note = { id: ++this.serial, note: pitch, velocity: config.velocity, startBeat: this.beat, endBeat: null, program: config.program, gain: config.gain };
      this.active.set(pitch, note); this.notes.push(note);
      this.noteChanges.set(note.id, note);
      this.emit({ kind: 9, channel: 0, a: pitch, b: config.velocity, beat: this.beat, noteId: note.id,
        durationBeats: Math.max(0, this.rowStart + this.rowLength - this.beat), generation: this.generation }, frame);
    }
  }
  _next(frame) {
    if (this.history.length) this.history.at(-1).endBeat = this.beat;
    const config = this.settings;
    if (this.generation < 0) this.row = automataMidiSeedRow(config);
    else {
      // Preserve existing cells by absolute MIDI pitch when width/offset change.
      const row = Array.from({ length: config.columns }, (_, column) => this.row[column + config.lowestNote - this.rowSettings.lowestNote] ?? 0);
      this.row = automatapoeiaTransformRow(automatapoeiaNextRow(row, config.rule, config.boundary, config.family), config.transform, config.boundary);
    }
    this.generation++; this.rowStart = this.beat; this.rowLength = config.rowBeats; this.rowSettings = { ...config };
    this.history.push({ generation: this.generation, row: [...this.row], startBeat: this.beat, endBeat: this.beat,
      lowestNote: config.lowestNote, velocity: config.velocity, articulation: config.articulation, program: config.program, gain: config.gain });
    this._soundRow(frame, config.articulation === 'hold'); this._prune();
  }
  _prune() {
    const start = this.beat - AUTOMATA_HISTORY_BEATS;
    while (this.history.length > 1 && (this.history[1].startBeat <= start || this.history.length > AUTOMATA_HISTORY_ROWS)) this.history.shift();
    this.notes = this.notes.filter(note => note.endBeat === null || note.endBeat > start);
    for (const [id, note] of this.noteChanges) if (note.endBeat !== null && note.endBeat <= start) this.noteChanges.delete(id);
    while (this.tempos.length > 1 && this.tempos[1].beat <= start) this.tempos.shift();
  }
  advance(beats, tempo = 120, frameAt = () => 0) {
    if (!this.playing || !(beats > 0)) return;
    tempo = clamp(tempo, 30, 300, 120);
    if (this.tempos.at(-1)?.bpm !== tempo) this.tempos.push({ beat: this.beat, bpm: tempo });
    const start = this.beat, end = start + beats;
    while (this.rowStart + this.rowLength < end - EPSILON) {
      this.beat = this.rowStart + this.rowLength;
      this._next(frameAt(this.beat - start));
    }
    this.beat = end;
    if (this.history.length) this.history.at(-1).endBeat = end;
    this._prune();
  }
  process(frames, sampleRate, tempo) {
    const increment = tempo / (60 * sampleRate);
    this.advance(frames * increment, tempo, beat => Math.max(0, Math.min(frames - 1, Math.round(beat / increment))));
  }
  rejoin() {
    this.release();
    if (!this.playing || this.generation < 0) return;
    this.configureSource(this.rowSettings, 0);
    for (const note of this.active.values()) this.emit({ kind: 9, channel: 0, a: note.note, b: note.velocity,
      beat: this.beat, noteId: note.id, durationBeats: Math.max(0, this.rowStart + this.rowLength - this.beat), generation: this.generation }, 0);
  }
  snapshot(full = false) {
    const state = { playing: this.playing, generation: this.generation, row: [...this.row], beat: this.beat,
      phase: this.generation < 0 ? 0 : clamp((this.beat - this.rowStart) / this.rowLength, 0, 1),
      rowStart: this.rowStart, rowLength: this.rowLength, rowSettings: { ...this.rowSettings }, settings: { ...this.settings },
      serial: this.serial, tempos: this.tempos.map(tempo => ({ ...tempo })),
      history: this.history.map(item => ({ ...item, row: [...item.row] })) };
    if (full) Object.assign(state, { notes: this.notes.map(note => ({ ...note })), tempos: this.tempos.map(tempo => ({ ...tempo })), serial: this.serial });
    return state;
  }
  restore(state) {
    this.settings = settingsFor(state.settings); this.playing = Boolean(state.playing);
    this.generation = state.generation; this.row = [...state.row]; this.beat = state.beat;
    this.rowStart = state.rowStart; this.rowLength = state.rowLength; this.rowSettings = settingsFor(state.rowSettings);
    this.history = state.history.map(item => ({ ...item, row: [...item.row] }));
    this.notes = (state.notes ?? []).map(note => ({ ...note })); this.tempos = (state.tempos ?? []).map(tempo => ({ ...tempo }));
    this.serial = state.serial ?? this.serial; this.active = new Map(this.notes.filter(note => note.endBeat === null).map(note => [note.note, note]));
    this.noteChanges = new Map();
  }
  takeNoteChanges() { const changes = [...this.noteChanges.values()].map(note => ({ ...note })); this.noteChanges.clear(); return changes; }
}

const vlq = value => { const bytes = [value & 127]; while ((value = Math.floor(value / 128))) bytes.unshift((value & 127) | 128); return bytes; };
const chunk = (id, bytes) => [...id].map(char => char.charCodeAt(0)).concat([bytes.length >>> 24, bytes.length >>> 16 & 255, bytes.length >>> 8 & 255, bytes.length & 255], bytes);

/** Encode the performed source gates, including live rate/pitch/program/tempo
 * changes and pause releases. Capture never restarts or launches the source.
 * Global MIDI effects are deliberately downstream of this reusable source pad.
 */
export function captureAutomataMidi(state, requestedBeats = 4) {
  const beats = clamp(requestedBeats, .125, AUTOMATA_HISTORY_BEATS, 4);
  const end = state.beat, start = Math.max(0, end - beats), length = end - start;
  const selected = (state.notes ?? []).filter(note => note.startBeat < end && (note.endBeat ?? end) > start);
  if (!length || !selected.length) throw new Error('Play Automatapoeia until it has notes to capture.');
  const ppq = 15360, endTick = Math.max(1, Math.round(length * ppq)), events = [];
  const add = (beat, rank, bytes) => events.push({ tick: Math.max(0, Math.min(endTick, Math.round((beat - start) * ppq))), rank, bytes });
  const tempos = state.tempos ?? [], initialTempo = tempos.findLast(tempo => tempo.beat <= start)?.bpm ?? 120;
  for (const tempo of [{ beat: start, bpm: initialTempo }, ...tempos.filter(tempo => tempo.beat > start && tempo.beat < end)]) {
    const micros = Math.round(60000000 / tempo.bpm); add(tempo.beat, -3, [255, 81, 3, micros >>> 16, micros >>> 8 & 255, micros & 255]);
  }
  const history = state.history.filter(row => row.startBeat < end && row.endBeat > start);
  const first = history[0] ?? state.rowSettings;
  add(start, -2, [192, first.program]); add(start, -2, [176, 7, Math.round(first.gain * 127)]);
  for (const row of history) if (row.startBeat > start) { add(row.startBeat, -2, [192, row.program]); add(row.startBeat, -2, [176, 7, Math.round(row.gain * 127)]); }
  for (const note of selected) {
    const on = Math.min(endTick - 1, Math.max(0, Math.round((Math.max(start, note.startBeat) - start) * ppq)));
    const off = Math.min(endTick, Math.max(on + 1, Math.round((Math.min(end, note.endBeat ?? end) - start) * ppq)));
    events.push({ tick: on, rank: 1, bytes: [144, note.note, note.velocity] }, { tick: off, rank: 0, bytes: [128, note.note, 0] });
  }
  events.sort((a, b) => a.tick - b.tick || a.rank - b.rank);
  const track = []; let previous = 0;
  for (const event of events) { track.push(...vlq(event.tick - previous), ...event.bytes); previous = event.tick; }
  track.push(...vlq(endTick - previous), 255, 47, 0);
  const midi = new Uint8Array([...chunk('MThd', [0, 0, 0, 1, ppq >>> 8, ppq & 255]), ...chunk('MTrk', track)]);
  const analysis = parseMidi(midi), lowestNote = Math.min(...analysis.notes.map(note => note.note)), highestNote = Math.max(...analysis.notes.map(note => note.note));
  const columns = highestNote - lowestNote + 1;
  const pixels = history.map(row => Array.from({ length: columns }, (_, column) => row.row[column + lowestNote - row.lowestNote] ?? 0));
  return { buffer: midi.buffer, midi, analysis, notes: analysis.notes, pixels, columns, lowestNote, duration: analysis.durationSeconds,
    durationBeats: analysis.durationBeats, title: 'Automatapoeia capture', settings: { ...state.settings }, sourceStartBeat: start, sourceEndBeat: end };
}
