import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  acceptedLine,
  handoff,
  ORDER_LINE,
} from "../apps/web/src/attributes-handoff-model.ts";
import {
  STEPS,
  type Tone,
  type WorkflowStep,
} from "../apps/web/src/control-workflow-model.ts";
import type {
  RequestRow,
  RequestsView,
} from "../apps/web/src/design-requests-model.ts";

type Shape = { tone: Tone; status: string; agent?: boolean; note?: string };

/** The workflow's steps, each as given or not started. */
function steps(given: Partial<Record<string, Shape>>): WorkflowStep[] {
  return STEPS.map((meta, at) => {
    const shape = given[meta.key] ?? { tone: "idle", status: "Not started" };
    return {
      ...meta,
      number: at + 1,
      tone: shape.tone,
      status: shape.status,
      agent: shape.agent ?? false,
      next: false,
      ...(shape.note !== undefined ? { note: shape.note } : {}),
    };
  });
}

const settled: Shape = { tone: "done", status: "Approved · 5 attributes" };

const accepted = (by: string, at: string) => ({
  criteria: { acceptedBy: by, acceptedAt: at },
});
const five = [
  accepted("Dana Reyes", "2026-11-17T05:20:00Z"),
  accepted("Dana Reyes", "2026-11-17T05:31:00Z"),
  accepted("Dana Reyes", "2026-11-17T05:25:00Z"),
  accepted("Dana Reyes", "2026-11-17T05:28:00Z"),
  accepted("Dana Reyes", "2026-11-17T05:29:00Z"),
];

function row(id: string, letters: string[]): RequestRow {
  return {
    id,
    version: 1,
    title: `Request ${id}`,
    description: "",
    shows: "",
    kind: "Document",
    icon: "file",
    line: "Document",
    origin: "AGENT",
    originLine: "",
    letters,
    attributeIds: letters,
    addresses: `addresses attributes ${letters.join(" and ")}`,
    state: "TO_ACCEPT",
    change: null,
    acceptedBy: null,
    acceptedAt: null,
    procedureIds: null,
  } as RequestRow;
}

function listed(
  rows: RequestRow[],
  over: { accept?: number; uncovered?: number; working?: boolean } = {},
): RequestsView {
  return {
    mode: "list",
    title: `${rows.length} requests`,
    rows,
    accept: rows
      .slice(0, over.accept ?? rows.length)
      .map((item) => ({ requirement_id: item.id, version: 1 })),
    confirm: [],
    // The chips as the list builds them: the last letters not addressed (17 November 2026:
    // the handoff reads coverage from the chips, so an empty list is never complete).
    coverage: ["A", "B", "C", "D", "E"].map((letter, at) => ({
      attributeId: letter,
      letter,
      text: "",
      state: at >= 5 - (over.uncovered ?? 0) ? "UNCOVERED" : "COVERED",
      requests: at >= 5 - (over.uncovered ?? 0) ? 0 : 1,
      label: "",
    })),
    coverageLine: "5 of 5 attributes addressed",
    uncovered: Array.from({ length: over.uncovered ?? 0 }, (_, at) => ({
      attributeId: `x${at}`,
      letter: "E",
      text: "",
      line: "",
      proposed: false,
    })),
    exceptions: [],
    history: [],
    attributes: ["A", "B", "C", "D", "E"].map((letter) => ({
      id: letter,
      letter,
      text: "",
      source: "Library",
    })),
    sources: "the control library",
    // The list's own header while the planner works (design-requests-model.requestsView).
    header: over.working
      ? {
          tone: "active",
          status: rows.length === 0 ? "Being planned" : "Being updated",
          line: "",
        }
      : {
          tone: "attention",
          status: `${over.accept ?? rows.length} requests to accept`,
          line: "",
        },
    working: over.working ?? false,
    settled: false,
    empty: "",
  } as RequestsView;
}

