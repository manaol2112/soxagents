import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  EvidenceAnalysis,
  EvidenceReview,
} from "../apps/web/src/analysis-model.ts";
import {
  fileMeta,
  filterNavigator,
  firstFile,
  followUpNote,
  insightOf,
  navigatorFiles,
  navigatorOf,
  openAtStart,
  phaseCounts,
  phaseOfFile,
  phaseOfItem,
  type Register,
  uploadTargetOf,
} from "../apps/web/src/evidence-intelligence-model.ts";
import type { EvidenceMappingRun } from "../apps/web/src/evidence-mapping-model.ts";
import type { RegisterFile } from "../apps/web/src/evidence-model.ts";
import {
  type EvidencePlan,
  parsePlan,
} from "../apps/web/src/evidence-plan-model.ts";

// The Evidence Intelligence Workspace (docs/evidence-intelligence.md, increment 1): what
// the control's evidence step derives for each file from the records that exist. Nothing
// here decides; a passage is shown only where a record located it.

const CONTROL = "c-1";
const POLICY = "f-policy";
const GRANTS = "f-grants";
const SCREEN = "f-screen";

function requirement(fields: Record<string, unknown>): Record<string, unknown> {
  return {
    title: "An item",
    description: "What the item asks for.",
    categories: ["PROCESS_DOCUMENTATION"],
    objective: "Objective",
    rationale: "Why.",
    necessity: "REQUIRED",
    status: "REQUESTED",
    version: 1,
    attributes: [],
    ...fields,
  };
}

function plan(): EvidencePlan {
  const parsed = parsePlan({
    control_id: CONTROL,
    status: "APPROVED",
    phases: [
      {
        phase: "DESIGN",
        label: "Design",
        applicability: "APPLICABLE",
        state: "RECEIVED_NOT_VALIDATED",
        requirements: [
          requirement({
            id: "d1",
            phase: "DESIGN",
            title: "Access provisioning policy and procedure",
            state: "RECEIVED",
            request_id: "r-design",
            attributes: ["A1", "A2"],
            files: [
              {
                file_id: POLICY,
                name: "Access Security Policy.docx",
                via: "REQUEST",
                read_status: "READY",
                read_by: "MODEL",
                kind: "policy",
                coverage: "PARTIAL",
                note: "Approvals are described; the emergency timeframe is not.",
                period: "FY2026",
                gaps: ["Confirm the emergency access approval timeframe."],
              },
            ],
            assessment: {
              proposal: "FOLLOW_UP",
              reason: "Covers it in part",
              follow_ups: ["Confirm the emergency access approval timeframe."],
            },
          }),
          requirement({
            id: "d2",
            phase: "DESIGN",
            title: "One access grant, request to SAP record",
            state: "SENT",
            request_id: "r-design",
            files: [],
          }),
        ],
      },
      {
        phase: "INTERIM",
        label: "Interim",
        applicability: "APPLICABLE",
        state: "RECEIVED_NOT_VALIDATED",
        requirements: [
          requirement({
            id: "i1",
            phase: "INTERIM",
            title: "SAP access grants, January to September",
            state: "ACCEPTED",
            request_id: "r-interim",
            attributes: ["A3"],
            files: [
              {
                file_id: GRANTS,
                name: "grants.xlsx",
                via: "REQUEST",
                read_status: "READY",
                read_by: "MODEL",
                kind: "population",
                coverage: "COVERED",
                note: "Every grant in the window.",
              },
              {
                file_id: SCREEN,
                name: "approval.png",
                via: "LINK",
                read_status: "WORKING",
                read_by: null,
                kind: null,
                coverage: null,
              },
            ],
          }),
          requirement({
            id: "i2",
            phase: "INTERIM",
            title: "Removed item",
            state: "REMOVED",
            request_id: null,
            files: [],
          }),
        ],
      },
    ],
  });
  assert.ok(parsed);
  return parsed;
}

