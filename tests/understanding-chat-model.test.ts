import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Draft, Prefill } from "../apps/web/src/control-setup-model.ts";
import {
  answeredTurns,
  askSeparately,
  CARRIED,
  chatRequest,
  copiedNote,
  copyChoices,
  copyOffer,
  copyTargetLine,
  draftText,
  extendInterview,
  greeting,
  interviewProgress,
  neededForLine,
  nextOpen,
  notesChosen,
  notesSummary,
  parseNotes,
  parseReading,
  parseReview,
  parseTargets,
  type Review,
  reviewGroups,
  startInterview,
  statusLine,
  stepOpen,
  withConfirmed,
} from "../apps/web/src/understanding-chat-model.ts";

const ORG = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const CONTROL = "33333333-3333-4333-8333-333333333333";
const ORACLE = "44444444-4444-4444-8444-444444444444";

function row(key: string, extra: Partial<Prefill> = {}): Prefill {
  return {
    key,
    question: `Question ${key}?`,
    required: true,
    value: "",
    source: "USUAL",
    proposalId: null,
    options: [],
    ...extra,
  };
}

describe("the engagement planner's greeting (9 November 2026)", () => {
  it("greets by name, says what it drafted from, and what is left", () => {
    const lines = greeting({
      firstName: "Avery",
      control: "ITGC-AC-01 · SAP ERP",
      priorYear: 2,
      documents: 1,
      open: 4,
      agentQuestions: 1,
      answered: 0,
    });
    assert.deepEqual(lines, [
      "Hello Avery. I'm the engagement planner. I drafted the understanding of ITGC-AC-01 · SAP ERP from the RCM, last year's file and the documents on file.",
      "4 points need you, 1 of them raised by the agents from the records. Each has a suggested answer: pick one, or tell me in your own words.",
    ]);
  });

  it("reads without a name, from the RCM alone, and when nothing is left", () => {
    const done = greeting({
      firstName: "",
      control: "ITGC-AC-01 · SAP ERP",
      priorYear: 0,
      documents: 0,
      open: 0,
      agentQuestions: 0,
      answered: 3,
    });
    assert.equal(
      done[0],
      "Hello. I'm the engagement planner. I drafted the understanding of ITGC-AC-01 · SAP ERP from the RCM.",
    );
    assert.equal(
      done[1],
      "All 3 points are on record. You can review them below.",
    );
    const one = greeting({
      firstName: "Sam",
      control: "X",
      priorYear: 0,
      documents: 0,
      open: 1,
      agentQuestions: 0,
      answered: 0,
    });
    assert.equal(
      one[1],
      "1 point needs you. Each has a suggested answer: pick one, or tell me in your own words.",
    );
  });
});

describe("the conversation so far", () => {
  it("lists each point answered before the one asked, as it will be recorded", () => {
    const rows = [
      row("approver"),
      row("tool", { source: "RECORDED", value: "ServiceNow" }),
      row("issue-1", {
        issue: { id: "i1", version: 1, point: false, conflict: false },
      }),
    ];
    const draft: Draft = {
      picks: { approver: { _: { label: "Line manager" } } },
      dismissed: ["issue-1"],
    };
    const screens = [
      { row: 0, step: "_" },
      { row: 1, step: "_" },
      { row: 2, step: "_" },
    ];
    assert.deepEqual(answeredTurns(rows, screens, draft, 3), [
      {
        key: "approver:_",
        row: "approver",
        question: "Question approver?",
        answer: "Line manager",
      },
      {
        key: "tool:_",
        row: "tool",
        question: "Question tool?",
        answer: "ServiceNow",
      },
      {
        key: "issue-1:_",
        row: "issue-1",
        question: "Question issue-1?",
        answer: "Not applicable",
      },
    ]);
    // Only what came before the point now asked.
    assert.equal(answeredTurns(rows, screens, draft, 1).length, 1);
    // Typed words are shown as typed.
    const typed: Draft = {
      picks: { approver: { _: { other: " IT security " } } },
      dismissed: [],
    };
    assert.equal(
      answeredTurns(rows, screens, typed, 1)[0]?.answer,
      "IT security",
    );
  });
});

