import { midiColorHue, paletteHue } from './midiphoria-renderer.js';

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

/** A readable score window follows the audio playhead without stretching glyphs. */
export function textMidiScoreLayout(score, width, height, time = 0) {
  const margin = Math.min(28, width * .06);
  const available = Math.max(1, width - margin * 2);
  const columns = Math.min(score.columns, width < 500 ? 24 : 48);
  const cell = Math.max(.1, Math.min(available / columns, Math.max(1, height - 100) / 7));
  const playColumn = clamp(Number.isFinite(time) ? time / score.secondsPerColumn : 0, 0, score.columns);
  const startColumn = clamp(playColumn - columns * .35, 0, score.columns - columns);
  return { cell, columns, startColumn, playColumn,
    left: (width - columns * cell) / 2, top: (height - 7 * cell) / 2 };
}

/** The very same pitches and durations sent to the MIDI player form these letters. */
export function drawTextMidiScore(context, width, height, score, state, options, settings) {
  if (!context || !score) return;
  const { cell, columns, startColumn, playColumn, left, top } = textMidiScoreLayout(score, width, height, state.time);
  const invert = settings.invert;
  context.save();
  context.globalCompositeOperation = 'source-over'; context.globalAlpha = 1;
  context.fillStyle = invert ? '#e7efe9' : '#030706';
  context.fillRect(0, 0, width, height);
  context.fillStyle = invert ? '#476350' : '#a1b4ae';
  context.font = '12px system-ui, sans-serif'; context.textBaseline = 'middle'; context.textAlign = 'left';
  context.fillText(score.text, left, Math.max(22, top - 26), columns * cell);
  context.save();
  context.beginPath(); context.rect(left, top, columns * cell, cell * 7); context.clip();
  const gap = Math.min(2, cell * .12);
  for (const note of score.notes) {
    const column = note.start / score.secondsPerColumn;
    const length = note.duration / score.secondsPerColumn;
    if (column + length < startColumn || column > startColumn + columns) continue;
    const x = left + (column - startColumn) * cell;
    const y = top + (score.highestNote - note.note) * cell;
    const active = state.playing && state.time >= note.start && state.time < note.start + note.duration;
    const hue = (paletteHue(midiColorHue({ ...note, channel: 0 }, options.colorSource), options.palette)
      + options.hueOffset / 360) * 360;
    const saturation = settings.color ? options.saturation * 90 : 0;
    context.fillStyle = `hsl(${hue} ${saturation}% ${invert ? active ? 28 : 40 : active ? 78 : 55}%)`;
    context.globalAlpha = active ? 1 : .64;
    context.fillRect(x + gap / 2, y + gap / 2, Math.max(.1, length * cell - gap), cell - gap);
    if (active) {
      context.globalAlpha = .35;
      context.fillStyle = invert ? '#07110b' : '#ffffff';
      context.fillRect(x + gap / 2, y + gap / 2, Math.max(.1, length * cell - gap), Math.max(1, cell * .12));
    }
  }
  context.restore();
  context.globalAlpha = 1;
  const x = left + (playColumn - startColumn) * cell;
  context.strokeStyle = invert ? '#21442e' : '#e5fff1'; context.lineWidth = 1.5;
  context.beginPath(); context.moveTo(x, top - 8); context.lineTo(x, top + 7 * cell + 8); context.stroke();
  context.restore();
}
