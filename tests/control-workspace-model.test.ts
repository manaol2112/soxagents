import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AssistantBrief } from "../apps/web/src/assistant-model.ts";
import type { ControlContext } from "../apps/web/src/control-context-model.ts";
import {
  type AgentLane,
  agentLanes,
  approachOf,
  attentionOf,
  figuresOf,
  filterActivity,
  type LifecycleStage,
  laneSummary,
  lifecycleOf,
  makeupText,
  parseActivity,
  type WorkspaceInput,
  workpaperMakeup,
} from "../apps/web/src/control-workspace-model.ts";
import {
  type ControlFiles,
  type ControlRequest,
  type ControlRow,
  parseControls,
} from "../apps/web/src/engagement-model.ts";
import {
  PHASE_STATE_SHORT,
  parsePlan,
} from "../apps/web/src/evidence-plan-model.ts";
import { evidenceSummary } from "../apps/web/src/evidence-workspace-model.ts";
import type {
  ControlReview,
  ReviewNote,
} from "../apps/web/src/review-model.ts";
import type { TestSheet } from "../apps/web/src/sheet-model.ts";
import type { ControlTest } from "../apps/web/src/testing-model.ts";
import type {
  Workpaper,
  WorkpaperSection,
} from "../apps/web/src/workpaper-model.ts";

function row(overrides: Partial<ControlRow>): ControlRow {
  return {
    ...(parseControls([
      { id: "c1", control_ref: "ITGC-AC-01", included: true },
    ])?.[0] as ControlRow),
    ...overrides,
  };
}

const request = (
  status: string,
  phase: string | null = "INTERIM",
): ControlRequest => ({
  id: `${status}-${phase}`,
  kind: "EVIDENCE",
  title: "Population",
  status,
  dueAt: "2026-10-20T00:00:00Z",
  version: 1,
  phase,
});

function sheet(overrides: Partial<TestSheet>): TestSheet {
  return {
    id: "s1",
    controlId: "c1",
    controlRef: "ITGC-AC-01",
    method: "SAMPLE",
    attributes: ["A", "B"],
    status: "OPEN",
    running: false,
    runState: "IDLE",
    proposedConclusion: "INCOMPLETE",
    conclusion: null,
    signedBy: null,
    signedAt: null,
    signoffNote: "",
    items: [],
    placements: [],
    counts: {
      items: 3,
      tested: 3,
      noEvidence: 0,
      exceptions: 0,
      unable: 0,
      review: 0,
      unplaced: 0,
    },
    blocking: [],
    proposal: null,
    proposalStatus: "NONE",
    proposalReason: "",
    deficiencyReference: null,
    version: 1,
    testRoundId: null,
    roundKind: null,
    waitingNote: "",
    ...overrides,
  };
}

function input(overrides: Partial<WorkspaceInput>): WorkspaceInput {
  return {
    control: row({}),
    plan: null,
    context: null,
    test: null,
    sheet: null,
    review: null,
    rounds: [],
    workpapers: [],
    tasks: [
      {
        id: "t1",
        title: "Test",
        status: "READY",
        phaseKey: null,
        kind: "test",
        controlId: "c1",
        controlRef: "ITGC-AC-01",
        agent: "Access tester",
        assignee: null,
        deadline: null,
        waitingOn: 0,
      },
    ],
    files: null,
    findings: [],
    ...overrides,
  };
}

const stageOf = (stages: LifecycleStage[], key: LifecycleStage["key"]) =>
  stages.find((stage) => stage.key === key);

