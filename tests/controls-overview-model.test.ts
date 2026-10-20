import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { appKind } from "../apps/web/src/app-kind.ts";
import {
  batchWrite,
  outcomeLine,
  parseSubmitResult,
} from "../apps/web/src/controls-batch-model.ts";
import {
  actionCenterFromQueue,
  agentSummary,
  agentText,
  countLine,
  evidenceText,
  nextDue,
  portfolio,
  registerHref,
  registerView,
  rowState,
  sortControls,
  tableColumns,
} from "../apps/web/src/controls-register-model.ts";
import {
  type ControlRequest,
  type ControlRow,
  EMPTY_ENGAGEMENT,
  filterControls,
  overallState,
  parseControls,
} from "../apps/web/src/engagement-model.ts";
import type { QueueItem } from "../apps/web/src/queue-model.ts";

function row(id: string, overrides: Partial<ControlRow> = {}): ControlRow {
  return {
    ...(parseControls([
      { id, control_ref: `ITGC-${id}`, included: true },
    ])?.[0] as ControlRow),
    ...overrides,
  };
}

const request = (
  id: string,
  status: string,
  dueAt = "2027-02-01T00:00:00Z",
): ControlRequest => ({
  id,
  kind: "EVIDENCE",
  title: "Population",
  status,
  dueAt,
  phase: "INTERIM",
  version: 3,
});

const idle = {
  reading: 0,
  readFailed: 0,
  testing: "IDLE" as const,
  drafting: "IDLE" as const,
  reviewing: "IDLE" as const,
  stopped: [],
};

const register = [
  row("01", { progress: "CONCLUDED", conclusion: "EFFECTIVE" }),
  row("02", {
    progress: "TO_REQUEST",
    drafted: true,
    requests: [request("r1", "DRAFT"), request("r2", "DRAFT")],
  }),
  row("03", {
    progress: "AWAITING_EVIDENCE",
    overdue: true,
    requests: [request("r3", "OVERDUE", "2027-01-05T00:00:00Z")],
  }),
  row("04", {
    progress: "AGENT_TESTING",
    testingRunning: true,
    agents: { ...idle, testing: "RUNNING" },
  }),
  row("05", {
    progress: "RESULTS_TO_CONFIRM",
    sheetStatus: "OPEN",
    yours: true,
    actor: "PREPARER",
  }),
  row("06", {
    progress: "READY_FOR_TESTING",
    readinessState: "NEEDS_INFORMATION",
    readinessLabel: "Needs information",
  }),
  row("07", {
    progress: "AWAITING_REVIEW",
    agents: { ...idle, stopped: ["reviewing"] },
  }),
  row("08", {
    progress: "TO_REQUEST",
    yours: true,
    actor: "APPROVER",
    requests: [request("r4", "APPROVAL_PENDING")],
  }),
];

describe("the overview's progress", () => {
  it("puts every control in one of four states that add up to the total", () => {
    const summary = portfolio(register);
    assert.deepEqual(
      summary.states.map((item) => [item.state, item.count]),
      [
        ["completed", 1],
        ["in_progress", 2],
        ["blocked", 3],
        ["not_started", 2],
      ],
    );
    assert.equal(
      summary.states.reduce((sum, item) => sum + item.count, 0),
      summary.total,
    );
    assert.equal(summary.needsYou, 2);
    // What blocks: missing information, an overdue request, a stopped agent.
    assert.deepEqual(
      register.filter((c) => overallState(c) === "blocked").map((c) => c.id),
      ["03", "06", "07"],
    );
  });

  it("opens each state as a view that shows exactly its controls", () => {
    for (const [queue, state] of [
      ["blocked", "blocked"],
      ["progress", "in_progress"],
      ["notstarted", "not_started"],
      ["concluded", "completed"],
    ] as const) {
      const shown = filterControls(register, {
        ...EMPTY_ENGAGEMENT.filters,
        queue,
      });
      assert.deepEqual(
        shown.map((c) => c.id),
        register.filter((c) => overallState(c) === state).map((c) => c.id),
        queue,
      );
    }
  });

  it("says what is shown of what is in scope, and why fewer", () => {
    const view = { ...registerView(EMPTY_ENGAGEMENT.filters), category: "it" };
    assert.equal(
      countLine(48, 80, view),
      "48 of 80 controls in scope · Type: IT controls",
    );
    assert.equal(
      countLine(80, 80, registerView(EMPTY_ENGAGEMENT.filters)),
      "80 controls in scope",
    );
    assert.equal(
      countLine(3, 80, {
        ...registerView(EMPTY_ENGAGEMENT.filters),
        queue: "blocked",
      }),
      "3 of 80 controls in scope · Blocked",
    );
  });
});

