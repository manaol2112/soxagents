import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  cardStatus,
  controlIcon,
  counts,
  DEFAULT_PAGE_VIEW,
  filterRows,
  groupProgress,
  groupRows,
  initials,
  NO_FILTERS,
  type PageRow,
  pageOf,
  planOf,
  readPageView,
  type ScopeFacts,
  stepStates,
  testingOf,
  tiles,
  toCsv,
  toPageRow,
  typeOf,
  type WorkFacts,
} from "../apps/web/src/controls-page-model.ts";

// The Controls page (decided by the product owner on 26 October 2026, from the reference
// given): the controls selected for each system and process, where each plan and test
// stands, filtered, grouped, paged and exported in the page.

const scope = (over: Partial<ScopeFacts> = {}): ScopeFacts => ({
  id: "c1",
  controlRef: "ITGC-AC-01",
  title: "User access provisioning",
  activity: "Access is approved before it is granted.",
  domain: "ACCESS",
  domainLabel: "",
  frequency: "RECURRING",
  keyControl: true,
  included: true,
  applicationId: "s1",
  applicationName: "SAP ERP",
  processId: null,
  frequencyLabel: "",
  ownerName: "",
  source: "LIBRARY",
  ...over,
});

const work = (over: Partial<WorkFacts> = {}): WorkFacts => ({
  progress: "PLAN_TO_APPROVE",
  evidencePlan: "PROPOSED",
  sheetStatus: null,
  testingRunning: false,
  exceptions: false,
  overdue: false,
  evidenceRequests: 0,
  evidenceReceived: 0,
  conclusion: "NOT_CONCLUDED",
  reviewStatus: null,
  assignees: [],
  journey: null,
  ...over,
});

const row = (over: Partial<PageRow> = {}): PageRow => ({
  ...toPageRow(scope(), work(), ""),
  ...over,
});

describe("controls page statuses", () => {
  it("reads the type from the control's area", () => {
    assert.equal(typeOf("ACCESS"), "ITGC");
    assert.equal(typeOf("CHANGE"), "ITGC");
    assert.equal(typeOf("ITAC"), "ITAC");
    assert.equal(typeOf("IPE"), "IPE");
    assert.equal(typeOf("REVENUE"), "BUSINESS");
  });

  it("reads the plan status from the evidence plan and the stage", () => {
    assert.equal(
      planOf({ evidencePlan: "PROPOSED", progress: "TO_REQUEST" }),
      "PENDING",
    );
    assert.equal(planOf({ progress: "PLAN_TO_APPROVE" }), "PENDING");
    assert.equal(
      planOf({ evidencePlan: "PLANNED", progress: "TO_REQUEST" }),
      "APPROVED",
    );
    assert.equal(
      planOf({ evidencePlan: "NONE", progress: "TO_REQUEST" }),
      "DRAFT",
    );
  });

  it("reads the testing status, exceptions first", () => {
    const base = {
      exceptions: false,
      sheetStatus: null,
      testingRunning: false,
    };
    assert.equal(testingOf({ ...base, progress: "TO_REQUEST" }), "NOT_STARTED");
    assert.equal(
      testingOf({ ...base, progress: "AGENT_TESTING" }),
      "IN_PROGRESS",
    );
    assert.equal(
      testingOf({
        ...base,
        sheetStatus: "OPEN",
        progress: "READY_FOR_TESTING",
      }),
      "IN_PROGRESS",
    );
    assert.equal(testingOf({ ...base, progress: "CONCLUDED" }), "COMPLETED");
    assert.equal(
      testingOf({
        ...base,
        exceptions: true,
        sheetStatus: "SIGNED_OFF",
        progress: "CONCLUDED",
      }),
      "EXCEPTIONS",
    );
  });

  it("marks the steps before the current one done and the current one now", () => {
    assert.deepEqual(stepStates("TEST"), {
      PLAN: "done",
      REQUEST: "done",
      TEST: "now",
      CONCLUDE: "todo",
      REVIEW: "todo",
    });
    assert.equal(stepStates("DONE").REVIEW, "done");
    assert.equal(stepStates("PLAN").PLAN, "now");
  });

  it("builds a row from the scope and the work, the journey's step first", () => {
    const built = toPageRow(scope(), work(), "");
    assert.equal(built.plan, "PENDING");
    assert.equal(built.testing, "NOT_STARTED");
    assert.equal(built.step, "PLAN");
    assert.equal(built.phaseLabels.PLAN, "Test plan awaiting approval");
    assert.equal(built.phaseLabels.REQUEST, "No evidence requests yet");
    // The area's and the frequency's names come from their codes when left out.
    assert.equal(built.process, "Logical access");
    assert.equal(built.area, "Logical access");
    assert.equal(built.frequency, "Each transaction");
    assert.equal(built.processKey, "ACCESS");
    assert.equal(built.type, "ITGC");
    const later = toPageRow(
      scope({ processId: "p1", ownerName: "" }),
      work({
        progress: "AWAITING_EVIDENCE",
        evidencePlan: "PLANNED",
        evidenceRequests: 3,
        evidenceReceived: 1,
        assignees: ["Dana Reviewer"],
        journey: { step: "REQUEST" },
      }),
      "Order to cash",
    );
    assert.equal(later.step, "REQUEST");
    assert.equal(later.phaseLabels.REQUEST, "1 of 3 received");
    assert.equal(later.process, "Order to cash");
    assert.equal(later.processKey, "p1");
    assert.equal(later.owner, "Dana Reviewer");
  });

  it("starts a control with no work yet at the plan, as a draft", () => {
    const fresh = toPageRow(scope(), null, "");
    assert.equal(fresh.plan, "DRAFT");
    assert.equal(fresh.testing, "NOT_STARTED");
    assert.equal(fresh.step, "PLAN");
    assert.equal(fresh.attention, false);
  });

  it("flags exceptions and overdue work for attention", () => {
    assert.equal(
      toPageRow(scope(), work({ overdue: true }), "").attention,
      true,
    );
    assert.equal(
      toPageRow(scope(), work({ exceptions: true }), "").attention,
      true,
    );
  });
});