describe("the control's lifecycle", () => {
  it("starts with nothing done for a new control", () => {
    const stages = lifecycleOf(input({}));
    assert.deepEqual(
      stages.map((stage) => [stage.key, stage.status]),
      [
        ["design", "not_started"],
        ["evidence", "not_started"],
        ["interim", "not_started"],
        ["rollforward", "not_started"],
        ["review", "not_started"],
        ["conclusion", "not_started"],
      ],
    );
    assert.equal(stageOf(stages, "evidence")?.note, "Not planned");
  });

  it("follows the evidence: drafted, awaiting approval, out, partly in, in", () => {
    const evidence = (requests: ControlRequest[], overdue = false) =>
      stageOf(
        lifecycleOf(input({ control: row({ requests, overdue }) })),
        "evidence",
      );
    assert.deepEqual(evidence([request("DRAFT")]), {
      key: "evidence",
      label: "Evidence",
      tab: "evidence",
      status: "ready",
      note: "Drafted, not sent",
      agent: false,
    });
    assert.equal(
      evidence([request("APPROVAL_PENDING")])?.status,
      "awaiting_approval",
    );
    // Approved and not sent is the preparer's to send, not still awaiting approval.
    const approved = evidence([
      { ...request("APPROVAL_PENDING"), approvalDecision: "APPROVED" },
    ]);
    assert.deepEqual(
      [approved?.status, approved?.note],
      ["ready", "Approved, not sent"],
    );
    // A kickoff draft held for planning is not ready to submit.
    const held = stageOf(
      lifecycleOf(
        input({
          control: row({
            requests: [{ ...request("DRAFT"), kickoff: true }],
            evidencePlan: "NONE",
          }),
        }),
      ),
      "evidence",
    );
    assert.deepEqual(
      [held?.status, held?.note],
      ["blocked", "Drafted before planning"],
    );
    assert.equal(evidence([request("SENT")])?.status, "waiting_evidence");
    assert.equal(
      evidence([request("RECEIVED"), request("SENT", "DESIGN")])?.note,
      "1/2 in",
    );
    assert.equal(evidence([request("SENT")], true)?.note, "Overdue · 0/1 in");
    // Roll-forward requests belong to their rounds, not to this stage.
    assert.equal(
      evidence([request("RECEIVED"), request("SENT", "ROLLFORWARD")])?.status,
      "done",
    );
  });

  it("does not call evidence done just because files arrived", () => {
    const plan = parsePlan({
      control_id: "c1",
      status: "APPROVED",
      phases: [
        {
          phase: "INTERIM",
          applicability: "APPLICABLE",
          state: "RECEIVED_NOT_VALIDATED",
          requirements: [
            {
              id: "q1",
              phase: "INTERIM",
              title: "Every change in the window",
              categories: ["POPULATION"],
              necessity: "REQUIRED",
              state: "RECEIVED",
              version: 1,
            },
          ],
        },
      ],
    });
    const received = row({ requests: [request("RECEIVED")] });
    const stages = lifecycleOf(input({ control: received, plan }));
    assert.equal(stageOf(stages, "evidence")?.status, "awaiting_approval");
    // A requirement judged insufficient is a gap, and blocks.
    const gap = parsePlan({
      control_id: "c1",
      status: "APPROVED",
      phases: [
        {
          phase: "INTERIM",
          applicability: "APPLICABLE",
          state: "OUTSTANDING",
          requirements: [
            {
              id: "q1",
              phase: "INTERIM",
              title: "Every change in the window",
              categories: ["POPULATION"],
              necessity: "REQUIRED",
              state: "INSUFFICIENT",
              version: 1,
            },
          ],
        },
      ],
    });
    assert.deepEqual(
      [
        stageOf(
          lifecycleOf(input({ control: received, plan: gap })),
          "evidence",
        )?.status,
        figuresOf(
          input({ control: received, plan: gap }),
          lifecycleOf(input({ control: received, plan: gap })),
        ).evidence.gaps,
      ],
      ["blocked", 1],
    );
  });

  it("shows the agent testing only while its run is on, and a stopped run as blocked", () => {
    const running = lifecycleOf(
      input({
        sheet: sheet({ running: true }),
        control: row({ sheetStatus: "OPEN", sheetLeft: "TESTING" }),
      }),
    );
    assert.deepEqual(stageOf(running, "interim"), {
      key: "interim",
      label: "Interim",
      tab: "testing",
      status: "in_progress",
      note: "Agent testing",
      agent: true,
    });
    const stopped = lifecycleOf(
      input({
        sheet: sheet({ running: false }),
        control: row({ sheetStatus: "OPEN", sheetLeft: "TESTING" }),
      }),
    );
    assert.equal(stageOf(stopped, "interim")?.status, "blocked");
    assert.equal(stageOf(stopped, "interim")?.agent, false);
    const decide = lifecycleOf(
      input({
        sheet: sheet({}),
        control: row({ sheetStatus: "OPEN", sheetLeft: "SIGN_OFF" }),
      }),
    );
    assert.equal(stageOf(decide, "interim")?.status, "awaiting_approval");
    const signed = lifecycleOf(
      input({
        sheet: sheet({ status: "SIGNED_OFF", conclusion: "EFFECTIVE" }),
        control: row({ sheetStatus: "SIGNED_OFF" }),
      }),
    );
    assert.equal(stageOf(signed, "interim")?.status, "done");
    assert.equal(stageOf(signed, "review")?.status, "ready");
  });

  it("marks a phase the plan says does not apply, never as done", () => {
    const plan = parsePlan({
      control_id: "c1",
      status: "APPROVED",
      phases: [
        {
          phase: "ROLLFORWARD",
          applicability: "NOT_APPLICABLE",
          state: "NOT_APPLICABLE",
          requirements: [],
        },
        {
          phase: "DESIGN",
          applicability: "NOT_APPLICABLE",
          state: "NOT_APPLICABLE",
          requirements: [],
        },
      ],
    });
    const stages = lifecycleOf(input({ plan }));
    assert.equal(stageOf(stages, "rollforward")?.status, "not_applicable");
    assert.equal(stageOf(stages, "design")?.status, "not_applicable");
  });

  it("concludes only with a concluded control, and reads the review's turn", () => {
    const stages = (overrides: Partial<ControlRow>) =>
      lifecycleOf(input({ control: row(overrides) }));
    assert.equal(
      stageOf(
        stages({ reviewLeft: "SIGN", sheetStatus: "SIGNED_OFF" }),
        "review",
      )?.status,
      "awaiting_approval",
    );
    assert.equal(
      stageOf(stages({ reviewLeft: "REPERFORMING" }), "review")?.agent,
      true,
    );
    assert.equal(
      stageOf(stages({ reviewLeft: "ADDRESS" }), "review")?.note,
      "Notes to answer",
    );
    assert.equal(
      stageOf(stages({ conclusion: "NOT_CONCLUDED" }), "conclusion")?.status,
      "not_started",
    );
    assert.deepEqual(
      stageOf(stages({ conclusion: "EXCEPTION" }), "conclusion")?.note,
      "With exceptions",
    );
  });
});

