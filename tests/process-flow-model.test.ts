import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  FLOW_CARD_HEIGHT,
  FLOW_PAD_X,
  FLOW_PASSES,
  FLOW_REST_MS,
  FLOW_SPEED,
  flowColumns,
  flowLayout,
  stepKind,
} from "../apps/web/src/process-flow-model.ts";

// The process flow as a map (asked for by the product owner on 27 October 2026, from a
// workflow-canvas reference): cards winding across the canvas, joined by connectors.
describe("process flow map", () => {
  it("fits three cards across a wide canvas, two on a medium one, one on a phone", () => {
    assert.equal(flowColumns(1040, 9), 3);
    assert.equal(flowColumns(700, 9), 2);
    assert.equal(flowColumns(360, 9), 1);
    // Never more columns than steps.
    assert.equal(flowColumns(1040, 2), 2);
  });

  it("winds left to right, then right to left, turning at the same side", () => {
    const layout = flowLayout(7, 1040);
    assert.deepEqual(
      layout.boxes.map((box) => [box.row, box.col]),
      [
        [0, 0],
        [0, 1],
        [0, 2],
        [1, 2],
        [1, 1],
        [1, 0],
        [2, 0],
      ],
    );
    // One connector between each step and the next.
    assert.equal(layout.segments.length, 6);
    // Within a row the connector is straight; the turn into the next row bends out past
    // the cards, on the right after an even row and on the left after an odd one.
    assert.match(layout.segments[0] ?? "", /^M [\d.]+ [\d.]+ L /);
    assert.match(layout.segments[2] ?? "", / C /);
    const right = layout.ports[2];
    const left = layout.ports[5];
    assert.ok(right !== undefined && left !== undefined);
    assert.equal(right.from[0], right.to[0]);
    assert.ok(right.from[0] > 1040 - FLOW_PAD_X - 1);
    assert.equal(left.from[0], FLOW_PAD_X);
    // The canvas is as tall as its rows, and every card fits inside it.
    assert.equal(layout.height, 2 * 24 + 3 * FLOW_CARD_HEIGHT + 2 * 56);
    for (const box of layout.boxes) {
      assert.ok(
        box.x >= FLOW_PAD_X && box.x + box.w <= 1040 - FLOW_PAD_X + 0.01,
      );
      assert.ok(box.y + box.h <= layout.height);
    }
  });

  it("stacks the steps on a phone, joined top to bottom", () => {
    const layout = flowLayout(3, 340);
    assert.equal(layout.columns, 1);
    assert.deepEqual(
      layout.ports.map((port) => port.from[0] === port.to[0]),
      [true, true],
    );
    assert.equal(layout.compact, false);
    // A single column with room for two lines is shorter and closer together.
    const narrow = flowLayout(9, 504);
    assert.equal(narrow.compact, true);
    assert.ok(narrow.height < flowLayout(9, 340).height);
    assert.ok((narrow.boxes[0]?.h ?? 0) < FLOW_CARD_HEIGHT);
    assert.equal(narrow.boxes[0]?.x, 24);
    assert.equal(flowLayout(0, 900).height, 0);
    assert.deepEqual(flowLayout(1, 900).segments, []);
  });

  it("shows where the control operates, a system step, or a person's step", () => {
    assert.equal(
      stepKind({ controlPoint: true, system: "JD Edwards" }),
      "control",
    );
    assert.equal(
      stepKind({ controlPoint: false, system: "JD Edwards" }),
      "system",
    );
    assert.equal(stepKind({ controlPoint: false, system: "" }), "person");
  });

  it("moves the marker only when the person allows motion, and pauses out of view", () => {
    const source = readFileSync("apps/web/src/process-flow.tsx", "utf8");
    assert.ok(source.includes("(prefers-reduced-motion: reduce)"));
    assert.ok(source.includes("IntersectionObserver"));
    assert.ok(source.includes("cancelAnimationFrame"));
    // Product owner, 27 October 2026: "the atom moves so fast and it's disturbing me when
    // I'm reading". Slow, finite (then Replay), and held while the person reads.
    assert.ok(FLOW_SPEED <= 80 && FLOW_REST_MS >= 2000);
    assert.equal(FLOW_PASSES, 2);
    assert.ok(source.includes("passes >= FLOW_PASSES"));
    assert.ok(source.includes("Replay the flow"));
    assert.ok(source.includes("hovered.current || reading.current"));
    const css = readFileSync("apps/web/app/process-flow.css", "utf8");
    assert.ok(css.includes("@media (prefers-reduced-motion: reduce)"));
  });
});
