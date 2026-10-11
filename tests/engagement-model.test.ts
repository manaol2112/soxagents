import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  byApplication,
  byArea,
  type ControlRow,
  detailTab,
  EMPTY_ENGAGEMENT,
  engagementNoticeFor,
  engagementWrite,
  filterControls,
  inQueue,
  parseControls,
  parseDashboard,
  parseDeficiencies,
  parsePlan,
  timelineMonths,
  timelinePercent,
} from "../apps/web/src/engagement-model.ts";

const ids = {
  organization_id: "11111111-1111-7111-8111-111111111111",
  project_id: "22222222-2222-7222-8222-222222222222",
};
const deficiency = "33333333-3333-7333-8333-333333333333";
const control = "44444444-4444-7444-8444-444444444444";
const base = `/organizations/${ids.organization_id}/projects/${ids.project_id}`;

describe("engagement workspace model", () => {
  it("parses the plan, the register, the deficiencies, and the dashboard", () => {
    const plan = parsePlan({
      started: true,
      kickoff: "2026-10-11",
      period_end: "2027-12-31",
      schedule_missing: false,
      phases: [
        {
          key: "INTERIM_TESTING",
          name: "Interim testing",
          planned_start: "2027-08-16",
          planned_end: "2027-11-14",
          version: 2,
          tasks: 32,
          done: 4,
          overdue: 1,
          status: "AT_RISK",
        },
      ],
      milestones: [
        {
          key: "PERIOD_END",
          name: "Period end",
          phase_key: "ROLLFORWARD",
          due_date: "2027-12-31",
          completed_at: null,
          version: 1,
          status: "UPCOMING",
        },
      ],
      tasks: [{ id: "t1", title: "Test", status: "READY", waiting_on: 2 }],
    });
    assert.equal(plan?.phases[0]?.status, "AT_RISK");
    assert.equal(plan?.milestones[0]?.dueDate, "2027-12-31");
    assert.equal(plan?.tasks[0]?.waitingOn, 2);
    assert.equal(parsePlan({ started: true }), null);
    const rows = parseControls([
      {
        id: control,
        control_ref: "AC-01",
        category: "it",
        stage: "PLANNED",
        included: true,
        stages: { walkthrough: "READY", evidence: "DRAFTED" },
        systems: ["SAP ERP"],
        conclusion: "WHATEVER",
      },
    ]);
    assert.equal(rows?.[0]?.stages.test, "NONE");
    assert.equal(rows?.[0]?.conclusion, "NOT_CONCLUDED");
    const findings = parseDeficiencies([
      {
        id: deficiency,
        reference: "D-001",
        severity: "CONTROL_DEFICIENCY",
        pending_change: {
          kind: "SEVERITY",
          severity: "MATERIAL_WEAKNESS",
          reason: "x",
        },
        can_decide: true,
      },
    ]);
    assert.equal(findings?.[0]?.pending?.severity, "MATERIAL_WEAKNESS");
    assert.equal(findings?.[0]?.canDecide, true);
    const dashboard = parseDashboard({
      started: true,
      controls: { in_scope: 16, by_category: { it: { PLANNED: 16 } } },
      deficiencies: { by_severity: { MATERIAL_WEAKNESS: 1 } },
    });
    assert.equal(dashboard?.controls.byCategory.it?.PLANNED, 16);
    assert.equal(dashboard?.deficiencies.bySeverity.MATERIAL_WEAKNESS, 1);
    assert.equal(dashboard?.evidence.total, 0);
  });

  it("builds each write and refuses bad input", () => {
    assert.deepEqual(
      engagementWrite({
        ...ids,
        intent: "phase",
        phase_key: "WALKTHROUGHS",
        version: "2",
        planned_start: "2026-10-18",
        planned_end: "2026-12-01",
      }),
      {
        intent: "phase",
        section: "plan",
        method: "PATCH",
        path: `${base}/workspace/phases/WALKTHROUGHS`,
        body: {
          version: 2,
          planned_start: "2026-10-18",
          planned_end: "2026-12-01",
        },
      },
    );
    const milestone = engagementWrite({
      ...ids,
      intent: "milestone",
      section: "timeline",
      milestone_key: "KICKOFF",
      version: "1",
      due_date: "2026-10-11",
      completed: "on",
    });
    assert.ok(!("error" in milestone));
    assert.equal(milestone.section, "timeline");
    assert.deepEqual(milestone.body, {
      version: 1,
      due_date: "2026-10-11",
      completed: true,
    });
    const logged = engagementWrite({
      ...ids,
      intent: "deficiency-create",
      title: " Approval missing ",
      control_id: control,
      deficiency_type: "OPERATING",
      likelihood: "PROBABLE",
      magnitude: "MATERIAL",
      severity: "MATERIAL_WEAKNESS",
      remediation_due: "",
    });
    assert.ok(!("error" in logged));
    assert.equal(logged.body.title, "Approval missing");
    assert.equal(logged.body.remediation_due, null);
    assert.equal(logged.body.control_id, control);
    const decide = engagementWrite({
      ...ids,
      intent: "deficiency-decide",
      deficiency_id: deficiency,
      version: "3",
      decision: "approve",
      reason: "Agreed",
    });
    assert.ok(!("error" in decide));
    assert.deepEqual(decide.body, {
      version: 3,
      approve: true,
      reason: "Agreed",
    });
    const retest = engagementWrite({
      ...ids,
      intent: "deficiency-progress",
      deficiency_id: deficiency,
      version: "3",
      retest_result: "PASSED",
    });
    assert.ok(!("error" in retest));
    assert.deepEqual(retest.body, { version: 3, retest_result: "PASSED" });
    for (const bad of [
      {
        ...ids,
        intent: "phase",
        phase_key: "NOPE",
        version: "1",
        planned_start: "2026-01-01",
        planned_end: "2026-02-01",
      },
      {
        ...ids,
        intent: "phase",
        phase_key: "PLANNING",
        version: "1",
        planned_start: "2026-03-01",
        planned_end: "2026-02-01",
      },
      {
        ...ids,
        intent: "deficiency-create",
        title: "x",
        deficiency_type: "BOTH",
        likelihood: "PROBABLE",
        magnitude: "MATERIAL",
        severity: "MATERIAL_WEAKNESS",
      },
      {
        ...ids,
        intent: "deficiency-create",
        title: "x",
        deficiency_type: "DESIGN",
        likelihood: "PROBABLE",
        magnitude: "MATERIAL",
        severity: "MATERIAL_WEAKNESS",
        condition: "password = Hunter2024",
      },
      {
        ...ids,
        intent: "deficiency-change",
        deficiency_id: deficiency,
        version: "1",
        kind: "SEVERITY",
        severity: "HUGE",
        reason: "x",
      },
      {
        ...ids,
        intent: "deficiency-change",
        deficiency_id: deficiency,
        version: "1",
        kind: "CLOSE",
        reason: "",
      },
      {
        ...ids,
        intent: "deficiency-progress",
        deficiency_id: deficiency,
        version: "1",
        status: "CLOSED",
      },
      {
        ...ids,
        intent: "deficiency-progress",
        deficiency_id: deficiency,
        version: "1",
        status: "OPEN",
        retest_result: "PASSED",
      },
      {
        ...ids,
        intent: "deficiency-decide",
        deficiency_id: "../x",
        version: "1",
        decision: "approve",
      },
      {
        organization_id: "x",
        project_id: ids.project_id,
        intent: "create-schedule",
      },
    ]) {
      assert.deepEqual(engagementWrite(bad), { error: "invalid" });
    }
  });

  it("maps results to notices", () => {
    assert.equal(engagementNoticeFor("deficiency-create", 200), "logged");
    assert.equal(engagementNoticeFor("deficiency-change", 200), "requested");
    assert.equal(engagementNoticeFor("phase", 200), "saved");
    assert.equal(engagementNoticeFor("phase", 409), "changed");
    assert.equal(engagementNoticeFor("deficiency-decide", 403), "denied");
    assert.equal(engagementNoticeFor("phase", 0), "unavailable");
  });

  it("filters the register by type, stage, and text", () => {
    const row = (overrides: Partial<ControlRow>): ControlRow => ({
      ...(parseControls([{ id: "x" }])?.[0] as ControlRow),
      ...overrides,
    });
    const rows = [
      row({
        id: "a",
        controlRef: "AC-01",
        category: "it",
        stage: "PLANNED",
        systems: ["SAP ERP"],
      }),
      row({
        id: "b",
        controlRef: "OTC-01",
        category: "business",
        stage: "TESTING",
        ownerName: "Dana",
      }),
    ];
    const filters = { ...EMPTY_ENGAGEMENT.filters };
    assert.deepEqual(
      filterControls(rows, { ...filters, category: "it" }).map((r) => r.id),
      ["a"],
    );
    assert.deepEqual(
      filterControls(rows, { ...filters, stage: "TESTING" }).map((r) => r.id),
      ["b"],
    );
    assert.deepEqual(
      filterControls(rows, { ...filters, query: "sap" }).map((r) => r.id),
      ["a"],
    );
    assert.deepEqual(
      filterControls(rows, { ...filters, query: "dana" }).map((r) => r.id),
      ["b"],
    );
  });

  it("places dates on the timeline", () => {
    assert.equal(timelinePercent("2027-01-01", "2027-01-01", "2027-12-31"), 0);
    assert.equal(
      timelinePercent("2028-06-01", "2027-01-01", "2027-12-31"),
      100,
    );
    assert.ok(
      Math.abs(timelinePercent("2027-07-02", "2027-01-01", "2027-12-31") - 50) <
        0.5,
    );
    const months = timelineMonths("2026-10-11", "2027-03-01");
    assert.deepEqual(
      months.map((m) => m.label),
      ["Nov", "Dec", "Jan", "Feb"],
    );
    assert.deepEqual(
      months.map((m) => m.year),
      [null, null, "2027", null],
    );
  });
  it("reads each control's next step and sorts it into work queues", () => {
    const rows = parseControls([
      {
        id: "a",
        control_ref: "AC-01",
        area: "Logical access",
        included: true,
        next_step: "Approve the samples",
        waiting_on: "TEAM",
        test_status: "PROPOSED",
        test_attributes: ["A request exists"],
        requests: [
          {
            id: "r1",
            kind: "SAMPLES",
            title: "Sample evidence",
            status: "DRAFT",
            due_at: "2027-01-01",
          },
          {
            id: "r2",
            kind: "WHATEVER",
            title: "x",
            status: "SENT",
            due_at: "2027-01-01",
          },
        ],
      },
      {
        id: "b",
        control_ref: "CM-01",
        area: "Change management",
        included: true,
        next_step: "Chase the overdue evidence request",
        waiting_on: "OWNER",
        overdue: true,
        deficiencies: 1,
      },
      {
        id: "c",
        control_ref: "AC-02",
        area: "Logical access",
        waiting_on: "NOBODY",
      },
    ]);
    assert.ok(rows !== null);
    const [first, second, third] = rows as [ControlRow, ControlRow, ControlRow];
    assert.equal(first.requests[1]?.kind, "EVIDENCE");
    assert.deepEqual(first.testAttributes, ["A request exists"]);
    assert.equal(third.waitingOn, "NONE");
    assert.equal(inQueue(first, "team"), true);
    assert.equal(inQueue(second, "owner"), true);
    assert.equal(inQueue(second, "overdue"), true);
    assert.equal(inQueue(second, "findings"), true);
    assert.equal(inQueue(first, "concluded"), false);
    assert.equal(inQueue(first, null), true);
    assert.deepEqual(
      byArea(rows).map((group) => [
        group.area,
        group.controls.map((c) => c.id),
      ]),
      [
        ["Logical access", ["a", "c"]],
        ["Change management", ["b"]],
      ],
    );
    assert.equal(detailTab(first, null), "testing");
    assert.equal(detailTab(second, null), "overview");
    assert.equal(detailTab(second, "findings"), "findings");
    assert.equal(detailTab(second, "nonsense"), "overview");
    const filters = { ...EMPTY_ENGAGEMENT.filters, queue: "team" as const };
    assert.deepEqual(
      filterControls(rows, filters).map((c) => c.id),
      ["a"],
    );
  });
  it("groups by application, listing a shared control under each", () => {
    const rows = parseControls([
      {
        id: "a",
        control_ref: "AC-01",
        systems: ["SAP ERP", "Active Directory"],
      },
      { id: "b", control_ref: "AC-02", systems: ["SAP ERP"] },
      { id: "c", control_ref: "EL-01", systems: [] },
    ]);
    assert.ok(rows !== null);
    assert.deepEqual(
      byApplication(rows).map((group) => [
        group.area,
        group.controls.map((control) => control.id),
      ]),
      [
        ["Active Directory", ["a"]],
        ["SAP ERP", ["a", "b"]],
        ["No application", ["c"]],
      ],
    );
    assert.equal(EMPTY_ENGAGEMENT.filters.group, "area");
  });
});