function paper(overrides: Partial<Workpaper>): Workpaper {
  return {
    id: "w1",
    controlId: "c1",
    stage: "EFFECTIVENESS",
    status: "DRAFT",
    drafting: false,
    draftState: "IDLE",
    draftNote: "",
    currentVersion: 1,
    shownVersion: 1,
    reference: "ITGC-AC-01-TOE",
    title: "Testing",
    templateTitle: "Testing",
    purpose: "",
    kind: "ITGC",
    tabs: [],
    sections: [],
    versions: [],
    preparedBy: null,
    preparedAt: null,
    preparedVersion: null,
    version: 1,
    ...overrides,
  };
}

function section(
  key: string,
  source: WorkpaperSection["source"],
  text: string,
  cited = false,
): WorkpaperSection {
  return {
    key,
    title: key,
    kind: "text",
    guidance: "",
    fields: [],
    text,
    citations: cited
      ? [
          {
            fileId: "f1",
            fileName: "tickets.csv",
            quote: "T-1",
            found: true,
          } as unknown as WorkpaperSection["citations"][number],
        ]
      : [],
    columns: [],
    rows: [],
    source,
    tab: "interim",
    period: "",
  };
}

function note(overrides: Partial<ReviewNote>): ReviewNote {
  return {
    id: "n1",
    number: 1,
    targetKind: "GENERAL",
    itemId: null,
    indexes: [],
    workpaperId: null,
    reviewerResult: null,
    citations: [],
    text: "A note",
    severity: "SHOULD_FIX",
    status: "PROPOSED",
    raisedBy: "AGENT",
    raisedByName: null,
    raisedAt: "2026-10-01T00:00:00Z",
    decidedByName: null,
    decisionReason: "",
    response: "",
    respondedByName: null,
    respondedAt: null,
    clearedByName: null,
    clearedAt: null,
    clearReason: "",
    reopened: [],
    version: 1,
    ...overrides,
  };
}

function review(overrides: Partial<ControlReview>): ControlReview {
  return {
    id: "r1",
    controlId: "c1",
    controlRef: "ITGC-AC-01",
    label: "ITGC-AC-01",
    status: "OPEN",
    reperforming: false,
    reperformState: "IDLE",
    reperformedAt: "2026-10-02T00:00:00Z",
    reperformSource: "MODEL",
    reperformNote: "",
    sheetStatus: "SIGNED_OFF",
    sheetSignedBy: "Pat Preparer",
    sheetVersion: 2,
    sheetVersionReviewed: 2,
    workpapers: [],
    notes: [],
    counts: {},
    blocking: [],
    viewerIsReviewer: false,
    viewerPrepared: false,
    independenceRequired: true,
    signedBy: null,
    signedAt: null,
    signoffNote: "",
    version: 1,
    ...overrides,
  };
}

