import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { groupHeadline } from "../apps/web/src/controls-register-model.ts";
import {
  byApplication,
  byArea,
  type ControlRow,
  detailTab,
  EMPTY_ENGAGEMENT,
  engagementNoticeFor,
  engagementWrite,
  filterControls,
  filterOptions,
  hasDraftInput,
  inQueue,
  instanceLabel,
  lifecycle,
  openPhases,
  type Phase,
  parseControls,
  parseDashboard,
  parseDeficiencies,
  parsePlan,
  phaseOf,
  recordAction,
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

  it("lets the agent draft only from read evidence or signed-off testing", () => {
    const files = {
      files: [],
      applications: [],
      reviews: [],
      analyses: [],
    };
    const analysis = (status: "PENDING" | "READY", fileId: string) =>
      ({ status, fileId }) as unknown as (typeof files.analyses)[number];
    const mine = [{ id: "f1" }] as unknown as typeof files.files;
    assert.equal(hasDraftInput({ sheetStatus: null }, null), false);
    assert.equal(hasDraftInput({ sheetStatus: "OPEN" }, files), false);
    assert.equal(
      hasDraftInput(
        { sheetStatus: null },
        { ...files, files: mine, analyses: [analysis("PENDING", "f1")] },
      ),
      false,
    );
    // Another control's read file is not this control's evidence.
    assert.equal(
      hasDraftInput(
        { sheetStatus: null },
        { ...files, files: mine, analyses: [analysis("READY", "f2")] },
      ),
      false,
    );
    assert.equal(
      hasDraftInput(
        { sheetStatus: null },
        {
          ...files,
          files: mine,
          analyses: [analysis("PENDING", "f2"), analysis("READY", "f1")],
        },
      ),
      true,
    );
    assert.equal(hasDraftInput({ sheetStatus: "SIGNED_OFF" }, null), true);
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
        progress: "AGENT_TESTING",
        ownerName: "Dana",
      }),
    ];
    const filters = { ...EMPTY_ENGAGEMENT.filters };
    assert.deepEqual(
      filterControls(rows, { ...filters, category: "it" }).map((r) => r.id),
      ["a"],
    );
    assert.deepEqual(
      // The status filter is the stage the API works out for each control.
      filterControls(rows, { ...filters, stage: ["AGENT_TESTING"] }).map(
        (r) => r.id,
      ),
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
    // Application, area, owner, and key control narrow the register too; "" means
    // no application or the PBC coordinator.
    const more = [
      row({
        id: "c",
        applicationName: "SAP ERP",
        area: "Logical access",
        keyControl: true,
        ownerName: "Dana",
      }),
      row({
        id: "d",
        applicationName: "",
        area: "Entity level",
        keyControl: false,
        ownerName: "",
        ownerEmail: "",
      }),
      row({
        id: "e",
        applicationName: "Workday",
        area: "Logical access",
        keyControl: true,
        ownerName: "",
        ownerEmail: "lee@client.example",
      }),
    ];
    const ids = (overrides: Partial<typeof filters>) =>
      filterControls(more, { ...filters, ...overrides }).map((r) => r.id);
    assert.deepEqual(ids({ application: ["SAP ERP"] }), ["c"]);
    assert.deepEqual(ids({ application: [""] }), ["d"]);
    // Several values of one filter widen it; different filters narrow together.
    assert.deepEqual(ids({ application: ["SAP ERP", ""] }), ["c", "d"]);
    assert.deepEqual(ids({ area: ["Logical access"] }), ["c", "e"]);
    assert.deepEqual(ids({ owner: [""] }), ["d"]);
    assert.deepEqual(ids({ owner: ["lee@client.example"] }), ["e"]);
    assert.deepEqual(ids({ keyOnly: true, application: ["Workday"] }), ["e"]);
    // Search finds a control by its application and its owner's email too.
    assert.deepEqual(ids({ query: "workday" }), ["e"]);
    assert.deepEqual(ids({ query: "lee@client" }), ["e"]);
    assert.deepEqual(
      ids({ area: ["Logical access"], application: ["SAP ERP", "Workday"] }),
      ["c", "e"],
    );
    assert.deepEqual(filterOptions(more), {
      applications: ["SAP ERP", "Workday", ""],
      areas: ["Logical access", "Entity level"],
      owners: ["Dana", "lee@client.example", ""],
    });
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
        actor: "PREPARER",
        yours: true,
        progress: "EVIDENCE_RECEIVED",
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
        exceptions: true,
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
    assert.equal(first.actor, "PREPARER");
    assert.equal(first.progress, "EVIDENCE_RECEIVED");
    // Anything unknown from the API falls back to the plainest value.
    assert.deepEqual(
      [third.actor, third.progress, third.yours],
      ["NONE", "TO_REQUEST", false],
    );
    assert.equal(inQueue(first, "team"), true);
    // A team step the API says is not the viewer's is not in their queue.
    assert.equal(inQueue({ ...first, yours: false }, "team"), false);
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
    // The record opens on the control's phase; links from before the phases still land.
    // A control opens on its overview, whatever phase it is in.
    assert.equal(detailTab(first, null), "overview");
    assert.equal(phaseOf(first), "testing");
    assert.equal(detailTab(second, null), "overview");
    // The tabs are by function now; links from the phase tabs land on Testing.
    assert.equal(detailTab(second, "findings"), "findings");
    assert.equal(detailTab(second, "testing"), "testing");
    assert.equal(detailTab(second, "evidence"), "evidence");
    assert.equal(detailTab(second, "activity"), "activity");
    assert.equal(detailTab(second, "interim"), "testing");
    assert.equal(detailTab(second, "rollforward"), "testing");
    assert.equal(detailTab(second, "workpapers"), "testing");
    assert.equal(detailTab(second, "nonsense"), "overview");
    const filters = { ...EMPTY_ENGAGEMENT.filters, queue: "team" as const };
    assert.deepEqual(
      filterControls(rows, filters).map((c) => c.id),
      ["a"],
    );
  });
  it("groups the instances by application, with the areas inside", () => {
    // A control over two systems is two instances with the same ID (Milestone 8.5).
    const rows = parseControls([
      {
        id: "a",
        control_ref: "AC-01",
        area: "Logical access",
        application_id: "app-sap",
        application_name: "SAP ERP",
        label: "AC-01 · SAP ERP",
        systems: ["SAP ERP"],
      },
      {
        id: "a2",
        control_ref: "AC-01",
        area: "Logical access",
        application_name: "Active Directory",
        systems: ["Active Directory"],
      },
      {
        id: "b",
        control_ref: "CM-01",
        area: "Change management",
        application_name: "SAP ERP",
        systems: ["SAP ERP"],
      },
      { id: "c", control_ref: "EL-01", area: "Entity level", systems: [] },
    ]);
    assert.ok(rows !== null);
    assert.equal(rows[0]?.label, "AC-01 · SAP ERP");
    assert.equal(rows[0]?.applicationId, "app-sap");
    assert.equal(rows[1]?.label, "AC-01");
    assert.deepEqual(
      byApplication(rows).map((group) => [
        group.area,
        group.areas.map((area) => [
          area.area,
          area.controls.map((control) => control.id),
        ]),
      ]),
      [
        ["Active Directory", [["Logical access", ["a2"]]]],
        [
          "SAP ERP",
          [
            ["Logical access", ["a"]],
            ["Change management", ["b"]],
          ],
        ],
        ["Process and entity-level controls", [["Entity level", ["c"]]]],
      ],
    );
    assert.deepEqual(
      byArea(rows).map((group) => group.controls.map((c) => c.id)),
      [["a", "a2"], ["b"], ["c"]],
    );
    assert.equal(EMPTY_ENGAGEMENT.filters.group, "application");
    assert.equal(instanceLabel("AC-01", "Oracle"), "AC-01 · Oracle");
    assert.equal(instanceLabel("AC-01", ""), "AC-01");
    assert.equal(instanceLabel(null, "Oracle"), null);
  });
  it("queues controls under independent review and reads the review progress", () => {
    const rows = parseControls([
      {
        id: "a",
        control_ref: "AC-01",
        review_status: "OPEN",
        review_left: "DECIDE",
        progress: "AWAITING_REVIEW",
      },
      {
        id: "b",
        control_ref: "AC-02",
        review_status: "OPEN",
        review_left: "REPERFORMING",
        progress: "AWAITING_REVIEW",
      },
      {
        id: "c",
        control_ref: "AC-03",
        review_status: "SIGNED_OFF",
        review_left: "SIGNED",
        progress: "CONCLUDED",
      },
      { id: "d", control_ref: "AC-04", review_left: "nonsense" },
    ]);
    assert.ok(rows !== null);
    assert.deepEqual(
      rows.map((row) => [row.reviewStatus, row.reviewLeft]),
      [
        ["OPEN", "DECIDE"],
        ["OPEN", "REPERFORMING"],
        ["SIGNED_OFF", "SIGNED"],
        [null, null],
      ],
    );
    // In review is the two review stages, so its count matches the progress summary:
    // the reviewer's turn (a re-performing reviewer agent included) or notes to answer.
    assert.deepEqual(
      rows.filter((row) => inQueue(row, "review")).map((row) => row.id),
      ["a", "b"],
    );
    const dashboard = parseDashboard({
      controls: {},
      review: {
        in_scope: 16,
        signed_off: 3,
        to_decide: 2,
        open_notes: 5,
        complete: false,
      },
    });
    assert.deepEqual(dashboard?.review, {
      inScope: 16,
      notStarted: 0,
      reperforming: 0,
      toDecide: 2,
      toAddress: 0,
      toClear: 0,
      toSign: 0,
      signedOff: 3,
      openNotes: 5,
      complete: false,
    });
  });
});

