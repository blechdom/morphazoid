import { analyzeBeatWindows } from "./beat-analysis.js";

// One worker per request. terminate() cancels even while synchronous DSP runs.
self.onmessage = ({ data }) => {
  const id = data?.id;
  try {
    self.postMessage({ id, result: analyzeBeatWindows(data) });
  } catch (error) {
    self.postMessage({ id, error: error?.message || "Beat analysis failed" });
  }
};
