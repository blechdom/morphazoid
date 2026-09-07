import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./shader-synth-playground-xyflow.css";

const SIGNAL_COLORS = Object.freeze({
  audio: "#74f7ff",
  control: "#ffda57",
  trigger: "#ff6eaa",
  stereo: "#91ff63",
});

function sameEndpoint(first, second) {
  return Boolean(
    first
    && second
    && first.nodeId === second.nodeId
    && first.portId === second.portId
    && first.direction === second.direction,
  );
}

function PortRow({ moduleId, moduleLabel, port, direction, pendingPort, actions }) {
  const endpoint = {
    nodeId: moduleId,
    portId: port.id,
    direction,
    type: port.type,
  };
  const pending = Boolean(pendingPort);
  const isPending = sameEndpoint(pendingPort, endpoint);
  const compatibility = pending && !isPending
    ? actions.validateEndpoints(pendingPort, endpoint)
    : null;
  const isCompatible = Boolean(compatibility?.valid);
  const acceptedTypes = direction === "input" ? (port.types ?? [port.type]) : [port.type];
  const typeLabel = acceptedTypes.join(" or ");
  const signalColor = SIGNAL_COLORS[port.type] ?? SIGNAL_COLORS.audio;
  const handleType = direction === "input" ? "target" : "source";
  const position = direction === "input" ? Position.Left : Position.Right;

  return (
    <div
      className={`mz-flow-port-row is-${direction}${isPending ? " is-pending" : ""}${isCompatible ? " is-compatible" : ""}${pending && !isPending && !isCompatible ? " is-incompatible" : ""}`}
      style={{ "--mz-signal-color": signalColor }}
    >
      <Handle
        id={port.id}
        type={handleType}
        position={position}
        className={`mz-flow-handle is-${port.type}`}
        aria-hidden="true"
        tabIndex={-1}
      />
      <button
        type="button"
        className="mz-flow-port-action nodrag nopan nowheel"
        aria-label={`${moduleLabel}, ${port.label}, ${typeLabel} ${direction}`}
        aria-pressed={isPending}
        title={compatibility?.reason ?? `${port.label}: ${typeLabel} ${direction}`}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          actions.activatePort(endpoint, port.label);
        }}
      >
        <span>{port.label}</span>
        <small>{port.type}</small>
      </button>
    </div>
  );
}

const ShaderModuleNode = memo(function ShaderModuleNode({ id, data, selected }) {
  const {
    label,
    category,
    color,
    execution,
    inputs,
    outputs,
    params,
    extraParamCount,
    bypassed,
    pendingPort,
    removable,
    actions,
  } = data;
  const status = bypassed ? "GPU state bypassed" : "Active in GPU graph";

  return (
    <article
      className={`patch-node mz-flow-node${selected ? " is-selected" : ""}${bypassed ? " is-bypassed" : ""}`}
      style={{ "--mz-node-color": color }}
      aria-label={`${label} module, ${status}${selected ? ", selected" : ""}`}
      data-node-id={id}
    >
      <header className="mz-flow-node__header">
        <span className="mz-flow-node__glyph" aria-hidden="true">{label.slice(0, 2).toUpperCase()}</span>
        <span className="mz-flow-node__identity">
          <b>{label}</b>
          <small>{category}</small>
        </span>
        <span className="mz-flow-node__status" title={status}>
          <i aria-hidden="true" />
          <span className="sr-only">{status}</span>
        </span>
      </header>

      <div className="mz-flow-node__ports">
        <div className="mz-flow-port-column is-input">
          <span className="mz-flow-port-heading">← IN</span>
          {inputs.map((port) => (
            <PortRow
              key={`input-${port.id}`}
              moduleId={id}
              moduleLabel={label}
              port={port}
              direction="input"
              pendingPort={pendingPort}
              actions={actions}
            />
          ))}
        </div>
        <div className="mz-flow-port-column is-output">
          <span className="mz-flow-port-heading">OUT →</span>
          {outputs.map((port) => (
            <PortRow
              key={`output-${port.id}`}
              moduleId={id}
              moduleLabel={label}
              port={port}
              direction="output"
              pendingPort={pendingPort}
              actions={actions}
            />
          ))}
        </div>
      </div>

      {params.length > 0 ? (
        <div className="mz-flow-node__quick-controls">
          {params.map((param) => (
            <label className="mz-flow-parameter nodrag nopan nowheel" key={param.id}>
              <span>
                {param.label}
                <output>{param.formattedValue}</output>
              </span>
              <input
                type="range"
                min={param.sliderMin}
                max={param.sliderMax}
                step={param.sliderStep}
                value={param.sliderValue}
                data-param-id={param.id}
                aria-label={`${label} ${param.label}`}
                onPointerDown={(event) => event.stopPropagation()}
                onChange={(event) => actions.setParameter(
                  id,
                  param.id,
                  event.currentTarget.value,
                  param.valueScale,
                )}
              />
            </label>
          ))}
          {extraParamCount > 0 ? (
            <small className="mz-flow-node__more">+{extraParamCount} more in inspector</small>
          ) : null}
        </div>
      ) : null}

      <p className="mz-flow-node__execution">{bypassed ? "Input A passes through" : execution}</p>
      {!removable ? <span className="mz-flow-node__fixed">Fixed output</span> : null}
    </article>
  );
});

