import { formatChaoticFrequency } from "./chaotic-fm.js";

const FULL_GRAPH_HEIGHT = 236;
const NODE_WIDTH = 112;
const NODE_HEIGHT = 54;

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function buildStages(stack) {
  return [
    {
      kind: "carrier",
      title: stack.carrier.frequencyHz < 20 ? "LFO / CARRIER" : "CARRIER",
      value: `${formatChaoticFrequency(stack.carrier.frequencyHz)} sine`,
    },
    {
      kind: "entry",
      title: "ENTRY SINE",
      value: "frequency oscillator",
    },
    ...stack.turns.map((turn) => ({
      kind: "turn",
      title: `TURN ${turn.index} SINE`,
      value: "signed-frequency osc.",
      turn,
    })),
  ];
}

function buildDetailedDiagram(stack, outputLevel) {
  const stages = buildStages(stack);
  const graphWidth = Math.max(980, stages.length * 270 + 170);
  const left = 64;
  const outputX = graphWidth - 140;
  const busEnd = outputX - 44;
  const right = busEnd - 120;
  const nodeY = 124;
  const recursiveRailY = 78;
  const busY = 200;
  const spacing = stages.length > 1
    ? (right - left) / (stages.length - 1)
    : 0;
  const positions = stages.map((_, index) => left + spacing * index);
  let entryGeometry = null;
  const recursiveLinks = [];

  const connectionMarkup = stages.slice(1).map((stage, edgeIndex) => {
    const sourceEdge = positions[edgeIndex] + NODE_WIDTH * 0.5;
    const inputX = positions[edgeIndex + 1] - NODE_WIDTH * 0.5;

    if (stage.kind === "entry") {
      const sumX = inputX - 60;
      const centerWidth = 84;
      const deviationWidth = 82;
      const gap = sumX - sourceEdge;
      const deviationX = sourceEdge + gap * 0.45;
      entryGeometry = Object.freeze({
        centerRight: sumX + centerWidth * 0.5,
        inputX,
        junctionRight: sumX + 8,
        sumX,
      });
      return `
        <path class="chaotic-path-entry-wire"
          d="M ${sourceEdge} ${nodeY} L ${deviationX - deviationWidth * 0.5} ${nodeY}
             M ${deviationX + deviationWidth * 0.5} ${nodeY} L ${sumX - 8} ${nodeY}" />
        <path class="chaotic-path-entry-wire" marker-end="url(#chaoticFmSignalArrow)"
          d="M ${sumX + 8} ${nodeY} L ${inputX} ${nodeY}" />
        <text class="chaotic-path-entry-label" x="${(sourceEdge + inputX) * 0.5}" y="96">
          CARRIER WAVE + CENTER → ENTRY FREQUENCY
        </text>
        <g class="chaotic-path-block">
          <rect x="${deviationX - deviationWidth * 0.5}" y="${nodeY - 19}"
            width="${deviationWidth}" height="38" rx="4" />
          <text class="chaotic-path-title" x="${deviationX}" y="${nodeY - 4}">× DEVIATION</text>
          <text class="chaotic-path-value" x="${deviationX}" y="${nodeY + 11}">
            ${formatChaoticFrequency(stack.entry.modulationAmount)}
          </text>
        </g>
        <g class="chaotic-path-block is-control">
          <rect x="${sumX - centerWidth * 0.5}" y="40"
            width="${centerWidth}" height="38" rx="4" />
          <text class="chaotic-path-title" x="${sumX}" y="55">CENTER</text>
          <text class="chaotic-path-value" x="${sumX}" y="70">
            ${formatChaoticFrequency(stack.entry.centerFrequencyHz)}
          </text>
        </g>
        <path class="chaotic-path-control-wire"
          d="M ${sumX} 78 L ${sumX} ${nodeY - 8}" />
        <g class="chaotic-path-junction">
          <circle cx="${sumX}" cy="${nodeY}" r="8" />
          <text x="${sumX}" y="${nodeY + 4}">+</text>
        </g>
        <circle class="chaotic-path-input-port" cx="${inputX}" cy="${nodeY}" r="3.5" />
      `;
    }

    const { turn } = stage;
    const gap = inputX - sourceEdge;
    const amountX = sourceEdge + gap * 0.22;
    const tanhX = sourceEdge + gap * 0.5;
    const rateX = sourceEdge + gap * 0.78;
    const blockWidth = Math.max(52, Math.min(70, gap * 0.2));
    const sourceBendX = sourceEdge + 12;
    const targetBendX = inputX - 12;
    recursiveLinks.push(Object.freeze({ inputX, sourceEdge, turn: turn.index }));
    return `
      <path class="chaotic-path-recursive-wire"
        d="M ${sourceEdge} ${nodeY} L ${sourceBendX} ${nodeY}
           L ${sourceBendX} ${recursiveRailY}
           L ${amountX - blockWidth * 0.5} ${recursiveRailY}
           M ${amountX + blockWidth * 0.5} ${recursiveRailY}
           L ${tanhX - blockWidth * 0.5} ${recursiveRailY}
           M ${tanhX + blockWidth * 0.5} ${recursiveRailY}
           L ${rateX - blockWidth * 0.5} ${recursiveRailY}
           M ${rateX + blockWidth * 0.5} ${recursiveRailY}
           L ${targetBendX} ${recursiveRailY} L ${targetBendX} ${nodeY}" />
      <path class="chaotic-path-recursive-wire" marker-end="url(#chaoticFmSignalArrow)"
        d="M ${targetBendX} ${nodeY} L ${inputX} ${nodeY}" />
      <text class="chaotic-path-recursion-label"
        x="${(sourceEdge + inputX) * 0.5}" y="50">
        PREVIOUS SINE → NEXT FREQUENCY
      </text>
      <g class="chaotic-path-block">
        <rect x="${amountX - blockWidth * 0.5}" y="${recursiveRailY - 17}"
          width="${blockWidth}" height="34" rx="4" />
        <text class="chaotic-path-title" x="${amountX}" y="${recursiveRailY - 3}">× AMOUNT</text>
        <text class="chaotic-path-value" x="${amountX}" y="${recursiveRailY + 11}">
          ${formatChaoticFrequency(turn.amount)}
        </text>
      </g>
      <g class="chaotic-path-block">
        <rect x="${tanhX - blockWidth * 0.5}" y="${recursiveRailY - 17}"
          width="${blockWidth}" height="34" rx="4" />
        <text class="chaotic-path-title" x="${tanhX}" y="${recursiveRailY + 4}">TANH</text>
      </g>
      <g class="chaotic-path-block is-control">
        <rect x="${rateX - blockWidth * 0.5}" y="${recursiveRailY - 17}"
          width="${blockWidth}" height="34" rx="4" />
        <text class="chaotic-path-title" x="${rateX}" y="${recursiveRailY - 3}">× RATE</text>
        <text class="chaotic-path-value" x="${rateX}" y="${recursiveRailY + 11}">
          ${formatChaoticFrequency(turn.nonlinearityHz)}
        </text>
      </g>
      <circle class="chaotic-path-input-port" cx="${inputX}" cy="${nodeY}" r="3.5" />
    `;
  }).join("");

  const operatorMarkup = stages.map((stage, index) => {
    const x = positions[index];
    const audible = index === stack.audibleOperator;
    return `
      <g class="chaotic-path-operator${index === 0 ? " is-seed" : ""}${audible ? " is-audible" : ""}">
        <rect x="${x - NODE_WIDTH * 0.5}" y="${nodeY - NODE_HEIGHT * 0.5}"
          width="${NODE_WIDTH}" height="${NODE_HEIGHT}" rx="5" />
        <text class="chaotic-path-title" x="${x}" y="${nodeY - 5}">${stage.title}</text>
        <text class="chaotic-path-value" x="${x}" y="${nodeY + 11}">${stage.value}</text>
        <path class="chaotic-path-tap${audible ? " is-open" : ""}"
          d="M ${x} ${nodeY + NODE_HEIGHT * 0.5} L ${x} ${busY}" />
        <circle class="chaotic-path-tap-switch${audible ? " is-open" : ""}"
          cx="${x}" cy="${busY}" r="4.5" />
      </g>
    `;
  }).join("");

  const markup = `
    <svg class="chaotic-path-detail" viewBox="0 0 ${graphWidth} ${FULL_GRAPH_HEIGHT}"
      style="--chaotic-graph-width: ${graphWidth}px"
      preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <defs>
        <marker class="chaotic-path-signal-arrow" id="chaoticFmSignalArrow"
          viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6"
          markerUnits="strokeWidth" orient="auto">
          <path d="M 0 0 L 8 4 L 0 8 z" />
        </marker>
        <marker class="chaotic-path-arrow" id="chaoticFmAudioArrow"
          viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6"
          markerUnits="strokeWidth" orient="auto">
          <path d="M 0 0 L 8 4 L 0 8 z" />
        </marker>
      </defs>
      ${connectionMarkup}
      ${operatorMarkup}
      <path class="chaotic-path-bus" d="M ${left} ${busY} L ${busEnd} ${busY}" />
      <text class="chaotic-path-bus-label" x="${left}" y="226">
        AUDIO DEPTH TAPS · OPERATOR ${stack.audibleOperator} IS OPEN
      </text>
      <path class="chaotic-path-audio-wire" marker-end="url(#chaoticFmAudioArrow)"
        d="M ${busEnd} ${busY} L ${outputX - 7} ${busY}" />
      <g class="chaotic-path-output">
        <rect x="${outputX}" y="176" width="116" height="48" rx="5" />
        <text class="chaotic-path-title" x="${outputX + 58}" y="195">DEPTH MIX</text>
        <text class="chaotic-path-value" x="${outputX + 58}" y="211">
          ${Math.round(outputLevel * 100)}% → AUDIO
        </text>
      </g>
    </svg>
  `;

  return Object.freeze({
    entry: entryGeometry,
    graphWidth,
    markup,
    recursiveLinks: Object.freeze(recursiveLinks),
  });
}

