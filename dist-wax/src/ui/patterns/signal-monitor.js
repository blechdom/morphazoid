import {
  applyCommonOptions,
  classNames,
  defineApi,
  requireDocument,
} from "../internal.js";

const VARIANTS = new Set(["scope", "spectrum", "spectrogram", "xy", "overlay"]);

function replaceText(element, value) {
  element.textContent = String(value ?? "");
  element.hidden = !element.textContent;
  return element.textContent;
}

/**
 * Create the accessible stage shell shared by signal visualizers. Rendering,
 * analyzers, animation loops, and audio ownership stay with the caller.
 */
export function createSignalMonitor(options = {}, doc = globalThis.document) {
  requireDocument(doc);
  const variant = VARIANTS.has(options.variant) ? options.variant : "scope";
  const root = doc.createElement("figure");
  root.className = classNames("mz-signal-monitor", "stage-wrap", options.className);
  root.setAttribute("data-variant", variant);
  applyCommonOptions(root, options);

  const canvas = options.canvas ?? doc.createElement("canvas");
  canvas.className = classNames("mz-signal-monitor__canvas", options.canvasClassName);
  canvas.width = Math.max(160, Math.round(Number(options.width) || 760));
  canvas.height = Math.max(100, Math.round(Number(options.height) || 360));
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", String(options.ariaLabel ?? `${options.title ?? "Signal"} ${variant} monitor`));
  if (options.describedBy) canvas.setAttribute("aria-describedby", String(options.describedBy));
  canvas.textContent = String(options.fallback ?? `${variant} signal visualization`);

  const heading = doc.createElement("figcaption");
  heading.className = "mz-signal-monitor__heading";
  const kicker = doc.createElement("p");
  kicker.className = "mz-signal-monitor__kicker";
  const title = doc.createElement("h2");
  title.className = "mz-signal-monitor__title";
  const subtitle = doc.createElement("small");
  subtitle.className = "mz-signal-monitor__subtitle";
  heading.append(kicker, title, subtitle);

  const meta = doc.createElement("div");
  meta.className = "mz-signal-monitor__meta stage-meta mz-hud-label";
  meta.setAttribute("aria-hidden", "true");
  const metaText = doc.createElement("span");
  meta.append(metaText);

  const legend = doc.createElement("div");
  legend.className = "mz-signal-monitor__legend";
  legend.setAttribute("aria-label", "Signal legend");

  const xAxis = doc.createElement("div");
  xAxis.className = "mz-signal-monitor__axis mz-signal-monitor__axis--x";
  xAxis.setAttribute("aria-hidden", "true");
  const yAxis = doc.createElement("div");
  yAxis.className = "mz-signal-monitor__axis mz-signal-monitor__axis--y";
  yAxis.setAttribute("aria-hidden", "true");
  // A figcaption must be the first or last child of its figure. Keep it first;
  // absolute positioning still lets the caption sit over the rendered stage.
  root.append(heading, canvas, meta, legend, xAxis, yAxis);

  const setLegend = (items = []) => {
    legend.replaceChildren();
    items.forEach((item, index) => {
      const entry = doc.createElement("span");
      const swatch = doc.createElement("i");
      swatch.setAttribute("aria-hidden", "true");
      if (swatch.style?.setProperty) swatch.style.setProperty("--mz-legend-color", String(item.color ?? "var(--mz-color-accent)"));
      entry.append(swatch, doc.createTextNode(String(item.label ?? item)));
      entry.setAttribute("data-index", String(index));
      legend.append(entry);
    });
    legend.hidden = !items.length;
    return items;
  };
  const setAxis = (element, values = []) => {
    element.replaceChildren();
    values.forEach((value) => {
      const label = doc.createElement("span");
      label.textContent = String(value);
      element.append(label);
    });
    element.hidden = !values.length;
    return values;
  };
  const draw = (renderer, contextOptions) => {
    const context = canvas.getContext?.("2d", contextOptions);
    if (context && typeof renderer === "function") renderer(context, canvas, root);
    return context;
  };

  replaceText(kicker, options.kicker);
  replaceText(title, options.title ?? "Signal monitor");
  replaceText(subtitle, options.subtitle);
  replaceText(metaText, options.meta);
  setLegend(options.legend ?? []);
  setAxis(xAxis, options.xAxis ?? []);
  setAxis(yAxis, options.yAxis ?? []);

  return defineApi(root, {
    canvas,
    heading,
    kickerElement: kicker,
    titleElement: title,
    subtitleElement: subtitle,
    metaElement: metaText,
    legend,
    xAxis,
    yAxis,
    draw,
    setTitle: (value) => replaceText(title, value),
    setSubtitle: (value) => replaceText(subtitle, value),
    setMeta: (value) => replaceText(metaText, value),
    setLegend,
    setXAxis: (values) => setAxis(xAxis, values),
    setYAxis: (values) => setAxis(yAxis, values),
  });
}