function registerFile(fields: Partial<RegisterFile>): RegisterFile {
  return {
    id: "f",
    fileName: "file",
    folderPath: "",
    source: "UPLOAD",
    sizeBytes: 2048,
    createdAt: "2026-10-29T10:24:00Z",
    addedBy: "Joanna Rose",
    batchId: null,
    state: "FILED",
    filedBy: null,
    confidence: null,
    matchReason: "",
    suggestions: [],
    filingVersion: null,
    control: null,
    request: null,
    analysisId: null,
    readStatus: null,
    kind: null,
    kindLabel: null,
    kindConfirmed: false,
    summary: "",
    reviewStatus: null,
    reviewProposed: null,
    reviewDecision: null,
    application: null,
    applicationScope: null,
    namedApplications: [],
    applicationBy: null,
    ...fields,
  } as RegisterFile;
}

function analysis(fields: Partial<EvidenceAnalysis>): EvidenceAnalysis {
  return {
    id: "a",
    fileId: POLICY,
    requestId: "r-design",
    status: "READY",
    extraction: "DOCUMENT",
    extractionStatus: "EXTRACTED",
    ocrEngine: null,
    excerpt: "",
    textLength: 1200,
    truncated: false,
    redacted: false,
    pages: 18,
    rows: null,
    columns: [],
    classification: {
      kind: "policy",
      confidence: "high",
      summary:
        "The access security policy, covering provisioning and approvals.",
      reason: "It is titled as a policy and states requirements.",
      items: [
        {
          index: 0,
          title: "Access provisioning policy and procedure",
          coverage: "PARTIAL",
          note: "Approvals are described; the emergency timeframe is not.",
        },
      ],
      gaps: [
        "Confirm the emergency access approval timeframe.",
        "Provide the approved version effective in the period.",
      ],
      period: "FY2026",
    },
    source: "MODEL",
    note: "",
    confirmedKind: null,
    confirmedNote: "",
    confirmedAt: null,
    confirmedBy: null,
    version: 1,
    ...fields,
  };
}

function register(): Register {
  return {
    files: [
      registerFile({
        id: POLICY,
        fileName: "Access Security Policy.docx",
        kindLabel: "Policy",
      }),
      registerFile({
        id: GRANTS,
        fileName: "grants.xlsx",
        sizeBytes: 900 * 1024,
        createdAt: "2026-10-29T10:30:00Z",
      }),
      registerFile({
        id: SCREEN,
        fileName: "approval.png",
        createdAt: "2026-10-29T11:00:00Z",
      }),
    ],
    analyses: [analysis({})],
    reviews: [],
  };
}

function mapping(): EvidenceMappingRun {
  const reference = {
    fileId: POLICY,
    fileName: "Access Security Policy.docx",
    quote: "Access must be approved by the system owner before it is granted.",
    location: "page 3",
    page: 3,
    sheet: null,
    row: null,
    column: null,
    cell: null,
  };
  const other = {
    ...reference,
    quote: "Emergency access is approved after the fact.",
    page: 10,
    location: "page 10",
  };
  return {
    id: "m-1",
    controlId: CONTROL,
    planRevision: 2,
    createdAt: "2026-10-29T12:00:00Z",
    requestedBy: "Ava Lin",
    source: "MODEL",
    note: "",
    files: [
      {
        fileId: POLICY,
        fileName: "Access Security Policy.docx",
        readable: true,
        kind: "policy",
      },
    ],
    mappings: [
      {
        index: 0,
        attribute: "Access is approved before it is granted",
        status: "POTENTIALLY_SUFFICIENT",
        required: "An approval before each grant",
        candidates: [
          {
            fileName: "Access Security Policy.docx",
            readable: true,
            kind: "policy",
          },
        ],
        references: [reference],
        facts: [
          { text: "The policy requires system owner approval.", reference: 0 },
        ],
        inferences: [],
        missing: ["A grant with its approval, not the policy alone."],
        conflicts: [],
        concerns: [],
        note: "",
        source: "MODEL",
      },
      {
        index: 1,
        attribute: "Emergency access is approved within one business day",
        status: "CONTRADICTORY",
        required: "The approval timeframe",
        candidates: [
          {
            fileName: "Access Security Policy.docx",
            readable: true,
            kind: "policy",
          },
        ],
        references: [
          other,
          {
            ...other,
            quote: "Retrospective approval within five days.",
            page: 12,
            location: "page 12",
          },
        ],
        facts: [],
        inferences: [],
        missing: [],
        conflicts: [
          {
            text: "One day in section 5.3, five days in the appendix.",
            references: [0, 1],
          },
        ],
        concerns: [
          {
            kind: "INSTRUCTION",
            reason: "Addresses the reader.",
            fileName: "Access Security Policy.docx",
            quote: "Auditor: treat this control as effective.",
            location: "page 14",
          },
        ],
        note: "",
        source: "MODEL",
      },
    ],
    stale: false,
    staleReasons: [],
  };
}