describe("the offer to copy the answers to other systems", () => {
  it("offers only systems that would take an answer, and says what is kept", () => {
    const offered = copyOffer({
      controlRef: "ITGC-AC-01",
      system: "SAP ERP",
      targets: [
        {
          controlId: ORACLE,
          system: "Oracle EBS",
          fills: ["approver"],
          differs: ["tool"],
        },
        {
          controlId: CONTROL,
          system: "Workday",
          fills: [],
          differs: ["approver"],
        },
      ],
    });
    assert.ok(offered !== null);
    assert.deepEqual(
      offered.systems.map((item) => item.system),
      ["Oracle EBS"],
    );
    assert.equal(
      offered.text,
      "ITGC-AC-01 also runs on Oracle EBS. Do you want me to use these answers there too? Only the questions it has not answered are filled. Answers a system already has are kept as they are.",
    );
    assert.equal(copyOffer(null), null);
    assert.equal(
      copyOffer({ controlRef: "X", system: "Y", targets: [] }),
      null,
    );
    assert.equal(
      copiedNote(["Oracle EBS", "Workday"]),
      "Done. The answers are on Oracle EBS and Workday now, each recorded with where it came from.",
    );
  });
});

describe("what comes back from the API", () => {
  it("reads the planner's reading, and refuses what it cannot use", () => {
    assert.deepEqual(
      parseReading({ intent: "ANSWER", value: "Line manager", reply: "" }),
      {
        intent: "ANSWER",
        value: "Line manager",
        reply: "",
      },
    );
    assert.equal(
      parseReading({ intent: "ANSWER", value: " ", reply: "" }),
      null,
    );
    assert.equal(parseReading({ intent: "SAVE", value: "x", reply: "" }), null);
    assert.equal(parseReading(null), null);
    const found = parseTargets({
      control_ref: "ITGC-AC-01",
      system: "SAP ERP",
      targets: [
        {
          control_id: ORACLE,
          system: "Oracle EBS",
          fills: ["a", 3],
          differs: [],
        },
        "x",
      ],
    });
    assert.deepEqual(found, {
      controlRef: "ITGC-AC-01",
      system: "SAP ERP",
      targets: [
        { controlId: ORACLE, system: "Oracle EBS", fills: ["a"], differs: [] },
      ],
    });
    assert.equal(parseTargets({ targets: [] }), null);
  });

  it("sends only checked requests to the API", () => {
    const ids = {
      organization_id: ORG,
      project_id: PROJECT,
      control_id: CONTROL,
    };
    const base = `/organizations/${ORG}/projects/${PROJECT}/controls/${CONTROL}/understanding`;
    assert.deepEqual(chatRequest({ ...ids, intent: "targets" }), {
      method: "GET",
      path: `${base}/copy-targets`,
      body: null,
    });
    assert.deepEqual(
      chatRequest({
        ...ids,
        intent: "interpret",
        key: "approver",
        step: "",
        text: " Line manager ",
      }),
      {
        method: "POST",
        path: `${base}/interpret`,
        body: { key: "approver", step: "", text: "Line manager" },
      },
    );
    assert.deepEqual(
      chatRequest({
        ...ids,
        intent: "copy-out",
        targets: [ORACLE, ORACLE, "nope"],
      }),
      { method: "POST", path: `${base}/copy-out`, body: { targets: [ORACLE] } },
    );
    for (const bad of [
      { ...ids, intent: "interpret", key: "../x", text: "y" },
      { ...ids, intent: "interpret", key: "a", text: "" },
      { ...ids, intent: "interpret", key: "a", text: "x".repeat(601) },
      { ...ids, intent: "copy-out", targets: [] },
      { ...ids, intent: "delete" },
      { ...ids, control_id: "not-a-uuid", intent: "targets" },
    ]) {
      assert.deepEqual(
        chatRequest(bad),
        { error: "invalid" },
        JSON.stringify(bad),
      );
    }
  });
});

