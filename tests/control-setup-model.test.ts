import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  agentQuestions,
  answerChoices,
  choiceTag,
  confirmPlan,
  countWord,
  type Draft,
  documentChoices,
  firstOpenQuestion,
  firstToAnswer,
  type InterviewStep,
  interviewAnswer,
  interviewShort,
  introHeadline,
  longChoices,
  NO_DOCUMENT,
  nextScreen,
  ONE_SCREEN,
  type Prefill,
  prefillAnswers,
  questionsLeft,
  type SetupInput,
  type SetupIssue,
  STEP_BRIEF,
  saveOne,
  screensFor,
  setupBegunKey,
  setupDraftKey,
  setupState,
  setupSteps,
  summaryRows,
  walkInterview,
} from "../apps/web/src/control-setup-model.ts";

const fresh: SetupInput = {
  slots: [
    { key: "provisioner", value: "", blocks: true },
    { key: "ticketing-tool", value: "", blocks: false },
  ],
  processRequired: false,
  processPending: true,
  approvedAttributes: 0,
  proposedAttributes: 5,
  openQuestions: 0,
  documents: 0,
  unreviewedDocuments: 0,
  plan: { exists: true, approved: false, pendingReview: true },
  canAct: true,
  canApprove: false,
};

describe("the control's guided setup", () => {
  it("lists the work in order, leaving out what does not apply", () => {
    const steps = setupSteps(fresh);
    assert.deepEqual(
      steps.map((step) => [step.key, step.summary, step.done]),
      [
        ["answers", "0 of 2 answered", false],
        ["attributes", "5 proposed to decide", false],
        ["documents", "None linked", false],
        ["plan", "Awaiting approval", false],
      ],
    );
    // A business process control adds its process.
    const process = setupSteps({ ...fresh, processRequired: true });
    assert.deepEqual(
      process.map((step) => step.key),
      ["answers", "process", "attributes", "documents", "plan"],
    );
  });

  it("asks the agents' open questions in Control understanding, not on a step of their own", () => {
    const answered = fresh.slots.map((slot) => ({ ...slot, value: "x" }));
    const steps = setupSteps({ ...fresh, openQuestions: 2 });
    assert.equal(
      steps.some((step) => (step.key as string) === "questions"),
      false,
    );
    assert.deepEqual(
      [steps[0]?.key, steps[0]?.summary, steps[0]?.done],
      ["answers", "4 to answer", false],
    );
    // Every client-specific question answered, and the agents raise one later: the step
    // opens again and the setup returns to it.
    const later = setupSteps({
      ...fresh,
      slots: answered,
      approvedAttributes: 3,
      proposedAttributes: 0,
      openQuestions: 1,
    });
    assert.deepEqual(
      [later[0]?.summary, later[0]?.done],
      ["1 to answer", false],
    );
    assert.equal(setupState(later, false).first, "answers");
    // Settled: back to how it reads with no agent questions.
    const settled = setupSteps({ ...fresh, slots: answered });
    assert.deepEqual(
      [settled[0]?.summary, settled[0]?.done],
      ["All 2 answered", true],
    );
    // A control with nothing to fill in still asks what the agents raised.
    const onlyAgents = setupSteps({ ...fresh, slots: [], openQuestions: 1 });
    assert.deepEqual(
      [onlyAgents[0]?.key, onlyAgents[0]?.summary],
      ["answers", "1 to answer"],
    );
    assert.equal(setupSteps({ ...fresh, slots: [] })[0]?.key, "attributes");
  });

  it("opens for whoever can do the next part, and says what it waits on otherwise", () => {
    const state = setupState(setupSteps(fresh), true);
    assert.equal(state.complete, false);
    assert.equal(state.opensForViewer, true);
    assert.equal(state.first, "answers");
    // Only the plan's approval left, and the viewer cannot approve: no pop-up.
    const onlyPlan = setupSteps({
      ...fresh,
      slots: fresh.slots.map((slot) => ({ ...slot, value: "x" })),
      approvedAttributes: 5,
      proposedAttributes: 0,
    });
    const waiting = setupState(onlyPlan, true);
    assert.equal(waiting.opensForViewer, false);
    assert.equal(waiting.waitingOn, "Waiting for the test plan's approval");
    // The approver gets it.
    const approver = setupState(
      setupSteps({
        ...fresh,
        slots: fresh.slots.map((slot) => ({ ...slot, value: "x" })),
        approvedAttributes: 5,
        proposedAttributes: 0,
        canApprove: true,
      }),
      true,
    );
    assert.equal(approver.opensForViewer, true);
    assert.equal(approver.first, "plan");
    // A read-only member is never asked.
    const reader = setupState(
      setupSteps({ ...fresh, canAct: false, canApprove: false }),
      true,
    );
    assert.equal(reader.opensForViewer, false);
  });

  it("is complete only when every required step is done and readiness holds nothing", () => {
    const done = setupSteps({
      ...fresh,
      slots: fresh.slots.map((slot) => ({ ...slot, value: "x" })),
      approvedAttributes: 5,
      proposedAttributes: 0,
      plan: { exists: true, approved: true, pendingReview: false },
    });
    // Governing documents are optional.
    assert.equal(setupState(done, false).complete, true);
    // Readiness still holding (a conflict, a missing frequency) keeps it open.
    assert.equal(setupState(done, true).complete, false);
    // A plan still being drafted is no one's to approve yet.
    const drafting = setupSteps({
      ...fresh,
      plan: { exists: false, approved: false, pendingReview: false },
      canApprove: true,
    });
    const plan = drafting.find((step) => step.key === "plan");
    assert.equal(plan?.summary, "Being drafted");
    assert.equal(plan?.mine, false);
  });
});