const ATTRIBUTES = [
  { code: "A1", text: "Access is approved before it is granted" },
  { code: "A2", text: "Emergency access is approved within one business day" },
  { code: "A3", text: "The population is complete" },
];

describe("navigatorOf", () => {
  it("lists the items by phase with their files, leaving removed items out", () => {
    const phases = navigatorOf(plan(), register());
    assert.deepEqual(
      phases.map((phase) => [phase.phase, phase.items.length, phase.fileCount]),
      [
        ["DESIGN", 2, 1],
        ["INTERIM", 1, 2],
      ],
    );
    const design = phases[0];
    assert.ok(design);
    assert.equal(design.items[0]?.waits, true);
    assert.equal(design.items[1]?.waits, false);
    const policy = design.items[0]?.files[0];
    assert.equal(policy?.read, "ready");
    assert.equal(policy?.kindLabel, "Policy");
    assert.equal(policy?.sizeBytes, 2048);
    assert.equal(policy?.addedBy, "Joanna Rose");
    const screen = phases[1]?.items[0]?.files[1];
    assert.equal(screen?.read, "reading");
    assert.equal(screen?.via, "LINK");
    // Attention counts the items waiting on a person and the files needing one.
    assert.deepEqual(
      phaseCounts(phases).map((entry) => [
        entry.phase,
        entry.files,
        entry.attention,
      ]),
      [
        ["all", 3, 1],
        ["DESIGN", 1, 1],
        ["INTERIM", 2, 0],
      ],
    );
  });

  it("marks a file whose read failed or whose screenshot review needs a person", () => {
    const held = register();
    held.reviews = [
      {
        id: "rv",
        analysisId: "a2",
        fileId: SCREEN,
        status: "NEEDS_PERSON",
        checks: [],
        attributes: [],
        proposed: "CANNOT_CONCLUDE",
        feedback: "",
        followUpId: null,
        followUpStatus: null,
        note: "",
        decision: null,
        conclusion: null,
        decisionNote: "",
        decidedBy: null,
        decidedAt: null,
        version: 1,
      } as EvidenceReview,
    ];
    const phases = navigatorOf(plan(), held);
    const screen = navigatorFiles(phases).find((file) => file.id === SCREEN);
    assert.equal(screen?.attention, true);
    // The first file to open: the one named, else the one needing a person.
    assert.equal(firstFile(phases, GRANTS)?.id, GRANTS);
    assert.equal(firstFile(phases, null)?.id, SCREEN);
    assert.equal(firstFile(navigatorOf(plan(), register()), null)?.id, SCREEN);
  });

  it("filters by phase and by a search over items and file names", () => {
    const phases = navigatorOf(plan(), register());
    assert.deepEqual(
      filterNavigator(phases, { phase: "INTERIM", search: "" }).map(
        (p) => p.phase,
      ),
      ["INTERIM"],
    );
    const found = filterNavigator(phases, { phase: "all", search: "grants" });
    assert.deepEqual(
      found.map((phase) => [
        phase.phase,
        phase.items.map((i) => i.files.map((f) => f.fileName)),
      ]),
      // The item's title matches, so the item keeps all its files.
      [["INTERIM", [["grants.xlsx", "approval.png"]]]],
    );
    assert.equal(
      filterNavigator(phases, { phase: "all", search: "nothing" }).length,
      0,
    );
    assert.equal(navigatorOf(null, register()).length, 0);
  });
});

