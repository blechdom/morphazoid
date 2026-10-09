import { midiColorHue, paletteHue } from './midiphoria-renderer.js';

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

/** Time rises through a readable score window; pitch and time cells stay square. */
export function textMidiScoreLayout(score, width, height, time = 0) {
  const margin = Math.min(28, width * .06);
  const available = Math.max(1, width - margin * 2);
  const columns = score.columns;
  const rows = Math.min(score.rows, height < 300 ? 16 : 24);
  const cell = Math.max(.1, Math.min(available / columns, Math.max(1, height - 96) / rows));
  const playRow = clamp(Number.isFinite(time) ? time / score.secondsPerRow : 0, 0, score.rows);
  const startRow = clamp(playRow - rows * .35, 0, score.rows - rows);
  const top = (height - rows * cell) / 2;
  return { cell, columns, rows, startRow, playRow,
    left: (width - columns * cell) / 2, top, bottom: top + rows * cell };
}

/** The very same pitches and durations sent to the MIDI player form these letters. */
export function drawTextMidiScore(context, width, height, score, state, options, settings) {
  if (!context || !score) return;
  const { cell, columns, rows, startRow, playRow, left, top, bottom } = textMidiScoreLayout(score, width, height, state.time);
  const invert = settings.invert;
  context.save();
  context.globalCompositeOperation = 'source-over'; context.globalAlpha = 1;
  context.fillStyle = invert ? '#e7efe9' : '#030706';
  context.fillRect(0, 0, width, height);
  context.fillStyle = invert ? '#476350' : '#a1b4ae';
  context.font = '12px system-ui, sans-serif'; context.textBaseline = 'middle'; context.textAlign = 'left';
  context.fillText(score.text, left, Math.max(22, top - 26), columns * cell);
  context.save();
  context.beginPath(); context.rect(left, top, columns * cell, rows * cell); context.clip();
  const gap = Math.min(2, cell * .12);
  const playY = bottom - (playRow - startRow) * cell;
  for (const note of score.notes) {
    const row = note.start / score.secondsPerRow;
    const length = note.duration / score.secondsPerRow;
    if (row + length < startRow || row > startRow + rows) continue;
    const x = left + (note.note - score.lowestNote) * cell;
    const y = bottom - (row + length - startRow) * cell;
    const active = state.playing && state.time >= note.start && state.time < note.start + note.duration;
    const baseHue = midiColorHue({ ...note, channel: 0 }, options.colorSource);
    const hue = (options.colorSource === 'voice' ? baseHue
      : paletteHue(baseHue, options.palette) + options.hueOffset / 360) * 360;
    const saturation = settings.color ? options.saturation * 90 : 0;
    context.fillStyle = `hsl(${hue} ${saturation}% ${invert ? active ? 28 : 40 : active ? 78 : 55}%)`;
    context.globalAlpha = active ? 1 : .64;
    context.fillRect(x + gap / 2, y + gap / 2, cell - gap, Math.max(.1, length * cell - gap));
    if (active) {
      context.globalAlpha = .35;
      context.fillStyle = invert ? '#07110b' : '#ffffff';
      context.fillRect(x + gap / 2, clamp(playY, y + gap / 2, y + length * cell - gap),
        cell - gap, Math.max(1, cell * .12));
    }
  }
  context.restore();
  context.globalAlpha = 1;
  context.strokeStyle = invert ? '#21442e' : '#e5fff1'; context.lineWidth = 1.5;
  context.beginPath(); context.moveTo(left - 8, playY); context.lineTo(left + columns * cell + 8, playY); context.stroke();
  context.restore();
}
