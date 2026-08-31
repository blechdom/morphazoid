import { createPeakMeter, createSignedSegmentMeter, createStereoMeter } from "../src/ui/index.js";
import "./catalog.css";

export default {
  title: "Patterns/Level Meters",
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    controls: { disable: true },
    docs: { description: { component: "Static meter views shared by mastheads, microphone inputs, and signed breath/pressure displays. Audio measurement remains application-owned." } },
  },
};

export const StereoOutput = { render: () => createStereoMeter({ left: 0.66, right: 0.48, active: true }) };
export const StereoClipping = { render: () => createStereoMeter({ left: 1, right: 0.91, active: true }) };
export const StereoInactive = { render: () => createStereoMeter({ left: 0, right: 0, active: false }) };
export const Peak = { render: () => createPeakMeter({ label: "Microphone", value: 0.58, peak: 0.81 }) };
export const PeakClipping = { render: () => createPeakMeter({ label: "Input", value: 0.92, peak: 1 }) };
export const SignedInhale = { render: () => createSignedSegmentMeter({ value: -0.72, negativeLabel: "DRAW", positiveLabel: "BLOW" }) };
export const SignedExhale = { render: () => createSignedSegmentMeter({ value: 0.84, negativeLabel: "IN", positiveLabel: "OUT" }) };

export const MeterFamily = {
  render: () => {
    const list = document.createElement("div");
    list.className = "mz-state-list";
    const entries = [
      ["Stereo output", createStereoMeter({ left: 0.66, right: 0.48 })],
      ["Peak + hold", createPeakMeter({ label: "Microphone", value: 0.58, peak: 0.81 })],
      ["Signed pressure", createSignedSegmentMeter({ value: -0.72, negativeLabel: "DRAW", positiveLabel: "BLOW" })],
    ];
    entries.forEach(([name, component]) => {
      const row = document.createElement("div");
      row.className = "mz-state-list__item";
      const label = document.createElement("span");
      label.className = "mz-state-list__label";
      label.textContent = name;
      const content = document.createElement("div");
      content.className = "mz-state-list__content";
      content.append(component);
      row.append(label, content);
      list.append(row);
    });
    return list;
  },
};
