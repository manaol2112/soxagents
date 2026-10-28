import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  clock,
  contextProblem,
  contextWrite,
  documentUploadTarget,
  type NarrativeReview,
  type NarrativeRun,
  narrativeProgress,
  parseContext,
  planOutcomeLine,
  REVIEW_ACTION_LABELS,
  reviewActions,
  reviewHeadline,
  showsReadiness,
} from "../apps/web/src/control-context-model.ts";

const ORG = "01a13253-ec1a-7604-8944-a06dd7633ce0";
const PROJECT = "01a1327d-b92a-7bd1-b34b-845a8d89c879";
const CONTROL = "01a13300-0000-7000-8000-000000000002";
const OTHER = "01a13300-0000-7000-8000-000000000003";
const ITEM = "01a13300-0000-7000-8000-000000000009";
const IDS = { organization_id: ORG, project_id: PROJECT, control_id: CONTROL };
const BASE = `/organizations/${ORG}/projects/${PROJECT}`;

describe("control context", () => {
  it("parses readiness, attributes, documents, issues, and the process map", () => {
    const context = parseContext({
      control_id: CONTROL,
      classifications: ["BUSINESS_PROCESS", "NOPE"],
      derived_classifications: ["BUSINESS_PROCESS"],
      classifications_overridden: false,
      process_required: true,
      readiness: {
        state: "PROCESS_UNDERSTANDING_INCOMPLETE",
        label: "Process understanding incomplete",
        process_required: true,
        checks: [
          {
            key: "process",
            title: "Process understanding",
            status: "BLOCKED",
            summary: "1 open point",
            blockers: [
              {
                detail: "No map yet.",
                why: "It matters.",
                resolve: "Build it.",
              },
            ],
          },
        ],
      },
      attributes: {
        approved: [
          {
            id: ITEM,
            position: 0,
            text: "Approved before posting",
            status: "APPROVED",
            basis: "DOCUMENTED",
            source_kind: "RCM",
            source_document_id: null,
            source_title: "",
            source_quote: "",
            note: "",
            proposal: null,
            replaces_id: null,
            decided_by: null,
            version: 1,
          },
        ],
        proposed: [
          {
            id: OTHER,
            text: "Dated",
            status: "PROPOSED",
            proposal: "ADD",
            basis: "?",
          },
        ],
        history: [],
      },
      issues: [
        {
          id: ITEM,
          origin: "SOURCES",
          kind: "CONFLICT",
          topic: "Frequency",
          detail: "Monthly vs quarterly.",
          quotes: [
            { source: OTHER, title: "Policy", quote: "reviewed quarterly" },
          ],
          raised_by: "RULES",
          status: "OPEN",
          version: 1,
        },
      ],
      documents: [
        {
          id: OTHER,
          kind: "POLICY",
          title: "Credit note policy",
          origin: "WRITTEN",
          control_ids: [CONTROL, OTHER, 7],
          reviewed: false,
        },
      ],
      understanding: {
        status: "DRAFT",
        steps: [
          {
            key: "s1",
            description: "Billing raises it.",
            control_point: true,
            basis: "?",
          },
        ],
        built_by: "RULES",
        proposed_steps: null,
        version: 2,
      },
    });
    assert.ok(context !== null);
    assert.deepEqual(context.classifications, ["BUSINESS_PROCESS"]);
    assert.equal(context.readiness?.state, "PROCESS_UNDERSTANDING_INCOMPLETE");
    assert.equal(
      context.readiness?.checks[0]?.blockers[0]?.resolve,
      "Build it.",
    );
    assert.equal(context.approved[0]?.sourceKind, "RCM");
    // Unknown values fall back to the cautious reading: an unknown basis is inferred.
    assert.equal(context.proposed[0]?.basis, "INFERRED");
    assert.equal(context.issues[0]?.quotes[0]?.quote, "reviewed quarterly");
    assert.deepEqual(context.documents[0]?.controlIds, [CONTROL, OTHER]);
    assert.equal(context.understanding.steps[0]?.controlPoint, true);
    assert.equal(context.understanding.steps[0]?.basis, "TEAM");
    assert.equal(context.understanding.proposedSteps, null);
    assert.equal(parseContext({ classifications: [] }), null);
  });

  it("builds each action's call and refuses what does not fit", () => {
    assert.deepEqual(
      contextWrite({ ...IDS, intent: "attribute-add", text: "  Dated  " }),
      {
        intent: "attribute-add",
        method: "POST",
        path: `${BASE}/controls/${CONTROL}/attributes`,
        body: { text: "Dated" },
        slow: false,
      },
    );
    const decide = contextWrite({
      ...IDS,
      intent: "attribute-decide",
      attribute_id: ITEM,
      decision: "APPROVE",
      version: 2,
      text: "Reworded",
    });
    assert.ok(!("error" in decide));
    assert.deepEqual(decide.body, {
      decision: "APPROVE",
      version: 2,
      text: "Reworded",
    });
    const review = contextWrite({ ...IDS, intent: "review" });
    assert.ok(!("error" in review) && review.slow);
    const saved = contextWrite({
      ...IDS,
      intent: "process-save",
      summary: "Short.",
      steps: [
        {
          description: " Billing raises it. ",
          controlPoint: true,
          basis: "DOCUMENTED",
          // The attributes evaluated at the step (26 October 2026): a code is kept only
          // when it is well formed.
          attributes: ["A1", "not a code!", 7],
        },
        { description: "   " },
      ],
      version: 0,
      confirm: true,
    });
    assert.ok(!("error" in saved));
    assert.deepEqual(saved.body, {
      summary: "Short.",
      // The narrative's sections (0117): none given here.
      sections: [],
      steps: [
        {
          description: "Billing raises it.",
          actor: "",
          system: "",
          control_point: true,
          basis: "DOCUMENTED",
          source: "",
          quote: "",
          attributes: ["A1"],
        },
      ],
      version: 0,
      confirm: true,
    });
    const written = contextWrite({
      organization_id: ORG,
      project_id: PROJECT,
      intent: "document-write",
      kind: "POLICY",
      title: "Policy",
      body: "Credit notes are approved.",
      control_ids: [CONTROL, "nope", OTHER],
    });
    assert.ok(!("error" in written));
    assert.equal(written.path, `${BASE}/source-documents`);
    assert.deepEqual(written.body.control_ids, [CONTROL, OTHER]);
    const classify = contextWrite({
      ...IDS,
      intent: "classify",
      classifications: [],
    });
    assert.ok(!("error" in classify));
    assert.deepEqual(classify.body, { classifications: null });
    for (const bad of [
      { ...IDS, intent: "attribute-add", text: "" },
      { ...IDS, intent: "attribute-add", text: "token=sk-live-1234567890abcd" },
      {
        ...IDS,
        intent: "attribute-edit",
        attribute_id: ITEM,
        text: "x",
        version: 0,
      },
      {
        ...IDS,
        intent: "attribute-decide",
        attribute_id: ITEM,
        decision: "MAYBE",
        version: 1,
      },
      {
        ...IDS,
        intent: "issue-resolve",
        issue_id: ITEM,
        status: "RESOLVED",
        note: " ",
        version: 1,
      },
      {
        ...IDS,
        intent: "document-write",
        kind: "SECRET",
        title: "t",
        body: "b",
      },
      { ...IDS, intent: "delete-everything" },
      { ...IDS, control_id: "x", intent: "review" },
    ]) {
      assert.deepEqual(contextWrite(bad), { error: "invalid" });
    }
  });

  it("parses library version 3 definitions, procedures, and an update", () => {
    const context = parseContext({
      control_id: CONTROL,
      attributes: {
        approved: [
          {
            id: ITEM,
            text: "Access was approved before it was granted",
            status: "APPROVED",
            version: 1,
            definition: {
              key: "ac01-approved-before",
              confidence: "HIGH",
              condition: "Every sampled grant",
              evidence: ["Ticket", "Provisioning log", 7],
              extract: ["Approval date", "Grant date"],
              compare: "Approval date on or before grant date",
              passes: "Approved on or before the grant",
              fails: "Approved after the grant",
              insufficient: "No approval date",
              review: "",
              not_infer: "Approval from a ticket being closed",
              basis: ["AS 2201.44"],
              question: "",
              blocks: false,
            },
          },
          { id: OTHER, text: "Client attribute", definition: { key: 3 } },
        ],
      },
      testing: {
        version: 3,
        objective: "Only approved access",
        procedures: [
          { key: "p1", phase: "ROLLFORWARD", action: "Inquire", evidence: [] },
          { key: "p2", phase: "SOMETHING", action: "Inspect" },
        ],
        questions: ["What threshold?"],
      },
      library_update: {
        available: true,
        library_version: 2,
        current_version: 3,
        items: [
          {
            change: "REWORD",
            key: "k",
            text: "New",
            was: "Old",
            reason: "Why",
          },
          { change: "BOGUS", key: "x" },
        ],
        note: "Sheets keep their attributes.",
      },
    });
    assert.ok(context !== null);
    const definition = context.approved[0]?.definition;
    assert.equal(definition?.confidence, "HIGH");
    assert.deepEqual(definition?.evidence, ["Ticket", "Provisioning log"]);
    assert.equal(definition?.notInfer, "Approval from a ticket being closed");
    // A client's own attribute has no definition.
    assert.equal(context.approved[1]?.definition, null);
    assert.deepEqual(
      context.testing?.procedures.map((p) => p.phase),
      ["ROLLFORWARD", "OPERATING"],
    );
    assert.deepEqual(context.testing?.questions, ["What threshold?"]);
    assert.equal(context.libraryUpdate?.libraryVersion, 2);
    assert.deepEqual(
      context.libraryUpdate?.items.map((item) => item.change),
      ["REWORD", "KEEP"],
    );
    // No update when the API says none is available, and none for older payloads.
    const current = parseContext({
      control_id: CONTROL,
      library_update: { available: false, items: [] },
    });
    assert.equal(current?.libraryUpdate, null);
    assert.equal(current?.testing, null);
    assert.deepEqual(contextWrite({ ...IDS, intent: "library-adopt" }), {
      intent: "library-adopt",
      method: "POST",
      path: `${BASE}/controls/${CONTROL}/library-update/adopt`,
      body: {},
      slow: false,
    });
    assert.equal(
      contextProblem(409, "no library update for this control"),
      "This control is already on the current library version.",
    );
  });

  it("parses the control statement and builds the values write", () => {
    const context = parseContext({
      control_id: CONTROL,
      design: {
        text: "Entries above [the journal entry review threshold] are approved.",
        risk: "Erroneous entries are posted.",
        assertions: ["Existence or occurrence", 4],
        control_type: "PREVENTIVE",
        nature: "MANUAL",
        frequency: "EVENT_DRIVEN",
        information: [
          {
            name: "Journal listing",
            kind: "QUERY",
            elements: ["Amount"],
            ipe: "IPE-02",
          },
        ],
        itgcs: ["ITGC-AC-01"],
        slots: [
          {
            key: "je-threshold",
            label: "the journal entry review threshold",
            kind: "AMOUNT",
            blocks: true,
            value: "",
            automatic: false,
            version: 0,
          },
          { key: "system", label: "the system", automatic: true, value: "SAP" },
          { label: "no key" },
        ],
        missing: ["the journal entry review threshold"],
      },
      library_update: {
        available: true,
        fields: [{ field: "title", was: "Old", now: "New" }],
        splits: [
          {
            control_ref: "ITGC-OP-03.1",
            title: "Failed backups",
            reason: "Moved",
          },
        ],
      },
    });
    assert.ok(context !== null);
    const design = context.design;
    assert.ok(design !== null);
    assert.deepEqual(design.assertions, ["Existence or occurrence"]);
    assert.deepEqual(
      design.slots.map((slot) => [slot.key, slot.blocks, slot.automatic]),
      [
        ["je-threshold", true, false],
        ["system", false, true],
      ],
    );
    assert.equal(design.information[0]?.ipe, "IPE-02");
    assert.equal(context.libraryUpdate?.splits[0]?.controlRef, "ITGC-OP-03.1");
    assert.equal(context.libraryUpdate?.fields[0]?.now, "New");
    assert.equal(parseContext({ control_id: CONTROL })?.design, null);
    assert.deepEqual(
      contextWrite({
        ...IDS,
        intent: "values-set",
        values: { "je-threshold": " 25,000 " },
        everywhere: true,
      }),
      {
        intent: "values-set",
        method: "PUT",
        path: `${BASE}/controls/${CONTROL}/values`,
        body: { values: { "je-threshold": "25,000" }, everywhere: true },
        slow: false,
      },
    );
    for (const values of [
      {},
      { "Bad Key": "x" },
      { "je-threshold": "password=hunter22" },
      { "je-threshold": "x".repeat(301) },
    ]) {
      assert.deepEqual(contextWrite({ ...IDS, intent: "values-set", values }), {
        error: "invalid",
      });
    }
  });

  it("names the upload target for a document linked to several controls", () => {
    const target = documentUploadTarget(
      {
        organization_id: ORG,
        project_id: PROJECT,
        kind: "NARRATIVE",
        title: "",
      },
      [CONTROL, OTHER, "nope"],
      { name: "Access narrative.docx", size: 1200 },
    );
    assert.ok(target !== null);
    const url = new URL(`http://x${target.path}`);
    assert.equal(url.pathname, `${BASE}/source-documents/upload`);
    assert.deepEqual(url.searchParams.getAll("control_id"), [CONTROL, OTHER]);
    assert.equal(url.searchParams.get("title"), "Access narrative.docx");
    assert.equal(
      documentUploadTarget(
        { organization_id: ORG, project_id: PROJECT, kind: "NARRATIVE" },
        [],
        { name: "big.pdf", size: 5 * 1024 * 1024 + 1 },
      ),
      null,
    );
    assert.equal(
      documentUploadTarget(
        { organization_id: ORG, project_id: PROJECT, kind: "?" },
        [],
        {
          name: "a.txt",
          size: 1,
        },
      ),
      null,
    );
  });

  it("explains failures and shows readiness only when it stops testing", () => {
    assert.equal(contextProblem(200), null);
    assert.match(
      contextProblem(409, "attribute exists") ?? "",
      /already on the control/,
    );
    assert.match(
      contextProblem(409, "mark the step where the control operates") ?? "",
      /Mark the step/,
    );
    assert.match(contextProblem(409) ?? "", /changed/);
    assert.match(contextProblem(413) ?? "", /5 MB/);
    assert.match(contextProblem(403) ?? "", /role/);
    assert.equal(showsReadiness("CONFLICT_REQUIRES_REVIEW"), true);
    assert.equal(showsReadiness("PROCESS_UNDERSTANDING_INCOMPLETE"), true);
    assert.equal(showsReadiness("EVIDENCE_PENDING"), false);
    assert.equal(showsReadiness("READY"), false);
  });
});

