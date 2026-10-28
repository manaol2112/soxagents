/**
 * The process flow as a map (asked for by the product owner on 27 October 2026, from a
 * workflow-canvas reference: "I want to create a wow factor"): the narrative's steps as
 * cards that wind across the canvas, left to right, turning at the edge, then right to
 * left, joined by connectors an animated marker travels along, step by step.
 *
 * Every card has the same height, so the layout is computed from the canvas width alone
 * and the connectors are drawn from the same numbers as the cards.
 */

import type { ProcessStep } from "./control-context-model.ts";

/** The canvas's padding: room at each side for the connector turning to the next row. */
export const FLOW_PAD_X = 48;
export const FLOW_PAD_Y = 24;
export const FLOW_GAP_X = 56;
export const FLOW_GAP_Y = 56;
export const FLOW_CARD_HEIGHT = 148;
/** One column wide enough for two lines of text: a shorter card, closer together. */
const COMPACT_HEIGHT = 124;
const COMPACT_GAP_Y = 32;
const SINGLE_PAD_X = 24;
/** How far a turning connector bends out past the cards. */
const TURN = 36;

export type FlowBox = {
  index: number;
  row: number;
  col: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type FlowLayout = {
  columns: number;
  /** One column with room for each step's text on two lines. */
  compact: boolean;
  width: number;
  height: number;
  boxes: FlowBox[];
  /** The connector from each step to the next, as SVG path data; one fewer than boxes. */
  segments: string[];
  /** The two ends of each connector, for the port dots. */
  ports: Array<{ from: [number, number]; to: [number, number] }>;
};

/** How many cards fit across: three on a wide canvas, two on a medium one, one on a
 * phone, never more than there are steps. */
export function flowColumns(width: number, count: number): number {
  const fit = width >= 900 ? 3 : width >= 600 ? 2 : 1;
  return Math.max(1, Math.min(fit, count));
}

export function flowLayout(count: number, width: number): FlowLayout {
  const columns = flowColumns(width, count);
  // One column has no turns to make room for at its sides.
  const padX = columns === 1 ? SINGLE_PAD_X : FLOW_PAD_X;
  const compact = columns === 1 && width >= 420;
  const gapY = columns === 1 ? COMPACT_GAP_Y : FLOW_GAP_Y;
  const w = Math.max(
    160,
    (width - 2 * padX - (columns - 1) * FLOW_GAP_X) / columns,
  );
  const h = compact ? COMPACT_HEIGHT : FLOW_CARD_HEIGHT;
  const boxes: FlowBox[] = [];
  for (let index = 0; index < count; index++) {
    const row = Math.floor(index / columns);
    const step = index % columns;
    // Even rows run left to right, odd rows right to left, so each row turns into the
    // next at the same side.
    const col = row % 2 === 0 ? step : columns - 1 - step;
    boxes.push({
      index,
      row,
      col,
      x: padX + col * (w + FLOW_GAP_X),
      y: FLOW_PAD_Y + row * (h + gapY),
      w,
      h,
    });
  }
  const segments: string[] = [];
  const ports: FlowLayout["ports"] = [];
  for (let index = 0; index + 1 < boxes.length; index++) {
    const a = boxes[index] as FlowBox;
    const b = boxes[index + 1] as FlowBox;
    const ay = a.y + a.h / 2;
    const by = b.y + b.h / 2;
    let from: [number, number];
    let to: [number, number];
    let d: string;
    if (columns === 1) {
      from = [a.x + a.w / 2, a.y + a.h];
      to = [b.x + b.w / 2, b.y];
      d = `M ${from[0]} ${from[1]} L ${to[0]} ${to[1]}`;
    } else if (a.row === b.row) {
      const rightward = b.col > a.col;
      from = [rightward ? a.x + a.w : a.x, ay];
      to = [rightward ? b.x : b.x + b.w, by];
      d = `M ${from[0]} ${from[1]} L ${to[0]} ${to[1]}`;
    } else {
      // The turn into the next row, out past the cards and back.
      const right = a.row % 2 === 0;
      const side = right ? a.x + a.w : a.x;
      const out = right ? side + TURN : side - TURN;
      from = [side, ay];
      to = [right ? b.x + b.w : b.x, by];
      d = `M ${from[0]} ${from[1]} C ${out} ${ay} ${out} ${by} ${to[0]} ${to[1]}`;
    }
    segments.push(d);
    ports.push({ from, to });
  }
  const rows = count === 0 ? 0 : Math.ceil(count / columns);
  return {
    columns,
    compact,
    width,
    height: rows === 0 ? 0 : 2 * FLOW_PAD_Y + rows * h + (rows - 1) * gapY,
    boxes,
    segments,
    ports,
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

/** The marker's pace along a connector, in pixels a second, how long it rests at each
 * step, and how many times it runs through before it stops. Slow and finite, so it never
 * pulls the eye away from reading (product owner, 27 October 2026: "the atom moves so
 * fast and it's disturbing me when I'm reading"). */
export const FLOW_SPEED = 60;
export const FLOW_REST_MS = 2200;
export const FLOW_PASSES = 2;