const nodeTypes = Object.freeze({ shaderModule: ShaderModuleNode });

function toFlowNode(node, actions) {
  return {
    id: node.id,
    type: "shaderModule",
    position: node.position,
    selected: node.selected,
    deletable: node.removable,
    dragHandle: ".mz-flow-node__header",
    data: { ...node, actions },
  };
}

function toFlowEdge(edge, playing) {
  return {
    id: edge.id,
    source: edge.source,
    sourceHandle: edge.sourceHandle,
    target: edge.target,
    targetHandle: edge.targetHandle,
    type: "smoothstep",
    selected: edge.selected,
    animated: playing,
    reconnectable: true,
    deletable: true,
    focusable: true,
    interactionWidth: 24,
    style: {
      stroke: SIGNAL_COLORS[edge.signalType] ?? SIGNAL_COLORS.audio,
      strokeWidth: edge.selected ? 3 : 2,
    },
  };
}

function transportLabel(snapshot) {
  if (snapshot.playing && snapshot.audioOn) return "PATCH RUNNING · AUDIO ON";
  if (snapshot.playing) return "PATCH RUNNING · AUDIO OFF";
  if (snapshot.audioOn) return "PATCH PAUSED · AUDIO ON";
  return "PATCH READY · AUDIO OFF";
}

