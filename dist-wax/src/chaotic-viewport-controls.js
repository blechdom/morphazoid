const CHAOTIC_INSTRUMENT_IDS = new Set([
  "recursive-fm",
  "recursive-pm",
  "chaotic-fm",
  "chaotic-pm",
  "cascading-fm",
  "cascading-pm",
  "weierstrass",
]);
const FLOW_OVERLAY_IDS = new Set([
  "recursive-fm",
  "recursive-pm",
  "chaotic-fm",
  "chaotic-pm",
  "cascading-fm",
  "cascading-pm",
]);

const INSTANCES = new WeakMap();
const RANGE_ATTRIBUTES = Object.freeze(["min", "max", "step"]);

function rangeProgress(input) {
  const minimum = Number(input.min);
  const maximum = Number(input.max);
  const value = Number(input.value);
  if (![minimum, maximum, value].every(Number.isFinite) || maximum <= minimum) {
    return 0;
  }
  return Math.min(1, Math.max(0, (value - minimum) / (maximum - minimum)));
}

function controlLabel(source) {
  const label = source.closest?.("label");
  return label?.querySelector?.("b")?.textContent?.trim()
    || source.getAttribute?.("aria-label")
    || source.id;
}

function controlReadout(source) {
  return source.closest?.("label")?.querySelector?.("output")?.textContent?.trim()
    || source.value;
}

function sectionName(section) {
  return section.querySelector?.(".group-title")?.textContent?.trim()
    || "Sound";
}

function copyRange(source, mirror) {
  for (const attribute of RANGE_ATTRIBUTES) {
    if (source.hasAttribute?.(attribute)) {
      mirror.setAttribute(attribute, source.getAttribute(attribute));
    } else {
      mirror.removeAttribute(attribute);
    }
  }
  mirror.value = source.value;
  mirror.disabled = source.disabled;
}

function dispatchSourceEvent(source, type, runtime) {
  const EventConstructor = runtime?.Event
    || source.ownerDocument?.defaultView?.Event
    || globalThis.Event;
  if (typeof EventConstructor !== "function") return;
  source.dispatchEvent(new EventConstructor(type, { bubbles: true }));
}

function applySectionPalette(group, section, runtime) {
  const computed = runtime?.getComputedStyle?.(section);
  const mappings = [
    ["--viewport-accent", "--accent"],
    ["--viewport-accent-soft", "--accent-soft"],
    ["--viewport-accent-glow", "--accent-glow"],
  ];
  for (const [target, source] of mappings) {
    const value = computed?.getPropertyValue?.(source)?.trim();
    if (value) group.style.setProperty(target, value);
  }
}

function createMirroredControl(doc, source, mode, runtime, scheduleSyncAll) {
  const labelText = controlLabel(source);
  const wrapper = doc.createElement("label");
  wrapper.className = `chaotic-viewport-control chaotic-viewport-${mode}`;
  wrapper.title = labelText;

  const mirror = doc.createElement("input");
  mirror.type = "range";
  mirror.id = `viewport-${source.id}`;
  mirror.setAttribute("aria-label", `${labelText}, graphic pane`);
  mirror.setAttribute("data-source-control", source.id);

  const label = doc.createElement("b");
  label.textContent = labelText;
  const output = doc.createElement("output");
  output.htmlFor = mirror.id;

  let dial = null;
  if (mode === "knob") {
    const dialWrap = doc.createElement("span");
    dialWrap.className = "chaotic-viewport-knob-dial-wrap";
    dial = doc.createElement("span");
    dial.className = "chaotic-viewport-knob-dial";
    dial.setAttribute("aria-hidden", "true");
    dialWrap.append(dial, mirror);
    wrapper.append(dialWrap, label, output);
  } else {
    const copy = doc.createElement("span");
    copy.className = "chaotic-viewport-slider-copy";
    copy.append(label, output);
    wrapper.append(copy, mirror);
  }

  const sync = () => {
    copyRange(source, mirror);
    wrapper.hidden = Boolean(source.closest?.("[hidden]"));
    const readout = controlReadout(source);
    const progress = rangeProgress(source);
    output.textContent = readout;
    mirror.setAttribute("aria-valuetext", readout);
    wrapper.style.setProperty("--viewport-progress", `${progress * 100}%`);
    wrapper.style.setProperty("--viewport-arc-progress", `${progress * 75}%`);
    if (dial) {
      dial.style.setProperty(
        "--viewport-knob-angle",
        `${-135 + progress * 270}deg`,
      );
    }
  };

  mirror.addEventListener("input", () => {
    source.value = mirror.value;
    dispatchSourceEvent(source, "input", runtime);
    sync();
    scheduleSyncAll();
  });
  mirror.addEventListener("change", () => {
    source.value = mirror.value;
    dispatchSourceEvent(source, "change", runtime);
    sync();
    scheduleSyncAll();
  });
  source.addEventListener("input", scheduleSyncAll);
  source.addEventListener("change", scheduleSyncAll);
  sync();

  return { source, mirror, sync, wrapper };
}