describe("the action center", () => {
  const item = (over: Partial<QueueItem> = {}): QueueItem => ({
    id: "samples:t1",
    kind: "samples",
    obligation: "SAMPLES_APPROVAL",
    source: { type: "control_test", id: "t1" },
    stage: "TESTING",
    controlId: register[0]?.id ?? "a",
    controlRef: "ITGC-AC-01",
    phase: "INTERIM",
    roundId: null,
    roundKind: null,
    title: "Approve the samples",
    reason: "",
    owner: { role: "PREPARER", names: [] },
    authorized: true,
    ready: true,
    blockers: [],
    blocks: false,
    bucket: "MINE",
    link: { section: "controls", query: {} },
    at: null,
    ...over,
  });

  it("says a batch of drafted requests once, with what to submit, only for who may", () => {
    const drafted = register.flatMap((control) =>
      control.requests
        .filter((request) => request.status === "DRAFT")
        .map((request) =>
          item({
            id: `request-draft:${request.id}`,
            kind: "request-draft",
            source: { type: "pbc_request", id: request.id },
            controlId: control.id,
          }),
        ),
    );
    const items = actionCenterFromQueue(drafted, register, true);
    const batch = items.find((entry) => entry.key === "drafted");
    assert.ok(batch);
    assert.equal(
      batch.title,
      "Submit 2 drafted evidence requests for approval",
    );
    assert.deepEqual(batch.batch, [
      { requestId: "r1", version: 3 },
      { requestId: "r2", version: 3 },
    ]);
    assert.equal(
      actionCenterFromQueue(drafted, register, false).some(
        (entry) => entry.key === "drafted",
      ),
      false,
    );
  });

  it("lists only the viewer's items on the controls shown, one line per kind", () => {
    const items = actionCenterFromQueue(
      [
        item(),
        item({ id: "samples:t2", source: { type: "control_test", id: "t2" } }),
        item({ id: "approval:a1", kind: "approval" }),
        item({
          id: "review:r1",
          kind: "review",
          bucket: "WAITING",
          authorized: false,
        }),
        item({ id: "samples:t9", controlId: "not-shown" }),
      ],
      register,
      true,
    );
    assert.deepEqual(
      items.map((entry) => [entry.key, entry.count]),
      [
        ["approval", 1],
        ["samples", 2],
      ],
    );
    assert.deepEqual(items[0]?.to, { kind: "approvals" });
    assert.deepEqual(items[1]?.to, { kind: "queue", filter: "bucket:MINE" });
    assert.deepEqual(actionCenterFromQueue([], register, true), []);
  });
});

describe("the agents", () => {
  it("counts only what the run records show", () => {
    const summary = agentSummary(register);
    assert.equal(summary.running, 1);
    assert.equal(summary.testing, 1);
    assert.equal(summary.awaitingConfirmation, 1);
    assert.equal(summary.waitingEvidence, 1);
    assert.equal(summary.stopped, 1);
    assert.equal(summary.queued, 0);
    // A queued run is queued, not running.
    const queued = agentSummary([
      row("q", { agents: { ...idle, drafting: "QUEUED" } }),
    ]);
    assert.deepEqual([queued.running, queued.queued], [0, 1]);
  });

  it("names an agent on a row only when one is at work or stopped", () => {
    assert.equal(agentText(register[3] as ControlRow), "Testing");
    assert.equal(agentText(register[6] as ControlRow), "Stopped");
    assert.equal(agentText(register[0] as ControlRow), "");
    assert.equal(
      agentText(row("r", { agents: { ...idle, reading: 2 } })),
      "Reading files",
    );
  });
});

describe("a row", () => {
  it("says its state once: a drafted request is not also 'not sent'", () => {
    assert.deepEqual(rowState(register[1] as ControlRow), {
      label: "Request drafted",
      tone: "plain",
      detail: "",
    });
    assert.equal(
      rowState(register[7] as ControlRow).label,
      "Awaiting approval",
    );
    assert.deepEqual(rowState(register[5] as ControlRow), {
      label: "Ready for testing",
      tone: "blocked",
      detail: "Needs information",
    });
    assert.equal(rowState(register[3] as ControlRow).tone, "active");
    assert.equal(rowState(register[0] as ControlRow).tone, "done");
  });

  it("gives its evidence and next due date from its requests", () => {
    assert.equal(evidenceText(row("e")), "None requested");
    assert.equal(nextDue(register[2] as ControlRow), "2027-01-05T00:00:00Z");
    assert.equal(nextDue(register[1] as ControlRow), null);
  });

  it("sorts by owner, application, and the next due date", () => {
    const rows = [
      row("a", { ownerName: "Zoe", applicationName: "SAP" }),
      row("b", { ownerName: "Ann", applicationName: "Okta" }),
    ];
    assert.deepEqual(
      sortControls(rows, "owner").map((c) => c.id),
      ["b", "a"],
    );
    assert.deepEqual(
      sortControls(rows, "application").map((c) => c.id),
      ["b", "a"],
    );
    assert.deepEqual(
      sortControls(
        [register[1] as ControlRow, register[2] as ControlRow],
        "due",
      ).map((c) => c.id),
      ["03", "02"],
    );
  });
});