describe("the understanding as a draft to review", () => {
  const need = (key: string, extra: Record<string, unknown>) => ({
    key,
    kind: "ANSWER",
    label: key,
    question: `${key}?`,
    value: "",
    options: [],
    why: "",
    status: "MISSING",
    source: "NONE",
    needed_for: ["EVIDENCE"],
    proposal_id: null,
    required: true,
    ...extra,
  });
  const body = {
    control_ref: "ITGC-AC-01",
    system: "SAP ERP",
    other_systems: ["Oracle EBS"],
    statement: [
      { text: "Access is granted by ", key: null },
      { text: "[Approver]", key: "approver" },
    ],
    needs: [
      need("rcm-frequency", {
        kind: "RCM",
        status: "CONFIRMED",
        source: "RCM",
        value: "Daily",
      }),
      need("approver", {
        status: "PROPOSED",
        source: "USUAL",
        value: "Line manager",
        options: ["Line manager", "IT security"],
        needed_for: ["EVIDENCE", "ATTRIBUTES", "TESTING"],
      }),
      need("tool", {
        status: "PROPOSED",
        source: "PRIOR_YEAR",
        value: "ServiceNow",
        proposal_id: "p1",
      }),
      need("owner", {
        status: "CONFIRMED",
        source: "PERSON",
        value: "IT security",
      }),
      need("q1", {
        kind: "QUESTION",
        source: "AGENT",
        needed_for: ["EVIDENCE", "ATTRIBUTES"],
      }),
      need("odd", { kind: "NOT_A_KIND" }),
    ],
    evidence: { ready: false, missing: ["approver", "tool", "q1?", "x"] },
    attributes: { ready: true, missing: [] },
    attributes_approved: 3,
    attributes_proposed: 1,
  };

  it("reads the review, leaving out what it cannot read", () => {
    const review = parseReview(body);
    assert.ok(review !== null);
    assert.equal(review.needs.length, 5);
    assert.equal(review.statement[1]?.key, "approver");
    assert.equal(review.attributesProposed, 1);
    assert.equal(parseReview({ needs: [] }), null);
  });

  it("asks the person only what is theirs: last year's answers together, a guess one at a time", () => {
    const review = parseReview(body);
    assert.ok(review !== null);
    const groups = reviewGroups(review);
    // A usual-practice suggestion is a guess, never confirmed in bulk; testing's need first.
    assert.deepEqual(
      groups.needsYou.map((item) => item.key),
      ["approver", "q1"],
    );
    assert.deepEqual(
      groups.lastYear.map((item) => item.key),
      ["tool"],
    );
    assert.deepEqual(
      groups.confirmed.map((item) => item.key),
      ["owner"],
    );
    assert.deepEqual(
      groups.rcm.map((item) => item.key),
      ["rcm-frequency"],
    );
  });

  it("says in one line what the gates still wait for", () => {
    const review = parseReview(body);
    assert.ok(review !== null);
    assert.deepEqual(statusLine(review), {
      done: false,
      text: "4 points left before the evidence can be requested.",
    });
    assert.deepEqual(
      statusLine({
        ...review,
        evidence: { ready: true, missing: [] },
        attributes: { ready: false, missing: ["a"] },
      }),
      {
        done: false,
        text: "1 point left before the attributes can be finalized.",
      },
    );
    assert.deepEqual(
      statusLine({
        ...review,
        evidence: { ready: true, missing: [] },
        attributes: { ready: true, missing: [] },
      }),
      {
        done: true,
        text: "Understood. The evidence can be requested and the attributes finalized.",
      },
    );
    assert.equal(
      statusLine({ ...review, evidence: { ready: false, missing: [] } }).text,
      "Waiting for the understanding to be confirmed.",
    );
  });
});