const laneOf = (lanes: AgentLane[], key: AgentLane["key"]) => {
  const found = lanes.find((lane) => lane.key === key);
  assert.ok(found, `no ${key} lane`);
  return found;
};

describe("the agents on a control", () => {
  it("keeps running, queued, and stopped apart, and runs only on a record's say", () => {
    const idle = laneOf(agentLanes(input({})), "tester");
    assert.deepEqual([idle.run, idle.runNote], ["idle", ""]);
    const queued = laneOf(
      agentLanes(
        input({ sheet: sheet({ running: true, runState: "QUEUED" }) }),
      ),
      "tester",
    );
    assert.deepEqual([queued.run, queued.runNote], ["queued", "Run queued"]);
    const running = laneOf(
      agentLanes(
        input({
          sheet: sheet({
            running: true,
            runState: "RUNNING",
            counts: { ...sheet({}).counts, items: 4 },
          }),
        }),
      ),
      "tester",
    );
    assert.deepEqual(
      [running.run, running.runNote],
      ["running", "Testing 4 items"],
    );
    const stopped = laneOf(
      agentLanes(
        input({
          sheet: sheet({
            counts: { ...sheet({}).counts, items: 4, tested: 1 },
          }),
          control: row({ sheetStatus: "OPEN", sheetLeft: "TESTING" }),
        }),
      ),
      "tester",
    );
    assert.deepEqual(
      [stopped.run, stopped.runNote],
      ["stopped", "Stopped with 3 items untested. A person runs it again."],
    );
    // The lifecycle says queued, not testing, until the tester picks it up.
    const stages = lifecycleOf(
      input({ sheet: sheet({ running: true, runState: "QUEUED" }) }),
    );
    assert.equal(stageOf(stages, "interim")?.note, "Queued for the tester");
  });

  it("shows agents working at once, each on its own job", () => {
    const lanes = agentLanes(
      input({
        control: row({ requests: [request("RECEIVED")] }),
        files: {
          files: [
            { readStatus: "WORKING" },
            { readStatus: "READY" },
          ] as ControlFiles["files"],
          applications: [],
          analyses: [],
          reviews: [],
        },
        workpapers: [
          paper({
            stage: "DESIGN",
            drafting: true,
            draftState: "QUEUED",
            currentVersion: 0,
          }),
        ],
      }),
    );
    assert.deepEqual(laneSummary(lanes), {
      running: 1,
      queued: 1,
      stopped: 0,
      decisions: 0,
    });
    assert.equal(laneOf(lanes, "reader").runNote, "Reading 1 file");
    assert.equal(laneOf(lanes, "reader").output, "Read 1 of 2 files");
    assert.equal(laneOf(lanes, "design").runNote, "Draft queued");
  });

  it("says what each agent waits for: a dependency, or a gate a person holds", () => {
    const fresh = agentLanes(input({}));
    assert.equal(
      laneOf(fresh, "reader").waitsFor,
      "Waits for evidence to be requested",
    );
    const readerWaits = (status: string) =>
      laneOf(
        agentLanes(input({ control: row({ requests: [request(status)] }) })),
        "reader",
      ).waitsFor;
    assert.equal(readerWaits("DRAFT"), "Waits for the requests to be sent");
    assert.equal(readerWaits("SENT"), "Waits for the owner's evidence");
    // Answered with nothing linked is not "waiting for a request".
    assert.equal(
      readerWaits("RECEIVED"),
      "Requests answered, but no file is linked to this control",
    );
    assert.equal(
      laneOf(fresh, "design").waitsFor,
      "Starts when the first evidence file is read",
    );
    assert.equal(laneOf(fresh, "tester").waitsFor, "Waits for evidence");
    assert.equal(
      laneOf(fresh, "effectiveness").waitsFor,
      "Starts when the tester has its first results",
    );
    assert.equal(
      laneOf(fresh, "reviewer").waitsFor,
      "Starts when the testing workpaper is prepared",
    );
    // Readiness holds the tester, with the blocker in words.
    const blocked = agentLanes(
      input({
        control: row({
          readinessState: "NEEDS_INFORMATION",
          readinessLabel: "Needs information",
          readinessBlocker: "Approve at least one attribute.",
        }),
        context: {
          readiness: {
            state: "NEEDS_INFORMATION",
            label: "Needs information",
            processRequired: false,
            checks: [],
          },
          proposed: [],
          approved: [],
          documents: [],
          understanding: { status: "NONE", builtBy: "RULES", steps: [] },
          processRequired: false,
          classifications: [],
        } as unknown as ControlContext,
      }),
    );
    assert.equal(
      laneOf(blocked, "tester").waitsFor,
      "Waits: needs information. Approve at least one attribute.",
    );
    // The population first; the tester's own waiting note when it has one.
    assert.equal(
      laneOf(
        agentLanes(input({ control: row({ populationPending: true }) })),
        "tester",
      ).waitsFor,
      "Waits for the population to be read",
    );
    assert.equal(
      laneOf(
        agentLanes(
          input({ sheet: sheet({ waitingNote: "Testing waits: conflict." }) }),
        ),
        "tester",
      ).waitsFor,
      "Testing waits: conflict.",
    );
  });

  it("keeps the agent's output apart from a person's decision on it", () => {
    const proposed = laneOf(agentLanes(input({ sheet: sheet({}) })), "tester");
    assert.equal(proposed.output, "Tested 3 of 3 items");
    assert.deepEqual(proposed.decision, {
      state: "pending",
      text: "Proposed results to confirm and sign off",
      owner: "Preparer",
    });
    const signed = laneOf(
      agentLanes(
        input({
          sheet: sheet({
            status: "SIGNED_OFF",
            conclusion: "EFFECTIVE",
            signedBy: "Pat Preparer",
          }),
        }),
      ),
      "tester",
    );
    assert.deepEqual(signed.decision, {
      state: "decided",
      text: "Signed off by Pat Preparer: effective",
      owner: "",
    });
    // Drafted requests wait for the preparer's batch; then the approver.
    const drafted = laneOf(
      agentLanes(input({ control: row({ requests: [request("DRAFT")] }) })),
      "requests",
    );
    assert.equal(drafted.decision.owner, "Preparer");
    const approval = laneOf(
      agentLanes(
        input({ control: row({ requests: [request("APPROVAL_PENDING")] }) }),
      ),
      "requests",
    );
    assert.deepEqual(
      [approval.decision.owner, approval.decision.state],
      ["Approver", "pending"],
    );
  });

  it("builds the testing workpaper from proposed results, prepared only after sign-off", () => {
    const building = paper({
      sections: [
        section("population", "AGENT", "Users were listed [^1].", true),
        section("procedures", "AGENT", "Each ticket was compared."),
        section("matrix", "RECORDS", "3 items"),
        section("scope", "PERSON", "Written by the preparer."),
        section("conclusion", "RECORDS", ""),
      ],
    });
    const lane = laneOf(
      agentLanes(input({ sheet: sheet({}), workpapers: [building] })),
      "effectiveness",
    );
    assert.equal(
      lane.output,
      "Version 1, from proposed results · 1 drafted with evidence cited · 1 drafted without a citation · 1 written by a person · 1 from the records · 1 not drafted yet",
    );
    assert.deepEqual(lane.decision, {
      state: "pending",
      text: "Prepared once the testing is signed off",
      owner: "Preparer",
    });
    // Its open review notes are unresolved judgments on it.
    const noted = workpaperMakeup(
      building,
      review({
        notes: [
          note({ workpaperId: "w1", status: "OPEN" }),
          note({ id: "n2", workpaperId: "w1", status: "CLEARED" }),
        ],
      }),
    );
    assert.equal(noted.openNotes, 1);
    assert.match(makeupText(noted), /1 review note open/);
    // A failed draft is stopped, with the agent's note.
    const failed = laneOf(
      agentLanes(
        input({
          workpapers: [
            paper({
              currentVersion: 0,
              draftNote: "The agent could not finish the draft. Draft again.",
            }),
          ],
        }),
      ),
      "effectiveness",
    );
    assert.deepEqual(
      [failed.run, failed.runNote],
      ["stopped", "The agent could not finish the draft. Draft again."],
    );
  });

  it("separates the reviewer agent's findings from the reviewer's decisions", () => {
    const lanes = agentLanes(
      input({
        review: review({
          notes: [
            note({ targetKind: "RESULT", reviewerResult: "EXCEPTION" }),
            note({ id: "n2", status: "PROPOSED" }),
          ],
        }),
      }),
    );
    const reviewer = laneOf(lanes, "reviewer");
    assert.equal(
      reviewer.output,
      "Re-performed the testing: 1 difference from the preparer's results · 2 notes proposed",
    );
    assert.deepEqual(reviewer.decision, {
      state: "pending",
      text: "2 proposed notes to accept or dismiss",
      owner: "Reviewer",
    });
    // The reviewer's own view says "You"; the preparer is told someone else signs off.
    const mine = laneOf(
      agentLanes(
        input({
          review: review({ notes: [note({})], viewerIsReviewer: true }),
        }),
      ),
      "reviewer",
    );
    assert.equal(mine.decision.owner, "You");
    const prepared = laneOf(
      agentLanes(
        input({
          review: review({
            notes: [note({ status: "OPEN" })],
            viewerPrepared: true,
          }),
        }),
      ),
      "reviewer",
    );
    assert.deepEqual(
      [prepared.decision.owner, prepared.decision.text, prepared.note],
      [
        "You",
        "1 note to answer",
        "You prepared this control, so another person signs off its review.",
      ],
    );
    const queued = laneOf(
      agentLanes(
        input({
          review: review({
            reperforming: true,
            reperformState: "QUEUED",
            reperformedAt: null,
          }),
        }),
      ),
      "reviewer",
    );
    assert.deepEqual([queued.run, queued.output], ["queued", ""]);
    // The API's own note for a re-performance that gave up (control_reviews.py).
    const stopped = laneOf(
      agentLanes(
        input({
          review: review({
            reperformNote:
              "The re-performance did not finish. Re-perform to try again.",
          }),
        }),
      ),
      "reviewer",
    );
    assert.equal(stopped.run, "stopped");
  });

  it("leaves out the agents of a phase the plan says does not apply", () => {
    const plan = parsePlan({
      control_id: "c1",
      status: "APPROVED",
      phases: [
        {
          phase: "DESIGN",
          applicability: "NOT_APPLICABLE",
          state: "NOT_APPLICABLE",
          requirements: [],
        },
      ],
    });
    const keys = agentLanes(input({ plan })).map((lane) => lane.key);
    assert.ok(!keys.includes("design"));
    assert.ok(keys.includes("tester"));
  });
});

