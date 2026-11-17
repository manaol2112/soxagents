import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ASSUMPTION_TEXT_MAX,
  assumptionProblem,
  assumptionTextProblem,
  contextWrite,
  criteriaHistoryPath,
  parseAssumption,
  parseContext,
  parseCriteriaHistory,
} from "../apps/web/src/control-context-model.ts";
import {
  type WorkflowInput,
  workflowOf,
} from "../apps/web/src/control-workflow-model.ts";
import { basedOnSummary } from "../apps/web/src/step-frame-model.ts";
import { agentNote, panelFrame } from "../apps/web/src/step-panel-model.ts";
import {
  ADDED_FOR_ATTRIBUTES,
  addedForAttributes,
  basedOnLine,
  CHECKING_LINE,
  CHECKING_STATUS,
  characterCount,
  completeLine,
  completeStatus,
  dayWords,
  decidedAssumptions,
  decidedLine,
  offersAttributes,
  openAssumptions,
  previousCriteriaLabel,
  raisedChip,
  readsAgain,
  readyOnceComplete,
  rulesOpen,
  understandingEnd,
  updatedFromLine,
  versionLine,
  whenWords,
} from "../apps/web/src/understanding-once-model.ts";

// B1j (docs/control-workflow-plan.md; product owner, 16 November 2026, on ITGC-CM-06): "This
// is so annoying. Keeps going back and forth to the control understanding and attributes ...
// This could be a never ending loop so I want you to really address the issue here." Approved
// prototype brief-proto/loop.png, with "On the attribute" for a gap an agent finds later.
// Synthetic data only.

const ORG = "01a13253-ec1a-7604-8944-a06dd7633ce0";
const PROJECT = "01a1327d-b92a-7bd1-b34b-845a8d89c879";
const CONTROL = "01a13300-0000-7000-8000-000000000002";
const ATTRIBUTE = "01a13300-0000-7000-8000-000000000009";
const ASSUMPTION = "01a13300-0000-7000-8000-0000000000a1";
const DANA = "01a13300-0000-7000-8000-0000000000d1";
const IDS = { organization_id: ORG, project_id: PROJECT, control_id: CONTROL };
const BASE = `/organizations/${ORG}/projects/${PROJECT}/controls/${CONTROL}`;
const COMPLETED = "2026-11-16T16:12:00Z";

const open = {
  id: ASSUMPTION,
  matter: "patch to change record link",
  assumed:
    "A patch is linked to its change record by patch and host, not by date.",
  status: "OPEN",
  answer: "",
  decided_by: null,
  decided_at: null,
  attribute_codes: ["A"],
  version: 1,
};