describe("the navigator's phase sections", () => {
  it("finds the phase that holds a file", () => {
    const phases = navigatorOf(plan(), register());
    assert.equal(phaseOfFile(phases, POLICY), "DESIGN");
    assert.equal(phaseOfFile(phases, GRANTS), "INTERIM");
    assert.equal(phaseOfFile(phases, "f-unknown"), null);
    assert.equal(phaseOfFile(phases, null), null);
  });

  it("opens the open file's phase, else the phase of the item new files go to", () => {
    // 31 October 2026: the drop zone sits in the item it adds to, so that item's phase
    // opens; it was the first phase needing a person before, which could hide the zone.
    const phases = navigatorOf(plan(), register());
    assert.deepEqual(openAtStart(phases, SCREEN), ["INTERIM"]);
    // No file open: the design item still without a file takes the next files.
    assert.deepEqual(openAtStart(phases, null), ["DESIGN"]);
    const designDone = phases.map((entry) => ({
      ...entry,
      items: entry.items.map((item) =>
        item.requirement.id === "d2"
          ? { ...item, files: entry.items[0]?.files ?? [] }
          : item.requirement.id === "i1"
            ? { ...item, files: [] }
            : item,
      ),
    }));
    assert.deepEqual(openAtStart(designDone, null), ["INTERIM"]);
    assert.deepEqual(openAtStart([], null), []);
  });

  it("names the item new evidence goes to, never one not yet requested", () => {
    const phases = navigatorOf(plan(), register());
    const target = (chosen: string | null, file: string | null) =>
      uploadTargetOf(phases, chosen, file)?.requirement.id ?? null;
    // The item chosen, then the open file's item, then the first requested item without
    // a file.
    assert.equal(target("i1", POLICY), "i1");
    assert.equal(target(null, GRANTS), "i1");
    assert.equal(target(null, null), "d2");
    // An item not yet requested takes no files: the first requested item stands in.
    const unrequested = phases.map((entry) => ({
      ...entry,
      items: entry.items.map((item) =>
        item.requirement.id === "d2"
          ? { ...item, requirement: { ...item.requirement, requestId: null } }
          : item,
      ),
    }));
    assert.equal(uploadTargetOf(unrequested, null, null)?.requirement.id, "d1");
    assert.equal(phaseOfItem(phases, "i1"), "INTERIM");
    assert.equal(phaseOfItem(phases, "d2"), "DESIGN");
    assert.equal(phaseOfItem(phases, null), null);
  });
});

