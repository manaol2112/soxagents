"use client";

import {
  Background,
  BackgroundVariant,
  Controls,
  type Edge as FlowEdge,
  type Node as FlowNode,
  Handle,
  MarkerType,
  type NodeProps,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
} from "@xyflow/react";
import { memo, useEffect, useMemo } from "react";
import "@xyflow/react/dist/base.css";
import {
  KIND_LABELS,
  NODE_SIZE,
  type StepKey,
  TONE_LABELS,
  type WorkflowStep,
  workflowLayout,
} from "./control-workflow-model";
import { UiIcon } from "./ui-icon";

type StepData = {
  step: WorkflowStep;
  /** Its panel is open. */
  selected: boolean;
  onOpen: (key: StepKey) => void;
  /** The words on a next step's node, as the Next step card says them. */
  flag: string | null;
};
type BandData = {
  group: string;
  label: string;
  width: number;
  height: number;
};

const NO_FLAGS: Partial<Record<StepKey, string>> = {};

const KIND_ICON = {
  source: "database",
  agent: "sparkles",
  gate: "shield",
  output: "file",
} as const;

// A step is a real button: a click or Enter opens its work (product owner, 8 November 2026:
// one click, no summary in between). The
// handles edges join are its siblings, positioned by React Flow on the node's wrapper.
const StepNode = memo(function StepNode({
  data,
}: NodeProps<FlowNode<StepData>>) {
  const { step, selected, onOpen, flag } = data;
  const number = String(step.number).padStart(2, "0");
  return (
    <>
      <Handle
        type="target"
        position={Position.Left}
        id="left"
        isConnectable={false}
      />
      <Handle
        type="target"
        position={Position.Right}
        id="right"
        isConnectable={false}
      />
      <Handle
        type="target"
        position={Position.Top}
        id="top"
        isConnectable={false}
      />
      <Handle
        type="target"
        position={Position.Bottom}
        id="bottom-in"
        isConnectable={false}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="right"
        isConnectable={false}
      />
      <Handle
        type="source"
        position={Position.Left}
        id="left"
        isConnectable={false}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom"
        isConnectable={false}
      />
      <button
        type="button"
        className={`wf-node kind-${step.kind} tone-${step.tone}${selected ? " is-selected" : ""}${step.next ? " is-next" : ""}`}
        style={{ width: NODE_SIZE.width, height: NODE_SIZE.height }}
        aria-current={selected ? "step" : undefined}
        aria-label={`Step ${step.number}, ${step.title}. ${KIND_LABELS[step.kind]}. ${TONE_LABELS[step.tone]}: ${step.status}.${step.next ? ` ${flag ?? "A next step"}.` : ""}`}
        onClick={() => onOpen(step.key)}
      >
        {step.next ? (
          <span className="wf-flag" aria-hidden="true">
            {flag ?? "Next"}
          </span>
        ) : null}
        <span className="wf-kind">
          <UiIcon name={KIND_ICON[step.kind]} size={11} />
          {number} · {KIND_LABELS[step.kind]}
        </span>
        <span className="wf-title">{step.title}</span>
        <span className="wf-covers">{step.covers}</span>
        <span className="wf-state">
          {step.agent ? (
            <span className="wf-pulse" aria-hidden="true" />
          ) : (
            <span className={`wf-dot tone-${step.tone}`} aria-hidden="true" />
          )}
          <span className="wf-state-text">{step.status}</span>
        </span>
      </button>
    </>
  );
});

// A branch's band: the rounded box behind its steps, with its name, as in the product owner's
// diagram. It sits under the edges so a line between two of its steps stays in view.
const BandNode = memo(function BandNode({
  data,
}: NodeProps<FlowNode<BandData>>) {
  return (
    <div
      className={`wf-band band-${data.group}`}
      style={{ width: data.width, height: data.height }}
    >
      <span className="wf-band-label">{data.label}</span>
    </div>
  );
});

const NODE_TYPES = { step: StepNode, band: BandNode };

// React Flow lets a node take the pointer only when it is selectable or draggable, or the
// canvas has a node click handler; these are neither, and the button inside does the work.
const CLICKABLE = { pointerEvents: "all" } as const;
const INERT = { pointerEvents: "none" } as const;
const MARGIN = 24;

