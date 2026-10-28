/**
 * The process flow as a swimlane diagram (the product owner's reference of 27 October
 * 2026, replacing the winding map of the same day): one lane for each role that performs a
 * step, the steps in order across the lanes, a decision as a diamond whose Yes and No lead
 * to the steps the narrative names, and connectors routed between them. Everything is
 * worked out here from the steps alone, so the canvas, its zoom and its tests share it.
 */

import type { ProcessStep } from "./control-context-model.ts";

/** The lane's label column, the cards, the decision diamond, and the gaps between. */
export const LANE_LABEL_WIDTH = 200;
export const CARD_WIDTH = 236;
export const CARD_HEIGHT = 184;
export const DIAMOND_SIZE = 112;
const COLUMN_GAP = 72;
const LANE_PAD_X = 28;
const LANE_PAD_Y = 26;
const LANE_GAP = 16;
/** How far below a card a connector running back to an earlier step travels. */
const RETURN_DROP = 14;

export const LANE_HEIGHT = CARD_HEIGHT + 2 * LANE_PAD_Y;

/** The lane of a step with no role named. */
export const UNNAMED_LANE = "Role not named";

export type FlowLane = { name: string; y: number; h: number; steps: number };

export type FlowNode = {
  index: number;
  lane: number;
  column: number;
  x: number;
  y: number;
  w: number;
  h: number;
  decision: boolean;
};

export type FlowEdge = {
  from: number;
  to: number;
  /** SVG path data, orthogonal. */
  d: string;
  /** A decision's answer on its connector, with where it is written. */
  label: "Yes" | "No" | null;
  labelAt: [number, number] | null;
  /** Runs back to an earlier step (a refusal going round again). */
  back: boolean;
};

export type SwimlaneLayout = {
  width: number;
  height: number;
  lanes: FlowLane[];
  nodes: FlowNode[];
  edges: FlowEdge[];
};

/** The words for a step's role, its lane: as written, or the unnamed lane. */
export function laneName(actor: string): string {
  const name = actor.trim().replace(/\s+/g, " ");
  return name === "" ? UNNAMED_LANE : name;
}

/** A step's title: the narrative's, else the first words of its description; a decision
 * without one asks its question plainly. */
export function stepTitle(
  step: Pick<ProcessStep, "title" | "description" | "kind">,
): string {
  const given = step.title.trim();
  if (given !== "") {
    return given;
  }
  if (step.kind === "DECISION") {
    return "Approved?";
  }
  const words = step.description
    .trim()
    .replace(/[.;:].*$/s, "")
    .split(/\s+/)
    .filter((word) => word !== "");
  const short = words.slice(0, 6).join(" ");
  return words.length > 6 ? `${short}…` : short;
}

/** The step a decision's answer leads to, as an index: the one named (1 is the first),
 * else the next step; null when there is none. */
function target(
  step: ProcessStep,
  index: number,
  count: number,
  answer: "yes" | "no",
) {
  const named = step[answer];
  if (named >= 1 && named <= count && named - 1 !== index) {
    return named - 1;
  }
  return index + 1 < count ? index + 1 : null;
}

export function swimlaneLayout(steps: readonly ProcessStep[]): SwimlaneLayout {
  const names: string[] = [];
  const laneOf = steps.map((step) => {
    const name = laneName(step.actor);
    const known = names.findIndex(
      (item) => item.toLowerCase() === name.toLowerCase(),
    );
    if (known >= 0) {
      return known;
    }
    names.push(name);
    return names.length - 1;
  });

  // Columns: the next step in the same lane moves right; a handoff to another lane drops
  // or rises in the same column, as the reference does, unless that cell is taken.
  const taken = new Set<string>();
  const columnOf: number[] = [];
  steps.forEach((_, index) => {
    const lane = laneOf[index] ?? 0;
    let column =
      index === 0
        ? 0
        : (columnOf[index - 1] ?? 0) + (laneOf[index - 1] === lane ? 1 : 0);
    while (taken.has(`${lane}:${column}`)) {
      column += 1;
    }
    taken.add(`${lane}:${column}`);
    columnOf.push(column);
  });
  const columns = Math.max(1, ...columnOf.map((column) => column + 1));

  const lanes: FlowLane[] = names.map((name, lane) => ({
    name,
    y: lane * (LANE_HEIGHT + LANE_GAP),
    h: LANE_HEIGHT,
    steps: laneOf.filter((item) => item === lane).length,
  }));
  const cellX = (column: number) =>
    LANE_LABEL_WIDTH + LANE_PAD_X + column * (CARD_WIDTH + COLUMN_GAP);
  const nodes: FlowNode[] = steps.map((step, index) => {
    const lane = laneOf[index] ?? 0;
    const column = columnOf[index] ?? 0;
    const top = (lanes[lane]?.y ?? 0) + LANE_PAD_Y;
    const decision = step.kind === "DECISION";
    return decision
      ? {
          index,
          lane,
          column,
          x: cellX(column) + (CARD_WIDTH - DIAMOND_SIZE) / 2,
          y: top + (CARD_HEIGHT - DIAMOND_SIZE) / 2,
          w: DIAMOND_SIZE,
          h: DIAMOND_SIZE,
          decision,
        }
      : {
          index,
          lane,
          column,
          x: cellX(column),
          y: top,
          w: CARD_WIDTH,
          h: CARD_HEIGHT,
          decision,
        };
  });

  const edges: FlowEdge[] = [];
  steps.forEach((step, index) => {
    const answers: Array<["Yes" | "No" | null, number | null]> =
      step.kind === "DECISION"
        ? [
            ["Yes", target(step, index, steps.length, "yes")],
            ["No", target(step, index, steps.length, "no")],
          ]
        : [[null, index + 1 < steps.length ? index + 1 : null]];
    const seen = new Set<number>();
    for (const [label, to] of answers) {
      if (to === null || seen.has(to)) {
        continue;
      }
      seen.add(to);
      const from = nodes[index];
      const into = nodes[to];
      if (from === undefined || into === undefined) {
        continue;
      }
      edges.push(route(from, into, label, lanes));
    }
  });

  return {
    width: cellX(columns - 1) + CARD_WIDTH + LANE_PAD_X,
    height:
      lanes.length * LANE_HEIGHT + Math.max(0, lanes.length - 1) * LANE_GAP,
    lanes,
    nodes,
    edges,
  };
}

