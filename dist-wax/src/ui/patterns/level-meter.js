import {
  applyCommonOptions,
  classNames,
  defineApi,
  defineGetter,
  requireDocument,
  setClassState,
} from "../internal.js";

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, Number(value) || 0));
}

function formatPercent(value) {
  return `${Math.round(clamp(value) * 100)}%`;
}

/** Create the compact native stereo output meter used by the global header. */
export function createStereoMeter(options = {}, doc = globalThis.document) {
  requireDocument(doc);
  let left = clamp(options.left);
  let right = clamp(options.right);
  let active = options.active !== false;
  const clipAt = clamp(options.clipAt ?? 0.98);

  const root = doc.createElement("div");
  root.className = classNames("mz-stereo-meter", "header-output-meter-shell", options.className);
  root.setAttribute("role", "group");
  applyCommonOptions(root, { ...options, ariaLabel: options.ariaLabel ?? "Stereo audio output levels" });

  const createChannel = (side, compactLabel) => {
    const channel = doc.createElement("div");
    channel.className = `mz-stereo-meter__channel header-output-channel header-output-channel-${side.toLowerCase()}`;
    const label = doc.createElement("span");
    label.className = "mz-stereo-meter__label header-output-channel-label";
    label.textContent = compactLabel;
    label.setAttribute("aria-hidden", "true");
    const meter = doc.createElement("meter");
    meter.className = "mz-stereo-meter__meter header-output-meter";
    meter.min = 0;
    meter.max = 1;
    meter.low = 0.18;
    meter.high = 0.72;
    meter.optimum = 0.5;
    meter.textContent = "0%";
    meter.setAttribute("aria-label", `${side} audio output level`);
    channel.append(label, meter);
    return { channel, label, meter };
  };
  const leftChannel = createChannel("Left", "L");
  const rightChannel = createChannel("Right", "R");
  root.append(leftChannel.channel, rightChannel.channel);

  const paintChannel = (channel, value) => {
    const clipped = value >= clipAt;
    channel.meter.value = value;
    channel.meter.setAttribute("aria-valuenow", String(value));
    channel.meter.setAttribute("aria-valuetext", clipped ? `${formatPercent(value)}, clipping` : (value <= 0.001 ? "silent" : formatPercent(value)));
    setClassState(channel.channel, "is-clipping", clipped);
    setClassState(channel.meter, "is-clipping", clipped);
    return clipped;
  };
  const update = () => {
    const leftClipped = paintChannel(leftChannel, left);
    const rightClipped = paintChannel(rightChannel, right);
    setClassState(root, "is-active", active);
    setClassState(root, "is-clipping", leftClipped || rightClipped);
    root.setAttribute("data-active", String(active));
    return { left, right, active, clipped: leftClipped || rightClipped };
  };
  const setLevels = (nextLeft, nextRight = nextLeft) => {
    if (nextLeft && typeof nextLeft === "object") {
      left = clamp(nextLeft.left);
      right = clamp(nextLeft.right);
      if (nextLeft.active !== undefined) active = Boolean(nextLeft.active);
    } else {
      left = clamp(nextLeft);
      right = clamp(nextRight);
    }
    return update();
  };
  const setActive = (next) => { active = Boolean(next); update(); return active; };

  update();
  defineApi(root, {
    leftChannel: leftChannel.channel,
    rightChannel: rightChannel.channel,
    leftLabel: leftChannel.label,
    rightLabel: rightChannel.label,
    leftMeter: leftChannel.meter,
    rightMeter: rightChannel.meter,
    setLevels,
    setActive,
  });
  defineGetter(root, "levels", () => ({ left, right }));
  defineGetter(root, "active", () => active);
  return root;
}

