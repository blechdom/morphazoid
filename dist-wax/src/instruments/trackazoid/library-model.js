export const TRACK_METADATA_VERSION = 3;
export const PAD_COUNT = 8;
export const MAX_LIBRARY_ENTRIES = 20000;

const AUDIO_EXTENSION = /\.(?:mp3|wav|wave|aif|aiff|flac|ogg|oga|opus|m4a|aac|mp4|webm)$/i;

/** A picker hint only. The browser decoder remains the authority on codecs. */
export function supportedAudioFile(file) {
  return Boolean(file && (AUDIO_EXTENSION.test(String(file.name || ""))
    || /^audio\//i.test(String(file.type || ""))));
}

export function normalizeTrackPath(value) {
  const parts = String(value || "").replaceAll("\\", "/").split("/");
  if (parts.some((part) => part === "..")) return "";
  return parts.filter((part) => part && part !== ".").join("/");
}

/** Keep the complete tuple: unlike a short hash this cannot collide. */
export function trackIdentity({ folderId = "files", path, size, lastModified }) {
  return JSON.stringify([String(folderId), normalizeTrackPath(path),
    Math.max(0, Number(size) || 0), Math.max(0, Number(lastModified) || 0)]);
}

/** Saved pad data only: no active loop/transport state or audio samples. */
export function normalizeTrackPad(input, duration = Infinity) {
  if (!input || typeof input !== "object") return null;
  const limit = Number.isFinite(duration) && duration >= 0 ? duration : Number.MAX_SAFE_INTEGER;
  const time = (value) => Number.isFinite(value) && value >= 0 ? Math.min(value, limit) : null;
  const name = typeof input.name === "string"
    ? Array.from(input.name.replace(/[\u0000-\u001f\u007f]/g, " ").trim()).slice(0, 64).join("") : "";
  if (input.type === "cue") {
    const position = time(input.position);
    return position === null ? null : { type: "cue", position, name };
  }
  if (input.type === "loop") {
    const start = time(input.start), end = time(input.end);
    return start !== null && end !== null && end - start >= 0.05 ? { type: "loop", start, end, name } : null;
  }
  return null;
}

export function normalizeTrackMetadata(input = {}) {
  const value = input && typeof input === "object" ? input : {};
  const duration = Number.isFinite(value.duration) && value.duration > 0 ? value.duration : undefined;
  const limit = duration ?? Number.MAX_SAFE_INTEGER;
  const time = (position) => Number.isFinite(position) && position >= 0
    ? Math.min(position, limit) : null;
  const analysis = normalizeBeatAnalysis(value.analysis, limit);
  // Version 1 had no provenance. Preserve prepared tracks as manual so a new
  // analysis cannot silently replace an existing user's BPM/grid corrections.
  const legacyGrid = value.version === 1 && (duration !== undefined || Number.isFinite(value.bpm) && value.bpm !== 120 || value.beatOffset > 0);
  const gridSource = ["auto", "manual"].includes(value.gridSource) ? value.gridSource
    : legacyGrid ? "manual" : "unknown";
  // pads is canonical once present, including an explicitly empty/malformed
  // array. The derived cues field must never revive a cleared pad or flatten a
  // saved loop. Metadata without pads migrates the previous numeric markers.
  const hasPads = Object.hasOwn(value, "pads");
  const sourcePads = Array.isArray(value.pads) ? value.pads : [];
  const pads = Array.from({ length: PAD_COUNT }, (_, index) => normalizeTrackPad(hasPads
    ? sourcePads[index] : { type: "cue", position: value.cues?.[index] }, limit));
  return {
    version: TRACK_METADATA_VERSION,
    bpm: Number.isFinite(value.bpm) ? Math.max(20, Math.min(400, value.bpm)) : 120,
    beatOffset: time(value.beatOffset) ?? 0,
    pads,
    cues: pads.map((pad) => pad?.type === "loop" ? pad.start : pad?.position ?? null),
    gridSource,
    analysis,
    ...(duration === undefined ? {} : { duration }),
  };
}

/** Return a fresh normalized record; callers may persist only its pads patch. */
export function withTrackPad(metadata, index, pad) {
  const next = normalizeTrackMetadata(metadata);
  if (!Number.isInteger(index) || index < 0 || index >= PAD_COUNT) return next;
  next.pads[index] = normalizeTrackPad(pad, next.duration);
  next.cues[index] = next.pads[index]?.type === "loop" ? next.pads[index].start : next.pads[index]?.position ?? null;
  return next;
}

/** Persist only bounded, validated analysis data, never samples or worker state. */
export function normalizeBeatAnalysis(value, duration = Number.MAX_SAFE_INTEGER) {
  if (!value || !Number.isInteger(value.version) || value.version < 1 || !["ok", "unreliable"].includes(value.status)) return null;
  const confidence = (n) => Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
  const candidate = (item) => item && Number.isFinite(item.bpm) && item.bpm >= 40 && item.bpm <= 240
    && Number.isFinite(item.beatOffset) && item.beatOffset >= 0 && item.beatOffset <= duration
    ? { bpm: item.bpm, beatOffset: item.beatOffset, confidence: confidence(item.confidence) } : null;
  const best = candidate(value);
  if (value.status === "ok" && !best) return null;
  return {
    version: value.version, status: value.status,
    bpm: best?.bpm ?? null, beatOffset: best?.beatOffset ?? null,
    confidence: confidence(value.confidence),
    candidates: Array.isArray(value.candidates) ? value.candidates.slice(0, 6).map(candidate).filter(Boolean) : [],
    reason: ["too-short", "silence", "no-stable-beat"].includes(value.reason) ? value.reason : null,
    analyzedSeconds: Number.isFinite(value.analyzedSeconds) ? Math.max(0, Math.min(duration, value.analyzedSeconds)) : 0,
  };
}

export function hasBeatGrid(metadata) {
  return ["auto", "manual"].includes(metadata?.gridSource) && Number.isFinite(metadata.bpm)
    && metadata.bpm >= 40 && metadata.bpm <= 240;
}

export function withBeatAnalysis(metadata, result, { useAutomatic = false } = {}) {
  const analysis = normalizeBeatAnalysis(result, metadata.duration);
  const next = normalizeTrackMetadata({ ...metadata, analysis });
  if (analysis?.status === "ok" && (useAutomatic || next.gridSource !== "manual")) {
    next.bpm = analysis.bpm; next.beatOffset = analysis.beatOffset; next.gridSource = "auto";
  }
  return next;
}

export function fileTrackDescriptor(file, { folderId, folderName } = {}) {
  const relativePath = normalizeTrackPath(file?.webkitRelativePath || "");
  const folder = String(folderName || (relativePath.includes("/") ? relativePath.split("/")[0] : ""));
  const source = String(folderId || (folder ? `selection:${folder}` : "files"));
  const path = relativePath || normalizeTrackPath(file?.name);
  if (!path) throw new Error("The audio file has no valid local path.");
  const descriptor = {
    name: String(file.name || path.split("/").at(-1)), path,
    folder, folderId: source, size: Math.max(0, Number(file.size) || 0),
    lastModified: Math.max(0, Number(file.lastModified) || 0),
  };
  return { ...descriptor, id: trackIdentity(descriptor) };
}
