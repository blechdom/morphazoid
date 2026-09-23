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
