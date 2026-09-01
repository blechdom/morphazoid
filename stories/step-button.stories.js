import { createStepButton } from "../src/ui/index.js";
import "./catalog.css";

export default {
  title: "Primitives/Sequencer Step",
  component: createStepButton,
  tags: ["autodocs"],
  render: (args) => createStepButton(args),
  args: { index: 0, level: 0.72, current: false, loopEnd: false, outsideLoop: false, disabled: false },
  argTypes: { level: { control: { type: "range", min: 0, max: 1, step: 0.01 } } },
  parameters: {
    layout: "centered",
    docs: { description: { component: "One reusable sequencer cell with level, playhead, and loop-boundary states. Parent instruments own grid keyboard behavior, pattern rules, and scheduling." } },
  },
};

export const Active = {};
export const Inactive = { args: { level: 0 } };
export const Current = { args: { current: true, level: 1 } };
export const LoopEnd = { args: { index: 12, displayIndex: 13, level: 0.62, loopEnd: true } };
export const OutsideLoop = { args: { index: 13, displayIndex: 14, level: 0, outsideLoop: true } };
export const Disabled = { args: { disabled: true } };

export const SixteenStepFixture = {
  render: () => {
    const values = [1, 0, 0, 0.48, 0, 0, 0.76, 0, 0, 0.38, 0, 0, 0.62, 0, 0, 0];
    const row = document.createElement("div");
    row.className = "mz-step-fixture";
    row.setAttribute("role", "group");
    row.setAttribute("aria-label", "Sixteen-step interface fixture");
    values.forEach((level, index) => row.append(createStepButton({
      index,
      level,
      current: index === 6,
      loopEnd: index === 12,
      outsideLoop: index > 12,
    })));
    return row;
  },
  parameters: { controls: { disable: true } },
};