describe("test plan approval in readiness", () => {
  it("keeps a control whose plan waits for approval from reading as ready", () => {
    const context = parseContext({
      control_id: CONTROL,
      classifications: [],
      derived_classifications: [],
      classifications_overridden: false,
      process_required: false,
      readiness: {
        state: "PLAN_NOT_APPROVED",
        label: "",
        process_required: false,
        checks: [
          {
            key: "plan",
            title: "Test plan approval",
            status: "BLOCKED",
            summary: "Not approved",
            blockers: [
              {
                detail: "The test plan waits for a reviewer's approval.",
                why: "Testing follows the approved plan.",
                resolve: "Review the test plan and approve it.",
              },
            ],
          },
        ],
      },
    });
    assert.ok(context?.readiness);
    assert.equal(context.readiness.state, "PLAN_NOT_APPROVED");
    assert.equal(context.readiness.label, "Test plan awaiting approval");
    assert.equal(context.readiness.checks[0]?.key, "plan");
  });
});

// The process narrative drafted and reviewed in the background (26 October 2026): its
// fixed sections, its run, its review, and the questions the agents raise.
describe("the reviewed process narrative", () => {
  it("parses the sections in order, the run, the review and the raised questions", () => {
    const context = parseContext({
      control_id: CONTROL,
      issues: [
        {
          id: ITEM,
          origin: "PROCESS",
          kind: "MISSING",
          topic: "Exception route",
          detail: "What happens to a rejected request?",
          status: "OPEN",
          version: 1,
          question: "What happens to a rejected request?",
          suggestions: ["Returned to the requester", 3],
        },
      ],
      understanding: {
        status: "DRAFT",
        summary: "Purpose and scope. The control.",
        sections: [
          {
            key: "PURPOSE",
            heading: "Purpose and scope",
            text: "The control.",
            attributes: ["A1", 2],
          },
          { key: "NOPE", text: "Dropped." },
          {
            key: "APPROVAL",
            text: "The manager approves.",
            attributes: ["A1"],
          },
        ],
        steps: [],
        built_by: "AGENT",
        version: 3,
        run: {
          status: "WORKING",
          mode: "DRAFT",
          stage: "REVIEWING",
          round: 2,
          note: "",
          started_at: "2026-10-26T18:00:00Z",
          stage_at: "2026-10-26T18:00:40Z",
          progress: { answers: 12, documents: 2, attributes: 5, points: "x" },
        },
        review: {
          passed: false,
          reviewer: "AGENT",
          rounds: 1,
          coverage: [{ code: "A1", sections: ["PURPOSE"], steps: [2, "x"] }],
          findings: ["A2 is not explained in any section.", 4],
          fixes: ["Removed an oversight claim no answer supports.", null],
          questions: 2,
          incomplete: true,
          version: 3,
        },
      },
    });
    assert.ok(context !== null);
    const narrative = context.understanding;
    assert.deepEqual(
      narrative.sections.map((item) => [
        item.key,
        item.heading,
        item.attributes,
      ]),
      [
        ["PURPOSE", "Purpose and scope", ["A1"]],
        ["APPROVAL", "Review and approval", ["A1"]],
      ],
    );
    assert.deepEqual(narrative.run, {
      status: "WORKING",
      mode: "DRAFT",
      stage: "REVIEWING",
      round: 2,
      note: "",
      startedAt: "2026-10-26T18:00:00Z",
      stageAt: "2026-10-26T18:00:40Z",
      progress: { answers: 12, documents: 2, attributes: 5, points: 0 },
      planOutcome: null,
    });
    assert.deepEqual(narrative.review?.coverage, [
      { code: "A1", sections: ["PURPOSE"], steps: [2] },
    ]);
    assert.deepEqual(narrative.review?.findings, [
      "A2 is not explained in any section.",
    ]);
    assert.equal(narrative.review?.passed, false);
    assert.deepEqual(narrative.review?.fixes, [
      "Removed an oversight claim no answer supports.",
    ]);
    assert.equal(narrative.review?.questions, 2);
    assert.equal(narrative.review?.incomplete, true);
    assert.deepEqual(context.issues[0]?.suggestions, [
      "Returned to the requester",
    ]);
    assert.equal(
      context.issues[0]?.question,
      "What happens to a rejected request?",
    );
  });

  it("says what holds the review, never listing passed checks as problems", () => {
    const review: NarrativeReview = {
      passed: false,
      reviewer: "AGENT",
      rounds: 2,
      coverage: [],
      findings: [],
      fixes: ["Removed an oversight claim no answer supports."],
      questions: 1,
      incomplete: false,
      version: 4,
    };
    // Held only for the client's facts: the questions are in the walkthrough.
    assert.equal(
      reviewHeadline(review, 4),
      "Waiting on 1 point for the client to confirm in the walkthrough. The narrative is drafted again once they are confirmed.",
    );
    assert.equal(
      reviewHeadline(
        { ...review, findings: ["A2 is unexplained."], questions: 3 },
        4,
      ),
      "1 issue to resolve, and 3 points for the client to confirm in the walkthrough.",
    );
    assert.equal(
      reviewHeadline(
        { ...review, questions: 0, findings: ["A2 is unexplained."] },
        4,
      ),
      "The review found issues to resolve before approval.",
    );
    assert.equal(
      reviewHeadline({ ...review, passed: true, questions: 0 }, 4),
      "Reviewed: every attribute covered after 2 rounds of fixes.",
    );
    assert.equal(
      reviewHeadline({ ...review, reviewer: "RULES" }, 4),
      "Checked by the rules only: no model reviewed it.",
    );
    // An edit after the review makes it stale, whatever it found.
    assert.equal(
      reviewHeadline({ ...review, passed: true }, 5),
      "Changed since the review. Review it again before approving.",
    );
    // A review the agent did not finish is said as such, not counted as a point.
    assert.equal(
      reviewHeadline({ ...review, incomplete: true, questions: 6 }, 4),
      "The reviewer agent did not finish its review. Run it again; 6 points also wait for the client's confirmation.",
    );
  });

  it("says a review of the draft beside the narrative is that draft's", () => {
    const review: NarrativeReview = {
      passed: true,
      reviewer: "AGENT",
      rounds: 1,
      coverage: [],
      findings: [],
      fixes: [],
      questions: 0,
      incomplete: false,
      version: -1,
    };
    // Never "changed since the review": the way forward is Use the newer draft.
    assert.equal(
      reviewHeadline(review, 9),
      "The newer draft beside this one passed its review. Use the newer draft to take it with its review.",
    );
    assert.deepEqual(reviewActions(review, 9), []);
  });

  it("always offers a way forward from a held review", () => {
    const review: NarrativeReview = {
      passed: false,
      reviewer: "AGENT",
      rounds: 1,
      coverage: [],
      findings: [],
      fixes: [],
      questions: 6,
      incomplete: true,
      version: 4,
    };
    // The case reported on 26 October 2026: the review did not finish, facts awaited.
    assert.deepEqual(reviewActions(review, 4), ["review", "answer"]);
    assert.deepEqual(reviewActions({ ...review, incomplete: false }, 4), [
      "answer",
    ]);
    assert.deepEqual(
      reviewActions(
        { ...review, incomplete: false, questions: 0, findings: ["A2."] },
        4,
      ),
      ["redraft"],
    );
    assert.deepEqual(reviewActions({ ...review, passed: true }, 4), []);
    assert.deepEqual(reviewActions(review, 5), ["review"]);
    // Without a model, running the rules again changes nothing.
    assert.deepEqual(
      reviewActions(
        { ...review, reviewer: "RULES", incomplete: false, questions: 0 },
        4,
      ),
      [],
    );
    assert.equal(REVIEW_ACTION_LABELS.review, "Run the review again");
  });

  it("asks for a draft or a review, and saves sections with an optional note", () => {
    const narrate = contextWrite({ ...IDS, intent: "process-narrate" });
    assert.ok(!("error" in narrate));
    assert.equal(narrate.path, `${BASE}/controls/${CONTROL}/process/narrate`);
    const review = contextWrite({ ...IDS, intent: "process-review" });
    assert.ok(!("error" in review));
    assert.equal(
      review.path,
      `${BASE}/controls/${CONTROL}/process/review-narrative`,
    );
    const saved = contextWrite({
      ...IDS,
      intent: "process-save",
      sections: [
        {
          key: "PURPOSE",
          text: " The control. ",
          attributes: ["A1", "bad code"],
        },
        { key: "NOPE", text: "Dropped." },
        { key: "MONITORING", text: "   " },
      ],
      steps: [],
      version: 4,
      confirm: true,
      override_reason: "Walked through with the owner.",
    });
    assert.ok(!("error" in saved));
    assert.deepEqual(saved.body.sections, [
      { key: "PURPOSE", text: "The control.", attributes: ["A1"] },
    ]);
    assert.equal(saved.body.override_reason, "Walked through with the owner.");
    const plain = contextWrite({
      ...IDS,
      intent: "process-save",
      steps: [],
      version: 4,
    });
    assert.ok(!("error" in plain) && !("override_reason" in plain.body));
  });
});