describe("the draft's wording", () => {
  it("capitalizes a label that starts a sentence, and leaves a client's answer as given", () => {
    assert.equal(
      draftText("the role that grants access", "", true),
      "The role that grants access",
    );
    assert.equal(draftText("the role", "in the HR system. ", true), "The role");
    assert.equal(
      draftText("the HR system", "HR records each leaver in ", true),
      "the HR system",
    );
    assert.equal(draftText("daily", "", false), "daily");
  });
});

describe("an answer the server confirmed", () => {
  it("shows as on record at once, the rest unchanged", () => {
    const review = parseReview({
      control_ref: "X",
      system: "S",
      other_systems: [],
      statement: [],
      needs: [
        {
          key: "a",
          kind: "ANSWER",
          label: "a",
          question: "a?",
          value: "Usual",
          options: [],
          why: "",
          status: "PROPOSED",
          source: "USUAL",
          needed_for: ["EVIDENCE"],
          proposal_id: null,
          required: true,
        },
        {
          key: "b",
          kind: "ANSWER",
          label: "b",
          question: "b?",
          value: "",
          options: [],
          why: "",
          status: "MISSING",
          source: "NONE",
          needed_for: ["EVIDENCE"],
          proposal_id: null,
          required: true,
        },
      ],
      evidence: { ready: false, missing: ["a", "b"] },
      attributes: { ready: true, missing: [] },
      attributes_approved: 1,
      attributes_proposed: 0,
    });
    assert.ok(review !== null);
    const after = withConfirmed(review, { a: "IT security" });
    assert.deepEqual(
      after.needs.map((n) => [n.key, n.status, n.source, n.value]),
      [
        ["a", "CONFIRMED", "PERSON", "IT security"],
        ["b", "MISSING", "NONE", ""],
      ],
    );
    // Readiness waits for the server's next read.
    assert.deepEqual(after.evidence, review.evidence);
    assert.deepEqual(
      reviewGroups(after).confirmed.map((n) => n.key),
      ["a"],
    );
  });
});

describe("answers from walkthrough notes", () => {
  const body = {
    answers: [
      {
        key: "approver",
        question: "Who approves?",
        value: "Line manager",
        quote: "approved by the line manager",
        current: "",
      },
      {
        key: "tool",
        question: "Where?",
        value: "ServiceNow",
        quote: "raised in ServiceNow",
        current: "Jira",
      },
      { key: "bad", question: "?", value: " ", quote: "x", current: "" },
      "not an answer",
    ],
    asked: 5,
    source: "MODEL",
  };

  it("reads the planner's answers and leaves out what it cannot use", () => {
    const result = parseNotes(body);
    assert.ok(result !== null);
    assert.deepEqual(
      result.answers.map((a) => [a.key, a.value, a.current]),
      [
        ["approver", "Line manager", ""],
        ["tool", "ServiceNow", "Jira"],
      ],
    );
    assert.equal(result.source, "MODEL");
    assert.equal(parseNotes({ answers: "x" }), null);
  });

  it("never pre-selects an answer that would replace one on record", () => {
    const result = parseNotes(body);
    assert.ok(result !== null);
    assert.deepEqual(notesChosen(result.answers), {
      approver: true,
      tool: false,
    });
    assert.equal(
      notesSummary(result),
      "The planner found 2 answers in the notes, 1 of them different from an answer on record (left unticked). Each shows the words it rests on. Choose the ones to use.",
    );
    assert.equal(
      notesSummary({ answers: [], asked: 4, source: "RULES" }),
      "The notes give no answer that is not already on record. Nothing is changed.",
    );
  });

  it("sends notes of a sensible length only", () => {
    const ids = {
      organization_id: ORG,
      project_id: PROJECT,
      control_id: CONTROL,
      intent: "notes",
    };
    const base = `/organizations/${ORG}/projects/${PROJECT}/controls/${CONTROL}/understanding`;
    const notes =
      "Walkthrough with the access team: the line manager approves.";
    assert.deepEqual(chatRequest({ ...ids, text: ` ${notes} ` }), {
      method: "POST",
      path: `${base}/notes`,
      body: { text: notes },
    });
    assert.deepEqual(chatRequest({ ...ids, text: "Too short." }), {
      error: "invalid",
    });
    assert.deepEqual(chatRequest({ ...ids, text: "x".repeat(20001) }), {
      error: "invalid",
    });
  });
});