describe("the context's B1j fields, read strictly", () => {
  it("reads the completion, the question pass, the set's assumptions and each attribute's", () => {
    const context = parseContext({
      control_id: CONTROL,
      understanding_completed_at: COMPLETED,
      question_pass: "DONE",
      set_assumptions: [{ ...open, attribute_codes: [] }],
      attributes: {
        approved: [
          {
            id: ATTRIBUTE,
            text: "A change record exists for the patch applied",
            status: "APPROVED",
            assumptions: [
              open,
              {
                ...open,
                id: "01a13300-0000-7000-8000-0000000000a2",
                status: "CONFIRMED",
                decided_by: { id: DANA, name: "Dana Lee" },
                decided_at: "2026-11-16T17:00:00Z",
              },
            ],
            criteria_updated_from: "emergency changes",
            criteria_versions: 2,
          },
        ],
      },
    });
    assert.equal(context?.understandingCompletedAt, COMPLETED);
    assert.equal(context?.questionPass, "DONE");
    assert.equal(context?.setAssumptions?.length, 1);
    assert.deepEqual(context?.setAssumptions?.[0]?.attributeCodes, []);
    const [attribute] = context?.approved ?? [];
    assert.equal(attribute?.assumptions?.length, 2);
    assert.equal(attribute?.assumptions?.[0]?.status, "OPEN");
    assert.deepEqual(attribute?.assumptions?.[1]?.decidedBy, {
      id: DANA,
      name: "Dana Lee",
    });
    assert.equal(attribute?.criteriaUpdatedFrom, "emergency changes");
    assert.equal(attribute?.criteriaVersions, 2);
  });

  it("reads a body from before B1j as saying nothing of it", () => {
    const context = parseContext({ control_id: CONTROL });
    assert.equal(context?.understandingCompletedAt, null);
    assert.equal(context?.questionPass, null);
    assert.deepEqual(context?.setAssumptions, []);
    const bare = parseContext({
      control_id: CONTROL,
      attributes: { approved: [{ id: ATTRIBUTE, status: "APPROVED" }] },
    });
    assert.deepEqual(bare?.approved[0]?.assumptions, []);
    assert.equal(bare?.approved[0]?.criteriaUpdatedFrom, "");
    assert.equal(bare?.approved[0]?.criteriaVersions, 0);
  });

  it("never reads an unknown pass, a time that is none, or a negative count as one", () => {
    const context = parseContext({
      control_id: CONTROL,
      understanding_completed_at: "yesterday",
      question_pass: "MAYBE",
      attributes: {
        approved: [
          { id: ATTRIBUTE, status: "APPROVED", criteria_versions: -3 },
          { id: ATTRIBUTE, status: "APPROVED", criteria_versions: 1.5 },
        ],
      },
    });
    assert.equal(context?.understandingCompletedAt, null);
    assert.equal(context?.questionPass, null);
    assert.equal(context?.approved[0]?.criteriaVersions, 0);
    assert.equal(context?.approved[1]?.criteriaVersions, 0);
  });

  it("leaves out an assumption not shaped as one, never guessing", () => {
    assert.notEqual(parseAssumption(open), null);
    for (const bad of [
      { ...open, id: "a1" },
      { ...open, status: "MAYBE" },
      { ...open, assumed: "  " },
      { ...open, version: 0 },
      { ...open, version: 1.5 },
      { ...open, matter: 3 },
      // An open one with a decision, or a person's decision with no person or time.
      { ...open, decided_by: { id: DANA, name: "Dana Lee" } },
      { ...open, status: "CONFIRMED" },
      {
        ...open,
        status: "CONFIRMED",
        decided_by: { id: DANA, name: "Dana Lee" },
      },
      {
        ...open,
        status: "CHANGED",
        decided_by: { id: DANA, name: "Dana Lee" },
        decided_at: COMPLETED,
        answer: "",
      },
      { ...open, decided_by: "Dana Lee" },
      null,
      "open",
    ]) {
      assert.equal(parseAssumption(bad), null, JSON.stringify(bad));
    }
    // Accepted with the attribute, or replaced by a later run: no person is needed.
    assert.equal(
      parseAssumption({ ...open, status: "ACCEPTED_WITH_ATTRIBUTE" })?.status,
      "ACCEPTED_WITH_ATTRIBUTE",
    );
    assert.equal(
      parseAssumption({ ...open, status: "SUPERSEDED" })?.status,
      "SUPERSEDED",
    );
  });

  it("keeps at most ten assumptions on an attribute", () => {
    const many = Array.from({ length: 14 }, (_, at) => ({
      ...open,
      id: `01a13300-0000-7000-8000-0000000001${String(at).padStart(2, "0")}`,
    }));
    const context = parseContext({
      control_id: CONTROL,
      attributes: {
        approved: [{ id: ATTRIBUTE, status: "APPROVED", assumptions: many }],
      },
    });
    assert.equal(context?.approved[0]?.assumptions?.length, 10);
  });
});

