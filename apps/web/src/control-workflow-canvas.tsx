"use client";

import {
  Background,
  BackgroundVariant,
  type CoordinateExtent,
  type Edge as FlowEdge,
  type Node as FlowNode,
  Handle,
  type NodeProps,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  useStoreApi,
} from "@xyflow/react";
import {
  type KeyboardEvent,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import "@xyflow/react/dist/base.css";
import {
  FRAME_PAD,
  KIND_ICON,
  KIND_LABELS,
  NODE_SIZE,
  type StepKey,
  sidewaysLimits,
  TONE_LABELS,
  type WorkflowStep,
  workflowFrame,
  workflowLayout,
} from "./control-workflow-model";
import { UiIcon } from "./ui-icon";

type StepData = {
  step: WorkflowStep;
  /** Its panel is open. */
  selected: boolean;
  onOpen: (key: StepKey) => void;
  /** Keyboard focus reached it: the canvas brings it into view. */
  onFocus: (key: StepKey) => void;
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

/** Motion, unless the person asked for less. */
function duration(ms: number): number {
  return typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? 0
    : ms;
}

// A step is a real button: a click or Enter opens its work (product owner, 8 November 2026:
// one click, no summary in between). The
// handles edges join are its siblings, positioned by React Flow on the node's wrapper.
const StepNode = memo(function StepNode({
  data,
}: NodeProps<FlowNode<StepData>>) {
  const { step, selected, onOpen, onFocus, flag } = data;
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
        className={`wf-node kind-${step.kind} tone-${step.tone}${selected ? " is-selected" : ""}${step.next ? " is-next" : ""}${step.agent ? " is-working" : ""}`}
        style={{ width: NODE_SIZE.width, height: NODE_SIZE.height }}
        aria-current={selected ? "step" : undefined}
        aria-label={`Step ${step.number}, ${step.title}. ${KIND_LABELS[step.kind]}. ${TONE_LABELS[step.tone]}: ${step.status}.${step.next ? ` ${flag ?? "A next step"}.` : ""}`}
        onClick={() => onOpen(step.key)}
        onFocus={() => onFocus(step.key)}
      >
        {step.next ? (
          <span className="wf-flag" aria-hidden="true">
            {flag ?? "Next"}
          </span>
        ) : null}
        <span className="wf-node-head">
          <span className={`wf-badge kind-${step.kind}`}>
            <UiIcon name={KIND_ICON[step.kind]} size={13} />
            {KIND_LABELS[step.kind]}
          </span>
          <span className="wf-num">{number}</span>
        </span>
        <span className="wf-title">{step.title}</span>
        <span className="wf-covers">{step.covers}</span>
        <span className="wf-state" title={step.status}>
          {step.agent ? (
            <span className="wf-pulse" aria-hidden="true" />
          ) : step.tone === "done" ? (
            <span className="wf-check" aria-hidden="true">
              <UiIcon name="check" size={11} />
            </span>
          ) : (
            <span className={`wf-dot tone-${step.tone}`} aria-hidden="true" />
          )}
          <span className="wf-state-text">{step.status}</span>
        </span>
      </button>
    </>
  );
});

// A stage's lane: a soft tint behind its steps, with its name, as in the product owner's
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

/** The arrowheads, drawn in the theme's colours: neutral, a step done, the way to a next step. */
function ArrowDefs() {
  return (
    <svg className="wf-defs" aria-hidden="true" focusable="false">
      <defs>
        {(["wf-arrow", "wf-arrow-reached", "wf-arrow-next"] as const).map(
          (id) => (
            <marker
              key={id}
              id={id}
              className={id}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="9"
              markerHeight="9"
              markerUnits="userSpaceOnUse"
              orient="auto-start-reverse"
            >
              <path d="M1.5 1.5 9 5l-7.5 3.5z" strokeLinejoin="round" />
            </marker>
          ),
        )}
      </defs>
    </svg>
  );
}

type Content = { width: number; height: number };

/** The first view: the readable zoom, moved on to show `focus` if need be (workflowFrame). */
function useDefaultView(
  content: Content,
  focus: { current: { x: number; width: number } | null },
) {
  const flow = useReactFlow();
  const store = useStoreApi();
  return useCallback(
    (ms = 0) => {
      const { width } = store.getState();
      if (width === 0) {
        return;
      }
      const frame = workflowFrame(width, content, focus.current);
      void flow.setViewport(
        { x: frame.x, y: frame.y, zoom: frame.zoom },
        { duration: duration(ms) },
      );
    },
    [flow, store, content, focus],
  );
}

/** Frames the workflow at the readable zoom; framed again only when the canvas changes size. */
function Framing({ frame }: { frame: (ms?: number) => void }) {
  const ready = useStore((state) => state.panZoom !== null);
  const width = useStore((state) => state.width);
  useEffect(() => {
    if (ready && width > 0) {
      frame();
    }
  }, [ready, width, frame]);
  return null;
}

/** Sideways on a trackpad, or Shift and the wheel, pans the workflow; an up-and-down wheel
 * still scrolls the page. */
function SidewaysScroll({ content }: { content: Content }) {
  const flow = useReactFlow();
  const store = useStoreApi();
  const dom = useStore((state) => state.domNode);
  useEffect(() => {
    if (dom === null) {
      return;
    }
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey) {
        return; // a pinch: React Flow zooms
      }
      const sideways = Math.abs(event.deltaX) > Math.abs(event.deltaY);
      const delta = sideways ? event.deltaX : event.shiftKey ? event.deltaY : 0;
      if (delta === 0) {
        return;
      }
      const {
        transform: [x, y, zoom],
        width,
      } = store.getState();
      const limits = sidewaysLimits(zoom, width, content.width);
      if (limits === null) {
        return;
      }
      // Taken here, also at either end, so the browser does not go back a page instead.
      event.preventDefault();
      const scale = event.deltaMode === 1 ? 20 : 1;
      const next = Math.min(
        limits.max,
        Math.max(limits.min, x - delta * scale),
      );
      if (next !== x) {
        void flow.setViewport({ x: next, y, zoom });
      }
    };
    dom.addEventListener("wheel", onWheel, { passive: false });
    return () => dom.removeEventListener("wheel", onWheel);
  }, [dom, flow, store, content.width]);
  return null;
}