// The narrative's progress and its points (decided by the product owner on 26 October
// 2026): a real status while the agents work, and a round of points confirmed as one
// decision.
describe("the narrative's progress and points", () => {
  const run: NarrativeRun = {
    status: "WORKING",
    mode: "DRAFT",
    stage: "REVIEWING",
    round: 1,
    note: "",
    startedAt: "2026-10-26T18:00:00Z",
    stageAt: "2026-10-26T18:00:40Z",
    progress: { answers: 12, documents: 2, attributes: 5, points: 0 },
    planOutcome: null,
  };
  const at = Date.parse("2026-10-26T18:01:15Z");

  it("shows each step, the one under way and for how long", () => {
    const { steps, seconds } = narrativeProgress(run, at);
    assert.deepEqual(
      steps.map((step) => [step.label, step.state]),
      [
        ["Gathering the facts", "done"],
        ["Drafting the narrative", "done"],
        ["Independent review", "active"],
        ["Final checks", "pending"],
      ],
    );
    assert.equal(steps[0]?.detail, "12 answers, 2 documents and 5 attributes");
    assert.equal(steps[2]?.seconds, 35);
    assert.equal(seconds, 75);
    assert.equal(clock(seconds), "1:15");
  });

  it("adds the second review only when it happens, and waits before the start", () => {
    const second = narrativeProgress({ ...run, round: 2 }, at).steps;
    assert.deepEqual(
      second.map((step) => step.state),
      ["done", "done", "done", "active", "pending"],
    );
    assert.equal(second[3]?.label, "Second review");
    const waiting = narrativeProgress(
      { ...run, status: "PENDING", stage: "" },
      at,
    );
    assert.equal(waiting.steps[0]?.state, "active");
    assert.equal(waiting.seconds, 0);
    // Reviewing alone reads the narrative instead of drafting it.
    assert.equal(
      narrativeProgress({ ...run, mode: "REVIEW" }, at).steps[1]?.label,
      "Reading the narrative",
    );
  });

  it("sends a round of points as one request, each with its answer", () => {
    const id = "01a13300-0000-7000-8000-0000000000aa";
    const sent = contextWrite({
      ...IDS,
      intent: "process-points",
      items: [{ issue_id: id, version: 2, answer: " Signed in ServiceNow. " }],
    });
    assert.ok(!("error" in sent));
    assert.equal(sent.path, `${BASE}/controls/${CONTROL}/process/points`);
    assert.deepEqual(sent.body, {
      items: [{ issue_id: id, version: 2, answer: "Signed in ServiceNow." }],
    });
    for (const items of [
      [],
      [{ issue_id: id, version: 2, answer: "" }],
      [{ issue_id: "x", version: 2, answer: "Yes" }],
      [{ issue_id: id, version: 0, answer: "Yes" }],
    ]) {
      assert.ok(
        "error" in contextWrite({ ...IDS, intent: "process-points", items }),
      );
    }
  });

  it("reads a point's statement, section, codes, round and kind", () => {
    const context = parseContext({
      control_id: CONTROL,
      design: null,
      issues: [
        {
          id: "i1",
          origin: "PROCESS",
          kind: "MISSING",
          topic: "Evidence of the check",
          detail: "",
          why: "A1 needs evidence.",
          resolve: "",
          quotes: [],
          raised_by: "AGENT",
          status: "OPEN",
          resolution_note: "",
          version: 1,
          question: "Where is the check recorded?",
          suggestions: [],
          proposal: "Role owners sign the listing in ServiceNow.",
          section: "RECORDING",
          attributes: ["A1", 3],
          round: 1,
          point_kind: "MISSING",
        },
      ],
    });
    const issue = context?.issues[0];
    assert.equal(
      issue?.proposal,
      "Role owners sign the listing in ServiceNow.",
    );
    assert.equal(issue?.section, "RECORDING");
    assert.deepEqual(issue?.attributes, ["A1"]);
    assert.equal(issue?.round, 1);
    assert.equal(issue?.pointKind, "MISSING");
  });
});