/** Create a horizontal live/peak meter with accessible meter semantics. */
export function createPeakMeter(options = {}, doc = globalThis.document) {
  requireDocument(doc);
  let value = clamp(options.value);
  let peak = clamp(options.peak ?? value);

  const root = doc.createElement("div");
  root.className = classNames("mz-peak-meter", options.className);
  root.setAttribute("role", "meter");
  root.setAttribute("aria-valuemin", "0");
  root.setAttribute("aria-valuemax", "1");
  applyCommonOptions(root, { ...options, ariaLabel: options.ariaLabel ?? options.label ?? "Signal level" });

  const heading = doc.createElement("span");
  heading.className = "mz-peak-meter__heading";
  const label = doc.createElement("b");
  label.textContent = String(options.label ?? "Level");
  const output = doc.createElement("output");
  heading.append(label, output);
  const track = doc.createElement("span");
  track.className = "mz-peak-meter__track";
  track.setAttribute("aria-hidden", "true");
  const fill = doc.createElement("i");
  fill.className = "mz-peak-meter__fill";
  const peakMarker = doc.createElement("i");
  peakMarker.className = "mz-peak-meter__peak";
  track.append(fill, peakMarker);
  root.append(heading, track);

  const update = () => {
    if (root.style?.setProperty) {
      root.style.setProperty("--mz-meter-value-percent", `${value * 100}%`);
      root.style.setProperty("--mz-meter-peak-percent", `${peak * 100}%`);
    }
    const formatted = typeof options.formatValue === "function"
      ? options.formatValue(value, root)
      : options.formatValue === undefined
        ? formatPercent(value)
        : String(options.formatValue).replace("{}", String(value));
    output.value = String(formatted);
    output.textContent = output.value;
    root.setAttribute("aria-valuenow", String(value));
    root.setAttribute("aria-valuetext", output.value);
    setClassState(root, "is-clipping", peak >= clamp(options.clipAt ?? 0.98));
    return { value, peak };
  };
  const setValue = (next, nextPeak = Math.max(peak, clamp(next))) => {
    value = clamp(next);
    peak = clamp(nextPeak);
    return update();
  };
  const setPeak = (next) => { peak = clamp(next); update(); return peak; };

  update();
  defineApi(root, { labelElement: label, output, track, fill, peakMarker, setValue, setPeak });
  defineGetter(root, "value", () => value);
  defineGetter(root, "peak", () => peak);
  return root;
}

/** Create the signed inhale/exhale style segmented meter used by physical models. */
export function createSignedSegmentMeter(options = {}, doc = globalThis.document) {
  requireDocument(doc);
  let value = clamp(options.value, -1, 1);
  const segmentCount = Math.max(2, Math.round(Number(options.segments) || 4));

  const root = doc.createElement("div");
  root.className = classNames("mz-signed-meter", options.className);
  root.setAttribute("role", "meter");
  root.setAttribute("aria-valuemin", "-1");
  root.setAttribute("aria-valuemax", "1");
  applyCommonOptions(root, { ...options, ariaLabel: options.ariaLabel ?? "Signed level" });
  if (root.style?.setProperty) root.style.setProperty("--mz-signed-segment-count", String(segmentCount * 2 + 1));
  const negativeLabel = doc.createElement("span");
  negativeLabel.className = "mz-signed-meter__label is-negative";
  negativeLabel.textContent = String(options.negativeLabel ?? "IN");
  const track = doc.createElement("span");
  track.className = "mz-signed-meter__segments";
  track.setAttribute("aria-hidden", "true");
  const segments = [];
  for (let index = -segmentCount; index <= segmentCount; index += 1) {
    const segment = doc.createElement("i");
    segment.className = classNames("mz-signed-meter__segment", index < 0 && "is-negative", index === 0 && "is-center", index > 0 && "is-positive");
    segment.setAttribute("data-index", String(index));
    track.append(segment);
    segments.push({ index, element: segment });
  }
  const positiveLabel = doc.createElement("span");
  positiveLabel.className = "mz-signed-meter__label is-positive";
  positiveLabel.textContent = String(options.positiveLabel ?? "OUT");
  root.append(negativeLabel, track, positiveLabel);

  const update = () => {
    const activeCount = Math.ceil(Math.abs(value) * segmentCount);
    segments.forEach(({ index, element }) => {
      const activeSegment = value < 0
        ? index < 0 && Math.abs(index) <= activeCount
        : value > 0 && index > 0 && index <= activeCount;
      setClassState(element, "is-active", activeSegment);
    });
    root.setAttribute("aria-valuenow", String(value));
    root.setAttribute("aria-valuetext", value === 0 ? "centered" : `${formatPercent(Math.abs(value))} ${value < 0 ? negativeLabel.textContent : positiveLabel.textContent}`);
    return value;
  };
  const setValue = (next) => { value = clamp(next, -1, 1); update(); return value; };

  update();
  defineApi(root, { negativeLabelElement: negativeLabel, positiveLabelElement: positiveLabel, track, segments: segments.map(({ element }) => element), setValue });
  defineGetter(root, "value", () => value);
  return root;
}