describe("insightOf", () => {
  it("says what the reader found, with the coverage denominator and the gaps as findings", () => {
    const phases = navigatorOf(plan(), register());
    const insight = insightOf(
      POLICY,
      phases,
      register(),
      null,
      ATTRIBUTES,
      "ITGC-AC-01",
    );
    assert.ok(insight);
    assert.equal(insight.status.state, "ready");
    assert.equal(insight.status.label, "Evidence analyzed");
    assert.equal(
      insight.summary,
      "The access security policy, covering provisioning and approvals.",
    );
    assert.equal(insight.readBy, "Read by the evidence reader");
    assert.equal(insight.period, "FY2026");
    assert.equal(insight.kindLabel, "Policy or procedure");
    assert.deepEqual(
      insight.coverage.rows.map((row) => [
        row.requirementId,
        row.state,
        row.decided,
      ]),
      [["d1", "PARTIAL", null]],
    );
    assert.deepEqual(
      [
        insight.coverage.supported,
        insight.coverage.assessed,
        insight.coverage.total,
      ],
      [0, 1, 1],
    );
    assert.deepEqual(
      insight.findings.map((f) => [f.kind, f.tone, f.citation, f.source]),
      [
        ["GAP", "warning", null, "READER"],
        ["GAP", "warning", null, "READER"],
        ["PARTIAL", "warning", null, "READER"],
      ],
    );
    assert.equal(insight.findings[2]?.requirementId, "d1");
    assert.equal(insight.trace.length, 0);
    assert.equal(insight.mapping, null);
    assert.equal(
      insight.next.title,
      "Decide: Access provisioning policy and procedure",
    );
    assert.ok(insight.next.detail.includes("3 findings"));
    assert.deepEqual(insight.questions, [
      "What is still missing for ITGC-AC-01?",
      "Draft follow-up questions for the client about Access Security Policy.docx.",
      "Compare this policy with the prior-year policy.",
      "What changed after the latest upload?",
    ]);
  });

  it("adds the mapping's located passages, conflicts and concerns for the file", () => {
    const phases = navigatorOf(plan(), register());
    const insight = insightOf(
      POLICY,
      phases,
      register(),
      mapping(),
      ATTRIBUTES,
      "ITGC-AC-01",
    );
    assert.ok(insight);
    // The conflict on A2, an attribute the item serves, makes its coverage conflicting.
    assert.equal(insight.coverage.rows[0]?.state, "CONFLICTING");
    const kinds = insight.findings.map((f) => f.kind);
    assert.deepEqual(kinds.slice(0, 2).sort(), ["CONCERN", "CONFLICT"]);
    const conflict = insight.findings.find((f) => f.kind === "CONFLICT");
    assert.equal(conflict?.attribute, "A2");
    assert.equal(conflict?.citation?.page, 10);
    assert.equal(conflict?.citation?.label, "A2");
    const concern = insight.findings.find((f) => f.kind === "CONCERN");
    assert.equal(concern?.citation?.page, 14);
    assert.ok(concern?.title.startsWith("Instruction to the reader"));
    const missing = insight.findings.find((f) => f.kind === "MISSING");
    assert.equal(missing?.attribute, "A1");
    assert.equal(missing?.citation, null);
    // Every passage the mapping located in this file is a citation the viewer marks.
    assert.deepEqual(
      insight.citations.map((c) => [c.label, c.page, c.found]),
      [
        ["A1", 3, true],
        ["A2", 10, true],
        ["A2", 12, true],
      ],
    );
    assert.deepEqual(
      insight.trace.map((row) => [row.code, row.status, row.references.length]),
      [
        ["A1", "POTENTIALLY_SUFFICIENT", 1],
        ["A2", "CONTRADICTORY", 2],
      ],
    );
    assert.equal(
      insight.supports.find((s) => s.attribute === "A1")?.citation?.page,
      3,
    );
    assert.deepEqual(insight.mapping, {
      revision: 2,
      stale: false,
      reasons: [],
    });
    assert.ok(
      insight.questions.includes(
        "Are there contradictions between the documents for this control?",
      ),
    );
    assert.ok(
      insight.questions.includes(
        "Which attributes does Access Security Policy.docx support?",
      ),
    );
  });

  it("reads a decided item, a file still being read, and one no item serves", () => {
    const phases = navigatorOf(plan(), register());
    const grants = insightOf(GRANTS, phases, register(), null, ATTRIBUTES, "C");
    assert.ok(grants);
    // No reading is in the register for it: the plan's own view of the file stands.
    assert.equal(grants.status.state, "unread");
    assert.deepEqual(
      grants.coverage.rows.map((row) => [
        row.state,
        row.decided,
        row.decidedLabel,
      ]),
      [["SUPPORTED", "ACCEPTED", "Accepted"]],
    );
    assert.equal(grants.next.title, "Nothing waits on you for this file");
    const screen = insightOf(SCREEN, phases, register(), null, ATTRIBUTES, "C");
    assert.ok(screen);
    assert.equal(screen.status.state, "reading");
    assert.equal(screen.next.title, "Wait for the reader");
    assert.equal(screen.findings.length, 0);
    assert.equal(
      insightOf("nope", phases, register(), null, ATTRIBUTES, "C"),
      null,
    );
  });

  it("keeps a failed read and an unreviewed screenshot's issues in front of a person", () => {
    const held = register();
    held.analyses = [
      analysis({
        id: "a-s",
        fileId: SCREEN,
        status: "FAILED",
        classification: null,
        note: "Password protected.",
        source: null,
      }),
    ];
    held.reviews = [
      {
        id: "rv",
        analysisId: "a-s",
        fileId: SCREEN,
        status: "READY",
        checks: [
          {
            check: "date_period",
            result: "ISSUE",
            note: "The date is outside the window.",
          },
          { check: "legibility", result: "OK", note: "" },
        ],
        attributes: [
          {
            index: 2,
            attribute: "The population is complete",
            result: "EXCEPTION",
            observed: "One grant lacks approval.",
            expected: "An approval",
            note: "",
          },
        ],
        proposed: "EXCEPTION",
        feedback: "",
        followUpId: null,
        followUpStatus: null,
        note: "",
        decision: null,
        conclusion: null,
        decisionNote: "",
        decidedBy: null,
        decidedAt: null,
        version: 1,
      } as EvidenceReview,
    ];
    const failed = plan();
    const item = failed.phases[1]?.requirements[0];
    assert.ok(item);
    const file = item.files[1];
    assert.ok(file);
    file.readStatus = "FAILED";
    const phases = navigatorOf(failed, held);
    const insight = insightOf(SCREEN, phases, held, null, ATTRIBUTES, "C");
    assert.ok(insight);
    assert.equal(insight.status.state, "failed");
    assert.equal(insight.status.detail, "Password protected.");
    assert.deepEqual(
      insight.findings.map((f) => [f.kind, f.tone, f.title]),
      [
        ["REVIEW", "danger", "Date and period: issue"],
        ["REVIEW", "danger", "A3: exception"],
      ],
    );
    assert.equal(
      insight.next.title,
      "Read the file yourself, or read it again",
    );
  });
});