describe("one story across the views", () => {
  it("tells drafted, unsent evidence the same way on the overview, the lanes, and the evidence tab", () => {
    const plan = parsePlan({
      control_id: "c1",
      status: "PROPOSED",
      phases: [
        {
          phase: "DESIGN",
          applicability: "APPLICABLE",
          state: "NOT_SENT",
          requirements: [
            {
              id: "q1",
              phase: "DESIGN",
              title: "How the control is performed",
              categories: ["PROCESS_DOCUMENTATION"],
              necessity: "REQUIRED",
              status: "REQUESTED",
              state: "READY_FOR_REVIEW",
              request_id: "DRAFT-DESIGN",
              version: 1,
            },
          ],
        },
      ],
    });
    const control = row({
      requests: [request("DRAFT", "DESIGN")],
      drafted: true,
    });
    const work = input({ control, plan });
    // The lifecycle: drafted, not sent; never "not planned" or "outstanding".
    assert.deepEqual(
      [
        stageOf(lifecycleOf(work), "evidence")?.status,
        stageOf(lifecycleOf(work), "evidence")?.note,
      ],
      ["ready", "Drafted, not sent"],
    );
    // The phase says the same in its own words.
    assert.equal(plan?.phases[0]?.state, "NOT_SENT");
    assert.equal(PHASE_STATE_SHORT.NOT_SENT, "Drafted, not sent");
    // The request drafter's output waits for the preparer's batch; the reader waits for it to go.
    const lanes = agentLanes(work);
    assert.deepEqual(laneOf(lanes, "requests").decision, {
      state: "pending",
      text: "1 request drafted, to review and approve",
      owner: "Preparer",
    });
    // A kickoff draft held for planning is not offered for submission.
    const held = agentLanes(
      input({
        control: row({
          requests: [{ ...request("DRAFT", "INTERIM"), kickoff: true }],
          evidencePlan: "NONE",
        }),
      }),
    );
    assert.match(
      laneOf(held, "requests").decision.text,
      /drafted before planning: plan the evidence/,
    );
    // A draft that waits on a proposed plan says so, not that planning is missing.
    const proposed = agentLanes(
      input({
        control: row({
          requests: [request("DRAFT", "DESIGN")],
          evidencePlan: "PROPOSED",
        }),
      }),
    );
    assert.equal(
      laneOf(proposed, "requests").decision.text,
      "1 request drafted, held until the evidence plan is approved",
    );
    assert.equal(
      laneOf(lanes, "reader").waitsFor,
      "Waits for the requests to be sent",
    );
    // The Evidence tab counts it as drafted and unsent, with nothing outstanding with the owner.
    const summary = evidenceSummary(plan, control.requests, null);
    assert.deepEqual(
      [
        summary.requests.drafted,
        summary.requests.out,
        summary.requirements.unsent,
        summary.requirements.withOwner,
      ],
      [1, 0, 1, 0],
    );
  });
});