describe("the guided review: one point at a time (mock-up approved 9 November 2026)", () => {
  const need = (
    key: string,
    extra: Partial<Review["needs"][number]> = {},
  ): Review["needs"][number] => ({
    key,
    kind: "ANSWER",
    label: key,
    question: `${key}?`,
    value: "",
    options: [],
    why: "",
    status: "MISSING",
    source: "NONE",
    neededFor: ["EVIDENCE"],
    proposalId: null,
    required: true,
    ...extra,
  });
  const review = (needs: Review["needs"]): Review => ({
    controlRef: "ITGC-AC-02",
    system: "SAP ERP",
    otherSystems: [],
    statement: [],
    needs,
    evidence: { ready: false, missing: [] },
    attributes: { ready: false, missing: [] },
    attributesApproved: 0,
    attributesProposed: 0,
  });
  const lastYear = (key: string) =>
    need(key, {
      status: "PROPOSED",
      source: "PRIOR_YEAR",
      value: "ServiceNow",
      proposalId: `p-${key}`,
    });
  const start = review([
    need("rcm", { kind: "RCM", status: "CONFIRMED", source: "RCM" }),
    lastYear("tool"),
    lastYear("ticket"),
    need("approver", {
      status: "PROPOSED",
      source: "USUAL",
      value: "Line manager",
    }),
    need("reviewer"),
    need("policy", { kind: "DOCUMENT", required: false }),
    need("owner", { status: "CONFIRMED", source: "PERSON" }),
  ]);

  it("asks last year's answers first as one step, then each open point; nothing on record", () => {
    const course = startInterview(start);
    assert.deepEqual(course.carried, ["tool", "ticket"]);
    assert.deepEqual(course.plan, [CARRIED, "approver", "reviewer", "policy"]);
    assert.deepEqual(startInterview(review([need("a")])).plan, ["a"]);
  });

  it("counts every required point, last year's included, and marks one done only on record", () => {
    const course = startInterview(start);
    assert.deepEqual(interviewProgress(start, course), {
      done: 0,
      total: 4,
      marks: [false, false, false, false],
    });
    const after = withConfirmed(start, { tool: "ServiceNow", approver: "IT" });
    assert.equal(interviewProgress(after, course).done, 2);
    // A usual-practice suggestion is not done until it is confirmed.
    assert.equal(stepOpen(start, course, "approver"), true);
  });

  it("moves to the next open point, past ones settled meanwhile, and ends after the last", () => {
    const course = startInterview(start);
    const settled = withConfirmed(start, { approver: "IT" });
    assert.equal(nextOpen(settled, course, 0), 2);
    assert.equal(nextOpen(settled, course, -1), 0);
    const all = withConfirmed(settled, {
      tool: "a",
      ticket: "b",
      reviewer: "c",
      policy: "d",
    });
    assert.equal(nextOpen(all, course, -1), course.plan.length);
    // The carried step is open while any of last year's answers waits.
    assert.equal(
      stepOpen(withConfirmed(start, { tool: "a" }), course, CARRIED),
      true,
    );
  });

  it("keeps the course fixed after a save and adds a point a later read raises at the end", () => {
    const course = startInterview(start);
    const saved = withConfirmed(start, { approver: "IT" });
    assert.equal(extendInterview(saved, course), course);
    const raised = review([
      ...saved.needs,
      need("q1", { kind: "QUESTION", source: "AGENT" }),
    ]);
    assert.deepEqual(extendInterview(raised, course).plan, [
      CARRIED,
      "approver",
      "reviewer",
      "policy",
      "q1",
    ]);
  });

  it("asks a last-year answer the person did not confirm on its own, right after the carried step", () => {
    const course = askSeparately(startInterview(start), ["ticket", "nope"]);
    assert.deepEqual(course.carried, ["tool"]);
    assert.deepEqual(course.plan, [
      CARRIED,
      "ticket",
      "approver",
      "reviewer",
      "policy",
    ]);
    // Still counted once.
    assert.equal(interviewProgress(start, course).total, 4);
    assert.equal(extendInterview(start, course).plan.length, 5);
  });

  it("says what a point is needed for", () => {
    assert.equal(
      neededForLine(
        need("x", { neededFor: ["EVIDENCE", "ATTRIBUTES", "TESTING"] }),
      ),
      "Needed for D&I evidence · attributes · testing",
    );
    assert.equal(neededForLine(need("x", { neededFor: [] })), "");
  });
});

