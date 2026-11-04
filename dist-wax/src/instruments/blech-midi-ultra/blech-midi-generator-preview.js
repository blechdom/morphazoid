const COLORS = ['#c7ff2a', '#ff2532', '#32ffdf', '#f2dd71', '#f2f1e6', '#13bea4', '#d9f3a7', '#ff7b50'];

/** Prepared-score monitor; never owns playback or an audio clock. */
export function drawGeneratorPreview(canvas, artwork, { frame = -1, frames = 0, grid = true, pitchWindow = null } = {}) {
  const ctx = canvas.getContext('2d'), ratio = Math.min(canvas.ownerDocument.defaultView?.devicePixelRatio || 1, 2);
  const width = Math.max(256, Math.min(1200, Math.round(canvas.clientWidth * ratio))), height = Math.round(width * .32);
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  ctx.fillStyle = '#0d100f'; ctx.fillRect(0, 0, width, height);
  const duration = Math.max(.25, artwork?.durationBeats || 1), notes = artwork?.notes ?? [];
  const low = pitchWindow?.low ?? 0, span = pitchWindow?.span ?? 128;
  ctx.strokeStyle = '#343f35'; ctx.lineWidth = 1;
  if (grid) for (let x = 0; x <= span; x += 12) { ctx.beginPath(); ctx.moveTo(x / span * width, 0); ctx.lineTo(x / span * width, height); ctx.stroke(); }
  const rows = frames || 8;
  if (grid) for (let y = 0; y <= rows; y++) { ctx.beginPath(); ctx.moveTo(0, y / rows * height); ctx.lineTo(width, y / rows * height); ctx.stroke(); }
  for (const note of notes) {
    ctx.fillStyle = COLORS[(note.layer ?? 0) % COLORS.length];
    ctx.globalAlpha = frame >= 0 && note.layer !== frame ? .2 : .95;
    ctx.fillRect((note.note - low) / span * width, height - (note.beat + note.duration) / duration * height,
      Math.max(1, width / span - .4), Math.max(1, note.duration / duration * height));
  }
  ctx.globalAlpha = 1;
  if (frame >= 0 && frames) { ctx.strokeStyle = COLORS[frame % COLORS.length]; ctx.lineWidth = 2; ctx.strokeRect(1, height - (frame + 1) / frames * height + 1, width - 2, height / frames - 2); }
  canvas.dataset.notes = String(notes.length); canvas.dataset.frame = String(frame);
}

export const generatorRange = (prefix, key, label, min, max, step, value) => `<label class="control" for="${prefix}${key}"><span><b>${label}</b><output id="${prefix}${key}Out">${value}</output></span><input id="${prefix}${key}" type="range" min="${min}" max="${max}" step="${step}" value="${value}"></label>`;