describe("the assumption decisions and the criteria history, as the routes take them", () => {
  it("sends That's right at the version read", () => {
    assert.deepEqual(
      contextWrite({
        ...IDS,
        intent: "assumption-confirm",
        assumption_id: ASSUMPTION,
        version: 3,
      }),
      {
        intent: "assumption-confirm",
        method: "POST",
        path: `${BASE}/assumptions/${ASSUMPTION}/confirm`,
        body: { version: 3 },
        slow: false,
      },
    );
    for (const bad of [
      { assumption_id: "a1", version: 3 },
      { assumption_id: ASSUMPTION, version: 0 },
      { assumption_id: ASSUMPTION },
    ]) {
      assert.deepEqual(
        contextWrite({ ...IDS, intent: "assumption-confirm", ...bad }),
        { error: "invalid" },
      );
    }
  });

  it("sends Change… with the person's own words, 10 to 1,000 characters", () => {
    const words =
      "  Patches are matched to change records by the ticket number.  ";
    assert.deepEqual(
      contextWrite({
        ...IDS,
        intent: "assumption-change",
        assumption_id: ASSUMPTION,
        text: words,
        version: 2,
      }),
      {
        intent: "assumption-change",
        method: "POST",
        path: `${BASE}/assumptions/${ASSUMPTION}/change`,
        body: { text: words.trim(), version: 2 },
        slow: false,
      },
    );
    for (const text of [
      "Too short",
      "x".repeat(ASSUMPTION_TEXT_MAX + 1),
      "The admin password: hunter22 is shared.",
    ]) {
      assert.deepEqual(
        contextWrite({
          ...IDS,
          intent: "assumption-change",
          assumption_id: ASSUMPTION,
          text,
          version: 2,
        }),
        { error: "invalid" },
        text.slice(0, 20),
      );
    }
    assert.equal(assumptionTextProblem("x".repeat(10)), null);
    assert.equal(assumptionTextProblem("x".repeat(1000)), null);
    assert.match(assumptionTextProblem("short") ?? "", /at least 10/);
    assert.match(assumptionTextProblem("x".repeat(1001)) ?? "", /1,000/);
  });

  it("reads an attribute's earlier criteria from its own path, newest first", () => {
    assert.equal(
      criteriaHistoryPath({ ...IDS, attribute_id: ATTRIBUTE }),
      `${BASE}/attributes/${ATTRIBUTE}/criteria-history`,
    );
    assert.equal(criteriaHistoryPath({ ...IDS, attribute_id: "a1" }), null);
    assert.equal(
      criteriaHistoryPath({
        ...IDS,
        control_id: "../x",
        attribute_id: ATTRIBUTE,
      }),
      null,
    );
    const versions = parseCriteriaHistory({
      versions: [
        {
          version: 1,
          condition: "",
          pass_criteria: "A record exists.",
          fail_criteria: "None exists.",
          judgment_required: false,
          origin: "AGENT",
          written_at: "2026-11-16T16:01:00Z",
          written_by: { kind: "AGENT", name: "" },
          cause: "",
        },
        {
          version: 2,
          condition: "Each patch",
          pass_criteria: "The record names the patch and hosts.",
          fail_criteria: "It names another patch.",
          judgment_required: false,
          origin: "AGENT",
          written_at: "2026-11-16T16:12:00Z",
          written_by: { kind: "AGENT", name: "" },
          cause: "Your answer on emergency changes",
        },
        // Not a version: left out.
        { version: "3", written_by: { kind: "AGENT" } },
        { version: 4, judgment_required: false, written_at: "x" },
      ],
    });
    assert.deepEqual(
      versions?.map((item) => item.version),
      [2, 1],
    );
    assert.equal(versions?.[0]?.cause, "Your answer on emergency changes");
    assert.equal(parseCriteriaHistory({ versions: "none" }), null);
    assert.equal(parseCriteriaHistory(null), null);
  });

  it("says a refusal in the server's one sentence, or in the page's own words", () => {
    assert.equal(assumptionProblem(200), null);
    assert.equal(
      assumptionProblem(409, "The assumption changed; read it again."),
      "The assumption changed; read it again.",
    );
    assert.equal(
      assumptionProblem(409, "This assumption is already decided."),
      "This assumption is already decided.",
    );
    assert.match(
      assumptionProblem(409, "the attributes are being updated") ?? "",
      /^The agents are updating the attributes/,
    );
    assert.equal(
      assumptionProblem(409, "token=abc123 leaked."),
      "The assumption changed; read it again.",
    );
    assert.match(assumptionProblem(422) ?? "", /between 10 and 1,000/);
    assert.equal(
      assumptionProblem(403),
      "Your role cannot change this control.",
    );
  });
});