describe("the agents' questions in Control understanding", () => {
  const issue = (over: Partial<SetupIssue>): SetupIssue => ({
    id: "i1",
    origin: "PROCESS",
    kind: "MISSING",
    topic: "Late removals",
    detail: "Nothing says who is told.",
    why: "Testing needs the escalation.",
    quotes: [],
    status: "OPEN",
    version: 2,
    question: "Who is told when a removal is late?",
    suggestions: [],
    proposal: "",
    proposalBasis: "",
    ...over,
  });

  it("chooses the agent's statement, says where it comes from, and offers the others", () => {
    const [row] = agentQuestions([
      issue({
        proposal: "The IT Security Manager is told.",
        proposalBasis: "TYPICAL",
        suggestions: [
          "The CISO is told.",
          " The IT Security Manager is told. ",
          "",
        ],
      }),
    ]);
    assert.equal(row?.question, "Who is told when a removal is late?");
    assert.equal(row?.value, "The IT Security Manager is told.");
    assert.equal(row?.source, "TYPICAL");
    assert.equal(row?.required, true);
    assert.equal(row?.why, "Testing needs the escalation.");
    // The statement comes first and appears once.
    assert.deepEqual(row === undefined ? [] : answerChoices(row), [
      "The IT Security Manager is told.",
      "The CISO is told.",
    ]);
    const [fromRecords] = agentQuestions([
      issue({ proposal: "Stated.", proposalBasis: "SOURCES" }),
    ]);
    assert.equal(fromRecords?.source, "SOURCES");
  });

  it("never heads a question with a statement", () => {
    const [row] = agentQuestions([
      issue({ origin: "ATTRIBUTES", question: "", kind: "AMBIGUOUS" }),
    ]);
    assert.equal(row?.question, "Late removals");
    assert.equal(row?.context, "Nothing says who is told.");
    assert.equal(row?.value, "");
    assert.equal(row?.source, "NONE");
    assert.equal(row?.issue?.point, false);
  });

  it("makes a person choose between the sources of a conflict", () => {
    const [row] = agentQuestions([
      issue({
        origin: "SOURCES",
        kind: "CONFLICT",
        question: "",
        detail: "The policy and the RCM disagree on the deadline.",
        proposal: "Should not be used.",
        quotes: [
          { source: "s1", title: "Access policy", quote: "within 3 days" },
          { source: "s2", title: "RCM", quote: "within 1 day" },
        ],
      }),
    ]);
    assert.equal(row?.source, "CONFLICT");
    assert.equal(
      row?.question,
      "Which of these reflects how the control runs?",
    );
    assert.equal(
      row?.context,
      "The policy and the RCM disagree on the deadline.",
    );
    assert.equal(row?.value, "");
    assert.equal(row?.issue?.conflict, true);
    assert.deepEqual(row === undefined ? [] : answerChoices(row), [
      'Access policy: "within 3 days"',
      'RCM: "within 1 day"',
    ]);
  });

  it("asks only what is open, and keeps what this visit answered read-only", () => {
    const issues = [
      issue({ id: "open" }),
      issue({ id: "done", status: "RESOLVED" }),
      issue({ id: "gone", status: "DISMISSED" }),
    ];
    assert.deepEqual(
      agentQuestions(issues).map((row) => row.key),
      ["open"],
    );
    const [first, second] = agentQuestions(issues, {
      done: "As the agent said.",
    });
    assert.equal(first?.key, "open");
    assert.deepEqual(
      [second?.key, second?.value, second?.source, second?.options],
      ["done", "As the agent said.", "RECORDED", []],
    );
    // Answered, still open on the page's copy until it reads the records again.
    const [stale] = agentQuestions([issue({ id: "open" })], { open: "Saved." });
    assert.equal(stale?.source, "RECORDED");
  });

  it("settles a narrative point through its round, and anything else on its own record", () => {
    const point = agentQuestions([issue({ proposal: "Stated." })])[0];
    assert.ok(point !== undefined);
    assert.deepEqual(saveOne(point, " The CISO is told. "), {
      kind: "issue",
      issueId: "i1",
      version: 2,
      answer: "The CISO is told.",
      point: true,
    });
    const gap = agentQuestions([issue({ origin: "ATTRIBUTES" })])[0];
    assert.ok(gap !== undefined);
    assert.deepEqual(saveOne(gap, "x"), {
      kind: "issue",
      issueId: "i1",
      version: 2,
      answer: "x",
      point: false,
    });
    // What this visit already answered is not sent again: the record would refuse it.
    const again = agentQuestions([issue({})], { i1: "Saved." })[0];
    assert.ok(again !== undefined);
    assert.deepEqual(saveOne(again, "Saved."), { kind: "none" });
  });

  it("says when the reviewer agent has not cleared an agent's wording", () => {
    const unchecked = (over: Partial<SetupIssue>) =>
      agentQuestions([issue(over)])[0]?.unchecked;
    assert.equal(unchecked({ raisedBy: "AGENT" }), true);
    assert.equal(
      unchecked({ raisedBy: "AGENT", wordingReviewed: false }),
      true,
    );
    assert.equal(
      unchecked({ raisedBy: "AGENT", wordingReviewed: true }),
      false,
    );
    // The checks' own fixed wording is not an agent's to review.
    assert.equal(unchecked({ raisedBy: "RULES" }), false);
  });

  it("starts at the first question left, past what is on record", () => {
    const answered: Prefill = {
      key: "a",
      question: "Q",
      required: true,
      value: "x",
      source: "RECORDED",
      proposalId: null,
      options: [],
    };
    const rows = [
      answered,
      ...agentQuestions([issue({ proposal: "Stated." })]),
    ];
    assert.equal(firstOpenQuestion(rows), 1);
  });

  it("gives long answers a row each and leaves short ones two to a row", () => {
    assert.equal(longChoices(["ServiceNow", "Jira"]), false);
    assert.equal(longChoices(["ServiceNow", "x".repeat(49)]), true);
  });

  it("counts them among the questions the introduction promises", () => {
    assert.equal(questionsLeft({ ...fresh, openQuestions: 3 }), 5);
  });
});

