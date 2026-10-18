import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  draftedBatch,
  filterChips,
  groupHeadline,
  groupsStartOpen,
  nextStepLink,
  phaseLine,
  popoverCount,
  type RegisterView,
  registerHref,
  registerView,
  sortControls,
  stageCounts,
  stageText,
} from "../apps/web/src/controls-register-model.ts";
import {
  type ControlRow,
  EMPTY_ENGAGEMENT,
  type PhaseEvidence,
  parseControls,
} from "../apps/web/src/engagement-model.ts";

function row(overrides: Partial<ControlRow>): ControlRow {
  return {
    ...(parseControls([
      { id: "c1", control_ref: "ITGC-AC-01", included: true },
    ])?.[0] as ControlRow),
    ...overrides,
  };
}

const base = { organization: "org-1", project: "proj-1" };
const plain: RegisterView = registerView(EMPTY_ENGAGEMENT.filters);

describe("the controls register's view", () => {
  it("reads the view from the filters, grouped by application unless asked", () => {
    assert.deepEqual(plain, {
      q: "",
      category: null,
      queue: null,
      group: "application",
      sort: "control",
      app: [],
      area: [],
      owner: [],
      stage: [],
      key: false,
      layout: "applications",
    });
    assert.equal(
      registerView({ ...EMPTY_ENGAGEMENT.filters, group: "area" }).group,
      "area",
    );
  });

  it("keeps the whole view in the address, and changes only what is asked", () => {
    const view: RegisterView = {
      ...plain,
      q: " access ",
      queue: "team",
      app: ["SAP ERP", ""],
      stage: ["AWAITING_EVIDENCE"],
      key: true,
    };
    const href = registerHref(base, view);
    const params = new URL(href, "http://x").searchParams;
    assert.equal(params.get("section"), "controls");
    assert.equal(params.get("q"), "access");
    assert.equal(params.get("queue"), "team");
    assert.deepEqual(params.getAll("app"), ["SAP ERP", ""]);
    assert.deepEqual(params.getAll("stage"), ["AWAITING_EVIDENCE"]);
    assert.equal(params.get("key"), "1");
    assert.equal(params.get("group"), null);
    const changed = new URL(
      registerHref(base, view, { group: "area", queue: null }),
      "http://x",
    ).searchParams;
    assert.equal(changed.get("group"), "area");
    assert.equal(changed.get("queue"), null);
    // The rest of the view stays as it was.
    assert.deepEqual(changed.getAll("app"), ["SAP ERP", ""]);
    assert.equal(changed.get("q"), "access");
    // The order is in the address only when it is not the default.
    assert.equal(params.get("sort"), null);
    assert.equal(
      new URL(
        registerHref(base, view, { sort: "attention" }),
        "http://x",
      ).searchParams.get("sort"),
      "attention",
    );
  });

  it("shows each filter in force as a chip that removes only itself", () => {
    const view: RegisterView = {
      ...plain,
      q: "access",
      category: "it",
      app: ["SAP ERP", ""],
      stage: ["AWAITING_EVIDENCE"],
      owner: [""],
      key: true,
    };
    const chips = filterChips(view);
    assert.deepEqual(
      chips.map((chip) => chip.label),
      [
        "Search: access",
        "Type: IT controls",
        "Application: SAP ERP",
        "Application: Process and entity-level controls",
        "Status: Awaiting evidence",
        "Owner: PBC coordinator",
        "Key controls only",
      ],
    );
    const sap = chips.find((chip) => chip.id === "app-SAP ERP");
    assert.deepEqual(sap?.without, { app: [""] });
    // The view, the grouping, and the order are not filters, so they make no chip.
    assert.deepEqual(
      filterChips({ ...plain, queue: "team", group: "area", sort: "stage" }),
      [],
    );
    // The Filters button counts what it holds: not search, not application.
    assert.equal(popoverCount(view), 4);
    assert.equal(popoverCount(plain), 0);
  });
});