describe("controls page filters", () => {
  const rows = [
    row({ id: "a", ref: "AC-01", system: "SAP ERP", key: true }),
    row({
      id: "b",
      ref: "CM-01",
      system: "Workday",
      key: false,
      plan: "APPROVED",
    }),
    row({
      id: "c",
      ref: "BP-01",
      system: "",
      type: "BUSINESS",
      key: false,
      processKey: "p1",
    }),
    row({ id: "d", ref: "AC-02", system: "SAP ERP", included: false }),
  ];

  it("shows the controls in scope by default", () => {
    assert.deepEqual(
      filterRows(rows, NO_FILTERS).map((item) => item.id),
      ["a", "b", "c"],
    );
    assert.deepEqual(
      filterRows(rows, { ...NO_FILTERS, scope: ["OUT"] }).map(
        (item) => item.id,
      ),
      ["d"],
    );
    assert.equal(filterRows(rows, { ...NO_FILTERS, scope: [] }).length, 4);
  });

  it("combines the filters, key controls as a type", () => {
    assert.deepEqual(
      filterRows(rows, { ...NO_FILTERS, systems: ["SAP ERP"] }).map(
        (item) => item.id,
      ),
      ["a"],
    );
    assert.deepEqual(
      filterRows(rows, { ...NO_FILTERS, types: ["KEY"] }).map(
        (item) => item.id,
      ),
      ["a"],
    );
    assert.deepEqual(
      filterRows(rows, { ...NO_FILTERS, processes: ["p1"] }).map(
        (item) => item.id,
      ),
      ["c"],
    );
    assert.deepEqual(
      filterRows(rows, { ...NO_FILTERS, plan: ["APPROVED"] }).map(
        (item) => item.id,
      ),
      ["b"],
    );
    assert.deepEqual(
      filterRows(rows, { ...NO_FILTERS, query: "cm-01" }).map(
        (item) => item.id,
      ),
      ["b"],
    );
  });

  it("counts each value among the controls the scope filter keeps", () => {
    const tally = counts(rows, ["IN"]);
    assert.equal(tally.systems["SAP ERP"], 1);
    assert.equal(tally.types.KEY, 1);
    assert.equal(tally.types.ITGC, 2);
    assert.deepEqual(tally.scope, { IN: 3, OUT: 1 });
  });

  it("totals the tiles over the controls in scope", () => {
    assert.deepEqual(tiles(rows), {
      inScope: 3,
      outOfScope: 1,
      planToApprove: 2,
      testingInProgress: 0,
      testingComplete: 0,
      needsAttention: 0,
    });
  });
});