export function initializeChaoticViewportControls(
  doc = globalThis.document,
  runtime = globalThis,
  { instrumentId } = {},
) {
  if (!CHAOTIC_INSTRUMENT_IDS.has(instrumentId) || !doc?.querySelector) {
    return null;
  }
  const existing = INSTANCES.get(doc);
  if (existing) return existing;

  const stage = doc.querySelector(".stage");
  const panel = doc.querySelector(".panel");
  const stageWrap = stage?.querySelector?.(".stage-wrap");
  if (!stage || !stageWrap || !panel) return null;
  const overlaysFlow = FLOW_OVERLAY_IDS.has(instrumentId);

  const sources = [...panel.querySelectorAll(
    ".control-section input[type=\"range\"][id]",
  )].filter((source) => !source.closest?.("[data-chaos-dsp-reference]"));
  if (sources.length === 0) return null;

  const root = doc.createElement("section");
  root.className = overlaysFlow
    ? "chaotic-viewport-controls is-flow-overlay"
    : "chaotic-viewport-controls";
  root.setAttribute("aria-label", "Graphic pane synthesis controls");
  const groupsRoot = doc.createElement("div");
  groupsRoot.className = "chaotic-viewport-control-groups";
  root.append(groupsRoot);

  const controls = [];
  let syncQueued = false;
  const syncOverlayLayout = () => {
    if (!overlaysFlow || !root.offsetHeight) return;
    stageWrap.style.setProperty(
      "--chaotic-flow-top",
      `${root.offsetTop + root.offsetHeight + 14}px`,
    );
  };
  const schedule = runtime?.requestAnimationFrame
    ? (callback) => runtime.requestAnimationFrame(callback)
    : (callback) => Promise.resolve().then(callback);
  const syncAll = () => controls.forEach((control) => control.sync());
  const scheduleSyncAll = () => {
    if (syncQueued) return;
    syncQueued = true;
    schedule(() => {
      syncQueued = false;
      syncAll();
      syncOverlayLayout();
    });
  };

  const groupedSources = new Map();
  for (const source of sources) {
    const section = source.closest(".control-section");
    if (!groupedSources.has(section)) groupedSources.set(section, []);
    groupedSources.get(section).push(source);
  }

  for (const [section, sectionSources] of groupedSources) {
    const name = sectionName(section);
    const mode = "knob";
    const group = doc.createElement("fieldset");
    group.className = `chaotic-viewport-control-group is-${mode}-group`;
    group.style.setProperty("--viewport-control-count", sectionSources.length);
    group.style.setProperty(
      "--viewport-control-weight",
      Math.max(1.5, sectionSources.length),
    );
    applySectionPalette(group, section, runtime);

    const legend = doc.createElement("legend");
    legend.textContent = name;
    const bank = doc.createElement("div");
    bank.className = `chaotic-viewport-${mode}-bank`;
    for (const source of sectionSources) {
      const control = createMirroredControl(
        doc,
        source,
        mode,
        runtime,
        scheduleSyncAll,
      );
      controls.push(control);
      bank.append(control.wrapper);
    }
    group.append(legend, bank);
    groupsRoot.append(group);
  }

  if (overlaysFlow) stageWrap.append(root);
  else stage.append(root);
  panel.addEventListener("click", scheduleSyncAll);
  const Observer = runtime?.MutationObserver || doc.defaultView?.MutationObserver;
  const observer = typeof Observer === "function"
    ? new Observer(scheduleSyncAll)
    : null;
  observer?.observe(panel, {
    attributes: true,
    attributeFilter: ["hidden"],
    characterData: true,
    childList: true,
    subtree: true,
  });
  const LayoutObserver = runtime?.ResizeObserver || doc.defaultView?.ResizeObserver;
  const layoutObserver = overlaysFlow && typeof LayoutObserver === "function"
    ? new LayoutObserver(syncOverlayLayout)
    : null;
  layoutObserver?.observe(root);
  layoutObserver?.observe(stageWrap);
  scheduleSyncAll();

  const instance = Object.freeze({
    controls: Object.freeze(controls),
    root,
    sync: syncAll,
    dispose() {
      observer?.disconnect();
      layoutObserver?.disconnect();
      stageWrap.style.removeProperty("--chaotic-flow-top");
      root.remove();
      INSTANCES.delete(doc);
    },
  });
  INSTANCES.set(doc, instance);
  return instance;
}

export function isChaoticViewportInstrument(instrumentId) {
  return CHAOTIC_INSTRUMENT_IDS.has(instrumentId);
}