describe("the testing approach", () => {
  const labels = {
    ITGC: "IT general control",
    AUTOMATED_APPLICATION: "Automated application control",
  };

  it("tests an automated control once, and a manual one by sample", () => {
    const automated = approachOf(
      input({
        control: row({ nature: "AUTOMATED", sampleSize: 1 }),
        context: {
          classifications: ["AUTOMATED_APPLICATION"],
          processRequired: false,
        } as unknown as ControlContext,
      }),
      labels,
    );
    assert.deepEqual(
      [automated.kind, automated.method],
      ["Automated application control", "Tested once (automated)"],
    );
    const configured = approachOf(
      input({ sheet: sheet({ method: "TEST_OF_ONE" }) }),
      labels,
    );
    assert.equal(configured.method, "Tested once (as configured)");
    const planned = approachOf(
      input({ control: row({ sampleSize: 25 }) }),
      labels,
    );
    assert.equal(planned.method, "Sample of 25, planned");
    const drawn = approachOf(
      input({
        test: {
          status: "APPROVED",
          sampleSize: 25,
          samples: new Array(25).fill({}),
        } as unknown as ControlTest,
      }),
      labels,
    );
    assert.equal(drawn.method, "Sample of 25");
    assert.equal(automated.conflict, "");
  });

  it("flags an automated application control the RCM records as manual", () => {
    const classified = {
      classifications: ["AUTOMATED_APPLICATION"],
      processRequired: false,
    } as unknown as ControlContext;
    const approach = approachOf(
      input({
        control: row({
          nature: "MANUAL",
          natureLabel: "Manual",
          sampleSize: 5,
        }),
        context: classified,
      }),
      labels,
    );
    assert.equal(approach.method, "Sample of 5, planned");
    assert.match(approach.conflict, /RCM records it as manual/);
    // Once it is tested once, the records agree.
    assert.equal(
      approachOf(
        input({
          control: row({ nature: "MANUAL" }),
          context: classified,
          sheet: sheet({ method: "TEST_OF_ONE" }),
        }),
        labels,
      ).conflict,
      "",
    );
  });

  it("takes each phase from the evidence plan, with its reason", () => {
    const plan = parsePlan({
      control_id: "c1",
      status: "APPROVED",
      phases: [
        {
          phase: "DESIGN",
          applicability: "APPLICABLE",
          rationale: "A new control this year.",
          state: "OUTSTANDING",
          requirements: [],
        },
        {
          phase: "ROLLFORWARD",
          applicability: "CONDITIONAL",
          condition: "Only if interim testing ends before the last quarter.",
          state: "NOT_PLANNED",
          requirements: [],
        },
      ],
    });
    const approach = approachOf(input({ plan }), labels);
    assert.deepEqual(
      approach.phases.map((item) => [item.phase, item.applies, item.reason]),
      [
        ["DESIGN", "yes", "A new control this year."],
        ["INTERIM", "unplanned", ""],
        [
          "ROLLFORWARD",
          "conditional",
          "Only if interim testing ends before the last quarter.",
        ],
      ],
    );
  });
});

