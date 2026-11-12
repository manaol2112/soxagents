import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Draft, Prefill } from "../apps/web/src/control-setup-model.ts";
import {
  ANSWER_MAX,
  afterTopicSave,
  answerDisplay,
  answeredTurns,
  answerList,
  askSeparately,
  CARRIED,
  carriedCopy,
  carriedSource,
  chatRequest,
  chosenStart,
  composeAnswer,
  composeMultiple,
  confirmsByProposal,
  copiedNote,
  copyChoices,
  copyOffer,
  copyTargetLine,
  draftedFrom,
  draftText,
  drivesLine,
  extendInterview,
  followUpShown,
  greeting,
  ignoredNote,
  interviewProgress,
  multipleAnswer,
  multipleProblem,
  multipleStart,
  multipleValue,
  type Need,
  neededForLine,
  nextAfterUnderstanding,
  nextOpen,
  notesChosen,
  notesSummary,
  OTHER_RULE,
  OTHER_SYSTEM_FALLBACK,
  opensFollowUp,
  otherProblem,
  otherSystemLabel,
  otherText,
  parseAnswer,
  parseMultiple,
  parseNotes,
  parseReading,
  parseReview,
  parseTargets,
  pickedValue,
  pickProblem,
  proposalMark,
  proposedPick,
  type Review,
  readyLines,
  restartInterview,
  reviewGroups,
  SAME_SYSTEM_FALLBACK,
  START_NONE,
  sameSystemLabel,
  startFromBanner,
  startFromField,
  startInterview,
  statusLine,
  stepOpen,
  stepRequired,
  stepTopic,
  toggleMultiple,
  topicAsks,
  topicBlocked,
  topicDone,
  topicHint,
  topicLeft,
  topicName,
  topicSave,
  topicShown,
  topicStep,
  walkthroughOutcome,
  walkthroughRecord,
  withConfirmed,
  withOther,
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
        // Rewritten 11 November 2026 (product owner: the finalized attributes drive the
        // design evidence). Old: "Understood. The evidence can be requested and the
        // attributes finalized." New: the attributes come next, and only once they are
        // settled is the D&I evidence the next step.
        done: true,
        text: "Understood. Next, finalize the attributes: the D&I evidence is requested against them.",
      },
    );
    assert.equal(
      statusLine({
        ...review,
        evidence: { ready: true, missing: [] },
        attributes: { ready: true, missing: [] },
        attributesSettled: true,
      }).text,
      // Was "…The D&I evidence can be released." There is no separate D&I release since the
      // D&I requests list (product owner, 12 November 2026: "I don't want a separate D&I
      // release"): the requests are reviewed and accepted, and drafting follows.
      "Understood, and the attributes are settled. The D&I requests are ready to review.",
    );
    assert.equal(
      statusLine({ ...review, evidence: { ready: false, missing: [] } }).text,
      "Waiting for the understanding to be confirmed.",
    );
  });

  it("leads to the attributes first, then the D&I evidence (11 November 2026)", () => {
    const parsed = parseReview({
      ...body,
      evidence: { ready: true, missing: [] },
      attributes: { ready: true, missing: [] },
      attributes_settled: false,
      attributes_waiting:
        "The attributes are not settled: 1 proposed attribute waits for a decision.",
    });
    assert.ok(parsed !== null);
    assert.equal(parsed.attributesSettled, false);
    assert.match(parsed.attributesWaiting, /1 proposed attribute waits/);
    // Understood, attributes not settled: the attributes are next, the evidence after them.
    assert.deepEqual(
      readyLines(parsed).map((line) => [line.key, line.ready, line.note]),
      [
        ["attributes", true, "1 to decide"],
        ["evidence", false, "After the attributes"],
      ],
    );
    assert.equal(nextAfterUnderstanding(parsed), "attributes");
    // Settled: both done, and the step that follows is the D&I evidence.
    const settled = {
      ...parsed,
      attributesSettled: true,
      attributesProposed: 0,
    };
    assert.deepEqual(
      readyLines(settled).map((line) => [line.text, line.ready, line.note]),
      [
        ["Attributes settled", true, "Done"],
        ["D&I evidence can be requested", true, "Ready"],
      ],
    );
    assert.equal(nextAfterUnderstanding(settled), "evidence");
    // Not understood yet: the evidence line counts what is left, never "Ready".
    const open = parseReview(body);
    assert.ok(open !== null);
    assert.deepEqual(
      readyLines(open).map((line) => [line.key, line.ready, line.note]),
      [
        ["attributes", true, "1 to decide"],
        ["evidence", false, "4 left"],
      ],
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
    multiple: false,
    ...extra,
  });
  const review = (needs: Review["needs"]): Review => ({
    controlRef: "ITGC-AC-02",
    system: "SAP ERP",
    otherSystems: [],
    statement: [],
    narrative: [],
    needs,
    evidence: { ready: false, missing: [] },
    attributes: { ready: false, missing: [] },
    attributesApproved: 0,
    attributesProposed: 0,
    attributesSettled: false,
    attributesWaiting: "",
    startFrom: { chosen: null, options: [] },
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

describe("answers used on this system, proposed by default (11 November 2026)", () => {
  const raw = (key: string, extra: Record<string, unknown>) => ({
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
  const read = (needs: unknown[]): Review => {
    const review = parseReview({
      control_ref: "ITGC-AC-02",
      system: "SAP S/4HANA",
      other_systems: [],
      statement: [],
      needs,
      evidence: { ready: false, missing: [] },
      attributes: { ready: false, missing: [] },
      attributes_approved: 0,
      attributes_proposed: 0,
    });
    assert.ok(review !== null);
    return review;
  };
  const system = (key: string, extra: Record<string, unknown> = {}) =>
    raw(key, {
      status: "PROPOSED",
      source: "SYSTEM",
      value: "SAP_ALL holders",
      options: ["SAP_ALL holders", "Basis team"],
      source_detail: "Used on 5 other controls on SAP S/4HANA",
      ...extra,
    });
  const lastYear = raw("tool", {
    status: "PROPOSED",
    source: "PRIOR_YEAR",
    value: "ServiceNow",
    proposal_id: "p1",
  });
  const usual = raw("approver", {
    status: "PROPOSED",
    source: "USUAL",
    value: "Line manager",
    options: ["Line manager"],
  });

  it("reads the source and its words, pre-selected as a proposal, never as on record", () => {
    const review = read([
      system("admin-role"),
      system("hr", { source_detail: 7 }),
    ]);
    const [admin, hr] = review.needs;
    assert.ok(admin !== undefined && hr !== undefined);
    assert.deepEqual(
      [admin.source, admin.status, admin.value, admin.sourceDetail],
      [
        "SYSTEM",
        "PROPOSED",
        "SAP_ALL holders",
        "Used on 5 other controls on SAP S/4HANA",
      ],
    );
    assert.equal(
      sameSystemLabel(admin),
      "Used on 5 other controls on SAP S/4HANA",
    );
    // Without the server's words, a plain line.
    assert.equal(hr.sourceDetail, "");
    assert.equal(sameSystemLabel(hr), SAME_SYSTEM_FALLBACK);
    assert.equal(SAME_SYSTEM_FALLBACK, "Used on other controls on this system");
    // Pre-selected as the answer to confirm; another source has no such line.
    assert.deepEqual(proposedPick(admin), ["SAP_ALL holders"]);
    assert.equal(sameSystemLabel(read([lastYear]).needs[0] as Need), "");
    // Not on record: nothing reads it as confirmed.
    assert.deepEqual(
      reviewGroups(review).confirmed.map((need) => need.key),
      [],
    );
    // An unknown source is still left out.
    assert.equal(read([raw("x", { source: "ELSEWHERE" })]).needs.length, 0);
  });

  it("confirms them together with last year's answers; a usual-practice guess stays one at a time", () => {
    const review = read([lastYear, system("admin-role"), usual]);
    const groups = reviewGroups(review);
    assert.deepEqual(
      groups.sameSystem.map((need) => need.key),
      ["admin-role"],
    );
    assert.deepEqual(
      groups.needsYou.map((need) => need.key),
      ["approver"],
    );
    const course = startInterview(review);
    assert.deepEqual(course.plan, [CARRIED, "approver"]);
    assert.deepEqual(course.carried, ["tool", "admin-role"]);
    assert.deepEqual(course.carriedFrom, {
      tool: "PRIOR_YEAR",
      "admin-role": "SYSTEM",
    });
    const mixed = carriedCopy(course, 2);
    assert.equal(mixed.title, "Confirm the answers already known");
    assert.equal(mixed.step, "Answers already known");
    assert.match(
      mixed.hint,
      /^2 answers come from last year's workpaper or this system's other controls\./,
    );
    assert.equal(
      carriedSource(course, review.needs[1] as Need),
      "Used on 5 other controls on SAP S/4HANA",
    );
    assert.equal(
      carriedSource(course, review.needs[0] as Need),
      "Last year's workpaper",
    );
    assert.equal(
      draftedFrom(groups, course),
      "Drafted from the RCM, last year's workpaper and this system's other controls",
    );
    // Confirmed: on record as the person's answer, its proposal words gone; the step keeps
    // saying where its answers came from.
    const after = withConfirmed(review, { "admin-role": "SAP_ALL holders" });
    const confirmed = after.needs[1];
    assert.deepEqual(
      [confirmed?.status, confirmed?.source, confirmed?.sourceDetail],
      ["CONFIRMED", "PERSON", ""],
    );
    assert.equal(stepOpen(after, course, CARRIED), true);
    assert.equal(
      carriedCopy(course, 0).title,
      "Confirm the answers already known",
    );
    // Unticked: asked on its own, right after the carried step, still counted once.
    const apart = askSeparately(course, ["admin-role"]);
    assert.deepEqual(apart.plan, [CARRIED, "admin-role", "approver"]);
    assert.deepEqual(apart.carried, ["tool"]);
    assert.equal(apart.carriedFrom["admin-role"], "SYSTEM");
    assert.equal(carriedCopy(apart, 1).title, "Confirm last year's answers");
  });

  it("names the step by where its answers came from", () => {
    const only = read([system("admin-role"), system("owner")]);
    const course = startInterview(only);
    const copy = carriedCopy(course, 2);
    assert.deepEqual(
      [copy.chip, copy.title, copy.step, copy.confirmed(2)],
      [
        "Used on this system",
        "Confirm the answers used on this system",
        "Answers used on this system",
        "2 answers used on this system confirmed.",
      ],
    );
    assert.equal(
      copy.hint,
      "2 answers were given for this system's other controls. Untick any that differ for this control; it is asked on its own.",
    );
    assert.equal(
      draftedFrom(reviewGroups(only), course),
      "Drafted from the RCM and this system's other controls",
    );
    // Last year's alone reads as before.
    const prior = startInterview(read([lastYear]));
    assert.deepEqual(
      [carriedCopy(prior, 1).title, carriedCopy(prior, 1).confirmed(1)],
      ["Confirm last year's answers", "1 answer from last year confirmed."],
    );
    assert.equal(carriedSource(prior, read([lastYear]).needs[0] as Need), "");
    assert.equal(
      draftedFrom(reviewGroups(read([usual])), startInterview(read([usual]))),
      "Drafted from the RCM",
    );
  });

  it("proposes a governing document used on this system for the same confirm-together step", () => {
    const review = read([
      system("access-policy", {
        kind: "DOCUMENT",
        value: "Access Management Policy v3",
        options: [],
        required: false,
        source_detail: "Used on 1 other control on SAP S/4HANA",
      }),
    ]);
    const course = startInterview(review);
    assert.deepEqual(course.carried, ["access-policy"]);
    assert.equal(
      sameSystemLabel(review.needs[0] as Need),
      "Used on 1 other control on SAP S/4HANA",
    );
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

describe("the walkthrough, one step per topic (11 November 2026)", () => {
  const wt = (key: string, extra: Record<string, unknown> = {}) => ({
    key,
    kind: "WALKTHROUGH",
    label: "Scope",
    question: `${key}?`,
    value: "",
    why: "",
    status: "MISSING",
    source: "NONE",
    needed_for: [],
    required: true,
    topic: "SCOPE",
    topic_label: "Scope",
    answer_kind: "CHOICE",
    options: ["All users", "Privileged users"],
    drives: ["SCOPE"],
    quote: "",
    ...extra,
  });
  const body = (needs: unknown[]) => ({
    control_ref: "ITGC-AC-01",
    system: "SAP ERP",
    statement: [],
    needs: [
      {
        key: "approver",
        kind: "ANSWER",
        label: "approver",
        question: "Who approves?",
        value: "",
        options: [],
        why: "",
        status: "MISSING",
        source: "NONE",
        needed_for: ["EVIDENCE"],
        required: true,
      },
      ...needs,
    ],
    evidence: { ready: false, missing: [] },
    attributes: { ready: false, missing: [] },
  });
  const read = (needs: unknown[]): Review => {
    const review = parseReview(body(needs));
    assert.ok(review !== null);
    return review;
  };
  // Rewritten 11 November 2026 (product owner: the questions were "not even organized in a
  // chronological manner"). Old: the needs came out of topic order on purpose, and the
  // client sorted them into its own TOPICS list. New: the server sends them in asking order
  // (the order the control runs in) and the client never re-sorts, so the fixture is in the
  // server's order; the tests below that supply needs out of the old order cover the change.
  const start = read([
    wt("wt-ac01-scope-users"),
    wt("wt-ac01-scope-apps", {
      answer_kind: "MULTI",
      options: ["SAP ERP", "Oracle EBS", "Workday"],
      status: "PROPOSED",
      source: "PRIOR_YEAR",
      value: "SAP ERP; Workday",
    }),
    wt("wt-ac01-scope-note", {
      answer_kind: "TEXT",
      options: [],
      required: false,
    }),
    wt("wt-ac01-sod-check", {
      topic: "SEGREGATION",
      topic_label: "Segregation of duties",
      answer_kind: "YES_NO",
      options: [],
      status: "PROPOSED",
      source: "AGENT",
      value: "Yes",
      quote: "Requesters cannot approve their own access.",
    }),
    wt("wt-ac01-records", {
      topic: "RECORDS",
      topic_label: "Records and system data",
      status: "CONFIRMED",
      source: "PERSON",
      value: "All users",
    }),
    wt("wt-ac01-volume", {
      topic: "VOLUME",
      topic_label: "Volume",
      answer_kind: "TEXT",
      options: [],
      required: false,
    }),
  ]);

  it("reads a walkthrough question, with defaults for what the API leaves out", () => {
    const sod = start.needs.find((need) => need.key === "wt-ac01-sod-check");
    // Rewritten 11 November 2026. Old: the walkthrough's facts were topic, label, kind, drives
    // and quote. New: they also say whether the question takes an Other answer
    // (allowsOther), false when the API leaves allows_other out. Why: choice questions take
    // the person's own words ("do not take multiple answers", product owner).
    assert.deepEqual(sod?.walkthrough, {
      topic: "SEGREGATION",
      topicLabel: "Segregation of duties",
      answerKind: "YES_NO",
      drives: ["SCOPE"],
      quote: "Requesters cannot approve their own access.",
      allowsOther: false,
      // Rewritten 12 November 2026 (review M1). Old: no follow-up facts. New: whenKey and
      // whenValue, "" when the API leaves when_key and when_value out. Why: the client must
      // know which answer opens a follow-up, so one its parent no longer opens is not saved.
      whenKey: "",
      whenValue: "",
    });
    // Yes or No is implied.
    assert.deepEqual(sod?.options, ["Yes", "No"]);
    const bare = read([
      {
        key: "wt-ac01-bare",
        kind: "WALKTHROUGH",
        status: "MISSING",
        source: "NONE",
        topic: "SERVICE_ORG",
      },
      {
        key: "wt-ac01-choices",
        kind: "WALKTHROUGH",
        status: "MISSING",
        source: "NONE",
        topic: "APPROVAL",
        options: ["Manager", "", "Manager", "Owner"],
        drives: ["SAMPLING", "NOT_A_DRIVE", "EVIDENCE"],
      },
      // A kind with nothing to choose from is asked in the person's own words.
      wt("wt-ac01-empty", { answer_kind: "MULTI", options: [] }),
      // Rewritten 11 November 2026. Old: a topic outside the client's TOPICS list was left
      // out, even with the API's label. New: the topics and their order are the server's, so
      // a topic the client does not know is placed when the API labels it ("wt-ac01-new");
      // one with no label to show, no topic, or a malformed name still cannot be placed.
      wt("wt-ac01-new", { topic: "ELSEWHERE", topic_label: "Elsewhere" }),
      wt("wt-ac01-lost", { topic: "ELSEWHERE", topic_label: "" }),
      wt("wt-ac01-none", { topic: undefined }),
      wt("wt-ac01-bad", { topic: "not a topic" }),
    ]);
    const one = bare.needs.find((need) => need.key === "wt-ac01-bare");
    // Rewritten 11 November 2026 (see above). Old: no allowsOther. New: allowsOther false
    // by default.
    assert.deepEqual(one?.walkthrough, {
      topic: "SERVICE_ORG",
      topicLabel: "Service organizations",
      answerKind: "TEXT",
      drives: [],
      quote: "",
      allowsOther: false,
      // Rewritten 12 November 2026 (see above). Old: no follow-up facts. New: "" by default.
      whenKey: "",
      whenValue: "",
    });
    assert.equal(one?.label, "Service organizations");
    assert.equal(one?.required, true);
    assert.deepEqual(one?.options, []);
    const choices = bare.needs.find((need) => need.key === "wt-ac01-choices");
    assert.equal(choices?.walkthrough?.answerKind, "CHOICE");
    assert.deepEqual(choices?.options, ["Manager", "Owner"]);
    assert.deepEqual(choices?.walkthrough?.drives, ["EVIDENCE", "SAMPLING"]);
    assert.equal(
      bare.needs.find((need) => need.key === "wt-ac01-empty")?.walkthrough
        ?.answerKind,
      "TEXT",
    );
    assert.deepEqual(
      bare.needs.map((need) => need.key),
      [
        "approver",
        "wt-ac01-bare",
        "wt-ac01-choices",
        "wt-ac01-empty",
        "wt-ac01-new",
      ],
    );
    assert.equal(
      bare.needs.find((need) => need.key === "wt-ac01-new")?.walkthrough
        ?.topicLabel,
      "Elsewhere",
    );
    // Other kinds carry no walkthrough facts.
    assert.equal(bare.needs[0]?.walkthrough, undefined);
  });

  it("keeps the walkthrough out of the points, last year's step and the record's points", () => {
    const groups = reviewGroups(start);
    assert.deepEqual(
      groups.needsYou.map((need) => need.key),
      ["approver"],
    );
    assert.deepEqual(groups.lastYear, []);
    assert.deepEqual(groups.confirmed, []);
    // In the server's order.
    assert.deepEqual(
      groups.walkthrough.map((need) => need.key),
      [
        "wt-ac01-scope-users",
        "wt-ac01-scope-apps",
        "wt-ac01-scope-note",
        "wt-ac01-sod-check",
        "wt-ac01-records",
        "wt-ac01-volume",
      ],
    );
  });

  it("asks the points first, then one step per open topic in the server's order", () => {
    const course = startInterview(start);
    // RECORDS is on record already: not asked.
    assert.deepEqual(course.plan, [
      "approver",
      "wt:SCOPE",
      "wt:SEGREGATION",
      "wt:VOLUME",
    ]);
    assert.equal(stepTopic("wt:SCOPE"), "SCOPE");
    // Rewritten 11 November 2026. Old: stepTopic("wt:NOPE") was null, NOPE not being in the
    // client's TOPICS list. New: the topics are the server's, so any well-formed name is a
    // topic step (one with no questions shows nothing to ask); a malformed one is not.
    assert.equal(stepTopic("wt:NOPE"), "NOPE");
    assert.equal(stepTopic("wt:not a topic"), null);
    assert.equal(stepTopic("wt:"), null);
    assert.equal(stepTopic("approver"), null);
    assert.equal(topicStep("SERVICE_ORG"), "wt:SERVICE_ORG");
    // A topic shows its open questions in the server's order; one on record only when
    // reopened.
    assert.deepEqual(
      topicAsks(start, "SCOPE").map((need) => need.key),
      ["wt-ac01-scope-users", "wt-ac01-scope-apps", "wt-ac01-scope-note"],
    );
    assert.deepEqual(topicAsks(start, "RECORDS"), []);
    assert.deepEqual(
      topicAsks(start, "RECORDS", ["wt-ac01-records"]).map((need) => need.key),
      ["wt-ac01-records"],
    );
  });

  it("holds a topic open on its required questions only; an optional one is asked and can be left", () => {
    const course = startInterview(start);
    assert.equal(topicDone(start, "SCOPE"), false);
    assert.equal(stepRequired(start, course, "wt:SCOPE"), true);
    // VOLUME has only an optional question: asked, but it holds nothing back.
    assert.equal(stepOpen(start, course, "wt:VOLUME"), true);
    assert.equal(stepRequired(start, course, "wt:VOLUME"), false);
    assert.equal(topicDone(start, "VOLUME"), true);
    const scoped = withConfirmed(start, {
      "wt-ac01-scope-users": "All users",
      "wt-ac01-scope-apps": "SAP ERP",
    });
    // The optional note is still unanswered: the step is still asked, but done.
    assert.equal(topicDone(scoped, "SCOPE"), true);
    assert.equal(stepOpen(scoped, course, "wt:SCOPE"), true);
    assert.equal(stepRequired(scoped, course, "wt:SCOPE"), false);
    // The next open step after the points is the first open topic; the end after the last.
    assert.equal(nextOpen(start, course, 0), 1);
    const all = withConfirmed(scoped, {
      "wt-ac01-scope-note": "n/a",
      "wt-ac01-sod-check": "Yes",
      "wt-ac01-volume": "About 40 a month",
      approver: "Line manager",
    });
    assert.equal(nextOpen(all, course, -1), course.plan.length);
  });

  it("counts each required walkthrough question on its own in the header", () => {
    const course = startInterview(start);
    // approver + 2 required on scope + 1 on segregation; the optional ones are not counted.
    assert.deepEqual(interviewProgress(start, course), {
      done: 0,
      total: 4,
      marks: [false, false, false, false],
    });
    const after = withConfirmed(start, {
      "wt-ac01-scope-users": "All users",
      "wt-ac01-sod-check": "Yes",
      "wt-ac01-scope-note": "Optional, not counted",
    });
    assert.deepEqual(interviewProgress(after, course), {
      done: 2,
      total: 4,
      marks: [false, true, false, true],
    });
    // A proposal is not done until it is confirmed.
    assert.equal(
      interviewProgress(start, course).marks[3],
      false,
      "the agents' proposed Yes is not on record",
    );
  });

  it("adds a follow-up's topic after the step the person is on, in the server's order", () => {
    const course = startInterview(start);
    const followUp = read([
      wt("wt-ac01-scope-users"),
      wt("wt-ac01-approval-who", {
        topic: "APPROVAL",
        topic_label: "Approval",
      }),
      wt("wt-ac01-sod-check", { topic: "SEGREGATION", options: ["Yes"] }),
      wt("wt-ac01-volume", { topic: "VOLUME", required: false }),
    ]);
    // On the scope step (index 1): APPROVAL comes before SEGREGATION.
    assert.deepEqual(extendInterview(followUp, course, 1).plan, [
      "approver",
      "wt:SCOPE",
      "wt:APPROVAL",
      "wt:SEGREGATION",
      "wt:VOLUME",
    ]);
    // Already past SEGREGATION (index 2): never placed at or before the step the person is on.
    assert.deepEqual(extendInterview(followUp, course, 2).plan, [
      "approver",
      "wt:SCOPE",
      "wt:SEGREGATION",
      "wt:APPROVAL",
      "wt:VOLUME",
    ]);
    // Without a position, at the end, as any point a later read raises.
    assert.deepEqual(extendInterview(followUp, course).plan.slice(-1), [
      "wt:APPROVAL",
    ]);
    // Nothing new: the same course.
    assert.equal(extendInterview(start, course, 1), course);
  });

  it("starts each question on its proposal, and saves only what is answered", () => {
    const [users, apps, note] = topicAsks(start, "SCOPE");
    const sod = topicAsks(start, "SEGREGATION")[0];
    assert.ok(users && apps && note && sod);
    assert.deepEqual(proposedPick(users), []);
    assert.deepEqual(proposedPick(apps), ["SAP ERP", "Workday"]);
    assert.deepEqual(proposedPick(sod), ["Yes"]);
    // MULTI answers in the listed order, joined with "; ".
    assert.equal(pickedValue(apps, ["Workday", "SAP ERP"]), "SAP ERP; Workday");
    assert.equal(pickedValue(apps, ["Not an option"]), "");
    assert.equal(pickedValue(users, ["All users", "Privileged users"]), "");
    assert.equal(pickedValue(sod, ["Maybe"]), "");
    assert.equal(pickedValue(note, ["  typed  "]), "typed");
    assert.equal(pickedValue(note, ["x".repeat(1001)]), "");
    // The untouched proposal is saved (saving confirms it); an unanswered one is left out.
    assert.deepEqual(topicSave([users, apps, note], {}), {
      "wt-ac01-scope-apps": {
        value: "SAP ERP; Workday",
        not_applicable: false,
      },
    });
    assert.deepEqual(
      topicSave([users, apps, note], {
        "wt-ac01-scope-users": ["Privileged users"],
        "wt-ac01-scope-apps": ["Oracle EBS"],
        "wt-ac01-scope-note": ["  "],
      }),
      {
        "wt-ac01-scope-users": {
          value: "Privileged users",
          not_applicable: false,
        },
        "wt-ac01-scope-apps": { value: "Oracle EBS", not_applicable: false },
      },
    );
    // An answer on record reopened and left as it was is not saved again.
    const records = topicAsks(start, "RECORDS", ["wt-ac01-records"]);
    assert.deepEqual(topicSave(records, {}), {});
    assert.deepEqual(
      topicSave(records, { "wt-ac01-records": ["Privileged users"] }),
      {
        "wt-ac01-records": { value: "Privileged users", not_applicable: false },
      },
    );
  });

  it("keeps the person on a topic when a required follow-up appears, else moves on", () => {
    const shown = ["wt-ac01-scope-users", "wt-ac01-scope-apps"];
    const saved = withConfirmed(start, {
      "wt-ac01-scope-users": "Privileged users",
      "wt-ac01-scope-apps": "SAP ERP",
    });
    assert.deepEqual(afterTopicSave(shown, saved, "SCOPE"), {
      stay: false,
      note: "",
    });
    const followUp = read([
      ...saved.needs
        .filter((need) => need.kind === "WALKTHROUGH")
        .map((need) =>
          wt(need.key, {
            topic: need.walkthrough?.topic,
            status: need.status,
            source: need.source,
            value: need.value,
            required: need.required,
          }),
        ),
      wt("wt-ac01-scope-privileged-who"),
    ]);
    assert.deepEqual(afterTopicSave(shown, followUp, "SCOPE"), {
      stay: true,
      note: "Your answers raised 1 follow-up question.",
    });
    // A required question left unanswered keeps the person there too.
    assert.deepEqual(
      afterTopicSave(
        shown,
        withConfirmed(start, { "wt-ac01-scope-apps": "SAP ERP" }),
        "SCOPE",
      ),
      { stay: true, note: "1 required question here still needs an answer." },
    );
  });

  it("shows the answers on record by topic, and words the reason and the hint", () => {
    const saved = withConfirmed(start, { "wt-ac01-sod-check": "No" });
    assert.deepEqual(
      walkthroughRecord(saved).map((group) => [
        group.label,
        group.needs.map((need) => need.value),
      ]),
      [
        ["Segregation of duties", ["No"]],
        ["Records and system data", ["All users"]],
      ],
    );
    assert.equal(
      drivesLine(["SAMPLING", "EVIDENCE"]),
      "The answer shapes the evidence requested and the sample.",
    );
    assert.equal(drivesLine([]), "");
    assert.equal(
      topicHint(topicAsks(start, "SCOPE"), "Scope"),
      "3 questions, 1 optional. A proposed answer is selected: confirm it by saving, or change it.",
    );
    assert.equal(
      topicHint(topicAsks(start, "VOLUME"), "Volume"),
      "1 question, all optional.",
    );
    assert.equal(
      topicHint([], "Records and system data"),
      "Every question on records and system data is on record.",
    );
  });

  it("reads the server's answer to a save, with the reason and how to recover", () => {
    // Rewritten 12 November 2026 (review M1). Old: a save's outcome was { saved }. New: it
    // also carries `ignored`, the follow-ups the server left out (0 when absent). Why: the
    // server may ignore a follow-up whose parent the same save answered with an answer that
    // does not open it, and that is a success, never a problem.
    assert.deepEqual(walkthroughOutcome(200, "", { saved: 2 }), {
      saved: 2,
      ignored: 0,
    });
    assert.deepEqual(walkthroughOutcome(200, "", null), {
      saved: 0,
      ignored: 0,
    });
    const problem = (status: number, detail: string) => {
      const outcome = walkthroughOutcome(status, detail, null);
      assert.ok("problem" in outcome);
      return outcome.problem;
    };
    assert.match(
      problem(422, "Choose exactly one option."),
      /^The answers were not saved: Choose exactly one option\. Correct the answer and save again\.$/,
    );
    assert.match(
      problem(409, "The control is locked for review"),
      /locked for review\. The understanding changed meanwhile/,
    );
    assert.match(problem(0, ""), /did not answer in time\. Try again\./);
    assert.match(problem(403, ""), /Ask the engagement lead for access/);
    assert.match(problem(422, ""), /under 1,000 characters, then save again/);
  });

  it("sends only checked walkthrough answers to the API", () => {
    const ids = {
      organization_id: ORG,
      project_id: PROJECT,
      control_id: CONTROL,
      intent: "walkthrough-answers",
    };
    assert.deepEqual(
      chatRequest({
        ...ids,
        answers: {
          "wt-ac01-sod-check": { value: " Yes ", not_applicable: false },
          "wt-ac01-scope-apps": {
            value: "SAP ERP; Workday",
            not_applicable: false,
          },
          "wt-ac01-scope-note": { value: "", not_applicable: true },
        },
      }),
      {
        method: "PUT",
        path: `/organizations/${ORG}/projects/${PROJECT}/controls/${CONTROL}/walkthrough-answers`,
        body: {
          answers: {
            "wt-ac01-sod-check": { value: "Yes", not_applicable: false },
            "wt-ac01-scope-apps": {
              value: "SAP ERP; Workday",
              not_applicable: false,
            },
            "wt-ac01-scope-note": { value: "", not_applicable: true },
          },
        },
      },
    );
    // The longest answer allowed.
    assert.equal(
      "method" in
        chatRequest({
          ...ids,
          answers: {
            "wt-ac01-note": { value: "x".repeat(1000), not_applicable: false },
          },
        }),
      true,
    );
    const many = Object.fromEntries(
      Array.from({ length: 41 }, (_, index) => [
        `wt-ac01-q${index}`,
        { value: "Yes", not_applicable: false },
      ]),
    );
    for (const answers of [
      undefined,
      {},
      [],
      "wt-ac01-x",
      many,
      // Keys: a walkthrough question's only.
      { approver: { value: "Yes", not_applicable: false } },
      { "wt-A": { value: "Yes", not_applicable: false } },
      { "wt-ac01_x": { value: "Yes", not_applicable: false } },
      { [`wt-${"a".repeat(61)}`]: { value: "Yes", not_applicable: false } },
      { "wt-../x": { value: "Yes", not_applicable: false } },
      // Values: 1 to 1,000 characters, a string.
      { "wt-ac01-x": { value: "", not_applicable: false } },
      { "wt-ac01-x": { value: "   ", not_applicable: false } },
      { "wt-ac01-x": { value: "x".repeat(1001), not_applicable: false } },
      { "wt-ac01-x": { value: 3, not_applicable: false } },
      { "wt-ac01-x": "Yes" },
      { "wt-ac01-x": null },
      // The flag: a boolean, and a question marked not applicable carries no answer.
      { "wt-ac01-x": { value: "Yes" } },
      { "wt-ac01-x": { value: "Yes", not_applicable: "false" } },
      { "wt-ac01-x": { value: "Yes", not_applicable: true } },
    ]) {
      assert.deepEqual(
        chatRequest({ ...ids, answers }),
        { error: "invalid" },
        JSON.stringify(answers),
      );
    }
    assert.deepEqual(
      chatRequest({
        ...ids,
        control_id: "not-a-uuid",
        answers: { "wt-ac01-x": { value: "Yes", not_applicable: false } },
      }),
      { error: "invalid" },
    );
  });
});

describe("walkthrough answers proposed from notes (11 November 2026)", () => {
  it("reads how many the planner proposed, and says so", () => {
    const result = parseNotes({
      answers: [],
      asked: 12,
      source: "MODEL",
      walkthrough_proposed: 3,
    });
    assert.ok(result !== null);
    assert.equal(result.walkthroughProposed, 3);
    assert.match(
      notesSummary(result),
      /^The planner proposed 3 walkthrough answers/,
    );
    assert.match(notesSummary(result), /confirm them in their topics\.$/);
    // Odd counts are not trusted; nothing proposed keeps the old sentence.
    for (const odd of [-1, 1.5, "2", null]) {
      assert.equal(
        parseNotes({ answers: [], walkthrough_proposed: odd })
          ?.walkthroughProposed,
        0,
      );
    }
    assert.match(
      notesSummary({
        answers: [],
        asked: 1,
        source: "RULES",
        walkthroughProposed: 0,
      }),
      /Nothing is changed\.$/,
    );
  });
});

describe("the walkthrough in the server's order, and its narrative (11 November 2026)", () => {
  // Product owner: the questions were "not even organized in a chronological manner", and the
  // understanding showed no update when an answer was given.
  const wt = (
    key: string,
    topic: string,
    extra: Record<string, unknown> = {},
  ) => ({
    key,
    kind: "WALKTHROUGH",
    question: `${key}?`,
    value: "",
    why: "",
    status: "MISSING",
    source: "NONE",
    needed_for: [],
    required: true,
    topic,
    answer_kind: "TEXT",
    options: [],
    drives: [],
    quote: "",
    ...extra,
  });
  const read = (needs: unknown[], extra: Record<string, unknown> = {}) => {
    const review = parseReview({
      control_ref: "ITGC-AC-01",
      system: "SAP ERP",
      statement: [{ text: "Access is granted on request.", key: null }],
      needs,
      evidence: { ready: false, missing: [] },
      attributes: { ready: false, missing: [] },
      ...extra,
    });
    assert.ok(review !== null);
    return review;
  };
  // Out of the client's old TOPICS order (SCOPE, POPULATION, INITIATION, ...) on purpose:
  // POPULATION now follows the control as it runs, and VOLUME before SCOPE stands for any
  // order the server chooses.
  const needs = [
    wt("wt-ac01-volume", "VOLUME", { topic_label: "Volume" }),
    wt("wt-ac01-scope-users", "SCOPE", {
      topic_label: "What the control covers",
    }),
    wt("wt-ac01-start", "INITIATION"),
    wt("wt-ac01-population", "POPULATION", {
      topic_label: "Population for testing",
    }),
    wt("wt-ac01-approver", "APPROVAL", {
      status: "CONFIRMED",
      source: "PERSON",
      value: "The user's manager",
    }),
    // A follow-up right after its parent, in the same topic.
    wt("wt-ac01-approver-standard", "APPROVAL", {
      status: "CONFIRMED",
      source: "PERSON",
      value: "the user's manager",
    }),
    wt("wt-ac01-scope-note", "SCOPE", { required: false }),
  ];

  it("follows the order the server first asks each topic, never a list of the client's", () => {
    const review = read(needs);
    assert.deepEqual(startInterview(review).plan, [
      "wt:VOLUME",
      "wt:SCOPE",
      "wt:INITIATION",
      "wt:POPULATION",
    ]);
    assert.deepEqual(
      reviewGroups(review).walkthrough.map((need) => need.key),
      needs.map((need) => need.key),
    );
    // The API's labels; the client's fallback, updated to the new names, when it gives none.
    assert.equal(topicName(review, "SCOPE"), "What the control covers");
    assert.equal(topicName(review, "INITIATION"), "How it starts");
    assert.equal(topicName(review, "APPROVAL"), "Approval");
    assert.equal(
      read([wt("wt-ac01-x", "POPULATION")]).needs[0]?.walkthrough?.topicLabel,
      "Population for testing",
    );
    assert.equal(
      read([wt("wt-ac01-x", "SCOPE")]).needs[0]?.walkthrough?.topicLabel,
      "What the control covers",
    );
  });

  it("places a topic a later read opens by the server's order, after the step the person is on", () => {
    const review = read(needs);
    const course = startInterview(review);
    // APPROVAL is opened by a new follow-up; the server first asks APPROVAL after POPULATION,
    // so it goes there, not where an alphabetical or fixed list would put it.
    const later = read([
      ...needs,
      wt("wt-ac01-approval-evidence", "APPROVAL", { required: true }),
    ]);
    assert.deepEqual(extendInterview(later, course, 0).plan, [
      "wt:VOLUME",
      "wt:SCOPE",
      "wt:INITIATION",
      "wt:POPULATION",
      "wt:APPROVAL",
    ]);
    // A server that asks APPROVAL before INITIATION: it goes there, the steps behind kept.
    const early = read([
      needs[0],
      needs[1],
      wt("wt-ac01-approval-evidence", "APPROVAL"),
      ...needs.slice(2),
    ]);
    assert.deepEqual(extendInterview(early, course, 1).plan, [
      "wt:VOLUME",
      "wt:SCOPE",
      "wt:APPROVAL",
      "wt:INITIATION",
      "wt:POPULATION",
    ]);
  });

  it("keeps the server's order inside a step: an optional question before a required one stays first", () => {
    const review = read([
      wt("wt-ac01-scope-note", "SCOPE", { required: false }),
      wt("wt-ac01-scope-users", "SCOPE"),
      wt("wt-ac01-scope-zz", "SCOPE"),
      wt("wt-ac01-scope-aa", "SCOPE", { required: false }),
    ]);
    assert.deepEqual(
      topicAsks(review, "SCOPE").map((need) => need.key),
      [
        "wt-ac01-scope-note",
        "wt-ac01-scope-users",
        "wt-ac01-scope-zz",
        "wt-ac01-scope-aa",
      ],
    );
    // An answer reopened to change keeps its place too.
    const saved = withConfirmed(review, { "wt-ac01-scope-users": "All users" });
    assert.deepEqual(
      topicAsks(saved, "SCOPE", ["wt-ac01-scope-users"]).map(
        (need) => need.key,
      ),
      [
        "wt-ac01-scope-note",
        "wt-ac01-scope-users",
        "wt-ac01-scope-zz",
        "wt-ac01-scope-aa",
      ],
    );
    assert.deepEqual(
      topicAsks(saved, "SCOPE").map((need) => need.key),
      ["wt-ac01-scope-note", "wt-ac01-scope-zz", "wt-ac01-scope-aa"],
    );
  });

  it("groups the answers on record by topic and question in the server's order", () => {
    const review = withConfirmed(read(needs), {
      "wt-ac01-scope-note": "Only SAP",
      "wt-ac01-volume": "About 40 a month",
    });
    assert.deepEqual(
      walkthroughRecord(review).map((group) => [
        group.topic,
        group.label,
        group.needs.map((need) => need.key),
      ]),
      [
        ["VOLUME", "Volume", ["wt-ac01-volume"]],
        ["SCOPE", "What the control covers", ["wt-ac01-scope-note"]],
        [
          "APPROVAL",
          "Approval",
          ["wt-ac01-approver", "wt-ac01-approver-standard"],
        ],
      ],
    );
  });

  it("reads the narrative: confirmed answers by topic, each answer linked to its question", () => {
    const narrative = [
      {
        topic: "APPROVAL",
        label: "Approval",
        parts: [
          { text: "Approval is recorded by ", key: null },
          { text: "the user's manager", key: "wt-ac01-approver-standard" },
          { text: ".", key: null },
        ],
      },
      // A topic the client does not know, with the API's label.
      {
        topic: "NEW_TOPIC",
        label: "  Something new  ",
        parts: [{ text: "It is new.", key: null }],
      },
    ];
    const review = read(needs, { narrative });
    assert.deepEqual(review.narrative, [
      narrative[0],
      {
        topic: "NEW_TOPIC",
        label: "Something new",
        parts: [{ text: "It is new.", key: null }],
      },
    ]);
    // Absent, empty or not a list: nothing to show.
    assert.deepEqual(read(needs).narrative, []);
    assert.deepEqual(read(needs, { narrative: [] }).narrative, []);
    assert.deepEqual(read(needs, { narrative: "Approval is…" }).narrative, []);
    // The narrative a save already showed is kept until the next read replaces it.
    assert.deepEqual(
      withConfirmed(review, { "wt-ac01-scope-note": "Only SAP" }).narrative,
      review.narrative,
    );
  });

  it("leaves out what it cannot read in the narrative, and never invents a label", () => {
    const review = read(needs, {
      narrative: [
        null,
        "APPROVAL",
        // No label from the API: the client's fallback names a known topic...
        {
          topic: "SCOPE",
          parts: [
            { text: "All users are in scope.", key: "wt-ac01-scope-users" },
          ],
        },
        // ...but an unknown topic with no label is left out.
        { topic: "MYSTERY", parts: [{ text: "Hidden.", key: null }] },
        // A malformed topic name, or no parts: left out.
        { topic: "bad topic", label: "Bad", parts: [{ text: "x", key: null }] },
        { topic: "EXECUTION", label: "Performing the control", parts: "x" },
        // Parts with no text, or a key that is not a string, are left out.
        {
          topic: "APPROVAL",
          label: "Approval",
          parts: [
            { text: "", key: null },
            { key: "wt-ac01-approver" },
            { text: "the manager", key: 7 },
            { text: "the manager", key: "" },
            null,
            { text: "Approved by ", key: null },
            { text: "the manager", key: "wt-ac01-approver" },
            // A key left out reads as plain text.
            { text: "." },
          ],
        },
        // A topic whose every part is off is left out.
        {
          topic: "RECORDS",
          label: "Records",
          parts: [{ text: 3, key: null }],
        },
        // A topic given twice keeps one paragraph, its parts in order.
        {
          topic: "APPROVAL",
          label: "Approval",
          parts: [{ text: "Recorded in ServiceNow.", key: null }],
        },
      ],
    });
    assert.deepEqual(review.narrative, [
      {
        topic: "SCOPE",
        label: "What the control covers",
        parts: [
          { text: "All users are in scope.", key: "wt-ac01-scope-users" },
        ],
      },
      {
        topic: "APPROVAL",
        label: "Approval",
        parts: [
          { text: "Approved by ", key: null },
          { text: "the manager", key: "wt-ac01-approver" },
          { text: ".", key: null },
          { text: " ", key: null },
          { text: "Recorded in ServiceNow.", key: null },
        ],
      },
    ]);
  });
});

describe("walkthrough answers with Other, and more than one answer (11 November 2026)", () => {
  // Product owner: "The questions in control understanding do not take multiple answers."
  // A CHOICE or MULTI question the server marks allows_other also takes the person's own
  // words, as "Other: <text>" (3 to 200 characters, no ";"), last in a MULTI.
  const wt = (key: string, extra: Record<string, unknown> = {}) => ({
    key,
    kind: "WALKTHROUGH",
    question: `${key}?`,
    value: "",
    why: "",
    status: "MISSING",
    source: "NONE",
    needed_for: [],
    required: true,
    topic: "INITIATION",
    answer_kind: "MULTI",
    options: ["HR feed", "Ticket", "Email"],
    allows_other: true,
    drives: [],
    quote: "",
    ...extra,
  });
  const read = (needs: unknown[]) => {
    const review = parseReview({
      control_ref: "ITGC-AC-01",
      system: "SAP ERP",
      statement: [],
      needs,
      evidence: { ready: false, missing: [] },
      attributes: { ready: false, missing: [] },
    });
    assert.ok(review !== null);
    return review;
  };
  const need = (extra: Record<string, unknown> = {}) => {
    const found = read([wt("wt-ac01-start", extra)]).needs[0];
    assert.ok(found !== undefined);
    return found;
  };
  const OPTIONS = ["HR feed", "Ticket", "Email"];

  it("reads allows_other, false when absent or the kind takes no choice", () => {
    const review = read([
      wt("wt-ac01-multi"),
      wt("wt-ac01-choice", { answer_kind: "CHOICE" }),
      wt("wt-ac01-absent", { allows_other: undefined }),
      wt("wt-ac01-string", { allows_other: "true" }),
      wt("wt-ac01-yesno", { answer_kind: "YES_NO" }),
      wt("wt-ac01-text", { answer_kind: "TEXT", options: [] }),
      // A listed "Other (describe)" is the client's own Other chip: never offered twice.
      wt("wt-ac01-listed", {
        options: ["HR feed", "Other (describe)", "other"],
      }),
      wt("wt-ac01-kept", {
        allows_other: false,
        options: ["HR feed", "Other (describe)"],
      }),
    ]);
    const other = (key: string) =>
      review.needs.find((each) => each.key === key)?.walkthrough?.allowsOther;
    assert.equal(other("wt-ac01-multi"), true);
    assert.equal(other("wt-ac01-choice"), true);
    assert.equal(other("wt-ac01-absent"), false);
    assert.equal(other("wt-ac01-string"), false);
    assert.equal(other("wt-ac01-yesno"), false);
    assert.equal(other("wt-ac01-text"), false);
    const options = (key: string) =>
      review.needs.find((each) => each.key === key)?.options;
    assert.deepEqual(options("wt-ac01-listed"), ["HR feed"]);
    assert.deepEqual(options("wt-ac01-kept"), ["HR feed", "Other (describe)"]);
  });

  it("checks the Other words: 3 to 200 characters after trimming, no semicolon", () => {
    assert.equal(otherProblem("  A call from HR  "), "");
    assert.equal(otherProblem("abc"), "");
    assert.equal(otherProblem("x".repeat(200)), "");
    assert.match(otherProblem(""), /at least 3 characters/);
    assert.match(otherProblem("  ab  "), /at least 3 characters/);
    assert.match(otherProblem("x".repeat(201)), /200 characters \(201 now\)/);
    assert.match(otherProblem("HR; then IT"), /Leave out ";"/);
    assert.equal(OTHER_RULE, '3 to 200 characters, without ";".');
  });

  it("composes a CHOICE: one option, or one Other part", () => {
    assert.equal(composeAnswer("CHOICE", OPTIONS, ["Ticket"], null), "Ticket");
    assert.equal(
      composeAnswer("CHOICE", OPTIONS, [], "  A call from HR  "),
      "Other: A call from HR",
    );
    // An option and Other together, two options, or nothing: no value.
    assert.equal(composeAnswer("CHOICE", OPTIONS, ["Ticket"], "A call"), "");
    assert.equal(
      composeAnswer("CHOICE", OPTIONS, ["Ticket", "Email"], null),
      "",
    );
    assert.equal(composeAnswer("CHOICE", OPTIONS, [], null), "");
    assert.equal(composeAnswer("CHOICE", OPTIONS, ["Fax"], null), "");
    // Words that cannot be saved: no value.
    assert.equal(composeAnswer("CHOICE", OPTIONS, [], "ab"), "");
    assert.equal(composeAnswer("CHOICE", OPTIONS, [], "a; b c"), "");
  });

  it("composes a MULTI: options in their listed order, the Other part last", () => {
    assert.equal(
      composeAnswer("MULTI", OPTIONS, ["Email", "HR feed"], null),
      "HR feed; Email",
    );
    assert.equal(
      composeAnswer("MULTI", OPTIONS, ["Email", "HR feed"], " A call from HR "),
      "HR feed; Email; Other: A call from HR",
    );
    assert.equal(
      composeAnswer("MULTI", OPTIONS, [], "A call from HR"),
      "Other: A call from HR",
    );
    assert.equal(
      composeAnswer("MULTI", OPTIONS, ["HR feed"], "x".repeat(201)),
      "",
    );
    assert.equal(composeAnswer("MULTI", OPTIONS, ["HR feed"], "HR; IT"), "");
  });

  it("parses a value back into its options and Other words", () => {
    assert.deepEqual(parseAnswer("CHOICE", OPTIONS, true, "Ticket"), {
      options: ["Ticket"],
      other: null,
    });
    assert.deepEqual(
      parseAnswer("CHOICE", OPTIONS, true, "Other: A call from HR"),
      { options: [], other: "A call from HR" },
    );
    assert.deepEqual(
      parseAnswer(
        "MULTI",
        OPTIONS,
        true,
        "HR feed; Email; Other: A call from HR",
      ),
      { options: ["HR feed", "Email"], other: "A call from HR" },
    );
    assert.deepEqual(parseAnswer("MULTI", OPTIONS, true, "Email; HR feed"), {
      options: ["HR feed", "Email"],
      other: null,
    });
    const none = { options: [], other: null };
    // Off the contract: two Other parts, Other not last, Other the question does not take,
    // words too short, a CHOICE naming an unknown option.
    assert.deepEqual(
      parseAnswer("MULTI", OPTIONS, true, "HR feed; Other: one; Other: two"),
      none,
    );
    assert.deepEqual(
      parseAnswer("MULTI", OPTIONS, true, "Other: A call; HR feed"),
      none,
    );
    assert.deepEqual(
      parseAnswer("MULTI", OPTIONS, false, "HR feed; Other: A call"),
      none,
    );
    assert.deepEqual(
      parseAnswer("CHOICE", OPTIONS, false, "Other: A call"),
      none,
    );
    assert.deepEqual(parseAnswer("CHOICE", OPTIONS, true, "Other: ab"), none);
    assert.deepEqual(parseAnswer("CHOICE", OPTIONS, true, "Fax"), none);
    // Round trip: what is composed reads back the same.
    const value = composeAnswer("MULTI", OPTIONS, ["Ticket"], "A call from HR");
    const back = parseAnswer("MULTI", OPTIONS, true, value);
    assert.equal(
      composeAnswer("MULTI", OPTIONS, back.options, back.other),
      value,
    );
  });

  it("holds Other in a pick as one entry: CHOICE replaces, MULTI combines", () => {
    assert.deepEqual(withOther("CHOICE", ["Ticket"], "A call"), [
      "Other: A call",
    ]);
    assert.deepEqual(withOther("CHOICE", ["Other: A call"], null), []);
    assert.deepEqual(withOther("MULTI", ["Ticket", "Other: old"], "new "), [
      "Ticket",
      "Other: new ",
    ]);
    assert.deepEqual(withOther("MULTI", ["Ticket", "Other: old"], null), [
      "Ticket",
    ]);
    assert.equal(otherText(["Ticket", "Other:  typed "]), " typed ");
    assert.equal(otherText(["Ticket"]), null);
  });

  it("starts a question on a saved or proposed Other answer, and saves it as composed", () => {
    const multi = need({
      status: "CONFIRMED",
      source: "PERSON",
      value: "HR feed; Other: A call from HR on the day",
    });
    assert.deepEqual(proposedPick(multi), [
      "HR feed",
      "Other: A call from HR on the day",
    ]);
    const choice = need({
      answer_kind: "CHOICE",
      status: "PROPOSED",
      source: "AGENT",
      value: "Other: A call from HR on the day",
    });
    assert.deepEqual(proposedPick(choice), [
      "Other: A call from HR on the day",
    ]);
    assert.equal(pickedValue(choice, proposedPick(choice)), choice.value);
    // A proposal with an Other the question does not take starts on nothing chosen.
    const closed = need({
      allows_other: false,
      status: "PROPOSED",
      source: "AGENT",
      value: "HR feed; Other: A call from HR",
    });
    assert.deepEqual(proposedPick(closed), []);
    assert.equal(pickedValue(closed, ["HR feed", "Other: A call"]), "HR feed");
    // A reopened answer left as it was is not saved again; the Other words changed are.
    assert.deepEqual(topicSave([multi], {}), {});
    assert.deepEqual(
      topicSave([multi], {
        "wt-ac01-start": ["Other:  A call from IT ", "Email"],
      }),
      {
        "wt-ac01-start": {
          value: "Email; Other: A call from IT",
          not_applicable: false,
        },
      },
    );
    // CHOICE: an option and Other together is no answer.
    assert.equal(pickedValue(choice, ["Ticket", "Other: A call"]), "");
  });

  it("holds the topic's save while a chosen Other has words that cannot be saved", () => {
    const multi = need();
    assert.equal(pickProblem(multi, ["HR feed"]), "");
    assert.match(pickProblem(multi, ["HR feed", "Other: "]), /at least 3/);
    assert.match(pickProblem(multi, ["Other: a; b"]), /Leave out ";"/);
    assert.equal(
      topicBlocked([multi], { "wt-ac01-start": ["HR feed", "Other: ab"] })?.key,
      "wt-ac01-start",
    );
    assert.equal(
      topicBlocked([multi], { "wt-ac01-start": ["HR feed", "Other: abc"] }),
      null,
    );
    assert.equal(topicBlocked([multi], {}), null);
    // Nothing is sent for it meanwhile.
    assert.deepEqual(
      topicSave([multi], { "wt-ac01-start": ["HR feed", "Other: ab"] }),
      {},
    );
  });

  it("shows an answer on record without the Other prefix", () => {
    assert.equal(
      answerDisplay(
        need({
          status: "CONFIRMED",
          value: "HR feed; Other: A call from HR on the day",
        }),
      ),
      "HR feed, A call from HR on the day",
    );
    assert.equal(
      answerDisplay(
        need({
          answer_kind: "CHOICE",
          status: "CONFIRMED",
          value: "Other: A call",
        }),
      ),
      "A call",
    );
    assert.equal(
      answerDisplay(
        need({ answer_kind: "CHOICE", status: "CONFIRMED", value: "Ticket" }),
      ),
      "Ticket",
    );
    // A typed answer is shown as given, even one that starts with the words "Other: ".
    assert.equal(
      answerDisplay(
        need({
          answer_kind: "TEXT",
          options: [],
          status: "CONFIRMED",
          value: "Other: as typed",
        }),
      ),
      "Other: as typed",
    );
  });
});

describe("follow-ups a changed answer no longer opens (12 November 2026, review M1)", () => {
  // A follow-up names its parent (when_key) and the answer that opens it (when_value). The
  // server refused a whole topic save (409 "not asked") when it held a follow-up whose parent
  // the person had just changed; the step now hides that follow-up and never saves it.
  const wt = (key: string, extra: Record<string, unknown> = {}) => ({
    key,
    kind: "WALKTHROUGH",
    question: `${key}?`,
    value: "",
    why: "",
    status: "MISSING",
    source: "NONE",
    needed_for: [],
    required: true,
    topic: "APPROVAL",
    answer_kind: "CHOICE",
    options: ["Manager", "Owner", "Nobody"],
    drives: [],
    quote: "",
    ...extra,
  });
  const read = (needs: unknown[]): Review => {
    const review = parseReview({
      control_ref: "ITGC-AC-01",
      system: "SAP ERP",
      statement: [],
      needs,
      evidence: { ready: false, missing: [] },
      attributes: { ready: false, missing: [] },
    });
    assert.ok(review !== null);
    return review;
  };
  const byKey = (review: Review, key: string) => {
    const found = review.needs.find((need) => need.key === key);
    assert.ok(found !== undefined);
    return found;
  };
  // The approver on record is the manager; the follow-up on how the manager approves is
  // open, and the agents propose an answer for it.
  const review = read([
    wt("wt-ac01-approver", {
      status: "CONFIRMED",
      source: "PERSON",
      value: "Manager",
    }),
    wt("wt-ac01-manager-how", {
      answer_kind: "TEXT",
      options: [],
      status: "PROPOSED",
      source: "AGENT",
      value: "In the ticket",
      when_key: "wt-ac01-approver",
      when_value: "Manager",
    }),
    wt("wt-ac01-reviewed", {
      answer_kind: "YES_NO",
      options: [],
      status: "CONFIRMED",
      source: "PERSON",
      value: "Yes",
    }),
    wt("wt-ac01-reviewed-by", {
      status: "MISSING",
      when_key: "wt-ac01-reviewed",
      when_value: "Yes",
    }),
    wt("wt-ac01-channels", {
      answer_kind: "MULTI",
      options: ["Ticket", "Email", "Chat"],
      status: "CONFIRMED",
      source: "PERSON",
      value: "Ticket; Email",
    }),
    wt("wt-ac01-email-kept", {
      answer_kind: "YES_NO",
      options: [],
      when_key: "wt-ac01-channels",
      when_value: "Email",
    }),
  ]);
  const reopenedAll = [
    "wt-ac01-approver",
    "wt-ac01-reviewed",
    "wt-ac01-channels",
  ];

  it('reads when_key and when_value, "" when absent or not usable', () => {
    const parsed = read([
      wt("wt-ac01-root"),
      wt("wt-ac01-child", {
        when_key: " wt-ac01-root ",
        when_value: " Manager ",
      }),
      wt("wt-ac01-no-value", { when_key: "wt-ac01-root", when_value: "" }),
      wt("wt-ac01-no-key", { when_key: "", when_value: "Manager" }),
      wt("wt-ac01-wrong-type", { when_key: 7, when_value: ["Manager"] }),
      wt("wt-ac01-self", {
        when_key: "wt-ac01-self",
        when_value: "Manager",
      }),
    ]);
    const facts = (key: string) => {
      const wtFacts = byKey(parsed, key).walkthrough;
      return [wtFacts?.whenKey, wtFacts?.whenValue];
    };
    assert.deepEqual(facts("wt-ac01-root"), ["", ""]);
    assert.deepEqual(facts("wt-ac01-child"), ["wt-ac01-root", "Manager"]);
    assert.deepEqual(facts("wt-ac01-no-value"), ["", ""]);
    assert.deepEqual(facts("wt-ac01-no-key"), ["", ""]);
    assert.deepEqual(facts("wt-ac01-wrong-type"), ["", ""]);
    assert.deepEqual(facts("wt-ac01-self"), ["", ""]);
  });

  it("opens a follow-up on a CHOICE or Yes/No answer when equal, a MULTI when one part is", () => {
    const choice = byKey(review, "wt-ac01-approver");
    const yesNo = byKey(review, "wt-ac01-reviewed");
    const multi = byKey(review, "wt-ac01-channels");
    assert.equal(opensFollowUp(choice, ["Manager"], "Manager"), true);
    assert.equal(opensFollowUp(choice, ["Owner"], "Manager"), false);
    assert.equal(opensFollowUp(choice, ["Other: A peer"], "Manager"), false);
    assert.equal(opensFollowUp(choice, [], "Manager"), false);
    assert.equal(opensFollowUp(yesNo, ["Yes"], "Yes"), true);
    assert.equal(opensFollowUp(yesNo, ["No"], "Yes"), false);
    assert.equal(opensFollowUp(multi, ["Ticket", "Email"], "Email"), true);
    assert.equal(opensFollowUp(multi, ["Email"], "Email"), true);
    assert.equal(opensFollowUp(multi, ["Ticket", "Chat"], "Email"), false);
    assert.equal(opensFollowUp(multi, [], "Email"), false);
  });

  it("shows a follow-up by its parent's current pick, else by the answer on record", () => {
    // Not reopened: each parent's answer on record opens its follow-up.
    const asked = topicAsks(review, "APPROVAL");
    assert.deepEqual(
      asked.map((need) => need.key),
      ["wt-ac01-manager-how", "wt-ac01-reviewed-by", "wt-ac01-email-kept"],
    );
    assert.deepEqual(
      topicShown(asked, {}, review.needs).map((need) => need.key),
      ["wt-ac01-manager-how", "wt-ac01-reviewed-by", "wt-ac01-email-kept"],
    );
    // A pick made for a parent the step does not ask (not being changed) does not count.
    assert.deepEqual(
      topicShown(asked, { "wt-ac01-approver": ["Owner"] }, review.needs).map(
        (need) => need.key,
      ),
      ["wt-ac01-manager-how", "wt-ac01-reviewed-by", "wt-ac01-email-kept"],
    );
    // Reopened and untouched: the answer on record still opens them.
    const changing = topicAsks(review, "APPROVAL", reopenedAll);
    assert.equal(
      topicShown(changing, {}, review.needs).length,
      changing.length,
    );
    // Reopened and changed: each follow-up follows its parent's pick, kind by kind.
    const picks = {
      "wt-ac01-approver": ["Owner"],
      "wt-ac01-reviewed": ["No"],
      "wt-ac01-channels": ["Ticket", "Chat"],
    };
    assert.deepEqual(
      topicShown(changing, picks, review.needs).map((need) => need.key),
      ["wt-ac01-approver", "wt-ac01-reviewed", "wt-ac01-channels"],
    );
    // Switched back: shown again.
    const back = {
      "wt-ac01-approver": ["Manager"],
      "wt-ac01-reviewed": ["Yes"],
      "wt-ac01-channels": ["Email"],
    };
    assert.equal(
      topicShown(changing, back, review.needs).length,
      changing.length,
    );
    // A parent not on record and not in the step opens nothing; one the review does not
    // hold leaves the server's listing as it is.
    const unanswered = read([
      wt("wt-ac01-approver", { status: "MISSING" }),
      wt("wt-ac01-manager-how", {
        when_key: "wt-ac01-approver",
        when_value: "Manager",
      }),
      wt("wt-ac01-orphan", {
        when_key: "wt-ac01-elsewhere",
        when_value: "Manager",
      }),
    ]);
    const child = byKey(unanswered, "wt-ac01-manager-how");
    const orphan = byKey(unanswered, "wt-ac01-orphan");
    assert.equal(followUpShown(child, [child], {}, unanswered.needs), false);
    assert.equal(followUpShown(orphan, [orphan], {}, unanswered.needs), true);
  });

  it("starts a CHOICE question on its option on record or proposed (regression)", () => {
    // Found 12 November 2026: a CHOICE answer that is one option started on nothing chosen,
    // so its proposal was not pre-picked or saved, and a parent on record opened nothing.
    const approver = byKey(review, "wt-ac01-approver");
    assert.deepEqual(proposedPick(approver), ["Manager"]);
    const proposed = read([
      wt("wt-ac01-approver", {
        status: "PROPOSED",
        source: "AGENT",
        value: "Owner",
      }),
    ]);
    assert.deepEqual(topicSave(topicAsks(proposed, "APPROVAL"), {}), {
      "wt-ac01-approver": { value: "Owner", not_applicable: false },
    });
  });

  it("hides a follow-up of a follow-up its hidden parent no longer opens", () => {
    const chain = read([
      wt("wt-ac01-approver", {
        status: "CONFIRMED",
        source: "PERSON",
        value: "Manager",
      }),
      wt("wt-ac01-manager-kind", {
        status: "CONFIRMED",
        source: "PERSON",
        value: "Owner",
        when_key: "wt-ac01-approver",
        when_value: "Manager",
      }),
      wt("wt-ac01-owner-note", {
        answer_kind: "TEXT",
        options: [],
        when_key: "wt-ac01-manager-kind",
        when_value: "Owner",
      }),
    ]);
    const asked = topicAsks(chain, "APPROVAL", ["wt-ac01-approver"]);
    const picks = {
      "wt-ac01-approver": ["Nobody"],
      "wt-ac01-owner-note": ["Typed before the change"],
    };
    assert.deepEqual(
      topicShown(asked, picks, chain.needs).map((need) => need.key),
      ["wt-ac01-approver"],
    );
    assert.deepEqual(topicSave(asked, picks, chain.needs), {
      "wt-ac01-approver": { value: "Nobody", not_applicable: false },
    });
  });

  it("leaves out of the save a follow-up its parent's pick no longer opens, typed or proposed", () => {
    const changing = topicAsks(review, "APPROVAL", reopenedAll);
    const typed = {
      "wt-ac01-approver": ["Owner"],
      "wt-ac01-manager-how": ["Typed before the change"],
      "wt-ac01-reviewed": ["No"],
      "wt-ac01-reviewed-by": ["Manager"],
      "wt-ac01-channels": ["Ticket"],
      "wt-ac01-email-kept": ["Yes"],
    };
    assert.deepEqual(topicSave(changing, typed, review.needs), {
      "wt-ac01-approver": { value: "Owner", not_applicable: false },
      "wt-ac01-reviewed": { value: "No", not_applicable: false },
      "wt-ac01-channels": { value: "Ticket", not_applicable: false },
    });
    // The agents' proposal, untouched, is left out too: it is no longer pre-picked.
    assert.deepEqual(
      topicSave(changing, { "wt-ac01-approver": ["Owner"] }, review.needs),
      { "wt-ac01-approver": { value: "Owner", not_applicable: false } },
    );
    // While the parent's pick opens it, the follow-up is saved with it.
    assert.deepEqual(
      topicSave(
        changing,
        {
          ...typed,
          "wt-ac01-approver": ["Manager"],
          "wt-ac01-reviewed": ["Yes"],
          "wt-ac01-channels": ["Email", "Chat"],
        },
        review.needs,
      ),
      {
        "wt-ac01-manager-how": {
          value: "Typed before the change",
          not_applicable: false,
        },
        "wt-ac01-reviewed-by": { value: "Manager", not_applicable: false },
        "wt-ac01-channels": { value: "Email; Chat", not_applicable: false },
        "wt-ac01-email-kept": { value: "Yes", not_applicable: false },
      },
    );
    // Not reopened: the proposal and the answers follow the answers on record.
    assert.deepEqual(
      topicSave(topicAsks(review, "APPROVAL"), {}, review.needs),
      {
        "wt-ac01-manager-how": {
          value: "In the ticket",
          not_applicable: false,
        },
      },
    );
  });

  it("never lets a hidden required follow-up hold the save back", () => {
    const changing = topicAsks(review, "APPROVAL", reopenedAll);
    // Shown: two required follow-ups are unanswered, and an Other answer too short to save
    // would block the save.
    const open = {
      "wt-ac01-manager-how": [""],
      "wt-ac01-reviewed-by": ["Other: x"],
    };
    const withOtherAllowed = changing.map((need) =>
      need.key === "wt-ac01-reviewed-by" && need.walkthrough !== undefined
        ? { ...need, walkthrough: { ...need.walkthrough, allowsOther: true } }
        : need,
    );
    assert.equal(topicLeft(withOtherAllowed, open, review.needs), 3);
    assert.equal(
      topicBlocked(withOtherAllowed, open, review.needs)?.key,
      "wt-ac01-reviewed-by",
    );
    // Hidden by their parents' picks: nothing left, nothing blocked, the parents saved.
    const changed = {
      ...open,
      "wt-ac01-approver": ["Owner"],
      "wt-ac01-reviewed": ["No"],
      "wt-ac01-channels": ["Chat"],
    };
    assert.equal(topicLeft(withOtherAllowed, changed, review.needs), 0);
    assert.equal(topicBlocked(withOtherAllowed, changed, review.needs), null);
    assert.deepEqual(
      Object.keys(topicSave(withOtherAllowed, changed, review.needs)),
      ["wt-ac01-approver", "wt-ac01-reviewed", "wt-ac01-channels"],
    );
  });

  it("reads `ignored` in a save's answer as a success, with a quiet note", () => {
    assert.deepEqual(walkthroughOutcome(200, "", { saved: 2, ignored: 1 }), {
      saved: 2,
      ignored: 1,
    });
    // Off the contract: read as none.
    assert.deepEqual(walkthroughOutcome(200, "", { saved: 1, ignored: "1" }), {
      saved: 1,
      ignored: 0,
    });
    assert.deepEqual(walkthroughOutcome(200, "", { saved: 1, ignored: -2 }), {
      saved: 1,
      ignored: 0,
    });
    assert.equal(ignoredNote(0), "");
    assert.equal(
      ignoredNote(1),
      " 1 follow-up no longer applied and was left out.",
    );
    assert.equal(
      ignoredNote(2),
      " 2 follow-ups no longer applied and were left out.",
    );
  });
});

// Product owner, 11 November 2026: in Control Understanding, start from the answers already
// given for the same control on another application. They appear as proposals when the
// review loads; nothing is written until the person confirms.
describe("starting from the same control on another system (11 November 2026)", () => {
  const AD = "55555555-5555-4555-8555-555555555555";
  const raw = (key: string, extra: Record<string, unknown> = {}) => ({
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
  const fromAd = (key: string, extra: Record<string, unknown> = {}) =>
    raw(key, {
      status: "PROPOSED",
      source: "OTHER_SYSTEM",
      value: "Line manager",
      options: ["Line manager", "IT security"],
      source_detail: "From ITGC-AC-01 on Active Directory",
      ...extra,
    });
  const twoSystems = {
    chosen: AD,
    options: [
      { control_id: AD, system: "Active Directory", answers: 12 },
      { control_id: ORACLE, system: "Oracle", answers: 5 },
    ],
  };
  const read = (needs: unknown[], startFrom?: unknown): Review => {
    const review = parseReview({
      control_ref: "ITGC-AC-01",
      system: "SAP ERP",
      other_systems: [],
      statement: [],
      needs,
      evidence: { ready: false, missing: [] },
      attributes: { ready: false, missing: [] },
      ...(startFrom === undefined ? {} : { start_from: startFrom }),
    });
    assert.ok(review !== null);
    return review;
  };

  it("reads start_from, and reads nothing chosen and none offered when it is off or absent", () => {
    const review = read([], twoSystems);
    assert.deepEqual(review.startFrom, {
      chosen: AD,
      options: [
        { controlId: AD, system: "Active Directory", answers: 12 },
        { controlId: ORACLE, system: "Oracle", answers: 5 },
      ],
    });
    assert.deepEqual(chosenStart(review), {
      controlId: AD,
      system: "Active Directory",
      answers: 12,
    });
    // Absent, or not an object: nothing chosen, none offered; the review still reads.
    for (const off of [undefined, null, "AD", [], { chosen: AD }]) {
      assert.deepEqual(
        read([], off).startFrom,
        { chosen: null, options: [] },
        JSON.stringify(off),
      );
    }
    // Each option checked: a control id, a system, a whole number of answers; once each.
    const mixed = read([], {
      chosen: "not-an-option",
      options: [
        { control_id: AD, system: " Active Directory ", answers: 3 },
        { control_id: AD, system: "Again", answers: 9 },
        { control_id: "nope", system: "X", answers: 1 },
        { control_id: ORACLE, system: "Oracle", answers: -1 },
        { control_id: ORACLE, system: "Oracle", answers: 1.5 },
        { control_id: ORACLE, system: 7, answers: 1 },
        "Oracle",
        null,
      ],
    });
    assert.deepEqual(mixed.startFrom, {
      chosen: null,
      options: [{ controlId: AD, system: "Active Directory", answers: 3 }],
    });
    assert.equal(chosenStart(mixed), null);
    // The new source reads, with its words.
    const need = read([fromAd("approver")]).needs[0];
    assert.deepEqual(
      [need?.source, need?.status, need?.sourceDetail],
      ["OTHER_SYSTEM", "PROPOSED", "From ITGC-AC-01 on Active Directory"],
    );
    assert.equal(
      otherSystemLabel(need as Need),
      "From ITGC-AC-01 on Active Directory",
    );
    assert.equal(
      otherSystemLabel(
        read([fromAd("x", { source_detail: 3 })]).needs[0] as Need,
      ),
      OTHER_SYSTEM_FALLBACK,
    );
    assert.equal(otherSystemLabel(read([raw("y")]).needs[0] as Need), "");
  });

  it("shows the banner while a system is chosen, a select of several, a link for one", () => {
    const several = startFromBanner(read([fromAd("approver")], twoSystems));
    assert.ok(several !== null);
    assert.equal(
      several.text,
      "Answers from ITGC-AC-01 on Active Directory are proposed below — confirm or change each.",
    );
    assert.deepEqual(several.choose, {
      kind: "select",
      value: AD,
      options: [
        { value: AD, label: "Active Directory (12)" },
        { value: ORACLE, label: "Oracle (5)" },
        { value: START_NONE, label: "None" },
      ],
    });
    // None chosen: no sentence; the select reads None, to switch back.
    const none = startFromBanner(read([], { ...twoSystems, chosen: null }));
    assert.deepEqual(
      [none?.text, none?.choose.kind === "select" ? none.choose.value : ""],
      ["", START_NONE],
    );
    // Exactly one system: "Don't use these", then "Use answers from <system>".
    const one = { control_id: AD, system: "Active Directory", answers: 4 };
    const onlyOn = startFromBanner(read([], { chosen: AD, options: [one] }));
    assert.deepEqual(onlyOn?.choose, {
      kind: "link",
      value: START_NONE,
      label: "Don't use these",
    });
    const onlyOff = startFromBanner(read([], { chosen: null, options: [one] }));
    assert.deepEqual(onlyOff, {
      text: "",
      choose: {
        kind: "link",
        value: AD,
        label: "Use answers from Active Directory",
      },
    });
    // A system that answers none of the open questions is not offered; nothing to offer, no
    // banner.
    const spent = startFromBanner(
      read([], {
        chosen: AD,
        options: [one, { control_id: ORACLE, system: "Oracle", answers: 0 }],
      }),
    );
    assert.equal(spent?.choose.kind, "link");
    assert.equal(
      startFromBanner(
        read([], { chosen: AD, options: [{ ...one, answers: 0 }] }),
      ),
      null,
    );
    assert.equal(startFromBanner(read([])), null);
    // An unnamed system still reads.
    const unnamed = startFromBanner(
      read([], { chosen: AD, options: [{ ...one, system: "" }] }),
    );
    assert.match(unnamed?.text ?? "", /on another system are proposed/);
  });

  it("asks for the review from the system chosen, or none, and refuses anything else", () => {
    const ids = {
      organization_id: ORG,
      project_id: PROJECT,
      control_id: CONTROL,
    };
    const base = `/organizations/${ORG}/projects/${PROJECT}/controls/${CONTROL}/understanding`;
    assert.deepEqual(chatRequest({ ...ids, intent: "review" }), {
      method: "GET",
      path: `${base}/review`,
      body: null,
    });
    assert.deepEqual(chatRequest({ ...ids, intent: "review", from: "" }), {
      method: "GET",
      path: `${base}/review`,
      body: null,
    });
    assert.deepEqual(chatRequest({ ...ids, intent: "review", from: AD }), {
      method: "GET",
      path: `${base}/review?from=${AD}`,
      body: null,
    });
    assert.deepEqual(chatRequest({ ...ids, intent: "review", from: "none" }), {
      method: "GET",
      path: `${base}/review?from=none`,
      body: null,
    });
    for (const from of ["None", "../x", `${AD}&x=1`]) {
      assert.deepEqual(
        chatRequest({ ...ids, intent: "review", from }),
        { error: "invalid" },
        from,
      );
    }
    // The page's choice is sent for its own control only; none made leaves it to the server.
    assert.deepEqual(startFromField(null, CONTROL), {});
    assert.deepEqual(startFromField({ control: CONTROL, from: AD }, CONTROL), {
      from: AD,
    });
    assert.deepEqual(
      startFromField({ control: CONTROL, from: START_NONE }, CONTROL),
      { from: "none" },
    );
    assert.deepEqual(
      startFromField({ control: ORACLE, from: AD }, CONTROL),
      {},
    );
    assert.deepEqual(
      startFromField({ control: CONTROL, from: "bad" }, CONTROL),
      {},
    );
  });

  it("confirms them together with last year's and this system's answers, worded by source", () => {
    const lastYear = raw("tool", {
      status: "PROPOSED",
      source: "PRIOR_YEAR",
      value: "ServiceNow",
      proposal_id: "p1",
    });
    const sameSystem = raw("admin-role", {
      status: "PROPOSED",
      source: "SYSTEM",
      value: "SAP_ALL holders",
      source_detail: "Used on 5 other controls on SAP ERP",
    });
    const usual = raw("frequency", {
      status: "PROPOSED",
      source: "USUAL",
      value: "Weekly",
    });
    const review = read(
      [lastYear, sameSystem, fromAd("approver"), usual],
      twoSystems,
    );
    const groups = reviewGroups(review);
    assert.deepEqual(
      groups.otherSystem.map((need) => need.key),
      ["approver"],
    );
    // Never a point for the person on its own; a usual-practice guess still is.
    assert.deepEqual(
      groups.needsYou.map((need) => need.key),
      ["frequency"],
    );
    const course = startInterview(review);
    assert.deepEqual(course.plan, [CARRIED, "frequency"]);
    assert.deepEqual(course.carried, ["tool", "admin-role", "approver"]);
    assert.deepEqual(course.carriedFrom, {
      tool: "PRIOR_YEAR",
      "admin-role": "SYSTEM",
      approver: "OTHER_SYSTEM",
    });
    assert.equal(course.otherSystem, "Active Directory");
    const mixed = carriedCopy(course, 3);
    assert.deepEqual(
      [mixed.chip, mixed.title, mixed.step],
      [
        "Already known",
        "Confirm the answers already known",
        "Answers already known",
      ],
    );
    assert.equal(
      mixed.hint,
      "3 answers come from last year's workpaper, this system's other controls or the same control on Active Directory. Untick any that differ for this control; it is asked on its own.",
    );
    // Each says where it came from while the step mixes sources.
    assert.deepEqual(
      review.needs.slice(0, 3).map((need) => carriedSource(course, need)),
      [
        "Last year's workpaper",
        "Used on 5 other controls on SAP ERP",
        "From ITGC-AC-01 on Active Directory",
      ],
    );
    assert.equal(
      draftedFrom(groups, course),
      "Drafted from the RCM, last year's workpaper, this system's other controls and the same control on Active Directory",
    );
    // Two sources read as the mixed step too.
    const pair = startInterview(
      read([lastYear, fromAd("approver")], twoSystems),
    );
    assert.equal(
      carriedCopy(pair, 2).hint,
      "2 answers come from last year's workpaper or the same control on Active Directory. Untick any that differ for this control; it is asked on its own.",
    );
    // Untick it: asked on its own, preselected, labelled; saved as the statement's value.
    const apart = askSeparately(course, ["approver"]);
    assert.deepEqual(apart.plan, [CARRIED, "approver", "frequency"]);
    const approver = review.needs[2] as Need;
    assert.deepEqual(proposedPick(approver), ["Line manager"]);
    assert.equal(confirmsByProposal(approver), false);
    assert.equal(
      confirmsByProposal(
        read([raw("q", { ...fromAd("q"), proposal_id: "p9" })])
          .needs[0] as Need,
      ),
      false,
    );
    assert.equal(confirmsByProposal(review.needs[0] as Need), true);
    // Confirmed: on record as the person's answer, its proposal words gone.
    const after = withConfirmed(review, { approver: "Line manager" });
    assert.deepEqual(
      [
        after.needs[2]?.status,
        after.needs[2]?.source,
        after.needs[2]?.sourceDetail,
      ],
      ["CONFIRMED", "PERSON", ""],
    );
  });

  it("names the step after the other system when its answers are the only ones known", () => {
    const review = read([fromAd("approver"), fromAd("tool")], twoSystems);
    const course = startInterview(review);
    const copy = carriedCopy(course, 2);
    assert.deepEqual(
      [copy.chip, copy.title, copy.step, copy.confirmed(2), copy.confirmed(1)],
      [
        "From Active Directory",
        "Confirm the answers from Active Directory",
        "Answers from Active Directory",
        "2 answers from Active Directory confirmed.",
        "1 answer from Active Directory confirmed.",
      ],
    );
    assert.equal(
      copy.hint,
      "2 answers were given for the same control on Active Directory. Untick any that differ for this control; it is asked on its own.",
    );
    assert.equal(
      carriedCopy(course, 0).hint,
      "The answers from Active Directory are confirmed.",
    );
    // Alone, the title says where they came from: no line beside each.
    assert.equal(carriedSource(course, review.needs[0] as Need), "");
    assert.equal(
      draftedFrom(reviewGroups(review), course),
      "Drafted from the RCM and the same control on Active Directory",
    );
    // The system not named in start_from: plain words.
    const unnamed = startInterview(read([fromAd("approver")]));
    assert.equal(unnamed.otherSystem, undefined);
    assert.equal(
      carriedCopy(unnamed, 1).title,
      "Confirm the answers from another system",
    );
  });

  it("pre-selects an answer from another system in its walkthrough topic, as a proposal", () => {
    const question = {
      key: "wt-ac01-sod-check",
      kind: "WALKTHROUGH",
      label: "Segregation of duties",
      question: "Can a requester approve their own access?",
      value: "No",
      why: "",
      status: "PROPOSED",
      source: "OTHER_SYSTEM",
      source_detail: "From ITGC-AC-01 on Active Directory",
      needed_for: [],
      required: true,
      topic: "SEGREGATION",
      topic_label: "Segregation of duties",
      answer_kind: "YES_NO",
      options: [],
      drives: [],
      quote: "",
    };
    const review = read([question], twoSystems);
    const need = review.needs[0] as Need;
    // Not a carried answer: the walkthrough asks it in its topic.
    assert.deepEqual(reviewGroups(review).otherSystem, []);
    assert.deepEqual(startInterview(review).plan, [topicStep("SEGREGATION")]);
    const asked = topicAsks(review, "SEGREGATION");
    assert.deepEqual(proposedPick(need), ["No"]);
    // Saving the topic as it stands confirms it, through the walkthrough save.
    assert.deepEqual(topicSave(asked, {}), {
      "wt-ac01-sod-check": { value: "No", not_applicable: false },
    });
    assert.equal(topicLeft(asked, {}), 0);
    assert.match(
      topicHint(asked, "Segregation of duties"),
      /A proposed answer is selected/,
    );
    // Labelled with where it came from, by the standard checks' mark, never as on record.
    assert.deepEqual(proposalMark(need), {
      text: "From ITGC-AC-01 on Active Directory",
      agent: false,
    });
    assert.deepEqual(reviewGroups(review).confirmed, []);
    // The marks already in use read as before.
    assert.deepEqual(proposalMark({ ...need, source: "PRIOR_YEAR" }), {
      text: "From last year's workpaper",
      agent: false,
    });
    assert.deepEqual(proposalMark({ ...need, source: "AGENT" }), {
      text: "Proposed by the agents",
      agent: true,
    });
    assert.deepEqual(proposalMark({ ...need, source: "USUAL" }), {
      text: "Proposed",
      agent: true,
    });
  });

  it("sets the course afresh from the new read when the person switches systems", () => {
    const first = read(
      [fromAd("approver"), raw("reviewer"), raw("owner")],
      twoSystems,
    );
    const course = startInterview(first);
    assert.deepEqual(course.plan, [CARRIED, "reviewer", "owner"]);
    // On "reviewer", switching to none: the proposal is gone, the step kept.
    const none = read([raw("approver"), raw("reviewer"), raw("owner")], {
      ...twoSystems,
      chosen: null,
    });
    const after = restartInterview(none, course, 1);
    assert.deepEqual(after.interview.plan, ["approver", "reviewer", "owner"]);
    assert.deepEqual(after.interview.carried, []);
    assert.equal(after.interview.otherSystem, undefined);
    assert.equal(after.at, 1);
    // On the carried step when the new read has none: the first step still open.
    assert.equal(restartInterview(none, course, 0).at, 0);
    assert.equal(after.interview.plan[0], "approver");
    // Switching to Oracle: its proposals carried, named after it.
    const oracle = read(
      [
        fromAd("approver", { source_detail: "From ITGC-AC-01 on Oracle" }),
        raw("reviewer"),
        raw("owner"),
      ],
      { ...twoSystems, chosen: ORACLE },
    );
    const back = restartInterview(oracle, after.interview, 0);
    assert.deepEqual(back.interview.plan, [CARRIED, "reviewer", "owner"]);
    assert.equal(back.interview.otherSystem, "Oracle");
    assert.equal(
      carriedCopy(back.interview, 1).title,
      "Confirm the answers from Oracle",
    );
    assert.equal(back.at, 0);
  });
});

describe("statement questions that take more than one answer (12 November 2026)", () => {
  // Product owner, on "Who in IT approves a change before it goes to production?": "This type
  // of question could also have multiple answers, like business and IT. Why does this only
  // allow 1?"
  const APPROVERS = [
    "IT Change Advisory Board",
    "Change Manager",
    "IT Applications Manager",
    "IT Director",
    "Application owner",
    "Head of IT",
  ];
  const IAM = [
    "Identity and access management team",
    "Line manager",
    "Access management team",
  ];
  const need = (key: string, extra: Record<string, unknown>) => ({
    key,
    kind: "ANSWER",
    label: key,
    question: `${key}?`,
    value: "",
    options: APPROVERS,
    why: "",
    status: "MISSING",
    source: "NONE",
    needed_for: ["EVIDENCE"],
    proposal_id: null,
    required: true,
    ...extra,
  });
  const read = (needs: Array<Record<string, unknown>>): Review => {
    const review = parseReview({
      control_ref: "ITGC-CM-01",
      system: "SAP S/4HANA",
      statement: [
        { text: "Changes are approved by ", key: null },
        { text: "[Approver]", key: "change-approver" },
      ],
      needs,
    });
    assert.ok(review !== null);
    return review;
  };
  const first = (needs: Array<Record<string, unknown>>): Need =>
    read(needs).needs[0] as Need;

  it("reads multiple from the API: true only when given true, and only on a statement question", () => {
    assert.equal(first([need("a", { multiple: true })]).multiple, true);
    assert.equal(first([need("a", { multiple: false })]).multiple, false);
    assert.equal(first([need("a", {})]).multiple, false);
    assert.equal(first([need("a", { multiple: "true" })]).multiple, false);
    assert.equal(first([need("a", { multiple: 1 })]).multiple, false);
    assert.equal(
      first([need("a", { kind: "QUESTION", multiple: true })]).multiple,
      false,
    );
  });

  it("joins items as plain English, with no Oxford comma", () => {
    assert.equal(answerList([]), "");
    assert.equal(answerList(["A"]), "A");
    assert.equal(answerList(["A", "B"]), "A and B");
    assert.equal(answerList(["A", "B", "C"]), "A, B and C");
    assert.equal(answerList(["A", "B", "C", "D"]), "A, B, C and D");
    assert.equal(answerList(["  A ", "", " B"]), "A and B");
  });

  it("composes the options in their listed order, then the Other words last, trimmed", () => {
    assert.equal(
      composeMultiple(APPROVERS, { options: ["Change Manager"], other: null }),
      "Change Manager",
    );
    assert.equal(
      composeMultiple(APPROVERS, {
        options: ["IT Director", "Change Manager"],
        other: null,
      }),
      "Change Manager and IT Director",
    );
    assert.equal(
      composeMultiple(APPROVERS, {
        options: ["Head of IT", "IT Change Advisory Board", "IT Director"],
        other: null,
      }),
      "IT Change Advisory Board, IT Director and Head of IT",
    );
    assert.equal(
      composeMultiple(APPROVERS, {
        options: ["Change Manager"],
        other: "  the business process owner ",
      }),
      "Change Manager and the business process owner",
    );
    assert.equal(
      composeMultiple(APPROVERS, {
        options: ["Change Manager", "IT Director"],
        other: "Finance",
      }),
      "Change Manager, IT Director and Finance",
    );
    assert.equal(
      composeMultiple(APPROVERS, { options: [], other: "The CFO" }),
      "The CFO",
    );
    assert.equal(composeMultiple(APPROVERS, { options: [], other: null }), "");
    assert.equal(composeMultiple(APPROVERS, { options: [], other: "  " }), "");
    // Other words that are one of the options count as that option: never named twice.
    assert.equal(
      composeMultiple(APPROVERS, {
        options: ["Change Manager"],
        other: "change  manager",
      }),
      "Change Manager",
    );
  });

  it("reads a stored value back into the options and the Other words", () => {
    const back = (value: string, options: readonly string[] = APPROVERS) =>
      parseMultiple(options, value);
    assert.deepEqual(back(""), { options: [], other: null });
    assert.deepEqual(back("Change Manager"), {
      options: ["Change Manager"],
      other: null,
    });
    // Options in a different order come back in their listed order.
    assert.deepEqual(back("Head of IT, IT Director and Change Manager"), {
      options: ["Change Manager", "IT Director", "Head of IT"],
      other: null,
    });
    // Extra spaces and another case.
    assert.deepEqual(
      back("  change   MANAGER ,  it director   AND head of it  "),
      {
        options: ["Change Manager", "IT Director", "Head of IT"],
        other: null,
      },
    );
    // An option holding "and" is taken whole (the longest first), not split at its "and".
    assert.deepEqual(
      back("Identity and access management team and Line manager", IAM),
      {
        options: ["Identity and access management team", "Line manager"],
        other: null,
      },
    );
    assert.deepEqual(back("Access management team", IAM), {
      options: ["Access management team"],
      other: null,
    });
    // Other words holding "and" keep it: only the list's separators are taken out.
    assert.deepEqual(
      back("Change Manager and the business process owner and finance"),
      {
        options: ["Change Manager"],
        other: "the business process owner and finance",
      },
    );
    assert.deepEqual(
      back("Change Manager, IT Director and Research and Development"),
      {
        options: ["Change Manager", "IT Director"],
        other: "Research and Development",
      },
    );
    // An option is matched as a whole phrase, never inside a longer word.
    assert.deepEqual(back("Application owners group"), {
      options: [],
      other: "Application owners group",
    });
    // A value from before the question took more than one answer: its words are the Other.
    assert.deepEqual(back("The CFO"), { options: [], other: "The CFO" });
  });

  it("round-trips: a composed value reads back into the same pick", () => {
    const picks = [
      { options: ["Change Manager"], other: null },
      { options: ["Change Manager", "IT Director"], other: null },
      {
        options: [
          "IT Change Advisory Board",
          "IT Applications Manager",
          "Head of IT",
        ],
        other: null,
      },
      { options: ["Change Manager"], other: "the business process owner" },
      {
        options: ["IT Director", "Application owner"],
        other: "Sales and Marketing",
      },
      { options: [], other: "The CFO and the CIO" },
    ];
    for (const pick of picks) {
      const value = composeMultiple(APPROVERS, pick);
      assert.deepEqual(parseMultiple(APPROVERS, value), pick, value);
      assert.equal(
        composeMultiple(APPROVERS, parseMultiple(APPROVERS, value)),
        value,
      );
    }
    const iam = {
      options: ["Identity and access management team", "Line manager"],
      other: "HR",
    };
    assert.deepEqual(parseMultiple(IAM, composeMultiple(IAM, iam)), iam);
  });

  it("pre-selects a proposal or the answer on record; nothing for a question not answered", () => {
    for (const source of ["USUAL", "PRIOR_YEAR", "SYSTEM", "OTHER_SYSTEM"]) {
      const proposed = first([
        need("change-approver", {
          multiple: true,
          status: "PROPOSED",
          source,
          value: "Change Manager and the business process owner",
          proposal_id: source === "PRIOR_YEAR" ? "p1" : null,
        }),
      ]);
      assert.deepEqual(
        multipleStart(proposed),
        { options: ["Change Manager"], other: "the business process owner" },
        source,
      );
      // Untouched, the proposal is confirmed in its own words (last year's through its
      // proposal record, which compares the value).
      assert.equal(
        multipleAnswer(proposed, undefined),
        "Change Manager and the business process owner",
      );
    }
    const onRecord = first([
      need("change-approver", {
        multiple: true,
        status: "CONFIRMED",
        source: "PERSON",
        value: "it director, change manager",
      }),
    ]);
    assert.deepEqual(multipleStart(onRecord), {
      options: ["Change Manager", "IT Director"],
      other: null,
    });
    assert.equal(
      multipleAnswer(onRecord, undefined),
      "it director, change manager",
    );
    // Changed by the person: their pick, composed.
    assert.equal(
      multipleAnswer(
        onRecord,
        toggleMultiple(APPROVERS, multipleStart(onRecord), "Head of IT"),
      ),
      "Change Manager, IT Director and Head of IT",
    );
    const missing = first([
      need("change-approver", { multiple: true, value: "Change Manager" }),
    ]);
    assert.deepEqual(multipleStart(missing), { options: [], other: null });
    assert.equal(multipleAnswer(missing, undefined), "");
  });

  it("toggles an option, keeping the options in their listed order and the Other words", () => {
    const start = { options: ["IT Director"], other: "Finance" };
    const added = toggleMultiple(APPROVERS, start, "Change Manager");
    assert.deepEqual(added, {
      options: ["Change Manager", "IT Director"],
      other: "Finance",
    });
    assert.deepEqual(toggleMultiple(APPROVERS, added, "IT Director"), {
      options: ["Change Manager"],
      other: "Finance",
    });
  });

  it("holds the save back until something valid is chosen", () => {
    const q = first([need("change-approver", { multiple: true })]);
    assert.equal(multipleValue(q, { options: [], other: null }), "");
    assert.equal(multipleProblem(q, { options: [], other: null }), "");
    // Other ticked with no words: a problem that says how to recover, and nothing to save.
    const blank = { options: ["Change Manager"], other: "   " };
    assert.equal(
      multipleProblem(q, blank),
      "Describe the other answer, or untick Other (specify).",
    );
    assert.equal(multipleValue(q, blank), "");
    assert.equal(multipleAnswer(q, blank), "");
    // The Other words alone are enough.
    assert.equal(
      multipleValue(q, { options: [], other: "The CFO" }),
      "The CFO",
    );
    // Longer than the values save takes: held back, with the count.
    const long = { options: ["Change Manager"], other: "x".repeat(ANSWER_MAX) };
    assert.match(
      multipleProblem(q, long),
      /^Keep the answer to 300 characters \(319 now\)/,
    );
    assert.equal(multipleValue(q, long), "");
    assert.equal(
      multipleValue(q, {
        options: ["Change Manager", "Head of IT"],
        other: null,
      }),
      "Change Manager and Head of IT",
    );
  });

  it("leaves a single-choice statement question as it was", () => {
    const single = first([
      need("change-approver", {
        status: "PROPOSED",
        source: "USUAL",
        value: "Change Manager",
      }),
    ]);
    assert.equal(single.multiple, false);
    assert.equal(single.value, "Change Manager");
    assert.deepEqual(single.options, APPROVERS);
    assert.equal(single.walkthrough, undefined);
  });
});
