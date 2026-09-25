// The shared header can wrap as MIDI/output controls appear. Measure it rather
// than hard-coding phone offsets, and keep scrolled/focused controls below it.
const header = document.querySelector(".puggler-page .masthead");
const stage = document.querySelector(".puggler-stage-wrap");
if (header && stage) {
  const update = () => {
    const height = header.getBoundingClientRect().height;
    document.body.style.setProperty("--puggler-header-height", `${height}px`);
    document.documentElement.style.setProperty("--puggler-sticky-offset", `${height + stage.getBoundingClientRect().height + 8}px`);
  };
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(update) : null;
  observer?.observe(header);
  observer?.observe(stage);
  window.addEventListener("resize", update);
  update();
  window.addEventListener("pagehide", () => {
    observer?.disconnect();
    window.removeEventListener("resize", update);
  }, { once: true });
}

// Owner-requested mobile placement. Move the one host (even before presets
// register), never clone controls or re-register/recall instrument state.
const presetHost = document.querySelector('.puggler-preset-host');
const mobileSlot = document.querySelector('#mobilePresets');
const panelSlot = document.querySelector('#panelPresets');
if (presetHost && mobileSlot && panelSlot) {
  const mobile = window.matchMedia('(max-width:720px), (max-width:960px) and (max-height:560px) and (orientation:landscape)');
  const placePresets = () => {
    const target = mobile.matches ? mobileSlot : panelSlot;
    if (presetHost.parentElement === target) return;
    const focused = document.activeElement;
    const restoreFocus = presetHost.contains(focused);
    // Reparenting dismisses a top-layer popup. Close its disclosure too.
    for (const picker of presetHost.querySelectorAll('details[open]')) picker.open = false;
    target.append(presetHost);
    if (restoreFocus) {
      const nextFocus = focused.closest('.instrument-picker-panel')
        ? presetHost.querySelector('summary') : focused;
      nextFocus?.focus({ preventScroll:true });
    }
  };
  mobile.addEventListener('change', placePresets);
  placePresets();
  window.addEventListener('pagehide', () => mobile.removeEventListener('change', placePresets), { once:true });
}