describe("what needs a person", () => {
  const brief: AssistantBrief = {
    agent: "Access tester",
    headline: "",
    done: [],
    actions: [
      {
        key: "a",
        title: "Decide 2 results",
        detail: "",
        tab: "testing",
        anchor: "x",
        quick: null,
        urgent: false,
      },
      {
        key: "b",
        title: "Confirm the process",
        detail: "",
        tab: "design",
        anchor: "y",
        quick: null,
        urgent: true,
      },
    ],
    waiting: ["The owner has 1 request"],
    signature: "",
  };

  it("puts what blocks first, then the rest, then what waits on others", () => {
    const items = attentionOf(
      brief,
      row({ yours: false, nextStep: "Sign off the review", actor: "REVIEWER" }),
      "Reviewer",
    );
    assert.deepEqual(
      items.map((item) => [item.kind, item.title, item.owner]),
      [
        ["blocker", "Confirm the process", "You"],
        ["action", "Decide 2 results", "You"],
        ["waiting", "Sign off the review", "Reviewer"],
        ["waiting", "The owner has 1 request", "Pending"],
      ],
    );
  });

  it("does not list the viewer's own step, or a drafted request, as waiting", () => {
    const quiet = { ...brief, actions: [], waiting: [] };
    assert.deepEqual(attentionOf(quiet, row({ yours: true }), ""), []);
    assert.deepEqual(
      attentionOf(quiet, row({ drafted: true }), "Preparer"),
      [],
    );
  });
});