const mid = (node: FlowNode): [number, number] => [
  node.x + node.w / 2,
  node.y + node.h / 2,
];

/** An orthogonal connector from one step to another, with room for its label. */
function route(
  from: FlowNode,
  into: FlowNode,
  label: "Yes" | "No" | null,
  lanes: FlowLane[],
): FlowEdge {
  const [fx, fy] = mid(from);
  const [tx, ty] = mid(into);
  const forward =
    into.column > from.column ||
    (into.column === from.column && into.index > from.index);
  let d: string;
  let labelAt: [number, number];
  if (!forward) {
    // Back to an earlier step: down below the lower card, across, and up into it.
    const lane = lanes[Math.max(from.lane, into.lane)];
    const floor = (lane?.y ?? 0) + (lane?.h ?? 0) - RETURN_DROP;
    const below = Math.max(from.y + from.h, into.y + into.h) + RETURN_DROP;
    const y = Math.min(floor, below);
    d = `M ${fx} ${from.y + from.h} V ${y} H ${tx} V ${into.y + into.h}`;
    labelAt = [(fx + tx) / 2, y];
  } else if (into.column === from.column) {
    // A handoff straight down (or up) to another lane.
    const down = into.y > from.y;
    const start = down ? from.y + from.h : from.y;
    const end = down ? into.y : into.y + into.h;
    d = `M ${fx} ${start} V ${end}`;
    labelAt = [fx, (start + end) / 2];
  } else if (Math.abs(fy - ty) < 1) {
    d = `M ${from.x + from.w} ${fy} H ${into.x}`;
    labelAt = [(from.x + from.w + into.x) / 2, fy];
  } else {
    // Across and into another lane: out to the gap, along it, and in.
    const gap = into.x - (into.x - (from.x + from.w)) / 2;
    d = `M ${from.x + from.w} ${fy} H ${gap} V ${ty} H ${into.x}`;
    labelAt = [(from.x + from.w + gap) / 2, fy];
  }
  return {
    from: from.index,
    to: into.index,
    d,
    label,
    labelAt: label === null ? null : labelAt,
    back: !forward,
  };
}

/** The zoom that fits the whole diagram in a view, never larger than life, never smaller
 * than a third. */
export function fitScale(
  layout: Pick<SwimlaneLayout, "width" | "height">,
  view: { width: number; height: number },
  margin = 32,
): number {
  if (layout.width <= 0 || layout.height <= 0) {
    return 1;
  }
  const scale = Math.min(
    (view.width - 2 * margin) / layout.width,
    (view.height - 2 * margin) / layout.height,
    1,
  );
  return Math.max(MIN_ZOOM, Math.round(scale * 100) / 100);
}

export const MIN_ZOOM = 0.35;
export const MAX_ZOOM = 2;

/** One zoom step in or out, kept within bounds. */
export function zoomStep(scale: number, direction: 1 | -1): number {
  const next = Math.round((scale + direction * 0.1) * 100) / 100;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
}

/** What the diagram holds, for the line above it. */
export function flowSummary(steps: readonly ProcessStep[]): {
  steps: number;
  controls: number;
  owners: number;
  decisions: number;
} {
  return {
    steps: steps.length,
    controls: steps.filter((step) => step.controlPoint).length,
    owners: new Set(steps.map((step) => laneName(step.actor).toLowerCase()))
      .size,
    decisions: steps.filter((step) => step.kind === "DECISION").length,
  };
}

export type StepKind = "control" | "system" | "person";

/** What a step's card shows as its icon: where the control operates, a step done in a
 * system, or a step a person performs. */
export function stepKind(
  step: Pick<ProcessStep, "controlPoint" | "system">,
): StepKind {
  return step.controlPoint
    ? "control"
    : step.system !== ""
      ? "system"
      : "person";
}

export const BASIS_LABEL: Record<ProcessStep["basis"], string> = {
  DOCUMENTED: "Documented",
  INFERRED: "Inferred",
  TEAM: "From the team",
};