describe("the Attributes step once settled (product owner, 17 November 2026)", () => {
  it("shows only once every attribute is settled and no agent is at work", () => {
    const requests = listed([row("r1", ["A"])]);
    assert.equal(
      handoff({
        steps: steps({
          attributes: { tone: "attention", status: "2 to decide" },
        }),
        approved: five,
        requests,
      }),
      null,
    );
    assert.equal(
      handoff({
        steps: steps({ attributes: { ...settled, agent: true } }),
        approved: five,
        requests,
      }),
      null,
    );
    assert.equal(
      handoff({
        steps: steps({ attributes: settled }),
        approved: [],
        requests,
      }),
      null,
    );
    assert.notEqual(
      handoff({
        steps: steps({ attributes: settled }),
        approved: five,
        requests,
      }),
      null,
    );
  });

  it("says what was settled, by whom and on which day", () => {
    const shown = handoff({
      steps: steps({ attributes: settled }),
      approved: five,
      requests: listed([row("r1", ["A"])]),
      timeZone: "UTC",
    });
    // One card (product owner, 17 November 2026): what was settled, what is next.
    // Rewritten 19 November 2026 (owner-approved Review attributes prototype). Old: "All 5
    // attributes are settled" over "Accepted by Dana Reyes on Nov 17 · Next: 1 D&I request
    // to accept". New: "Attributes set" over the counts and what can start; who accepted
    // stays on each attribute's record ("Accepted by …" when a row is opened), and
    // acceptedLine still says it.
    assert.equal(shown?.title, "Attributes set");
    assert.equal(
      shown?.line,
      "5 accepted. D&I Evidence and Scope & Sampling can start.",
    );
    assert.equal(acceptedLine(five, "UTC"), "Accepted by Dana Reyes on Nov 17");
    assert.deepEqual(shown?.next, {
      key: "designevidence",
      label: "Continue to D&I Evidence",
    });
    assert.equal(shown?.gap, "");
    assert.equal(
      acceptedLine(
        [
          accepted("Dana Reyes", "2026-11-17T05:20:00Z"),
          accepted("Sam Okafor", "2026-11-18T09:00:00Z"),
        ],
        "UTC",
      ),
      "Accepted by Dana Reyes and 1 other on Nov 18",
    );
    // The standard's attributes the library approved at launch name no one.
    assert.equal(acceptedLine([accepted("", "")]), "");
  });

  it("puts the D&I requests to accept first, with the attributes each one addresses", () => {
    const shown = handoff({
      steps: steps({ attributes: settled }),
      approved: five,
      requests: listed([
        row("r1", ["B", "E"]),
        row("r2", ["A", "B", "C", "D", "E"]),
        row("r3", ["A"]),
        row("r4", ["C"]),
        row("r5", ["D"]),
      ]),
    });
    const [design, scope] = shown?.cards ?? [];
    assert.equal(design?.key, "designevidence");
    assert.equal(design?.branch, "D&I branch");
    assert.equal(design?.number, 4);
    assert.equal(design?.primary, true);
    assert.deepEqual(design?.pill, {
      label: "5 requests to accept",
      tone: "attention",
      working: false,
    });
    assert.equal(design?.action, "Review the requests");
    // Three shown, the rest counted.
    assert.deepEqual(
      design?.requests.map((item) => item.letters),
      [["B", "E"], ["A", "B", "C", "D", "E"], ["A"]],
    );
    assert.equal(design?.more, 2);
    assert.deepEqual(design?.coverage, {
      line: "5 of 5 attributes addressed",
      complete: true,
    });
    // The OE branch: it can start, and says once that its evidence waits for the D&I sign-off.
    assert.equal(scope?.key, "testdesign");
    assert.equal(scope?.primary, false);
    assert.deepEqual(scope?.pill, {
      label: "Can start now",
      tone: "idle",
      working: false,
    });
    assert.equal(scope?.order, ORDER_LINE);
    assert.equal(scope?.action, "Plan scope & sampling");
  });

  it("says an attribute no request addresses", () => {
    const shown = handoff({
      steps: steps({ attributes: settled }),
      approved: five,
      requests: listed([row("r1", ["A"])], { uncovered: 1 }),
    });
    assert.equal(shown?.cards[0]?.coverage?.complete, false);
    // Named, with the way on (design review, 17 November 2026).
    assert.equal(
      shown?.cards[0]?.coverage?.line,
      "Attribute E is not addressed by a D&I request. Add a request on D&I Evidence, or record why it is not evidenced at D&I.",
    );
  });

  it("while the planner drafts, the person's work is the OE plan", () => {
    const shown = handoff({
      steps: steps({ attributes: settled }),
      approved: five,
      requests: listed([], { working: true }),
    });
    const [design, scope] = shown?.cards ?? [];
    // Rewritten 17 November 2026 (product owner's report of the same day: "drafted" meant
    // two things on one screen). Old: "Being drafted" while the planner plans the requests.
    // New: the list's own "Being planned", as the D&I step says; "drafted" is kept for the
    // message to the owner.
    assert.deepEqual(design?.pill, {
      label: "Being planned",
      tone: "active",
      working: true,
    });
    assert.deepEqual(design?.requests, []);
    assert.equal(design?.coverage, null);
    assert.equal(design?.action, "Open D&I Evidence");
    assert.equal(design?.primary, false);
    assert.equal(scope?.primary, true);
  });

  it("once the requests are with the owner, the OE plan is the person's next work", () => {
    const shown = handoff({
      steps: steps({
        attributes: settled,
        designevidence: {
          tone: "active",
          status: "Sent · waiting for the owner",
        },
        testdesign: { tone: "attention", status: "Awaiting approval" },
      }),
      approved: five,
      requests: { mode: "hidden" },
    });
    const [design, scope] = shown?.cards ?? [];
    assert.deepEqual(design?.pill, {
      label: "Sent · waiting for the owner",
      tone: "active",
      working: false,
    });
    assert.match(design?.text ?? "", /with the control owner/);
    assert.equal(design?.primary, false);
    assert.equal(scope?.primary, true);
    assert.equal(scope?.action, "Review the plan");
    // Rewritten 19 November 2026 (Review attributes): the counts, then what comes next.
    // Old: "… · Next: Scope & Sampling, awaiting approval". New: a sentence after the counts.
    assert.equal(
      shown?.line,
      "5 accepted. Next: Scope & Sampling, awaiting approval.",
    );
    assert.equal(shown?.next.label, "Continue to Scope & Sampling");
    assert.deepEqual(scope?.pill.label, "Awaiting approval");
  });

  it("evidence back to review puts D&I first again, and a D&I sign-off drops the order line", () => {
    const shown = handoff({
      steps: steps({
        attributes: settled,
        designevidence: { tone: "attention", status: "2 items to review" },
        designassessment: { tone: "done", status: "Effective" },
        testdesign: { tone: "done", status: "Approved · 25 samples" },
      }),
      approved: five,
      requests: { mode: "hidden" },
    });
    const [design, scope] = shown?.cards ?? [];
    assert.equal(design?.primary, true);
    assert.equal(design?.action, "Review the evidence");
    assert.equal(scope?.order, "");
    assert.equal(scope?.action, "Open Scope & Sampling");
  });

  it("the step's own line, where its records word it, is said as given", () => {
    const shown = handoff({
      steps: steps({
        attributes: settled,
        designevidence: {
          tone: "active",
          status: "Requests accepted",
          note: "The requests are drafted when the planner finishes.",
        },
      }),
      approved: five,
      requests: { mode: "hidden" },
    });
    assert.equal(
      shown?.cards[0]?.text,
      "The requests are drafted when the planner finishes.",
    );
  });
});