/** Where more of the workflow lies off the canvas: a soft fade on that edge, and a button that
 * brings it into view. */
function EdgeFades({ content }: { content: Content }) {
  const flow = useReactFlow();
  const x = useStore((state) => state.transform[0]);
  const y = useStore((state) => state.transform[1]);
  const zoom = useStore((state) => state.transform[2]);
  const width = useStore((state) => state.width);
  const limits = width > 0 ? sidewaysLimits(zoom, width, content.width) : null;
  if (limits === null) {
    return null;
  }
  const before = x < limits.max - 1;
  const after = x > limits.min + 1;
  const move = (by: number) => {
    const next = Math.min(limits.max, Math.max(limits.min, x + by));
    void flow.setViewport({ x: next, y, zoom }, { duration: duration(240) });
  };
  const step = width * 0.7;
  return (
    <>
      <div className={`wf-fade is-start${before ? " is-shown" : ""}`}>
        <button
          type="button"
          className="wf-edge-btn"
          aria-label="Show the earlier steps"
          aria-disabled={!before}
          tabIndex={before ? 0 : -1}
          onClick={() => (before ? move(step) : undefined)}
        >
          <UiIcon name="back" size={15} />
        </button>
      </div>
      <div className={`wf-fade is-end${after ? " is-shown" : ""}`}>
        <button
          type="button"
          className="wf-edge-btn"
          aria-label="Show the later steps"
          aria-disabled={!after}
          tabIndex={after ? 0 : -1}
          onClick={() => (after ? move(-step) : undefined)}
        >
          <UiIcon name="arrow" size={15} />
        </button>
      </div>
    </>
  );
}

/** Zoom out, the zoom (which returns to the readable view), zoom in, and the whole workflow. */
function Tools({ frame }: { frame: (ms?: number) => void }) {
  const flow = useReactFlow();
  const zoom = useStore((state) => state.transform[2]);
  const percent = Math.round(zoom * 100);
  // A toolbar's arrow keys move between its buttons.
  const arrows = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }
    const buttons = [...event.currentTarget.querySelectorAll("button")];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) {
      return;
    }
    event.preventDefault();
    const by = event.key === "ArrowRight" ? 1 : -1;
    buttons[(at + by + buttons.length) % buttons.length]?.focus();
  };
  return (
    <Panel position="bottom-left" className="wf-tools">
      <div role="toolbar" aria-label="Workflow view" onKeyDown={arrows}>
        <button
          type="button"
          aria-label="Zoom out"
          title="Zoom out"
          onClick={() => void flow.zoomOut({ duration: duration(200) })}
        >
          <UiIcon name="minus" size={14} />
        </button>
        <button
          type="button"
          className="wf-zoom"
          aria-label={`Zoom ${percent}%. Return to the readable view`}
          title="Return to the readable view"
          onClick={() => frame(240)}
        >
          {percent}%
        </button>
        <button
          type="button"
          aria-label="Zoom in"
          title="Zoom in"
          onClick={() => void flow.zoomIn({ duration: duration(200) })}
        >
          <UiIcon name="plus" size={14} />
        </button>
        <span className="wf-tools-rule" aria-hidden="true" />
        <button
          type="button"
          aria-label="Show the whole workflow"
          title="Show the whole workflow"
          onClick={() =>
            void flow.fitView({ padding: 0.04, duration: duration(240) })
          }
        >
          <UiIcon name="fit" size={14} />
        </button>
      </div>
    </Panel>
  );
}