describe("the interview", () => {
  const steps: InterviewStep[] = [
    {
      key: "s1",
      question: "Is a late removal reported?",
      why: "It shows whether exceptions are followed up.",
      usual: "Yes",
      basis: "TYPICAL",
      answers: [
        { label: "Yes", says: "A late removal is reported.", next: "s2" },
        { label: "No", says: "A late removal is not reported.", next: "" },
      ],
    },
    {
      key: "s2",
      question: "Who receives the report?",
      why: "",
      usual: "IT Security Manager",
      basis: "TYPICAL",
      answers: [
        {
          label: "IT Security Manager",
          says: "The IT Security Manager receives it.",
          next: "",
        },
        {
          label: "Line manager",
          says: "The line manager receives it.",
          next: "",
        },
      ],
    },
  ];
  const interviewRow = (over: Partial<Prefill> = {}): Prefill => ({
    key: "late",
    question: "Is a late removal reported?",
    topic: "Late removals",
    required: true,
    value: "",
    source: "TYPICAL",
    proposalId: null,
    options: [],
    steps,
    issue: { id: "i1", version: 3, point: true, conflict: false },
    ...over,
  });
  const slotRow = (over: Partial<Prefill> = {}): Prefill => ({
    key: "tool",
    question: "Which tool?",
    required: false,
    value: "",
    source: "USUAL",
    proposalId: null,
    options: ["ServiceNow"],
    ...over,
  });
  const none: Draft = { picks: {}, dismissed: [] };

  it("asks a follow-up only when the answer calls for it", () => {
    assert.deepEqual(
      walkInterview(steps, {}).visited.map((step) => step.key),
      ["s1"],
    );
    assert.equal(walkInterview(steps, {}).complete, false);
    const no = walkInterview(steps, { s1: { label: "No" } });
    assert.deepEqual(
      no.visited.map((step) => step.key),
      ["s1"],
    );
    assert.equal(no.complete, true);
    const yes = walkInterview(steps, { s1: { label: "Yes" } });
    assert.deepEqual(
      yes.visited.map((step) => step.key),
      ["s1", "s2"],
    );
    assert.equal(yes.complete, false);
  });

  it("forgets what was answered on a way the person no longer takes", () => {
    const changed = {
      s1: { label: "No" },
      s2: { label: "Line manager" },
    };
    assert.equal(
      interviewAnswer(steps, changed),
      "A late removal is not reported.",
    );
    assert.equal(interviewShort(steps, changed), "No");
  });

  it("records the sentences the clicks mean, and shows the clicks", () => {
    const picks = {
      s1: { label: "Yes" },
      s2: { label: "Line manager" },
    };
    assert.equal(
      interviewAnswer(steps, picks),
      "A late removal is reported. The line manager receives it.",
    );
    assert.equal(interviewShort(steps, picks), "Yes · Line manager");
  });

  it("keeps a person's own words with the question they answer, and follows them up", () => {
    const own = { s1: { other: "Only above a threshold" } };
    // Followed up as the usual answer would be.
    assert.deepEqual(
      walkInterview(steps, own).visited.map((step) => step.key),
      ["s1", "s2"],
    );
    assert.equal(
      interviewAnswer(steps, own),
      "Is a late removal reported? Only above a threshold.",
    );
    assert.equal(
      interviewAnswer(steps, { s1: { other: "Sometimes!" } }),
      "Is a late removal reported? Sometimes!",
    );
  });

  it("lists the screens the answers lead through, ending at the first to answer", () => {
    const rows = [slotRow({ key: "a" }), interviewRow(), slotRow({ key: "b" })];
    assert.deepEqual(screensFor(rows, none), [{ row: 0, step: ONE_SCREEN }]);
    assert.equal(firstToAnswer(rows, none), 0);
    const onSlot: Draft = {
      picks: { a: { [ONE_SCREEN]: { label: "ServiceNow" } } },
      dismissed: [],
    };
    assert.deepEqual(screensFor(rows, onSlot), [
      { row: 0, step: ONE_SCREEN },
      { row: 1, step: "s1" },
    ]);
    const branch: Draft = {
      ...onSlot,
      picks: { ...onSlot.picks, late: { s1: { label: "Yes" } } },
    };
    assert.deepEqual(screensFor(rows, branch), [
      { row: 0, step: ONE_SCREEN },
      { row: 1, step: "s1" },
      { row: 1, step: "s2" },
    ]);
    // A question on record needs no answer, and one set aside moves on.
    assert.equal(
      firstToAnswer(
        [slotRow({ source: "RECORDED", value: "Jira" }), interviewRow()],
        { picks: {}, dismissed: ["late"] },
      ),
      null,
    );
  });

  it("goes to the summary only when every question has what it needs", () => {
    const rows = [interviewRow()];
    assert.equal(firstToAnswer(rows, none), 0);
    assert.equal(
      firstToAnswer(rows, {
        picks: { late: { s1: { label: "Yes" } } },
        dismissed: [],
      }),
      1,
    );
    assert.equal(
      firstToAnswer(rows, {
        picks: { late: { s1: { label: "No" } } },
        dismissed: [],
      }),
      null,
    );
  });

  it("returns an edit to the summary once the changed answer has what it needs", () => {
    // Regression (4 November 2026): after a follow-up, an edit walked on to the next topic.
    const rows = [
      interviewRow(),
      slotRow({ source: "RECORDED", value: "Jira" }),
    ];
    const yes: Draft = {
      picks: { late: { s1: { label: "Yes" } } },
      dismissed: [],
    };
    // Changed from No to Yes: the follow-up comes next, still as part of the edit.
    assert.equal(nextScreen(rows, yes, 0, true), 1);
    const answered: Draft = {
      picks: { late: { s1: { label: "Yes" }, s2: { label: "Line manager" } } },
      dismissed: [],
    };
    assert.equal(nextScreen(rows, answered, 1, true), null);
    // Not editing, the person walks on through the screens, then to the summary.
    assert.equal(nextScreen(rows, answered, 1, false), 2);
    assert.equal(nextScreen(rows, answered, 2, false), null);
  });

  it("summarizes what was chosen, what it records, and what can be changed", () => {
    const rows = [
      slotRow({ source: "RECORDED", value: "Jira", key: "tool" }),
      interviewRow(),
      interviewRow({
        key: "gone",
        topic: "Contractors",
        issue: { id: "i2", version: 1, point: false, conflict: false },
      }),
      interviewRow({
        key: "saved",
        topic: "Saved",
        source: "RECORDED",
        value: "On record.",
        issue: { id: "i3", version: 1, point: false, conflict: false },
      }),
    ];
    const draft: Draft = {
      picks: { late: { s1: { label: "No" } } },
      dismissed: ["gone"],
    };
    // What confirming saves comes first, then what is already on record.
    assert.deepEqual(summaryRows(rows, draft), [
      {
        key: "late",
        title: "Late removals",
        locked: false,
        short: "No",
        full: "A late removal is not reported.",
      },
      {
        key: "gone",
        title: "Contractors",
        locked: false,
        short: "Not applicable",
        full: "",
      },
      {
        key: "tool",
        title: "Which tool?",
        locked: false,
        short: "Jira",
        full: "",
      },
      {
        key: "saved",
        title: "Saved",
        locked: true,
        short: "On record.",
        full: "",
      },
    ]);
  });

  it("confirms the agents' questions together and never a client-specific one", () => {
    const rows = [
      slotRow({ key: "tool", source: "RECORDED", value: "Jira" }),
      interviewRow(),
      interviewRow({
        key: "gap",
        issue: { id: "i2", version: 4, point: false, conflict: false },
      }),
      interviewRow({
        key: "gone",
        issue: { id: "i3", version: 2, point: true, conflict: false },
      }),
      interviewRow({
        key: "source",
        steps: [],
        source: "CONFLICT",
        options: ['RCM: "1 day"'],
        issue: { id: "i4", version: 5, point: false, conflict: true },
      }),
      interviewRow({
        key: "dropped",
        steps: [],
        source: "CONFLICT",
        issue: { id: "i5", version: 6, point: false, conflict: true },
      }),
      interviewRow({
        key: "saved",
        source: "RECORDED",
        issue: { id: "i6", version: 1, point: false, conflict: false },
      }),
    ];
    const plan = confirmPlan(rows, {
      picks: {
        late: { s1: { label: "No" } },
        gap: { s1: { label: "Yes" }, s2: { label: "Line manager" } },
        source: { [ONE_SCREEN]: { label: 'RCM: "1 day"' } },
      },
      dismissed: ["gone", "dropped"],
    });
    assert.deepEqual(plan.points, [
      {
        issue_id: "i1",
        version: 3,
        answer: "A late removal is not reported.",
      },
    ]);
    assert.deepEqual(plan.resolved, [
      {
        issueId: "i2",
        version: 4,
        note: "A late removal is reported. The line manager receives it.",
      },
      { issueId: "i4", version: 5, note: 'RCM: "1 day"' },
    ]);
    assert.deepEqual(plan.dismissed, [
      {
        issueId: "i3",
        version: 2,
        note: "Marked not applicable in the control setup.",
      },
      { issueId: "i5", version: 6, note: "Dismissed in the control setup." },
    ]);
    assert.deepEqual(plan.settled.gone, "Not applicable");
    assert.equal("tool" in plan.settled, false);
    assert.equal("saved" in plan.settled, false);
  });

  it("confirms the usual answers word for word, so the record shows they were accepted", () => {
    const [row] = agentQuestions([
      {
        id: "i1",
        origin: "PROCESS",
        kind: "MISSING",
        topic: "Late removals",
        detail: "x",
        why: "",
        quotes: [],
        status: "OPEN",
        version: 2,
        question: "Is a late removal reported?",
        suggestions: [],
        proposal:
          "A late removal is reported. The IT Security Manager receives it.",
        proposalBasis: "TYPICAL",
        interview: steps,
      },
    ]);
    assert.ok(row !== undefined);
    assert.equal(row.topic, "Late removals");
    const plan = confirmPlan([row], {
      picks: {
        i1: { s1: { label: "Yes" }, s2: { label: "IT Security Manager" } },
      },
      dismissed: [],
    });
    assert.equal(plan.points[0]?.answer, row.value);
  });

  it("says where the answer already chosen comes from", () => {
    assert.equal(choiceTag(interviewRow(), "TYPICAL"), "Usual");
    assert.equal(choiceTag(interviewRow(), "SOURCES"), "From the records");
    assert.equal(choiceTag(slotRow(), ""), "Usual");
    assert.equal(
      choiceTag(slotRow({ source: "PRIOR_YEAR" }), ""),
      "Prior year",
    );
    assert.equal(
      choiceTag(slotRow({ source: "RECORDED" }), ""),
      "From the records",
    );
    assert.equal(choiceTag(slotRow({ source: "NONE" }), ""), "");
  });

  it("keeps unconfirmed answers apart for each control", () => {
    assert.notEqual(setupDraftKey("a"), setupDraftKey("b"));
    assert.notEqual(setupDraftKey("a"), setupBegunKey("a"));
  });
});