// Product owner, 17 November 2026, on a screen saying "Drafted 2 requests" above "Not drafted
// yet": "Need you to make sure that things like this will never show up in my app." What the
// settled Attributes step says (its line, its gap, its one way on) is read against what the
// D&I step says at the same time, for each mix, and must agree with it.
describe("the handoff never contradicts the D&I step", () => {
  const settledList = (): RequestsView => {
    const view = listed([row("r1", ["A", "B", "C"]), row("r2", ["D", "E"])], {
      accept: 0,
    });
    return view.mode === "list"
      ? {
          ...view,
          settled: true,
          header: { tone: "idle", status: "Requests accepted", line: "" },
        }
      : view;
  };
  const mixes: Record<
    string,
    { requests: RequestsView; design: Shape; scope: Shape }
  > = {
    "the planner planning the requests": {
      requests: listed([], { working: true }),
      design: { tone: "active", status: "Being planned" },
      scope: { tone: "active", status: "Plan being drafted", agent: true },
    },
    "the planner updating the requests": {
      requests: listed([row("r1", ["A"])], { working: true }),
      design: { tone: "active", status: "Being updated" },
      scope: { tone: "idle", status: "Not started" },
    },
    "an accepted list at rest": {
      requests: settledList(),
      design: { tone: "idle", status: "Requests accepted" },
      scope: { tone: "idle", status: "Not started" },
    },
    "no request yet": {
      requests: ((view: RequestsView): RequestsView =>
        view.mode === "list"
          ? {
              ...view,
              header: {
                tone: "attention",
                status: "No requests yet",
                line: "",
              },
              // As the list builds it: no gap line while the list is empty, every chip
              // still unaddressed (design-requests-model.requestsView).
              uncovered: [],
            }
          : view)(listed([], { uncovered: 5 })),
      design: { tone: "attention", status: "No requests yet" },
      scope: { tone: "idle", status: "Not started" },
    },
  };
  for (const [name, mix] of Object.entries(mixes)) {
    const shown = handoff({
      steps: steps({
        attributes: settled,
        designevidence: mix.design,
        testdesign: mix.scope,
      }),
      approved: five,
      requests: mix.requests,
    });
    it(`says "drafted" only where the D&I step does: ${name}`, () => {
      assert.ok(shown !== null);
      // The D&I side of the handoff; the OE card names its plan ("Plan being drafted").
      const design = shown.cards.find((card) => card.key === "designevidence");
      const said = [shown.line, shown.gap, design?.pill.label ?? ""].map(
        (text) => text.replace(/Scope & Sampling, plan being drafted/i, ""),
      );
      if (said.some((text) => /drafted/i.test(text))) {
        assert.match(mix.design.status, /drafted/i, said.join(" | "));
      }
      assert.equal(design?.pill.label, mix.design.status);
    });
    it(`never sends the person on to a step that asks nothing: ${name}`, () => {
      assert.ok(shown !== null);
      if (name === "an accepted list at rest") {
        assert.equal(shown.next.key, "testdesign");
        assert.doesNotMatch(shown.line, /Next: D&I Evidence/);
      }
    });
    it(`never calls coverage complete while an attribute is unaddressed: ${name}`, () => {
      assert.ok(shown !== null);
      const design = shown.cards.find((card) => card.key === "designevidence");
      const open =
        mix.requests.mode === "list"
          ? mix.requests.coverage.filter((chip) => chip.state === "UNCOVERED")
          : [];
      if (
        mix.requests.mode === "list" &&
        open.length > 0 &&
        !mix.requests.working
      ) {
        assert.equal(design?.coverage?.complete, false);
        assert.match(shown.gap, /not addressed by a D&I request/);
        assert.doesNotMatch(shown.gap, /^Attributes? {2}/);
        if (name === "no request yet") {
          assert.match(
            shown.gap,
            /^Attributes A, B, C, D and E are not addressed/,
          );
        }
      }
    });
  }
});