describe("an assumption's words: the agent's until a person decides", () => {
  const decided = (status: string, over: Record<string, unknown> = {}) =>
    parseAssumption({
      ...open,
      status,
      decided_by: { id: DANA, name: "Dana Lee" },
      decided_at: "2026-11-16T17:00:00Z",
      ...over,
    });

  it("words a person's decision with the person, and accepted-with-the-attribute as nobody's", () => {
    const confirmed = decided("CONFIRMED");
    assert.ok(confirmed !== null);
    assert.equal(
      decidedLine(confirmed, "UTC"),
      `Confirmed by Dana Lee, Nov 16: ${open.assumed}`,
    );
    const changed = decided("CHANGED", {
      answer: "They are matched by the ticket number.",
    });
    assert.ok(changed !== null);
    assert.equal(
      decidedLine(changed, "UTC"),
      "Changed by Dana Lee: They are matched by the ticket number.",
    );
    const accepted = decided("ACCEPTED_WITH_ATTRIBUTE");
    assert.ok(accepted !== null);
    const line = decidedLine(accepted, "UTC") ?? "";
    assert.equal(line, `Accepted with the attribute: ${open.assumed}`);
    assert.doesNotMatch(line, /Confirmed|Dana Lee/);
    const replaced = decided("SUPERSEDED");
    assert.ok(replaced !== null);
    assert.match(
      decidedLine(replaced, "UTC") ?? "",
      /^Replaced by a later run/,
    );
    const asked = parseAssumption(open);
    assert.ok(asked !== null);
    assert.equal(decidedLine(asked), null);
    assert.deepEqual(
      openAssumptions([asked, confirmed]).map((item) => item.status),
      ["OPEN"],
    );
    assert.deepEqual(
      decidedAssumptions([asked, confirmed]).map((item) => item.status),
      ["CONFIRMED"],
    );
    assert.deepEqual(openAssumptions(undefined), []);
  });

  it("counts the box, names where the criteria came from, and the earlier versions", () => {
    assert.equal(
      characterCount("  twelve chars  ", 1000),
      "12 of 1,000 characters",
    );
    assert.equal(
      updatedFromLine("emergency changes"),
      "Updated from your answer on emergency changes",
    );
    assert.equal(updatedFromLine(""), null);
    assert.equal(updatedFromLine(undefined), null);
    assert.equal(previousCriteriaLabel(2), "Previous criteria (2)");
    assert.equal(previousCriteriaLabel(0), null);
    assert.equal(previousCriteriaLabel(undefined), null);
  });

  it("says who wrote an earlier version: an agent's never as a person's", () => {
    const at = "2026-11-16T16:01:00Z";
    assert.equal(
      versionLine(
        { writtenBy: { kind: "AGENT", name: "" }, writtenAt: at, cause: "" },
        "UTC",
      ),
      "Tailored by the agent · Nov 16, 4:01 PM",
    );
    assert.equal(
      versionLine(
        {
          writtenBy: { kind: "PERSON", name: "Dana Lee" },
          writtenAt: at,
          cause: "Your answer on emergency changes",
        },
        "UTC",
      ),
      "Written by Dana Lee · Nov 16, 4:01 PM · Your answer on emergency changes",
    );
    assert.equal(
      versionLine(
        { writtenBy: { kind: "SEEDED", name: "" }, writtenAt: at, cause: "" },
        "UTC",
      ),
      "Seeded by the demo data · Nov 16, 4:01 PM",
    );
  });
});

