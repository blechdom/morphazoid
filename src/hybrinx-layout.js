const DEFAULT_STAGE_FRACTION = 0.72;
const FINE_STEP = 0.025;
const LARGE_STEP = 0.1;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function cssPixels(element, property, fallback) {
  const view = element.ownerDocument?.defaultView;
  const parsed = Number.parseFloat(view?.getComputedStyle(element).getPropertyValue(property));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function scheduleFrame(view, callback) {
  if (typeof view?.requestAnimationFrame === "function") return view.requestAnimationFrame(callback);
  return view?.setTimeout?.(callback, 0);
}

export function createHybrinxSplitPane(root) {
  if (!root) return null;
  const documentRef = root.ownerDocument;
  const view = documentRef?.defaultView;
  const stageWrap = root.querySelector("#stageWrap");
  const timeline = root.querySelector("#hybrinxTimelineSection");
  const separator = root.querySelector("#hybrinxSplitter");
  if (!stageWrap || !timeline || !separator) return null;

  let stageFraction = DEFAULT_STAGE_FRACTION;
  let activePointerId = null;
  let destroyed = false;

  function measurements() {
    const separatorHeight = separator.getBoundingClientRect().height || separator.offsetHeight || 13;
    const available = Math.max(0, root.clientHeight - separatorHeight);
    let minimumStage = Math.min(
      cssPixels(root, "--hybrinx-min-viewport", 96),
      available * 0.42,
    );
    let minimumTimeline = Math.min(
      cssPixels(root, "--hybrinx-min-timeline", 112),
      available * 0.48,
    );
    if (minimumStage + minimumTimeline > available && available > 0) {
      const scale = available / (minimumStage + minimumTimeline);
      minimumStage *= scale;
      minimumTimeline *= scale;
    }
    return {
      available,
      minimumStage,
      maximumStage: Math.max(minimumStage, available - minimumTimeline),
    };
  }

  function updateAccessibility(stagePixels, { available, minimumStage, maximumStage }) {
    const percentage = available > 0 ? Math.round(stagePixels / available * 100) : 0;
    const timelinePercentage = Math.max(0, 100 - percentage);
    separator.setAttribute("aria-valuemin", String(Math.round(minimumStage / Math.max(1, available) * 100)));
    separator.setAttribute("aria-valuemax", String(Math.round(maximumStage / Math.max(1, available) * 100)));
    separator.setAttribute("aria-valuenow", String(percentage));
    separator.setAttribute(
      "aria-valuetext",
      `Graphic viewport ${percentage}%, timeline ${timelinePercentage}%`,
    );
  }

  function setStagePixels(requestedPixels) {
    const limits = measurements();
    if (limits.available <= 0) return;
    const stagePixels = clamp(requestedPixels, limits.minimumStage, limits.maximumStage);
    stageFraction = stagePixels / limits.available;
    root.style.setProperty("--hybrinx-stage-size", `${stagePixels.toFixed(2)}px`);
    root.classList.add("is-split-ready");
    updateAccessibility(stagePixels, limits);
    const CustomEventClass = view?.CustomEvent ?? globalThis.CustomEvent;
    if (typeof CustomEventClass === "function") {
      root.dispatchEvent(new CustomEventClass("hybrinx:split-resize", {
        bubbles: true,
        detail: {
          stageFraction,
          timelineFraction: 1 - stageFraction,
        },
      }));
    }
  }

  function setStageFraction(fraction) {
    const { available } = measurements();
    setStagePixels(available * fraction);
  }

  function setFromPointer(event) {
    const bounds = root.getBoundingClientRect();
    const separatorHeight = separator.getBoundingClientRect().height || 13;
    setStagePixels(event.clientY - bounds.top - separatorHeight * 0.5);
  }

  function finishPointer(event) {
    if (activePointerId === null || (event.pointerId != null && event.pointerId !== activePointerId)) return;
    if (separator.hasPointerCapture?.(activePointerId)) separator.releasePointerCapture(activePointerId);
    activePointerId = null;
    separator.classList.remove("is-dragging");
    documentRef?.body?.classList.remove("is-resizing-hybrinx-split");
  }

  separator.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.isPrimary === false) return;
    event.preventDefault();
    activePointerId = event.pointerId;
    separator.setPointerCapture?.(event.pointerId);
    separator.classList.add("is-dragging");
    documentRef?.body?.classList.add("is-resizing-hybrinx-split");
    setFromPointer(event);
  });
  separator.addEventListener("pointermove", (event) => {
    if (event.pointerId !== activePointerId) return;
    event.preventDefault();
    setFromPointer(event);
  });
  separator.addEventListener("pointerup", finishPointer);
  separator.addEventListener("pointercancel", finishPointer);
  separator.addEventListener("lostpointercapture", finishPointer);

  separator.addEventListener("keydown", (event) => {
    const limits = measurements();
    const currentPixels = stageFraction * limits.available;
    const fineDelta = limits.available * (event.shiftKey ? LARGE_STEP : FINE_STEP);
    let nextPixels = null;
    if (event.key === "ArrowUp") nextPixels = currentPixels - fineDelta;
    if (event.key === "ArrowDown") nextPixels = currentPixels + fineDelta;
    if (event.key === "PageUp") nextPixels = currentPixels - limits.available * LARGE_STEP;
    if (event.key === "PageDown") nextPixels = currentPixels + limits.available * LARGE_STEP;
    if (event.key === "Home") nextPixels = limits.minimumStage;
    if (event.key === "End") nextPixels = limits.maximumStage;
    if (nextPixels === null) return;
    event.preventDefault();
    setStagePixels(nextPixels);
  });

  separator.addEventListener("dblclick", () => setStageFraction(DEFAULT_STAGE_FRACTION));

  const ResizeObserverClass = view?.ResizeObserver ?? globalThis.ResizeObserver;
  const resizeObserver = typeof ResizeObserverClass === "function"
    ? new ResizeObserverClass(() => {
      if (!destroyed) setStageFraction(stageFraction);
    })
    : null;
  resizeObserver?.observe(root);

  scheduleFrame(view, () => {
    if (!destroyed) setStageFraction(DEFAULT_STAGE_FRACTION);
  });

  return {
    reset() {
      setStageFraction(DEFAULT_STAGE_FRACTION);
    },
    setStageFraction,
    destroy() {
      destroyed = true;
      resizeObserver?.disconnect();
      finishPointer({ pointerId: activePointerId });
      root.classList.remove("is-split-ready");
      root.style.removeProperty("--hybrinx-stage-size");
    },
  };
}

if (typeof document !== "undefined") {
  createHybrinxSplitPane(document.querySelector(".hybrinx-page .syrinx-stage"));
}
