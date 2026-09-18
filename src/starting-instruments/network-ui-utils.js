import { clamp } from "./common.js";
import { NETWORK_SIZE } from "./loop-network.js";
export { MAX_LOOPS, MAX_ROUTES, loopPosition } from "./loop-network.js";
export function clampPosition(x, y) {
  return { x: clamp(x, 160, NETWORK_SIZE.width - 160), y: clamp(y, 160, NETWORK_SIZE.height - 160) };
}