function ShaderFlowEditor({ initialSnapshot, actions, registerApi, rootElement }) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [nodes, setNodes] = useState(() => initialSnapshot.nodes.map((node) => toFlowNode(node, actions)));
  const [edges, setEdges] = useState(() => initialSnapshot.edges.map((edge) => toFlowEdge(edge, initialSnapshot.playing)));
  const flowInstance = useRef(null);
  const reconnectingEdgeId = useRef(null);
  const coarsePointer = useMemo(
    () => Boolean(globalThis.matchMedia?.("(pointer: coarse)")?.matches),
    [],
  );
  const fitViewPadding = coarsePointer ? 0.08 : 0.1;

  useEffect(() => {
    setNodes(snapshot.nodes.map((node) => toFlowNode(node, actions)));
    setEdges(snapshot.edges.map((edge) => toFlowEdge(edge, snapshot.playing)));
  }, [actions, snapshot]);

  const fit = useCallback(() => {
    globalThis.requestAnimationFrame?.(() => {
      void flowInstance.current?.fitView({ padding: fitViewPadding, minZoom: 0.35, maxZoom: 1.08, duration: 240 });
    });
  }, [fitViewPadding]);

  const focusNode = useCallback((nodeId) => {
    globalThis.requestAnimationFrame?.(() => {
      const selector = `.react-flow__node[data-id="${CSS.escape(nodeId)}"]`;
      rootElement.querySelector(selector)?.focus();
    });
  }, [rootElement]);

  useEffect(() => registerApi({ update: setSnapshot, fit, focusNode }), [fit, focusNode, registerApi]);

  const handleNodesChange = useCallback((changes) => {
    setNodes((current) => applyNodeChanges(changes, current));
    changes.forEach((change) => {
      if (change.type === "position" && change.position && change.dragging !== true) {
        actions.moveNode(change.id, change.position);
      } else if (change.type === "select" && change.selected) {
        actions.selectNode(change.id);
      }
    });
  }, [actions]);
  const handleEdgesChange = useCallback((changes) => {
    setEdges((current) => applyEdgeChanges(changes, current));
    changes.forEach((change) => {
      if (change.type === "select" && change.selected) actions.selectConnection(change.id);
    });
  }, [actions]);
  const isValidConnection = useCallback(
    (connection) => actions.validateConnection(connection, {
      ignoreConnectionId: reconnectingEdgeId.current,
    }).valid,
    [actions],
  );
  const handleNodesDelete = useCallback((deletedNodes) => {
    deletedNodes.forEach((node) => actions.deleteNode(node.id));
  }, [actions]);
  const handleEdgesDelete = useCallback((deletedEdges) => {
    deletedEdges.forEach((edge) => actions.deleteConnection(edge.id));
  }, [actions]);
  const miniMapNodeColor = useCallback((node) => node.data.color, []);

  return (
    <div className="shader-flow-stage">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onInit={(instance) => { flowInstance.current = instance; }}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={(connection) => actions.connect(connection)}
        onConnectStart={(_event, connection) => actions.startConnection(connection)}
        onConnectEnd={() => actions.finishConnection()}
        onReconnect={(oldEdge, connection) => actions.reconnect(oldEdge.id, connection)}
        onReconnectStart={(_event, edge) => {
          reconnectingEdgeId.current = edge.id;
          actions.cancelPendingConnection();
        }}
        onReconnectEnd={() => {
          reconnectingEdgeId.current = null;
          actions.finishConnection();
        }}
        isValidConnection={isValidConnection}
        onNodeClick={(_event, node) => actions.selectNode(node.id)}
        onEdgeClick={(_event, edge) => {
          if (edge.selected) actions.activateConnection(edge.id);
        }}
        onPaneClick={() => actions.selectPane()}
        onNodeDragStart={(_event, node) => actions.beginMoveNode(node.id)}
        onNodesDelete={handleNodesDelete}
        onEdgesDelete={handleEdgesDelete}
        deleteKeyCode={["Backspace", "Delete"]}
        multiSelectionKeyCode={null}
        selectionOnDrag={false}
        nodesDraggable={!coarsePointer}
        panOnDrag={!coarsePointer}
        preventScrolling={!coarsePointer}
        zoomOnScroll={!coarsePointer}
        snapToGrid
        snapGrid={[12, 12]}
        nodeExtent={[[0, 0], [4096, 4096]]}
        connectionRadius={28}
        reconnectRadius={28}
        elevateEdgesOnSelect
        fitView
        fitViewOptions={{ padding: fitViewPadding, minZoom: 0.35, maxZoom: 1.08 }}
        minZoom={0.25}
        maxZoom={1.8}
        colorMode="dark"
        aria-label="XYFlow shader audio patch canvas"
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.1} color="rgba(116, 247, 255, 0.18)" />
        <Controls showInteractive={false} position="bottom-left" />
        <MiniMap
          pannable
          zoomable
          position="bottom-right"
          nodeColor={miniMapNodeColor}
          nodeStrokeWidth={2}
          maskColor="rgba(3, 5, 8, 0.78)"
        />
      </ReactFlow>
      <output className="shader-flow-status" aria-live="off">{transportLabel(snapshot)}</output>
    </div>
  );
}

function ShaderFlowRoot(props) {
  return (
    <ReactFlowProvider>
      <ShaderFlowEditor {...props} />
    </ReactFlowProvider>
  );
}

export function mountShaderSynthXyflow({ element, snapshot, actions }) {
  if (!(element instanceof HTMLElement)) throw new TypeError("XYFlow requires an HTML mount element.");
  const root = createRoot(element);
  let mountedApi = null;
  let latestSnapshot = snapshot;
  let fitPending = true;
  let destroyed = false;

  const registerApi = (nextApi) => {
    mountedApi = nextApi;
    mountedApi.update(latestSnapshot);
    if (fitPending) {
      fitPending = false;
      mountedApi.fit();
    }
  };

  root.render(
    <ShaderFlowRoot
      initialSnapshot={snapshot}
      actions={actions}
      registerApi={registerApi}
      rootElement={element}
    />,
  );
  element.hidden = false;

  return Object.freeze({
    update(nextSnapshot) {
      if (destroyed) return;
      latestSnapshot = nextSnapshot;
      mountedApi?.update(nextSnapshot);
    },
    fit() {
      if (destroyed) return;
      if (mountedApi) mountedApi.fit();
      else fitPending = true;
    },
    focusNode(nodeId) {
      if (!destroyed) mountedApi?.focusNode(nodeId);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      mountedApi = null;
      root.unmount();
      element.replaceChildren();
      element.hidden = true;
    },
  });
}

globalThis.MorphazoidShaderSynthGraphRenderer = Object.freeze({
  name: "xyflow",
  mount: mountShaderSynthXyflow,
});
