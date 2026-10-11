export const TRACK_METADATA_VERSION = 1;
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

export function normalizeTrackMetadata(input = {}) {
  const value = input && typeof input === "object" ? input : {};
  const duration = Number.isFinite(value.duration) && value.duration > 0 ? value.duration : undefined;
  const limit = duration ?? Number.MAX_SAFE_INTEGER;
  const time = (position) => Number.isFinite(position) && position >= 0
    ? Math.min(position, limit) : null;
  return {
    version: TRACK_METADATA_VERSION,
    bpm: Number.isFinite(value.bpm) ? Math.max(20, Math.min(400, value.bpm)) : 120,
    beatOffset: time(value.beatOffset) ?? 0,
    cues: Array.from({ length: 4 }, (_, index) => time(value.cues?.[index])),
    ...(duration === undefined ? {} : { duration }),
  };
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