describe("the answers the agent pre-fills", () => {
  const slots = [
    {
      key: "ticketing-tool",
      question: "Which tool records the requests?",
      label: "the ticketing tool",
      value: "",
      blocks: false,
      options: ["ServiceNow", "Jira"],
    },
    {
      key: "provisioner",
      question: "Who grants access?",
      label: "the provisioner",
      value: "",
      blocks: true,
      options: ["IT service desk administrator", "IAM team"],
    },
    {
      key: "approver",
      question: "",
      label: "the approver",
      value: "User's manager",
      blocks: true,
      options: [],
    },
    {
      key: "threshold",
      question: "What is the threshold?",
      label: "the threshold",
      value: "",
      blocks: false,
      options: [],
    },
  ];
  const proposals = [
    {
      id: "p1",
      slotKey: "ticketing-tool",
      value: "ServiceNow",
      status: "PROPOSED",
    },
    { id: "p2", slotKey: "provisioner", value: "Old", status: "DISMISSED" },
  ];

  it("uses the record, then the prior year, then the usual answer, required first", () => {
    const rows = prefillAnswers(slots, proposals);
    assert.deepEqual(
      rows.map((row) => [row.key, row.value, row.source, row.required]),
      [
        ["provisioner", "IT service desk administrator", "USUAL", true],
        ["approver", "User's manager", "RECORDED", true],
        ["ticketing-tool", "ServiceNow", "PRIOR_YEAR", false],
        ["threshold", "", "NONE", false],
      ],
    );
    assert.equal(rows[1]?.question, "the approver");
  });
});

