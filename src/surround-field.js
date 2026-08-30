// Web Audio guarantees support for at least 32 graph channels; an
// implementation may support more. This instrument deliberately caps its
// visual custom array at that portable floor.
export const DEMO_MAX_CHANNELS = 32;

const round = (value, places = 4) => Number(value.toFixed(places));

export function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, Number(value) || 0));
}

function polar(radius, degrees, z = 0) {
  const radians = (degrees * Math.PI) / 180;
  return {
    x: round(Math.sin(radians) * radius),
    y: round(-Math.cos(radians) * radius),
    z,
    azimuth: degrees,
  };
}

function speaker(id, label, channel, position, kind = "full") {
  return Object.freeze({ id, label, channel, kind, ...position });
}

export function ringSpeakers(count) {
  const safeCount = Math.round(clamp(count, 2, DEMO_MAX_CHANNELS));
  return Array.from({ length: safeCount }, (_, index) => {
    const angle = (index * 360) / safeCount;
    const label = safeCount <= 12 ? `S${index + 1}` : `${index + 1}`;
    return speaker(`ring-${safeCount}-${index}`, label, index + 1, polar(0.92, angle));
  });
}

export function makeLayouts(customRingCount = 8) {
  // The 7:4:1 label follows the requested bed:height:sub order. In cinema/home
  // notation the same array is commonly written 7.1.4.
  const sevenFourOne = [
    speaker("left", "L", 1, polar(0.92, -30)),
    speaker("right", "R", 2, polar(0.92, 30)),
    speaker("center", "C", 3, polar(0.92, 0)),
    speaker("sub", "LFE", 4, { x: -0.97, y: -0.28, z: -0.16, azimuth: -76 }, "lfe"),
    speaker("left-side", "Ls", 5, polar(0.92, -100)),
    speaker("right-side", "Rs", 6, polar(0.92, 100)),
    speaker("left-rear", "Lrs", 7, polar(0.92, -145)),
    speaker("right-rear", "Rrs", 8, polar(0.92, 145)),
    speaker("top-front-left", "Tfl", 9, { x: -0.55, y: -0.58, z: 0.95, azimuth: -44 }, "height"),
    speaker("top-front-right", "Tfr", 10, { x: 0.55, y: -0.58, z: 0.95, azimuth: 44 }, "height"),
    speaker("top-rear-left", "Trl", 11, { x: -0.55, y: 0.58, z: 0.95, azimuth: -136 }, "height"),
    speaker("top-rear-right", "Trr", 12, { x: 0.55, y: 0.58, z: 0.95, azimuth: 136 }, "height"),
  ];

  const fourOne = [
    speaker("front-left", "FL", 1, polar(0.92, -45)),
    speaker("front-right", "FR", 2, polar(0.92, 45)),
    speaker("rear-left", "RL", 3, polar(0.92, -135)),
    speaker("rear-right", "RR", 4, polar(0.92, 135)),
    speaker("sub", "LFE", 5, { x: -0.97, y: -0.12, z: -0.16, azimuth: -82 }, "lfe"),
  ];

  const cubeCoordinates = [
    [-0.78, -0.78, 0, "LFL"],
    [0.78, -0.78, 0, "LFR"],
    [-0.78, 0.78, 0, "LRL"],
    [0.78, 0.78, 0, "LRR"],
    [-0.78, -0.78, 0.92, "UFL"],
    [0.78, -0.78, 0.92, "UFR"],
    [-0.78, 0.78, 0.92, "URL"],
    [0.78, 0.78, 0.92, "URR"],
  ];
  const cube = cubeCoordinates.map(([x, y, z, label], index) =>
    speaker(`cube-${index}`, label, index + 1, {
      x,
      y,
      z,
      azimuth: round((Math.atan2(x, -y) * 180) / Math.PI),
    }, z > 0 ? "height" : "full"),
  );

  return Object.freeze({
    "7-4-1": Object.freeze({
      id: "7-4-1",
      name: "7:4:1",
      descriptor: "7 bed · 4 height · 1 LFE",
      view: "space",
      speakers: Object.freeze(sevenFourOne),
    }),
    "4-1": Object.freeze({
      id: "4-1",
      name: "4:1",
      descriptor: "4 around · 1 LFE",
      view: "plan",
      speakers: Object.freeze(fourOne),
    }),
    "8-circle": Object.freeze({
      id: "8-circle",
      name: "8 circle",
      descriptor: "8 equidistant · ear level",
      view: "plan",
      speakers: Object.freeze(ringSpeakers(8)),
    }),
    "8-cube": Object.freeze({
      id: "8-cube",
      name: "8 cube",
      descriptor: "4 lower · 4 upper",
      view: "space",
      speakers: Object.freeze(cube),
    }),
    custom: Object.freeze({
      id: "custom",
      name: `${Math.round(clamp(customRingCount, 2, DEMO_MAX_CHANNELS))} ring`,
      descriptor: `${Math.round(clamp(customRingCount, 2, DEMO_MAX_CHANNELS))} equidistant · custom`,
      view: "plan",
      speakers: Object.freeze(ringSpeakers(customRingCount)),
    }),
  });
}

