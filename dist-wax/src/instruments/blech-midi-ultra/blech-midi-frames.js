import { ART_LIMITS, encodeArtwork } from './blech-midi-art.js';
import { parseMidi } from '../midi-mixer/midi-mixer-model.js';

export const FRAME_LIMITS = Object.freeze({ count: 8, notes: ART_LIMITS.notes, beats: 16 });
const copy = frame => ({ name: frame.name, durationBeats: frame.durationBeats, notes: frame.notes.map(note => ({ ...note })) });

export function snapshotMidiFrame(score, name = 'Drawing') {
  const analysis = score?.analysis ?? (score?.buffer ? parseMidi(score.buffer) : score);
  const source = analysis?.notes;
  if (!Array.isArray(source) || !source.length) throw new Error('Prepare a drawing first, then capture it as a frame.');
  if (source.length > FRAME_LIMITS.notes) throw new Error('Keep each frame within 32,768 notes.');
  const notes = source.map(n => {
    if (![n.note, n.beat, n.duration, n.velocity].every(Number.isFinite) || n.note < 0 || n.note > 127 || n.beat < 0 || n.duration <= 0 || n.velocity < 1 || n.velocity > 127 || n.beat + n.duration > ART_LIMITS.beats) throw new Error('This frame contains invalid MIDI notes.');
    return { note: Math.round(n.note), beat: n.beat, duration: n.duration, velocity: Math.round(n.velocity), layer: 0 };
  });
  const durationBeats = Math.max(Number(analysis.durationBeats ?? score.durationBeats) || 0, ...notes.map(n => n.beat + n.duration));
  if (!Number.isFinite(durationBeats) || durationBeats <= 0 || durationBeats > ART_LIMITS.beats) throw new Error('Keep each frame within 512 beats.');
  return { name: String(name || 'Drawing').slice(0, 60), notes, durationBeats };
}

export class MidiFrameSequence {
  #frames = [];
  get count() { return this.#frames.length; }
  get noteCount() { return this.#frames.reduce((sum, frame) => sum + frame.notes.length, 0); }
  get frames() { return this.#frames.map(copy); }
  #insert(frame, at = this.count) {
    if (this.count >= FRAME_LIMITS.count) throw new Error('Keep up to eight frames. Delete one before capturing another.');
    if (this.noteCount + frame.notes.length > FRAME_LIMITS.notes) throw new Error('Keep the sequence within 32,768 notes.');
    this.#frames.splice(at, 0, frame); return at;
  }
  capture(score, name) { return this.#insert(snapshotMidiFrame(score, name)); }
  blank() { return this.#insert({ name: 'Rest', durationBeats: 1, notes: [] }); }
  duplicate(index) {
    const source = this.#frames[index]; if (!source) throw new Error('Choose a frame to duplicate.');
    return this.#insert(copy(source), index + 1);
  }
  remove(index) {
    if (!this.#frames[index]) throw new Error('Choose a frame to delete.');
    this.#frames.splice(index, 1); return Math.min(index, this.count - 1);
  }
  move(index, direction) {
    if (!this.#frames[index]) throw new Error('Choose a frame to move.');
    const target = Math.max(0, Math.min(this.count - 1, index + Math.sign(direction)));
    if (target !== index) { const [frame] = this.#frames.splice(index, 1); this.#frames.splice(target, 0, frame); }
    return target;
  }
  clear() { this.#frames = []; }
  artwork(beatsPerFrame = 1) {
    const beats = Number(beatsPerFrame);
    if (!Number.isFinite(beats) || beats < .25 || beats > FRAME_LIMITS.beats) throw new Error('Use ¼–16 beats per frame.');
    const notes = this.#frames.flatMap((frame, index) => frame.notes.map(note => ({ ...note,
      beat: index * beats + note.beat / frame.durationBeats * beats,
      duration: note.duration / frame.durationBeats * beats, layer: index,
    })));
    return { notes, durationBeats: this.count * beats };
  }
  score(beatsPerFrame = 1, tempo = 120) {
    const artwork = this.artwork(beatsPerFrame);
    if (!artwork.notes.length) throw new Error('Capture a drawing before dropping the sequence.');
    return encodeArtwork(artwork.notes, { title: 'MIDI frame sequence', tempo, durationBeats: artwork.durationBeats });
  }
}