describe("one question at a time", () => {
  const row = (over: Partial<Prefill>): Prefill => ({
    key: "provisioner",
    question: "Who grants access?",
    required: true,
    value: "IT service desk administrator",
    source: "USUAL",
    proposalId: null,
    options: ["IT service desk administrator", "IAM team"],
    ...over,
  });

  it("offers the usual answers, with the agent's own answer first when it is not one", () => {
    assert.deepEqual(answerChoices(row({})), [
      "IT service desk administrator",
      "IAM team",
    ]);
    assert.deepEqual(answerChoices(row({ value: "Snowflake admin" })), [
      "Snowflake admin",
      "IT service desk administrator",
      "IAM team",
    ]);
    assert.deepEqual(answerChoices(row({ value: "", options: [] })), []);
  });

  it("starts at the first question not on record", () => {
    assert.equal(
      firstOpenQuestion([row({ source: "RECORDED" }), row({}), row({})]),
      1,
    );
    assert.equal(firstOpenQuestion([row({ source: "RECORDED" })]), 0);
  });

  it("saves the answer as the person's, or accepts the proposal it still is", () => {
    assert.deepEqual(
      saveOne(row({ source: "RECORDED" }), "IT service desk administrator"),
      {
        kind: "none",
      },
    );
    assert.deepEqual(
      saveOne(
        row({ source: "PRIOR_YEAR", proposalId: "p1" }),
        "IT service desk administrator",
      ),
      { kind: "accept", proposalId: "p1" },
    );
    assert.deepEqual(
      saveOne(row({ source: "PRIOR_YEAR", proposalId: "p1" }), "IAM team"),
      { kind: "value", value: "IAM team" },
    );
    assert.deepEqual(saveOne(row({}), " IAM team "), {
      kind: "value",
      value: "IAM team",
    });
  });
});