export function clampPosition(position) {
  const x = clamp(position?.x, -0.86, 0.86);
  const y = clamp(position?.y, -0.86, 0.86);
  const length = Math.hypot(x, y);
  const scale = length > 0.86 ? 0.86 / length : 1;
  return Object.freeze({
    x: round(x * scale),
    y: round(y * scale),
    z: round(clamp(position?.z, 0, 1)),
  });
}

export function computeSpeakerGains(speakers, rawPosition, focus = 0.58) {
  const position = clampPosition(rawPosition);
  const normalizedFocus = clamp(focus, 0, 1);
  const exponent = 1.35 + normalizedFocus * 5.2;
  const directional = speakers.map((item) => {
    if (item.kind === "lfe") return 0;
    const distance = Math.max(
      0.12,
      Math.hypot(position.x - item.x, position.y - item.y, position.z - item.z),
    );
    return 1 / distance ** exponent;
  });
  const energy = Math.sqrt(directional.reduce((total, gain) => total + gain * gain, 0)) || 1;
  const lfeSend = 0.14 + (1 - normalizedFocus) * 0.08;
  return directional.map((gain, index) =>
    round(speakers[index].kind === "lfe" ? lfeSend : gain / energy),
  );
}

export function speakerPan(speakerItem) {
  return round(clamp(speakerItem.x / 0.92, -1, 1));
}

export function projectPoint(point, view = "plan") {
  if (view === "space") {
    return Object.freeze({
      x: round(50 + point.x * 25.5 + point.y * 13.5, 3),
      y: round(62 + point.y * 10.5 - point.z * 29, 3),
    });
  }
  return Object.freeze({
    x: round(50 + point.x * 42, 3),
    y: round(50 + point.y * 42, 3),
  });
}

export function outputModeFor(deviceChannels, speakerCount, forcePreview = false) {
  const supported = Math.round(clamp(deviceChannels, 0, DEMO_MAX_CHANNELS));
  if (!forcePreview && supported >= speakerCount) return "discrete";
  return "preview";
}

export function channelSummary(deviceChannels, speakerCount, forcePreview = false) {
  const probed = Number.isFinite(Number(deviceChannels)) && Number(deviceChannels) > 0;
  if (!probed) return Object.freeze({ mode: "unprobed", label: "Start audio to probe", detail: `${speakerCount} virtual channels` });
  const mode = outputModeFor(deviceChannels, speakerCount, forcePreview);
  return Object.freeze({
    mode,
    label: mode === "discrete" ? "Physical discrete" : "Stereo preview",
    detail: mode === "discrete"
      ? `${speakerCount} → ${deviceChannels} available outputs`
      : `${speakerCount} virtual → ${deviceChannels} device outputs`,
  });
}