describe("the redesigned register and record", () => {
  it("derives the lifecycle, the record's main action, and group summaries", () => {
    const rows = parseControls([
      {
        id: "a",
        control_ref: "AC-01",
        included: true,
        conclusion: "NOT_CONCLUDED",
        waiting_on: "TEAM",
        yours: true,
        progress: "AWAITING_EVIDENCE",
        stages: {
          walkthrough: "NONE",
          evidence: "REQUESTED",
          test: "NONE",
          review: "NONE",
        },
      },
      {
        id: "b",
        control_ref: "AC-05",
        included: true,
        waiting_on: "TEAM",
        yours: true,
        progress: "AWAITING_REVIEW",
        exceptions: true,
        sheet_status: "SIGNED_OFF",
        review_status: "OPEN",
        review_left: "DECIDE",
        stages: {
          walkthrough: "SUCCEEDED",
          evidence: "RECEIVED",
          test: "SUCCEEDED",
        },
        deficiencies: 1,
      },
      {
        id: "c",
        control_ref: "AC-06",
        included: true,
        test_status: "PROPOSED",
        waiting_on: "TEAM",
        yours: true,
        progress: "EVIDENCE_RECEIVED",
        stages: {},
      },
      {
        id: "d",
        control_ref: "AC-07",
        included: true,
        sheet_status: "SIGNED_OFF",
        stages: {},
      },
      {
        id: "e",
        control_ref: "AC-08",
        included: true,
        sheet_status: "OPEN",
        sheet_left: "DECIDE",
        stages: {},
      },
      {
        id: "f",
        control_ref: "AC-09",
        included: true,
        conclusion: "EFFECTIVE",
        progress: "CONCLUDED",
        stages: {},
      },
    ]);
    assert.ok(rows !== null);
    const [first, second, third, fourth, fifth, sixth] = rows;
    assert.ok(first && second && third && fourth && fifth && sixth);
    assert.deepEqual(
      lifecycle(first).map((step) => step.state),
      ["todo", "active", "todo", "todo", "todo"],
    );
    assert.deepEqual(
      lifecycle(second).map((step) => step.state),
      ["done", "done", "done", "active", "todo"],
    );
    assert.equal(lifecycle(sixth)[4]?.state, "done");
    assert.deepEqual(recordAction(first), {
      label: "Open evidence requests",
      tab: "evidence",
    });
    assert.deepEqual(recordAction(second), {
      label: "Open the review",
      tab: "review",
    });
    assert.deepEqual(recordAction(third), {
      label: "Review samples",
      tab: "testing",
    });
    assert.deepEqual(recordAction(fourth), {
      label: "Prepare the workpaper",
      tab: "testing",
    });
    assert.deepEqual(recordAction(fifth), {
      label: "Open the test sheet",
      tab: "testing",
    });
    assert.equal(recordAction(sixth), null);
    assert.deepEqual(groupHeadline(rows), {
      total: 6,
      concluded: 1,
      blocked: 0,
      needYou: 3,
      overdue: 0,
      inReview: 1,
      exceptions: 1,
    });
  });
});

describe("the project plan opens on the current work", () => {
  const phase = (key: string, status: Phase["status"], overdue = 0): Phase => ({
    key,
    name: key,
    plannedStart: "2027-01-01",
    plannedEnd: "2027-02-01",
    version: 1,
    tasks: 3,
    done: 0,
    overdue,
    status,
  });

  it("opens the phases under way, and any with overdue work", () => {
    const open = openPhases([
      phase("PLANNING", "DONE"),
      phase("DESIGN", "NOT_STARTED", 2),
      phase("EVIDENCE", "IN_PROGRESS"),
      phase("INTERIM", "AT_RISK"),
      phase("ROLLFORWARD", "NOT_STARTED"),
    ]);
    assert.deepEqual([...open].sort(), ["DESIGN", "EVIDENCE", "INTERIM"]);
  });

  it("opens the next phase to start when nothing is under way", () => {
    const open = openPhases([
      phase("PLANNING", "DONE"),
      phase("DESIGN", "NOT_STARTED"),
      phase("INTERIM", "NOT_STARTED"),
    ]);
    assert.deepEqual([...open], ["DESIGN"]);
  });

  it("opens nothing when every phase is done", () => {
    assert.equal(openPhases([phase("PLANNING", "DONE")]).size, 0);
  });
});