describe("the table", () => {
  it("keeps a person's columns, and falls back to the standard ones", () => {
    assert.deepEqual(tableColumns(null), [
      "application",
      "owner",
      "status",
      "evidence",
      "agent",
      "next",
    ]);
    assert.deepEqual(tableColumns("due,owner,unknown"), ["owner", "due"]);
    assert.deepEqual(tableColumns("nothing"), tableColumns(null));
  });

  it("is the same rows as the application view, in the address", () => {
    const view = { ...registerView(EMPTY_ENGAGEMENT.filters), queue: "team" };
    const href = registerHref({ organization: "o", project: "p" }, view, {
      layout: "table",
    });
    assert.match(href, /layout=table/);
    assert.match(href, /queue=team/);
    assert.doesNotMatch(
      registerHref({ organization: "o", project: "p" }, view),
      /layout=/,
    );
  });
});

describe("the application identity", () => {
  it("draws a neutral icon from the system record, never a letter", () => {
    assert.deepEqual(appKind("APPLICATION", "SAAS"), {
      icon: "cloud",
      label: "SaaS application",
    });
    assert.deepEqual(appKind("DATABASE", "ON_PREMISES"), {
      icon: "database",
      label: "On premises database",
    });
    assert.deepEqual(appKind(null, null), {
      icon: "window",
      label: "application",
    });
    assert.deepEqual(appKind("SOMETHING_NEW", null), {
      icon: "window",
      label: "application",
    });
  });
});

describe("the batch actions", () => {
  const ORG = "11111111-1111-4111-8111-111111111111";
  const PROJECT = "22222222-2222-4222-8222-222222222222";
  const REQ = "33333333-3333-4333-8333-333333333333";
  const ids = { organization_id: ORG, project_id: PROJECT };

  it("checks a submission before it reaches the API", () => {
    assert.deepEqual(
      batchWrite({
        ...ids,
        intent: "submit",
        items: [{ request_id: REQ, version: 2 }],
      }),
      {
        path: `/organizations/${ORG}/projects/${PROJECT}/pbc-request-batches/submit`,
        body: { items: [{ request_id: REQ, version: 2 }] },
      },
    );
    assert.deepEqual(batchWrite({ ...ids, intent: "submit", items: [] }), {
      error: "invalid",
    });
    assert.deepEqual(
      batchWrite({
        ...ids,
        intent: "submit",
        items: [{ request_id: "nope", version: 2 }],
      }),
      { error: "invalid" },
    );
  });

  it("checks an owner before it reaches the API", () => {
    assert.deepEqual(
      batchWrite({
        ...ids,
        intent: "owner",
        control_ids: [REQ],
        owner_name: " Morgan Lee ",
        owner_email: "Morgan@Client.Example",
      }),
      {
        path: `/organizations/${ORG}/projects/${PROJECT}/onboarding/controls/owner-batch`,
        body: {
          control_ids: [REQ],
          owner_name: "Morgan Lee",
          owner_email: "morgan@client.example",
        },
      },
    );
    assert.deepEqual(
      batchWrite({
        ...ids,
        intent: "owner",
        control_ids: [REQ],
        owner_name: "A",
        owner_email: "x",
      }),
      { error: "invalid" },
    );
  });

  it("says plainly what went and what did not, and why", () => {
    const outcome = parseSubmitResult({
      submitted: 2,
      failed: 2,
      outcomes: [
        { request_id: "a", ok: true },
        { request_id: "b", ok: true },
        { request_id: "c", ok: false, detail: "pbc request changed" },
        { request_id: "d", ok: false, detail: "pbc request changed" },
      ],
    });
    assert.ok(outcome);
    assert.equal(
      outcomeLine(outcome),
      "2 requests submitted for approval. 2 could not be: 2 because it changed since the page loaded.",
    );
    assert.equal(
      outcomeLine({ submitted: 1, failed: 0, problems: [] }),
      "1 request submitted for approval.",
    );
    assert.equal(parseSubmitResult({ nope: true }), null);
  });
});