describe("the engagement's progress", () => {
  it("puts every control in one stage, so the stages add up to the total", () => {
    const controls = [
      row({ id: "a", progress: "TO_REQUEST", drafted: true }),
      row({ id: "b", progress: "AWAITING_EVIDENCE", overdue: true }),
      row({ id: "c", progress: "AGENT_TESTING" }),
      row({ id: "d", progress: "CONCLUDED", exceptions: true }),
      row({ id: "e", progress: "AWAITING_REVIEW", exceptions: true }),
    ];
    const counts = stageCounts(controls);
    assert.equal(counts.total, 5);
    assert.equal(
      counts.stages.reduce((sum, item) => sum + item.count, 0),
      counts.total,
    );
    assert.deepEqual(
      counts.stages.filter((item) => item.count > 0).map((item) => item.stage),
      [
        "TO_REQUEST",
        "AWAITING_EVIDENCE",
        "AGENT_TESTING",
        "AWAITING_REVIEW",
        "CONCLUDED",
      ],
    );
    // Exceptions sit beside the stages; a control with them is counted once above.
    assert.equal(counts.exceptions, 2);
  });

  it("says once how many drafted requests wait to be submitted", () => {
    const request = (id: string, status: string) => ({
      id,
      kind: "EVIDENCE" as const,
      title: "Population",
      status,
      dueAt: "",
      version: 1,
      phase: "INTERIM",
    });
    const batch = draftedBatch([
      row({
        id: "a",
        drafted: true,
        requests: [request("1", "DRAFT"), request("2", "DRAFT")],
      }),
      row({
        id: "b",
        drafted: true,
        requests: [request("3", "DRAFT"), request("4", "SENT")],
      }),
      row({ id: "c", drafted: false, requests: [request("5", "DRAFT")] }),
    ]);
    assert.deepEqual(batch, { controls: 2, requests: 3 });
  });
});

describe("a group of controls", () => {
  it("says how far it is and what needs the viewer", () => {
    const controls = [
      row({ id: "a", yours: true, progress: "RESULTS_TO_CONFIRM" }),
      row({ id: "b", overdue: true, progress: "AWAITING_EVIDENCE" }),
      row({ id: "c", progress: "CONCLUDED" }),
      row({
        id: "d",
        progress: "AWAITING_REVIEW",
        exceptions: true,
        yours: true,
      }),
      // A team step that is not the viewer's (another's review) is not counted.
      row({
        id: "e",
        progress: "REVIEW_NOTES",
        waitingOn: "TEAM",
        yours: false,
      }),
    ];
    assert.deepEqual(groupHeadline(controls), {
      total: 5,
      concluded: 1,
      // The overdue control is blocked until its evidence is chased.
      blocked: 1,
      needYou: 2,
      overdue: 1,
      inReview: 2,
      exceptions: 1,
    });
  });

  it("starts open when the view is narrowed or short, and as headlines otherwise", () => {
    assert.equal(groupsStartOpen(plain, 79, 4), false);
    assert.equal(groupsStartOpen({ ...plain, queue: "team" }, 74, 4), true);
    assert.equal(groupsStartOpen({ ...plain, q: "AC-01" }, 4, 4), true);
    assert.equal(
      groupsStartOpen({ ...plain, stage: ["AGENT_TESTING"] }, 30, 4),
      true,
    );
    assert.equal(groupsStartOpen(plain, 19, 1), true);
    assert.equal(groupsStartOpen(plain, 25, 3), true);
  });

  it("orders controls by ID, by stage, or with what needs attention first", () => {
    const controls = [
      row({ id: "a", controlRef: "ITGC-AC-10", progress: "CONCLUDED" }),
      row({
        id: "b",
        controlRef: "ITGC-AC-02",
        progress: "AGENT_TESTING",
        exceptions: true,
      }),
      row({
        id: "c",
        controlRef: "ITGC-AC-03",
        progress: "TO_REQUEST",
        overdue: true,
      }),
      row({
        id: "d",
        controlRef: "ITGC-AC-01",
        progress: "AWAITING_REVIEW",
        yours: true,
      }),
    ];
    const ids = (sort: "control" | "stage" | "attention") =>
      sortControls(controls, sort).map((control) => control.id);
    // By control ID the API's order is kept as it is.
    assert.deepEqual(ids("control"), ["a", "b", "c", "d"]);
    assert.deepEqual(ids("stage"), ["c", "b", "d", "a"]);
    assert.deepEqual(ids("attention"), ["d", "c", "b", "a"]);
  });
});