describe("what was read, in the summary (10 November 2026)", () => {
  it("names the policy when the policy was read", () => {
    const one = {
      answers: [
        {
          key: "pw-length",
          question: "Length?",
          value: "14 characters",
          quote: "q",
          current: "12 characters",
        },
      ],
      asked: 13,
      source: "RULES" as const,
    };
    assert.match(
      notesSummary(one, "policy"),
      /in the policy, 1 of them different/,
    );
    assert.match(notesSummary(one), /in the notes/);
    assert.equal(
      notesSummary({ answers: [], asked: 13, source: "RULES" }, "policy"),
      "The policy gives no answer that is not already on record. Nothing is changed.",
    );
  });
});

describe("copying the answers to the systems chosen (10 November 2026)", () => {
  const target = (
    fills: string[],
    differs: string[],
    controlId = ORACLE,
    system = "Oracle EBS",
  ) => ({ controlId, system, fills, differs });
  const WORKDAY = "55555555-5555-4555-8555-555555555555";

  it("offers only a system a copy would change, and keeps one the person has touched", () => {
    const found = {
      controlRef: "ITGC-AC-02",
      system: "SAP ERP",
      targets: [target(["a"], []), target([], ["b"], WORKDAY, "Workday HCM")],
    };
    assert.deepEqual(
      copyChoices(found, {}).map((t) => t.system),
      ["Oracle EBS"],
    );
    // Filled after the person ticked it: still offered, so it does not vanish.
    const filled = { ...found, targets: [target([], [])] };
    assert.deepEqual(copyChoices(filled, {}), []);
    assert.equal(copyChoices(filled, { [ORACLE]: true }).length, 1);
    assert.equal(copyChoices(filled, { [ORACLE]: false }).length, 1);
    assert.deepEqual(copyChoices(null, {}), []);
  });

  it("says, for each system, what copying fills, what it keeps, and what a tick means", () => {
    assert.equal(
      copyTargetLine(target(["a"], [])),
      "Fills 1 answer it does not have.",
    );
    assert.equal(
      copyTargetLine(target(["a", "b"], ["c"]), true),
      "Fills 2 answers it does not have; keeps 1 it answers differently.",
    );
    assert.equal(
      copyTargetLine(target([], []), true),
      "Up to date. New answers are copied as they are saved.",
    );
    assert.equal(
      copyTargetLine(target([], ["c"]), true),
      "Up to date; keeps 1 it answers differently. New answers are copied as they are saved.",
    );
    assert.equal(
      copyTargetLine(target([], []), false),
      "Not copied to from now on. Answers already copied stay.",
    );
    assert.equal(
      copyTargetLine(target([], ["c"])),
      "Has its own answers; nothing to fill now.",
    );
    assert.equal(copyTargetLine(target([], [])), "Nothing to fill yet.");
  });
});