describe("the governing policy, answered from a linked document", () => {
  it("never holds evidence gathering, and a client can record it has none", () => {
    const answered = {
      ...fresh,
      approvedAttributes: 3,
      proposedAttributes: 0,
      plan: { exists: true, approved: true, pendingReview: false },
    };
    const held = setupSteps({
      ...answered,
      slots: [{ key: "doa-matrix", value: "", blocks: true, document: true }],
    });
    // Unanswered and even marked as blocking by the library: the setup can still complete.
    assert.equal(setupState(held, false).complete, true);
    const none = setupSteps({
      ...answered,
      slots: [
        {
          key: "doa-matrix",
          value: NO_DOCUMENT,
          blocks: false,
          document: true,
        },
      ],
    });
    const step = none.find((item) => item.key === "documents");
    assert.deepEqual(
      [step?.summary, step?.done, step?.optional],
      [NO_DOCUMENT, true, true],
    );
    // A document linked later still counts: the recorded answer does not hide it.
    const linked = setupSteps({
      ...answered,
      documents: 1,
      slots: [
        {
          key: "doa-matrix",
          value: NO_DOCUMENT,
          blocks: false,
          document: true,
        },
      ],
    });
    const linkedStep = linked.find((item) => item.key === "documents");
    assert.equal(linkedStep?.done, true);
    // The recorded answer is what the step says: "1 linked" would contradict it.
    assert.equal(linkedStep?.summary, NO_DOCUMENT);
    // The API reads the same words as established practice.
    assert.match(
      readFileSync(
        "services/api/ai_workforce_api/control_statements.py",
        "utf8",
      ),
      new RegExp(`NO_DOCUMENT = "${NO_DOCUMENT}"`),
    );
  });

  it("asks it on Governing documents, which stay optional: a client may have none", () => {
    const input: SetupInput = {
      ...fresh,
      slots: [
        { key: "provisioner", value: "x", blocks: true },
        { key: "approval-policy", value: "", blocks: true, document: true },
      ],
    };
    const steps = setupSteps(input);
    const answers = steps.find((step) => step.key === "answers");
    assert.deepEqual(
      [answers?.summary, answers?.done],
      ["All 1 answered", true],
    );
    const documents = steps.find((step) => step.key === "documents");
    assert.deepEqual(
      [documents?.summary, documents?.optional, documents?.done],
      ["Link the governing policy", true, false],
    );
    const linked = setupSteps({ ...input, documents: 2 });
    assert.equal(
      linked.find((step) => step.key === "documents")?.summary,
      "Choose the governing policy",
    );
    const chosen = setupSteps({
      ...input,
      documents: 2,
      slots: input.slots.map((slot) => ({ ...slot, value: "Access Policy" })),
    });
    assert.equal(chosen.find((step) => step.key === "documents")?.done, true);
    // Only document questions: no Control understanding step at all.
    const only = setupSteps({
      ...fresh,
      slots: [{ key: "policy", value: "", blocks: false, document: true }],
    });
    assert.equal(
      only.some((step) => step.key === "answers"),
      false,
    );
    assert.equal(only.find((step) => step.key === "documents")?.optional, true);
  });

  it("offers the control's policies first, then procedures, then the rest", () => {
    assert.deepEqual(
      documentChoices([
        { id: "1", title: "Leaver procedure", kind: "PROCEDURE" },
        { id: "2", title: "Network diagram", kind: "DIAGRAM" },
        { id: "3", title: "Access Security Policy", kind: "POLICY" },
        { id: "4", title: " ", kind: "POLICY" },
      ]).map((item) => item.title),
      ["Access Security Policy", "Leaver procedure", "Network diagram"],
    );
  });
});

