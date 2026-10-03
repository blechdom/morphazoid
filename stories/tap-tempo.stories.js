import { createRangeField, createTapTempoButton } from "../src/ui/index.js";
import "./catalog.css";

export default {
  title: "Primitives/Tap Tempo",
  tags: ["autodocs"],
  args: { disabled: false },
  render(args) {
    const row = document.createElement("div");
    row.className = "mz-tap-tempo-field mz-story-panel";
    const tempo = createRangeField({ label: "Tempo", min: 30, max: 300, step: 1, value: 120,
      formatValue: value => `${Math.round(value)} BPM` });
    row.append(tempo, createTapTempoButton({ ...args, onTempo: bpm => tempo.setValue(Math.max(30, Math.min(300, Math.round(bpm)))) }));
    return row;
  },
};
export const Default = {};
export const Disabled = { args: { disabled: true } };