describe("Control Understanding asked once", () => {
  it("names the times as the prototype does", () => {
    assert.equal(whenWords(COMPLETED, "UTC"), "Nov 16, 4:12 PM");
    assert.equal(dayWords(COMPLETED, "UTC"), "Nov 16");
    assert.equal(whenWords("not a time"), "");
    assert.equal(
      completeLine(COMPLETED, "UTC"),
      "Understanding complete · Nov 16, 4:12 PM",
    );
    assert.equal(
      completeStatus(COMPLETED, "UTC"),
      "Complete · Nov 16, 4:12 PM",
    );
    assert.equal(
      basedOnLine("Nov 16, 4:12 PM"),
      "the understanding of Nov 16, 4:12 PM",
    );
    // Within a workflow node's room, whatever the day and hour.
    assert.ok(
      completeStatus("2026-12-26T22:59:00Z", "UTC").length <= 28,
      completeStatus("2026-12-26T22:59:00Z", "UTC"),
    );
    assert.ok(CHECKING_STATUS.length <= 28);
    assert.equal(CHECKING_LINE, "Checking what else the agents need…");
    assert.equal(
      ADDED_FOR_ATTRIBUTES,
      "Added by the agents · for the attributes",
    );
  });

  it("labels the pass's questions, never the rules' or the narrative's", () => {
    assert.equal(
      addedForAttributes({ raisedBy: "AGENT", origin: "ATTRIBUTES" }),
      true,
    );
    assert.equal(
      addedForAttributes({ raisedBy: "AGENT", origin: "SOURCES" }),
      true,
    );
    assert.equal(
      addedForAttributes({ raisedBy: "AGENT", origin: "PROCESS" }),
      false,
    );
    assert.equal(
      addedForAttributes({ raisedBy: "RULES", origin: "SOURCES" }),
      false,
    );
    assert.equal(
      raisedChip({ raisedBy: "AGENT", origin: "ATTRIBUTES" }),
      ADDED_FOR_ATTRIBUTES,
    );
    assert.equal(
      raisedChip({ raisedBy: "RULES", origin: "SOURCES" }),
      "Raised by the rules",
    );
    assert.equal(
      raisedChip({ raisedBy: "AGENT", origin: "PROCESS" }),
      "Raised by the agents",
    );
    assert.equal(raisedChip(undefined), "Raised by the agents");
    const lines = [
      { key: "attributes" as const, ready: false, note: "1 left" },
      { key: "evidence" as const, ready: false, note: "1 left" },
    ];
    assert.deepEqual(readyOnceComplete(lines, true, 0), [
      { key: "attributes", ready: true, note: "Ready" },
      { key: "evidence", ready: false, note: "1 left" },
    ]);
    assert.equal(readyOnceComplete(lines, true, 2)[0]?.note, "2 to decide");
    assert.deepEqual(readyOnceComplete(lines, false, 0), lines);
    // While the agents check, the attributes are not ready yet, whatever the gates read.
    const ready = [{ key: "attributes" as const, ready: true, note: "Ready" }];
    assert.deepEqual(readyOnceComplete(ready, false, 0, true), [
      { key: "attributes", ready: false, note: "Checking" },
    ]);
    assert.equal(
      rulesOpen([
        { status: "OPEN", raisedBy: "RULES" },
        { status: "OPEN", raisedBy: "AGENT" },
        { status: "RESOLVED", raisedBy: "RULES" },
      ]),
      1,
    );
  });

  it("offers the attributes only once complete, and reads again while the pass runs", () => {
    const complete = { completedAt: COMPLETED, questionPass: "DONE" as const };
    const checking = { completedAt: null, questionPass: "CHECKING" as const };
    const done = { completedAt: null, questionPass: "DONE" as const };
    const waiting = { completedAt: null, questionPass: "WAITING" as const };
    const before = { completedAt: null, questionPass: null };
    assert.equal(understandingEnd(complete, false), "complete");
    assert.equal(understandingEnd(complete, true), "complete");
    assert.equal(understandingEnd(checking, true), "checking");
    assert.equal(understandingEnd(checking, false), "checking");
    assert.equal(understandingEnd(waiting, false), "open");
    // The gates read understood, the completion not yet recorded: never the way on yet.
    assert.equal(understandingEnd(done, true), "checking");
    assert.equal(understandingEnd(done, false), "open");
    // A body from before B1j: as before.
    assert.equal(understandingEnd(before, true), "understood");
    assert.equal(offersAttributes(complete), true);
    assert.equal(offersAttributes(checking), false);
    assert.equal(offersAttributes(done), false);
    assert.equal(offersAttributes(before), true);
    assert.equal(readsAgain(checking, false), true);
    assert.equal(readsAgain(complete, true), false);
    assert.equal(readsAgain(waiting, false), false);
  });
});

// The workflow (control-workflow-model, step-panel-model, step-frame-model).

const understood = [
  {
    key: "answers" as const,
    done: true,
    optional: false,
    mine: true,
    summary: "All 3 answered",
  },
];

function input(overrides: Partial<WorkflowInput> = {}): WorkflowInput {
  return {
    details: [
      { label: "Description", filled: true },
      { label: "Objective", filled: true },
      { label: "Frequency", filled: true },
      { label: "Owner", filled: true },
      { label: "Risk", filled: true },
    ],
    setup: understood,
    attributes: { approved: 4, proposed: 0, untailored: 0 },
    plan: { exists: false, approved: false, pendingReview: false },
    requirements: [],
    sheet: null,
    rounds: [],
    findings: [],
    reviewStatus: "",
    conclusion: "NOT_CONCLUDED",
    proposedConclusion: null,
    designPaper: null,
    designConclusion: null,
    effectivenessPaper: null,
    busy: new Set(),
    ...overrides,
  };
}

const step = (steps: ReturnType<typeof workflowOf>, key: string) =>
  steps.find((item) => item.key === key);