describe("the introduction before the wizard", () => {
  it("counts the questions left, the governing documents among them", () => {
    assert.equal(
      questionsLeft({
        ...fresh,
        slots: [
          { key: "a", value: "x", blocks: true },
          { key: "b", value: " ", blocks: true },
          { key: "policy", value: "", blocks: false, document: true },
        ],
      }),
      2,
    );
  });

  it("says what is asked, in words for a small count", () => {
    assert.equal(
      introHeadline(4),
      "Answer four quick questions to help prepare a client-specific setup.",
    );
    assert.equal(
      introHeadline(1),
      "Answer one quick question to help prepare a client-specific setup.",
    );
    assert.equal(countWord(12), "12");
    assert.match(introHeadline(0), /^Review what the agent prepared/);
  });

  it("describes every step in a line and remembers a begun setup per control", () => {
    for (const step of setupSteps({
      ...fresh,
      processRequired: true,
      openQuestions: 1,
    })) {
      assert.ok(STEP_BRIEF[step.key].endsWith("."), step.key);
    }
    assert.equal(setupBegunKey("c1"), "control-setup-begun:c1");
  });
});

// The owner's rule (2 November 2026): the setup dialog keeps one size on every step.
describe("the setup dialog's frame", () => {
  const css = readFileSync("apps/web/app/control-setup.css", "utf8").replace(
    /\r\n/g,
    "\n",
  );
  const block = (selector: string): string => {
    const start = css.indexOf(`${selector} {`);
    assert.ok(start >= 0, `no ${selector} block`);
    return css.slice(start, css.indexOf("\n}", start));
  };

  it("has a fixed height that does not follow the step's content", () => {
    assert.match(
      block(".record-dialog.cs-dialog:not(.cs-intro)"),
      /\n {2}height: min\(/,
    );
  });

  it("scrolls a long step inside its card, clear of the pinned links", () => {
    const card = block(".cs-main > .cs-card");
    assert.match(card, /overflow-y: auto;/);
    // Regression (4 November 2026): the links' ground reaches past the card's padding, and
    // without this a long step showed a horizontal scrollbar.
    assert.match(card, /overflow-x: hidden;/);
    assert.match(card, /scroll-padding-bottom: /);
    assert.match(
      block(".cs-main > .cs-card > .cs-card-foot"),
      /position: sticky;/,
    );
  });

  it("keeps the backdrop margin off the full-screen phone layout", () => {
    const at = css.indexOf(".record-backdrop:has(> .cs-dialog)");
    const before = css.slice(0, at);
    assert.ok(
      before.lastIndexOf("@media (min-width: 961px)") >
        before.lastIndexOf("}\n\n"),
      "the pinned margin applies only above 960px",
    );
  });
});
