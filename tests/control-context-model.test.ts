import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  contextProblem,
  contextWrite,
  documentUploadTarget,
  parseContext,
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
        },
        { description: "   " },
      ],
      version: 0,
      confirm: true,
    });
    assert.ok(!("error" in saved));
    assert.deepEqual(saved.body, {
      summary: "Short.",
      steps: [
        {
          description: "Billing raises it.",
          actor: "",
          system: "",
          control_point: true,
          basis: "DOCUMENTED",
          source: "",
          quote: "",
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
