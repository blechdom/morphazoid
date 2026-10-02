import { createAudioInputStrip } from "../src/ui/index.js";

export default { title: "Patterns/Audio input", tags: ["autodocs"] };

function render(args) {
  const panel = document.createElement("div");
  panel.style.width = "280px";
  const input = createAudioInputStrip(args);
  let active = false;
  input.button.addEventListener("click", () => {
    active = !active;
    input.setInputState({ active });
    input.setLevels(active ? { left: 0.45, right: 0.25 } : { left: 0, right: 0 });
  });
  input.sourceSelect?.addEventListener("change", () => input.setSource(input.sourceSelect.value));
  panel.append(input);
  return panel;
}

export const Mono = { render, args: { channels: 1 } };
export const Stereo = { render, args: { channels: 2 } };
export const MicOrFile = { render, args: { channels: 2, sources: [{ value: "mic", label: "Mic" }, { value: "file", label: "File" }] } };