/** Keyboard focus on a step out of view brings it into view, with a little room around it. */
function useReveal(
  placed: ReadonlyArray<{ key: StepKey; x: number }>,
  content: Content,
) {
  const flow = useReactFlow();
  const store = useStoreApi();
  return useCallback(
    (key: StepKey) => {
      const state = store.getState();
      // Focus scrolls the canvas's clipped frame itself; React Flow pans instead.
      const unscroll = () => {
        state.domNode?.scrollTo({ left: 0, top: 0 });
        state.domNode?.parentElement?.scrollTo({ left: 0, top: 0 });
      };
      unscroll();
      requestAnimationFrame(unscroll);
      const place = placed.find((item) => item.key === key);
      const [x, y, zoom] = state.transform;
      const limits = sidewaysLimits(zoom, state.width, content.width);
      if (place === undefined || limits === null) {
        return;
      }
      const room = FRAME_PAD * 2 * zoom;
      const left = x + place.x * zoom;
      const right = left + NODE_SIZE.width * zoom;
      let next = x;
      if (left < room) {
        next = x + (room - left);
      } else if (right > state.width - room) {
        next = x - (right - (state.width - room));
      }
      next = Math.min(limits.max, Math.max(limits.min, next));
      if (next !== x) {
        void flow.setViewport(
          { x: next, y, zoom },
          { duration: duration(200) },
        );
      }
    },
    [flow, store, placed, content.width],
  );
}

function Canvas({
  steps,
  selected,
  onOpen,
  flags,
  canvasWidth,
}: {
  steps: readonly WorkflowStep[];
  selected: StepKey | null;
  onOpen: (key: StepKey) => void;
  flags: Partial<Record<StepKey, string>>;
  canvasWidth: number;
}) {
  const layout = useMemo(() => workflowLayout(), []);
  const content = layout.size;
  // The step the first view shows: the one open, or else the first step to do next.
  const focusKey = selected ?? steps.find((step) => step.next)?.key ?? null;
  const focusPlace =
    layout.placed.find((place) => place.key === focusKey) ?? null;
  const focus = useRef<{ x: number; width: number } | null>(null);
  focus.current =
    focusPlace === null ? null : { x: focusPlace.x, width: NODE_SIZE.width };
  const frame = useDefaultView(content, focus);
  const reveal = useReveal(layout.placed, content);
  // The view the canvas mounts with, so it never draws once at the wrong size.
  // Only the first render's: later sizes are framed by Framing.
  const [initial] = useState(() => {
    const first = workflowFrame(canvasWidth, content, focus.current);
    return { x: first.x, y: first.y, zoom: first.zoom };
  });
  const extent = useMemo<CoordinateExtent>(
    () => [
      [-FRAME_PAD, -FRAME_PAD],
      [content.width + FRAME_PAD, content.height + FRAME_PAD],
    ],
    [content],
  );
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
          onFocus: reveal,
          flag: flags[place.key] ?? null,
        },
        draggable: false,
        connectable: false,
        focusable: false,
        style: CLICKABLE,
      })),
    ];
    const flowEdges: FlowEdge[] = layout.edges.map((edge) => {
      const source = by.get(edge.source);
      const target = by.get(edge.target);
      // The way into a step to do next is drawn in the accent; an edge out of a step that is
      // done reads as the path taken so far.
      const state =
        target?.next === true && source?.tone === "done"
          ? "next"
          : source?.tone === "done"
            ? "reached"
            : null;
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
        type: "smoothstep",
        className: `wf-edge${state !== null ? ` is-${state}` : ""}`,
        pathOptions: { borderRadius: 12, offset: 16 },
        focusable: false,
        ...(edge.label !== undefined
          ? {
              label: edge.label,
              labelBgPadding: [9, 4] as [number, number],
              labelBgBorderRadius: 11,
            }
          : {}),
        markerEnd: state === null ? "wf-arrow" : `wf-arrow-${state}`,
      };
    });
    return { nodes: flowNodes, edges: flowEdges };
  }, [layout, steps, selected, onOpen, reveal, flags]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      defaultViewport={initial}
      translateExtent={extent}
      minZoom={0.4}
      maxZoom={1.6}
      nodesDraggable={false}
      nodesConnectable={false}
      nodesFocusable={false}
      edgesFocusable={false}
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
      {/* A quiet dot grid under the lanes. */}
      <Background
        id="wf-dots"
        variant={BackgroundVariant.Dots}
        gap={20}
        size={1.4}
        className="wf-grid"
      />
      <ArrowDefs />
      <EdgeFades content={content} />
      <Tools frame={frame} />
      <Framing frame={frame} />
      <SidewaysScroll content={content} />
    </ReactFlow>
  );
}

/** The canvas: draws what the model laid out. Nothing moves or connects by hand; the view
 * opens at a readable size and pans sideways where the workflow is wider than the canvas. */
export function WorkflowCanvas({
  steps,
  selected,
  onOpen,
  flags = NO_FLAGS,
  canvasWidth,
}: {
  steps: readonly WorkflowStep[];
  /** The step whose panel is open. */
  selected: StepKey | null;
  onOpen: (key: StepKey) => void;
  /** The words on each next step's node (next-step-model). */
  flags?: Partial<Record<StepKey, string>>;
  /** The canvas's width as measured, for its first view. */
  canvasWidth: number;
}) {
  return (
    <ReactFlowProvider>
      <Canvas
        steps={steps}
        selected={selected}
        onOpen={onOpen}
        flags={flags}
        canvasWidth={canvasWidth}
      />
    </ReactFlowProvider>
  );
}
