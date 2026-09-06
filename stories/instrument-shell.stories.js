import { createInstrumentShellFixture } from "./instrument-shell-fixture.js";
import "./instrument-shell-fixtures.css";

export default {
  title: "Layouts/Instrument Shell",
  parameters: {
    layout: "fullscreen",
    controls: { disable: true },
    docs: {
      description: {
        component: "A temporary, layout-only reference for the existing Shape, Solid, and Hyper instrument shell. Controls demonstrate DOM states only and do not start audio or request device access.",
      },
    },
  },
};

export const Shape = {
  render: () => createInstrumentShellFixture("shape"),
};

export const Solid = {
  render: () => createInstrumentShellFixture("solid"),
};

export const Hyper = {
  render: () => createInstrumentShellFixture("hyper"),
};