describe("the control's figures", () => {
  it("counts evidence received and accepted, and potential exceptions apart from findings", () => {
    const control = row({
      requests: [request("RECEIVED"), request("SENT"), request("CANCELLED")],
    });
    const open = sheet({
      counts: { ...sheet({}).counts, exceptions: 2 },
    });
    const work = input({ control, sheet: open });
    const figures = figuresOf(work, lifecycleOf(work));
    assert.deepEqual(figures.evidence, {
      received: 1,
      total: 2,
      accepted: 0,
      gaps: 0,
    });
    assert.deepEqual(figures.findings, { open: 0, potential: 2 });
    assert.equal(figures.testing.detail, "3 of 3 items tested · 2 exceptions");
  });
});

describe("the activity", () => {
  it("reads the API's events and filters them by who and what", () => {
    const items = parseActivity([
      {
        id: "1",
        at: "2026-10-17T05:51:38Z",
        by: "agent",
        actor: "Access tester",
        category: "testing",
        action: "testing.items_tested",
        title: "Items tested",
        detail: "3 items",
      },
      {
        id: "2",
        at: "2026-10-17T05:50:00Z",
        by: "person",
        actor: "Dana",
        category: "evidence",
        action: "evidence.uploaded",
        title: "Evidence uploaded",
        detail: "",
      },
      {
        id: "3",
        at: "2026-10-17T05:49:00Z",
        by: "robot",
        actor: "",
        category: "mystery",
        action: "x",
        title: "X",
        detail: "",
      },
      { at: "2026-10-17T05:49:00Z" },
    ]);
    assert.ok(items !== null);
    assert.equal(items.length, 3);
    // Anything unknown falls back to the plainest reading.
    assert.deepEqual(
      [items[2]?.by, items[2]?.category],
      ["workspace", "workflow"],
    );
    assert.deepEqual(
      filterActivity(items, "agent", "all").map((i) => i.id),
      ["1"],
    );
    assert.deepEqual(
      filterActivity(items, "all", "evidence").map((i) => i.id),
      ["2"],
    );
    assert.equal(parseActivity("nope"), null);
  });
});

describe("a control whose test plan waits for approval", () => {
  function waiting(state: string): ControlContext {
    return {
      readiness: {
        state,
        label:
          state === "PLAN_NOT_APPROVED"
            ? "Test plan awaiting approval"
            : "Needs information",
        processRequired: false,
        checks: [],
      },
      proposed: [],
      approved: [],
      documents: [],
      understanding: { status: "NONE", builtBy: "RULES", steps: [] },
      processRequired: false,
      classifications: [],
    } as unknown as ControlContext;
  }

  it("shows the wait as a step of the work, not as a fault", () => {
    const stages = lifecycleOf(
      input({ context: waiting("PLAN_NOT_APPROVED") }),
    );
    const design = stages.find((stage) => stage.key === "design");
    assert.equal(design?.status, "awaiting_approval");
    assert.equal(design?.note, "Test plan awaiting approval");
    // Missing information is still a blocker.
    const held = lifecycleOf(input({ context: waiting("NEEDS_INFORMATION") }));
    assert.equal(
      held.find((stage) => stage.key === "design")?.status,
      "blocked",
    );
  });
});