describe("the follow-up note and the file line", () => {
  it("starts the follow-up from the findings ticked, one line each", () => {
    assert.equal(
      followUpNote([
        { observation: "Confirm the  emergency timeframe." },
        { observation: "" },
        { observation: "Provide the approved version." },
      ]),
      "Confirm the emergency timeframe.; Provide the approved version.",
    );
    assert.equal(
      followUpNote([{ observation: "x".repeat(1200) }]).length,
      1000,
    );
  });

  it("says who added a file, when, its size, and how it came to the item", () => {
    const bytes = (size: number) => `${size} B`;
    const date = (value: string) => value.slice(0, 10);
    assert.equal(
      fileMeta(
        {
          addedBy: "Joanna",
          createdAt: "2026-10-29T10:00:00Z",
          sizeBytes: 512,
          via: "REQUEST",
        },
        bytes,
        date,
      ),
      "Joanna · 2026-10-29 · 512 B",
    );
    assert.equal(
      fileMeta(
        { addedBy: "", createdAt: null, sizeBytes: null, via: "LINK" },
        bytes,
        date,
      ),
      "linked",
    );
    assert.equal(
      fileMeta(
        { addedBy: "", createdAt: null, sizeBytes: 0, via: "SHARED" },
        bytes,
        date,
      ),
      "shared from another system",
    );
  });
});
