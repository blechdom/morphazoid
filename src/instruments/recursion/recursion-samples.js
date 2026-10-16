import { loadProcessingDemo } from "../synthesis/demo-sources.js";
import { orderedSampleChoices } from "../micmic/native/recorded-input-player.js";

export function recursionSampleStatus({ pending, loaded, audioOn, playing, label }) {
  if (pending) return "Loading sample…";
  if (!loaded) return "Choose a sample to use as the seed.";
  if (!audioOn) return `${label} is the seed. Switch Audio on, then play.`;
  return playing ? `${label} · seed recurses while playing` : `${label} · ready to play`;
}

/** Bundled samples become the same bounded seed that file and microphone captures set. */
export function mountRecursionSamples({ container, audio, getSource, isAudioOn, isPlaying, togglePlayback, onSeed, onError }) {
  const doc = container.ownerDocument ?? globalThis.document;
  const abort = new AbortController();
  const choices = orderedSampleChoices();
  const el = (tag, attributes = {}, ...children) => {
    const node = doc.createElement(tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    node.append(...children);
    return node;
  };
  const text = value => { const node = el("span"); node.textContent = value; return node; };
  const select = el("select", { id: "recursionSampleSelect", "aria-label": "Sample seed" });
  const next = el("button", { type: "button", "aria-label": "Next sample" }); next.textContent = "›";
  const play = el("button", { type: "button", "aria-pressed": "false" }); play.textContent = "Play";
  const stop = el("button", { type: "button" }); stop.textContent = "Stop";
  const status = el("p", { role: "status" });
  const link = el("a", { target: "_blank", rel: "noopener" });
  link.hidden = true;
  const choice = el("label", { class: "recorded-input__choice", for: "recursionSampleSelect" }, text("Sample"), el("span", {}, select, next));
  container.classList.add("recorded-input");
  container.hidden = true;
  container.append(choice, el("div", { class: "recorded-input__transport" }, play, stop), status, link);
  const groups = new Map();
  for (const sample of choices) {
    if (!groups.has(sample.group)) {
      const group = el("optgroup", { label: sample.group });
      select.append(group); groups.set(sample.group, group);
    }
    const option = el("option", { value: sample.id }); option.textContent = sample.label;
    groups.get(sample.group).append(option);
  }
  let loadedId = null, label = "", credit = "", creditUrl = "", pending = false, controller = null, version = 0, disposed = false;

  const refresh = () => {
    if (disposed) return;
    const active = getSource() === "samples";
    container.hidden = !active;
    if (!active) return;
    const loaded = loadedId === select.value;
    play.disabled = !isAudioOn() || pending;
    play.setAttribute("aria-pressed", String(isPlaying()));
    play.textContent = isPlaying() ? "Restart" : "Play";
    stop.disabled = !isPlaying() && !pending;
    status.textContent = recursionSampleStatus({ pending, loaded, audioOn: isAudioOn(), playing: isPlaying(), label });
    link.hidden = !loaded || !credit; link.textContent = credit; link.href = creditUrl || "#";
  };

  async function load() {
    const id = select.value;
    if (loadedId === id) return true;
    controller?.abort();
    const mine = ++version, own = controller = new AbortController();
    pending = true; refresh();
    try {
      const context = new OfflineAudioContext(2, 1, 48_000);
      const result = await loadProcessingDemo(context, id, { signal: own.signal });
      if (disposed || mine !== version || getSource() !== "samples") return false;
      audio.setSampleSeed(result.buffer, result.label);
      loadedId = id; label = result.label; credit = result.credit; creditUrl = result.creditUrl;
      onSeed(label);
      return true;
    } catch (error) {
      if (own.signal.aborted || error?.name === "AbortError") return false;
      loadedId = null; onError(error); return false;
    } finally {
      if (mine === version) { pending = false; controller = null; refresh(); }
    }
  }
  const stopPlayback = () => { if (isPlaying()) togglePlayback(); };
  const run = task => Promise.resolve(task).catch(onError);
  const listen = (node, type, handler) => node.addEventListener(type, handler, { signal: abort.signal });
  listen(select, "change", () => { void run(load()); });
  listen(next, "click", () => {
    select.selectedIndex = (select.selectedIndex + 1) % choices.length;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  listen(play, "click", () => run((async () => {
    if (!isAudioOn()) return;
    if (!await load()) return;
    stopPlayback();
    togglePlayback();
  })()));
  listen(stop, "click", () => { version++; controller?.abort(); pending = false; stopPlayback(); refresh(); });
  const timer = setInterval(refresh, 250);
  timer?.unref?.();
  refresh();
  return {
    refresh,
    activate: () => run(load()),
    release() { version++; controller?.abort(); controller = null; pending = false; refresh(); },
    destroy() {
      if (disposed) return;
      version++; controller?.abort(); abort.abort(); clearInterval(timer); disposed = true;
    },
  };
}