// The test plan follows the approved narrative (product owner, 26 October 2026).
describe("updating the test plan from the approved narrative", () => {
  const run: NarrativeRun = {
    status: "WORKING",
    mode: "PLAN",
    stage: "EVIDENCE",
    round: 0,
    note: "",
    startedAt: "2026-10-26T18:00:00Z",
    stageAt: "2026-10-26T18:00:50Z",
    progress: { answers: 0, documents: 0, attributes: 0, points: 0 },
    planOutcome: null,
  };

  it("shows the plan update's own steps", () => {
    const { steps } = narrativeProgress(
      run,
      Date.parse("2026-10-26T18:01:00Z"),
    );
    assert.deepEqual(
      steps.map((step) => [step.label, step.state]),
      [
        ["Reading the approved narrative", "done"],
        ["Attributes", "done"],
        ["Evidence", "active"],
      ],
    );
    assert.equal(steps[2]?.seconds, 10);
  });

  it("says what changed and where it is decided", () => {
    assert.equal(
      planOutcomeLine({
        attributes: 2,
        evidence: 0,
        evidenceProposed: 1,
        note: "",
      }),
      "The test plan was updated from the approved narrative: 2 attribute changes to decide on the Attributes tab; 1 evidence change to accept on the Evidence tab.",
    );
    assert.equal(
      planOutcomeLine({
        attributes: 0,
        evidence: 0,
        evidenceProposed: 0,
        note: "",
      }),
      "The test plan was checked against the approved narrative: it already matches how the control operates.",
    );
  });

  it("says when the evidence planner fell back, never that the plan matches", () => {
    assert.equal(
      planOutcomeLine({
        attributes: 1,
        evidence: 0,
        evidenceProposed: 0,
        evidenceFallback: true,
        note: "",
      }),
      "The evidence planner did not finish, so the evidence was not updated from the approved narrative (1 attribute change to decide on the Attributes tab). Update the plan again.",
    );
  });

  it("reads the plan update's mode and outcome", () => {
    const context = parseContext({
      control_id: CONTROL,
      design: null,
      understanding: {
        status: "CONFIRMED",
        summary: "",
        steps: [],
        version: 4,
        run: {
          status: "IDLE",
          mode: "PLAN",
          stage: "",
          round: 0,
          note: "",
          plan_outcome: {
            attributes: 2,
            evidence: 3,
            evidence_proposed: 1,
            note: "Done.",
          },
        },
      },
    });
    assert.equal(context?.understanding?.run?.mode, "PLAN");
    assert.deepEqual(context?.understanding?.run?.planOutcome, {
      attributes: 2,
      evidence: 3,
      evidenceProposed: 1,
      evidenceFallback: false,
      note: "Done.",
    });
  });
});