describe("controls page layout and export", () => {
  it("groups by system, a control with none under No system", () => {
    const groups = groupRows(
      [
        row({ system: "Workday" }),
        row({ system: "" }),
        row({ system: "SAP ERP" }),
      ],
      "system",
    );
    assert.deepEqual(
      groups.map((group) => group.label),
      ["No system", "SAP ERP", "Workday"],
    );
    assert.equal(groupRows([row()], "control")[0]?.label, "");
  });

  it("pages the rows, keeping the page in range", () => {
    const list = Array.from({ length: 60 }, (_, index) => index);
    assert.deepEqual(pageOf(list, 2, 50), {
      rows: list.slice(50),
      page: 2,
      pages: 2,
    });
    assert.equal(pageOf(list, 9, 50).page, 2);
    assert.equal(pageOf([], 1, 50).pages, 1);
  });

  it("exports the rows as CSV, quoting cells that need it", () => {
    const csv = toCsv([row({ title: 'Access, "approved"' })]);
    const [head, line] = csv.split("\n");
    assert.match(head ?? "", /^Control,Title,System,Process,Type,Key/);
    assert.match(line ?? "", /"Access, ""approved"""/);
    assert.match(line ?? "", /In scope,Plan to approve,Not started/);
  });

  it("makes initials from a name or an address", () => {
    assert.equal(initials("Dana Reviewer"), "DR");
    assert.equal(initials("ops.lead@example.com"), "OL");
    assert.equal(initials(""), "?");
  });
});

describe("the controls page view a browser remembers", () => {
  it("opens by system until the person chooses otherwise", () => {
    assert.deepEqual(DEFAULT_PAGE_VIEW, {
      by: "system",
      layout: "table",
      size: 50,
    });
    assert.deepEqual(readPageView(null), DEFAULT_PAGE_VIEW);
  });

  it("keeps the person's choice", () => {
    assert.deepEqual(
      readPageView(
        JSON.stringify({ by: "process", layout: "cards", size: 100 }),
      ),
      { by: "process", layout: "cards", size: 100 },
    );
    assert.deepEqual(readPageView(JSON.stringify({ by: "control" })), {
      ...DEFAULT_PAGE_VIEW,
      by: "control",
    });
  });

  it("falls back to the default for anything it does not recognize", () => {
    assert.deepEqual(readPageView("not json"), DEFAULT_PAGE_VIEW);
    assert.deepEqual(readPageView("[]"), DEFAULT_PAGE_VIEW);
    assert.deepEqual(
      readPageView(JSON.stringify({ by: "owner", layout: "grid", size: 7 })),
      DEFAULT_PAGE_VIEW,
    );
  });
});

describe("the card view (product owner, 2 November 2026, card reference)", () => {
  it("shows what a control needs next in its one status pill", () => {
    assert.equal(cardStatus(row({ plan: "PENDING" })).label, "Plan to approve");
    assert.equal(cardStatus(row({ plan: "DRAFT" })).label, "Plan in draft");
    assert.equal(
      cardStatus(row({ plan: "APPROVED", testing: "NOT_STARTED" })).label,
      "In scope",
    );
    assert.equal(
      cardStatus(row({ plan: "APPROVED", testing: "EXCEPTIONS" })).tone,
      "is-danger",
    );
    assert.equal(cardStatus(row({ included: false })).label, "Out of scope");
  });

  it("picks the card's icon from what the control is about", () => {
    assert.equal(
      controlIcon(row({ title: "User Access Provisioning and Approval" })),
      "userPlus",
    );
    assert.equal(
      controlIcon(row({ title: "Timely Removal of Terminated User Access" })),
      "clock",
    );
    assert.equal(
      controlIcon(row({ title: "Authentication and Password Configuration" })),
      "shield",
    );
    assert.equal(
      controlIcon(row({ title: "Quarterly user access certification" })),
      "eye",
    );
    assert.equal(
      controlIcon(
        row({ title: "Three-way match blocks invoices outside tolerance" }),
      ),
      "file",
    );
    assert.equal(
      controlIcon(row({ title: "Something else", description: "" })),
      "layers",
    );
  });

  it("counts a group's approved plans among its in-scope controls", () => {
    assert.deepEqual(
      groupProgress([
        row({ id: "a", plan: "APPROVED" }),
        row({ id: "b", plan: "PENDING" }),
        row({ id: "c", plan: "APPROVED", included: false }),
      ]),
      { planned: 1, total: 2 },
    );
  });
});