describe("a control's stage and next step", () => {
  it("says what exactly, and marks an agent's unconfirmed work", () => {
    assert.deepEqual(stageText(row({ progress: "AGENT_TESTING" })), {
      label: "Agent testing",
      detail: "In progress",
      ai: true,
    });
    assert.deepEqual(
      stageText(
        row({
          progress: "RESULTS_TO_CONFIRM",
          sheetStatus: "OPEN",
          sheetLeft: "DECIDE",
        }),
      ),
      {
        label: "Results to confirm",
        detail: "Agent results, not yet confirmed",
        ai: true,
      },
    );
    // Signed off by a person: no longer the agent's unconfirmed work.
    assert.equal(
      stageText(
        row({ progress: "RESULTS_TO_CONFIRM", sheetStatus: "SIGNED_OFF" }),
      ).ai,
      false,
    );
    assert.equal(
      stageText(
        row({
          progress: "READY_FOR_TESTING",
          sheetLeft: "TESTING",
          testingRunning: false,
        }),
      ).detail,
      "Testing stopped",
    );
    // A drafted request says "not sent" in the evidence column, not twice.
    const request = (status: string) => ({
      id: status,
      kind: "EVIDENCE" as const,
      title: "Population",
      status,
      dueAt: "",
      version: 1,
      phase: "INTERIM",
    });
    assert.equal(
      stageText(row({ progress: "TO_REQUEST", requests: [request("DRAFT")] }))
        .detail,
      "",
    );
    assert.equal(
      stageText(
        row({
          progress: "TO_REQUEST",
          requests: [request("APPROVAL_PENDING")],
        }),
      ).detail,
      "Awaiting approval to send",
    );
    assert.equal(
      stageText(row({ progress: "TO_REQUEST" })).detail,
      "Nothing requested",
    );
    assert.equal(
      stageText(row({ progress: "CONCLUDED", conclusion: "EXCEPTION" })).detail,
      "With exceptions",
    );
  });

  it("links only the viewer's own step, to where it is done", () => {
    assert.deepEqual(
      nextStepLink(
        row({ yours: true, actor: "PREPARER", testStatus: "PROPOSED" }),
      ),
      { section: "controls", tab: "testing" },
    );
    assert.deepEqual(
      nextStepLink(row({ yours: true, actor: "REVIEWER", reviewLeft: "SIGN" })),
      { section: "controls", tab: "review" },
    );
    // An approval is given on the Approvals page.
    assert.deepEqual(nextStepLink(row({ yours: true, actor: "APPROVER" })), {
      section: "approvals",
    });
    // Someone else's step, or a step waiting on the client, has no link.
    assert.equal(
      nextStepLink(
        row({ yours: false, actor: "REVIEWER", reviewLeft: "SIGN" }),
      ),
      null,
    );
    assert.equal(nextStepLink(row({ yours: false, actor: "CLIENT" })), null);
    // A concluded control has nothing left to do, whatever it says.
    assert.equal(
      nextStepLink(row({ yours: true, conclusion: "EFFECTIVE" })),
      null,
    );
  });

  it("states each phase's evidence in a few characters", () => {
    const phase = (overrides: Partial<PhaseEvidence>): PhaseEvidence => ({
      phase: "INTERIM",
      requests: 2,
      received: 0,
      drafted: 0,
      out: 2,
      late: 0,
      ...overrides,
    });
    assert.deepEqual(phaseLine(phase({ received: 2, out: 0 })), {
      label: "Interim",
      text: "received",
      tone: "done",
    });
    assert.deepEqual(phaseLine(phase({ out: 0, drafted: 2 })), {
      label: "Interim",
      text: "not sent",
      tone: "drafted",
    });
    assert.deepEqual(
      phaseLine(phase({ phase: "ROLLFORWARD", received: 1, out: 1, late: 1 })),
      { label: "Roll-forward", text: "1/2", tone: "late" },
    );
  });
});
