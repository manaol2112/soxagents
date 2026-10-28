import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import type { ProcessStep } from "../apps/web/src/control-context-model.ts";
import {
  CARD_WIDTH,
  DIAMOND_SIZE,
  fitScale,
  flowSummary,
  LANE_HEIGHT,
  MAX_ZOOM,
  MIN_ZOOM,
  stepKind,
  stepTitle,
  swimlaneLayout,
  UNNAMED_LANE,
  zoomStep,
} from "../apps/web/src/process-flow-model.ts";

// The process flow as a swimlane diagram (the product owner's reference of 27 October
// 2026). It replaced the winding map of the same day: the cards that turned at the edge,
// the one-column phone stack and the animated marker are gone with that design, and their
// tests with them (the layout they checked no longer exists).

const step = (
  actor: string,
  extra: Partial<ProcessStep> = {},
): ProcessStep => ({
  key: "",
  description: "Does the work.",
  actor,
  system: "",
  controlPoint: false,
  basis: "INFERRED",
  source: "",
  sourceTitle: "",
  quote: "",
  attributes: [],
  title: "",
  kind: "STEP",
  yes: 0,
  no: 0,
  evidence: [],
  ...extra,
});

// The reference's access provisioning: requestor, approvers with a decision, the
// administrator.
const ACCESS: ProcessStep[] = [
  step("Requestor", { title: "Submit access request", system: "ServiceNow" }),
  step("Requestor", { title: "Route for approval" }),
  step("Manager / Application Owner", {
    title: "Approved?",
    kind: "DECISION",
    yes: 4,
    no: 1,
  }),
  step("Manager / Application Owner", {
    title: "Review & approve access",
    controlPoint: true,
  }),
  step("System Administrator", {
    title: "Provision approved role",
    controlPoint: true,
    system: "Active Directory",
    evidence: ["Approved ticket", "AD change log"],
  }),
  step("System Administrator", { title: "Document provisioning" }),
];

describe("the swimlane layout", () => {
  const layout = swimlaneLayout(ACCESS);

  it("gives each role a lane, in the order the roles first act", () => {
    assert.deepEqual(
      layout.lanes.map((lane) => [lane.name, lane.steps]),
      [
        ["Requestor", 2],
        ["Manager / Application Owner", 2],
        ["System Administrator", 2],
      ],
    );
    assert.equal(layout.lanes[1]?.y, LANE_HEIGHT + 16);
  });

  it("moves right within a lane and drops into the same column at a handoff", () => {
    assert.deepEqual(
      layout.nodes.map((node) => [node.lane, node.column]),
      [
        [0, 0],
        [0, 1],
        [1, 1],
        [1, 2],
        [2, 2],
        [2, 3],
      ],
    );
    // A decision is a diamond centred in its cell.
    const decision = layout.nodes[2];
    assert.equal(decision?.decision, true);
    assert.equal(decision?.w, DIAMOND_SIZE);
    assert.equal(
      (decision?.x ?? 0) + DIAMOND_SIZE / 2,
      (layout.nodes[1]?.x ?? 0) + CARD_WIDTH / 2,
    );
  });

  it("leads a decision's Yes and No where the narrative says, No back round", () => {
    const fromDecision = layout.edges.filter((edge) => edge.from === 2);
    assert.deepEqual(
      fromDecision.map((edge) => [edge.label, edge.to + 1, edge.back]),
      [
        ["Yes", 4, false],
        ["No", 1, true],
      ],
    );
    // Every other step leads to the next, unlabelled.
    assert.deepEqual(
      layout.edges
        .filter((edge) => edge.from !== 2)
        .map((edge) => [edge.from, edge.to, edge.label]),
      [
        [0, 1, null],
        [1, 2, null],
        [3, 4, null],
        [4, 5, null],
      ],
    );
    for (const edge of layout.edges) {
      assert.match(edge.d, /^M [\d.]+ [\d.]+( [HV] [\d.]+)+$/);
    }
  });

  it("follows the next step when a decision names none, and draws one connector", () => {
    const plain = swimlaneLayout([
      step("A"),
      step("A", { kind: "DECISION" }),
      step("A"),
    ]);
    assert.deepEqual(
      plain.edges.map((edge) => [edge.from, edge.to, edge.label]),
      [
        [0, 1, null],
        [1, 2, "Yes"],
      ],
    );
  });

  it("puts steps with no role named in one lane of their own", () => {
    const unnamed = swimlaneLayout([step(""), step("  ")]);
    assert.deepEqual(
      unnamed.lanes.map((lane) => lane.name),
      [UNNAMED_LANE],
    );
  });

  it("never puts two steps in one place when a role acts again later", () => {
    const back = swimlaneLayout([step("A"), step("B"), step("A"), step("B")]);
    const cells = back.nodes.map((node) => `${node.lane}:${node.column}`);
    assert.equal(new Set(cells).size, cells.length);
  });
});

describe("the step's words and the summary", () => {
  it("titles a step from the narrative, else its first words", () => {
    assert.equal(stepTitle(step("A", { title: "Grant role" })), "Grant role");
    assert.equal(
      stepTitle(
        step("A", {
          description:
            "The administrator grants the approved role in Active Directory. Then logs it.",
        }),
      ),
      "The administrator grants the approved role…",
    );
    assert.equal(stepTitle(step("A", { kind: "DECISION" })), "Approved?");
  });

  it("counts the steps, control points, owners and decisions", () => {
    assert.deepEqual(flowSummary(ACCESS), {
      steps: 6,
      controls: 2,
      owners: 3,
      decisions: 1,
    });
  });

  it("shows where the control operates, a system step, or a person's step", () => {
    assert.equal(stepKind({ controlPoint: true, system: "" }), "control");
    assert.equal(stepKind({ controlPoint: false, system: "SAP" }), "system");
    assert.equal(stepKind({ controlPoint: false, system: "" }), "person");
  });
});

describe("zoom and fit", () => {
  it("fits the diagram in the view, never larger than life nor below the minimum", () => {
    assert.equal(
      fitScale({ width: 500, height: 300 }, { width: 1200, height: 600 }),
      1,
    );
    assert.equal(
      fitScale({ width: 2000, height: 600 }, { width: 1064, height: 600 }),
      0.5,
    );
    assert.equal(
      fitScale({ width: 20000, height: 600 }, { width: 800, height: 600 }),
      MIN_ZOOM,
    );
  });

  it("zooms in tenths, within bounds", () => {
    assert.equal(zoomStep(1, 1), 1.1);
    assert.equal(zoomStep(1, -1), 0.9);
    assert.equal(zoomStep(MAX_ZOOM, 1), MAX_ZOOM);
    assert.equal(zoomStep(MIN_ZOOM, -1), MIN_ZOOM);
  });
});

describe("the diagram's styles", () => {
  const css = readFileSync("apps/web/app/process-flow.css", "utf8");

  it("uses tokens only and opens full screen over the page", () => {
    assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i);
    assert.match(css, /\.pf\.is-full \{\s*position: fixed;\s*inset: 0;/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  });
});
