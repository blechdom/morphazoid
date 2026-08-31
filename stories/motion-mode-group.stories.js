import { createMotionModeGroup } from "../src/ui/index.js";
import "./catalog.css";

export default {
  title: "Primitives/Motion Mode Group",
  component: createMotionModeGroup,
  tags: ["autodocs"],
  render: (args) => createMotionModeGroup(args),
  args: { direction: "forward", mode: "loop", disabled: false },
  argTypes: {
    direction: { control: "inline-radio", options: ["forward", "reverse"] },
    mode: { control: "inline-radio", options: ["loop", "pingpong"] },
  },
  parameters: {
    layout: "centered",
    docs: { description: { component: "The repeated direction, loop, and ping-pong selector used beside playhead-rate controls. Timing remains application-owned." } },
  },
};

export const ForwardLoop = {};
export const ReversePingPong = { args: { direction: "reverse", mode: "pingpong" } };
export const Disabled = { args: { disabled: true } };