function buildCompactDiagram(stack, outputLevel) {
  const hasTurns = stack.turns.length > 0;
  const turnTitle = stack.turns.length === 1
    ? "TURN 1 SINE"
    : `TURNS 1–${stack.turns.length}`;
  const outputPercent = Math.round(outputLevel * 100);
  const turnMarkup = hasTurns ? `
    <path class="chaotic-path-compact-link" marker-end="url(#chaoticFmCompactSignalArrow)"
      d="M 177 76 L 198 76" />
    <g class="chaotic-path-operator is-audible">
      <rect x="202" y="54" width="90" height="44" rx="5" />
      <text class="chaotic-path-title" x="247" y="72">${turnTitle}</text>
      <text class="chaotic-path-value" x="247" y="87">recursive drive</text>
    </g>
    <path class="chaotic-path-audio-wire" marker-end="url(#chaoticFmCompactAudioArrow)"
      d="M 292 76 L 307 76" />
    <text class="chaotic-path-recursion-label" x="235" y="120">
      SINE WAVE → NEXT FREQUENCY
    </text>
    <text class="chaotic-path-compact-detail" x="235" y="137">
      × AMOUNT · TANH · × RATE
    </text>
  ` : `
    <path class="chaotic-path-audio-wire" marker-end="url(#chaoticFmCompactAudioArrow)"
      d="M 177 76 L 307 76" />
    <text class="chaotic-path-recursion-label" x="242" y="120">
      DEPTH 0 · ENTRY SINE IS AUDIBLE
    </text>
  `;

  return `
    <svg class="chaotic-path-compact" viewBox="0 0 380 152"
      preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <defs>
        <marker class="chaotic-path-signal-arrow" id="chaoticFmCompactSignalArrow"
          viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5"
          markerUnits="strokeWidth" orient="auto">
          <path d="M 0 0 L 8 4 L 0 8 z" />
        </marker>
        <marker class="chaotic-path-arrow" id="chaoticFmCompactAudioArrow"
          viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5"
          markerUnits="strokeWidth" orient="auto">
          <path d="M 0 0 L 8 4 L 0 8 z" />
        </marker>
      </defs>
      <text class="chaotic-path-compact-heading" x="12" y="17">
        RECURSIVE FM · EACH SINE DRIVES THE NEXT SINE'S FREQUENCY
      </text>
      <g class="chaotic-path-operator is-seed">
        <rect x="8" y="54" width="72" height="44" rx="5" />
        <text class="chaotic-path-title" x="44" y="72">CARRIER</text>
        <text class="chaotic-path-value" x="44" y="87">
          ${formatChaoticFrequency(stack.carrier.frequencyHz)}
        </text>
      </g>
      <path class="chaotic-path-entry-wire" marker-end="url(#chaoticFmCompactSignalArrow)"
        d="M 80 76 L 93 76" />
      <g class="chaotic-path-operator">
        <rect x="97" y="54" width="80" height="44" rx="5" />
        <text class="chaotic-path-title" x="137" y="72">ENTRY SINE</text>
        <text class="chaotic-path-value" x="137" y="87">
          ${formatChaoticFrequency(stack.entry.centerFrequencyHz)} center
        </text>
      </g>
      ${turnMarkup}
      <g class="chaotic-path-output">
        <rect x="311" y="54" width="61" height="44" rx="5" />
        <text class="chaotic-path-title" x="341.5" y="72">AUDIO</text>
        <text class="chaotic-path-value" x="341.5" y="87">${outputPercent}%</text>
      </g>
    </svg>
  `;
}

export function buildChaoticFmFlowDiagram(
  stack,
  { outputLevel = 0.42 } = {},
) {
  const safeOutput = Math.min(0.82, Math.max(0, finiteNumber(outputLevel, 0.42)));
  const detail = buildDetailedDiagram(stack, safeOutput);
  const ariaLabel = `${formatChaoticFrequency(stack.carrier.frequencyHz)} carrier sine is scaled by `
    + `${formatChaoticFrequency(stack.entry.modulationAmount)} and added to a `
    + `${formatChaoticFrequency(stack.entry.centerFrequencyHz)} center for the entry oscillator. `
    + `Each of ${stack.turns.length} recursive turns sends the previous sine through amount, tanh, `
    + "and rate, then uses that signed result as the next sine oscillator's frequency. "
    + `The dotted vertical routes are audio depth taps; only operator ${stack.audibleOperator} reaches audio.`;

  return Object.freeze({
    ariaLabel,
    entry: detail.entry,
    graphWidth: detail.graphWidth,
    markup: detail.markup + buildCompactDiagram(stack, safeOutput),
    recursiveLinks: detail.recursiveLinks,
  });
}