/** Frames the workflow whole, as large as fits and never past full size; framed again only
 * when the canvas changes size. */
function Framing({
  width: contentWidth,
  height: contentHeight,
}: {
  width: number;
  height: number;
}) {
  const flow = useReactFlow();
  const ready = useStore((state) => state.panZoom !== null);
  const width = useStore((state) => state.width);
  const height = useStore((state) => state.height);
  useEffect(() => {
    if (!ready || width === 0 || height === 0) {
      return;
    }
    const zoom = Math.min(
      1,
      Math.max(
        0.5,
        Math.min(
          (width - MARGIN * 2) / contentWidth,
          (height - MARGIN * 2) / contentHeight,
        ),
      ),
    );
    const x = Math.max(MARGIN, (width - contentWidth * zoom) / 2);
    const y = Math.max(MARGIN, (height - contentHeight * zoom) / 2);
    void flow.setViewport({ x, y, zoom });
  }, [ready, width, height, contentWidth, contentHeight, flow]);
  return null;
}

/** The canvas: draws what the model laid out. Nothing moves or connects by hand. */
export function WorkflowCanvas({
  steps,
  selected,
  onOpen,
  flags = NO_FLAGS,
}: {
  steps: readonly WorkflowStep[];
  /** The step whose panel is open. */
  selected: StepKey | null;
  onOpen: (key: StepKey) => void;
  /** The words on each next step's node (next-step-model). */
  flags?: Partial<Record<StepKey, string>>;
}) {
  const layout = useMemo(() => workflowLayout(), []);
  const { nodes, edges } = useMemo(() => {
    const by = new Map(steps.map((step) => [step.key, step]));
    const flowNodes: FlowNode[] = [
      ...layout.bands.map((band) => ({
        id: `band:${band.key}`,
        type: "band",
        position: { x: band.x, y: band.y },
        width: band.width,
        height: band.height,
        zIndex: -1,
        data: {
          group: band.key,
          label: band.label,
          width: band.width,
          height: band.height,
        },
        draggable: false,
        connectable: false,
        selectable: false,
        focusable: false,
        style: INERT,
      })),
      ...layout.placed.map((place) => ({
        id: place.key,
        type: "step",
        position: { x: place.x, y: place.y },
        ...NODE_SIZE,
        data: {
          step: by.get(place.key) as WorkflowStep,
          selected: selected === place.key,
          onOpen,
          flag: flags[place.key] ?? null,
        },
        draggable: false,
        connectable: false,
        focusable: false,
        style: CLICKABLE,
      })),
    ];
    const flowEdges: FlowEdge[] = layout.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      type: "smoothstep",
      // An edge out of a step that is done reads as the path taken so far.
      className: `wf-edge${by.get(edge.source)?.tone === "done" ? " is-reached" : ""}`,
      pathOptions: { borderRadius: 10, offset: 20 },
      ...(edge.label !== undefined
        ? {
            label: edge.label,
            labelBgPadding: [6, 3] as [number, number],
            labelBgBorderRadius: 4,
          }
        : {}),
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
    }));
    return { nodes: flowNodes, edges: flowEdges };
  }, [layout, steps, selected, onOpen, flags]);
  const bounds = layout.size;

  return (
    <ReactFlowProvider>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        minZoom={0.4}
        maxZoom={1.6}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnScroll={false}
        zoomOnDoubleClick={false}
        preventScrolling={false}
        panOnScroll={false}
        attributionPosition="bottom-right"
        ariaLabelConfig={{
          "node.a11yDescription.default":
            "Select a step, or press Enter on it, to open its work.",
        }}
      >
        {/* A drafting grid: fine lines, and a stronger line every fifth, under the bands. */}
        <Background
          id="wf-grid-minor"
          variant={BackgroundVariant.Lines}
          gap={16}
          lineWidth={1}
          className="wf-grid wf-grid-minor"
        />
        <Background
          id="wf-grid-major"
          variant={BackgroundVariant.Lines}
          gap={80}
          lineWidth={1}
          className="wf-grid wf-grid-major"
        />
        <Controls
          showInteractive={false}
          className="wf-controls"
          position="bottom-left"
        />
        <Framing width={bounds.width} height={bounds.height} />
      </ReactFlow>
    </ReactFlowProvider>
  );
}