describe("the workflow once the understanding is complete", () => {
  // ITGC-CM-06 after B1j: complete at 4:12 PM; then the rules raised a frequency conflict.
  const completedWithRules = input({
    setup: [
      {
        key: "answers",
        done: false,
        optional: false,
        mine: true,
        summary: "1 to answer",
      },
    ],
    attributes: { approved: 4, proposed: 0, untailored: 0, questions: 1 },
    understanding: {
      completedAt: COMPLETED,
      questionPass: "DONE",
      rulesOpen: 1,
    },
    designRelease: {
      step: "WAITING",
      waitingOn: "UNDERSTANDING",
      waitingFor: "Control Understanding is not complete: 1 question is open.",
    },
  });

  it("reads Control Understanding complete, with its time, though a rules question is open", () => {
    const steps = workflowOf(completedWithRules);
    const understanding = step(steps, "understanding");
    assert.equal(understanding?.tone, "done");
    assert.match(
      understanding?.status ?? "",
      /^Complete · [A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2} [AP]M$/,
    );
    assert.ok((understanding?.status.length ?? 99) <= 28);
    assert.equal(understanding?.since, whenWords(COMPLETED));
    // The rules' question still shows there, with its own count.
    assert.ok(understanding !== undefined);
    assert.deepEqual(agentNote(understanding, completedWithRules).found, [
      `${understanding?.status}.`,
      "1 question the rules raised is open here.",
    ]);
  });

  it("never reads the Attributes step as waiting on the understanding, nor counts its questions", () => {
    const steps = workflowOf(completedWithRules);
    const attributes = step(steps, "attributes");
    assert.notEqual(attributes?.status, "Waiting on understanding");
    assert.equal(attributes?.tone, "done");
    assert.equal(attributes?.status, "4 attributes settled");
    const frame = panelFrame("attributes", steps, null);
    assert.notEqual(frame.need.kind, "wait");
    assert.doesNotMatch(
      `${frame.need.title} ${frame.need.detail}`,
      /It starts once Control Understanding|Waiting on understanding/,
    );
    assert.equal(frame.need.action?.step, undefined);
    assert.ok(attributes !== undefined);
    const note = agentNote(attributes, completedWithRules);
    assert.equal(
      note.found.some((line) => /question/.test(line)),
      false,
      note.found.join(" | "),
    );
    // The footer's quiet "Based on the understanding of <time>" is the one way back.
    const based = basedOnSummary(frame.basedOn);
    assert.equal(based?.first.key, "understanding");
    assert.equal(based?.label, `the understanding of ${whenWords(COMPLETED)}`);
  });

  it("still asks for the attributes' own decisions once complete", () => {
    const steps = workflowOf(
      input({
        attributes: { approved: 4, proposed: 1, untailored: 0, questions: 2 },
        understanding: { completedAt: COMPLETED, questionPass: "DONE" },
      }),
    );
    assert.deepEqual(
      [step(steps, "attributes")?.tone, step(steps, "attributes")?.status],
      ["attention", "1 attribute to decide"],
    );
  });
});

describe("the workflow while the agents check what else they need", () => {
  const checking = input({
    setup: [
      {
        key: "answers",
        done: true,
        optional: false,
        mine: true,
        summary: "All 14 answered",
      },
    ],
    understanding: { completedAt: null, questionPass: "CHECKING" },
    busy: new Set(["understanding"]),
  });

  it("shows Control Understanding checking, and the attributes waiting on it as today", () => {
    const steps = workflowOf(checking);
    assert.deepEqual(
      [
        step(steps, "understanding")?.tone,
        step(steps, "understanding")?.status,
      ],
      ["active", CHECKING_STATUS],
    );
    const frame = panelFrame("understanding", steps, null);
    assert.equal(frame.need.kind, "agent");
    assert.equal(frame.need.title, CHECKING_LINE);
    assert.match(frame.need.detail, /joins this course/);
    // Before completion the Attributes step says, as today, that it starts once the
    // understanding is done.
    assert.equal(step(steps, "attributes")?.status, "Waiting on understanding");
    const attributes = panelFrame("attributes", steps, null);
    assert.equal(attributes.need.kind, "wait");
    assert.match(
      attributes.need.detail,
      /^It starts once Control Understanding is done/,
    );
    // No time yet: the footer names the step as before.
    assert.equal(
      basedOnSummary(attributes.basedOn)?.label,
      `Control Understanding · ${CHECKING_STATUS}`,
    );
  });

  it("before B1j's fields, reads the understanding as before", () => {
    const steps = workflowOf(input());
    assert.deepEqual(
      [
        step(steps, "understanding")?.tone,
        step(steps, "understanding")?.status,
      ],
      ["done", "Understood"],
    );
    assert.equal(step(steps, "understanding")?.since, undefined);
  });
});
