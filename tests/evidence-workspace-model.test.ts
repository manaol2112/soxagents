import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  ControlFiles,
  ControlRequest,
} from "../apps/web/src/engagement-model.ts";
import {
  type EvidencePlan,
  parsePlan,
  planProblem,
  planWrite,
  waitsOnPerson,
} from "../apps/web/src/evidence-plan-model.ts";
import {
  evidenceSummary,
  fileServes,
  focusPhase,
  linkableFiles,
  matchesStatus,
  phaseDigest,
  proposals,
  requestRows,
  requirementGroups,
} from "../apps/web/src/evidence-workspace-model.ts";

const ORG = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const CONTROL = "33333333-3333-4333-8333-333333333333";
const REQ = "44444444-4444-4444-8444-444444444444";
const FILE = "55555555-5555-4555-8555-555555555555";
const LINK = "66666666-6666-4666-8666-666666666666";

function requirement(fields: Record<string, unknown>): Record<string, unknown> {
  return {
    title: "An item",
    description: "What the item asks for, in full.",
    categories: ["POPULATION"],
    objective: "Objective",
    rationale: "Why it is needed.",
    necessity: "REQUIRED",
    status: "REQUESTED",
    version: 1,
    ...fields,
  };
}

function plan(): EvidencePlan {
  const parsed = parsePlan({
    control_id: CONTROL,
    status: "PROPOSED",
    pending_changes: 1,
    phases: [
      {
        phase: "DESIGN",
        label: "Design effectiveness",
        applicability: "APPLICABLE",
        state: "NOT_SENT",
        requirements: [
          requirement({
            id: "d1",
            phase: "DESIGN",
            title: "How the control is performed",
            state: "READY_FOR_REVIEW",
            request_id: "r-design",
          }),
        ],
      },
      {
        phase: "INTERIM",
        label: "Interim operating effectiveness",
        applicability: "APPLICABLE",
        state: "RECEIVED_NOT_VALIDATED",
        requirements: [
          requirement({
            id: "i1",
            phase: "INTERIM",
            title: "Every grant in the window",
            state: "RECEIVED",
            request_id: "r-interim",
            files: [
              {
                file_id: "f-users",
                name: "users.csv",
                via: "REQUEST",
                read_status: "READY",
                coverage: "COVERED",
                note: "Every field is there.",
              },
            ],
            assessment: {
              proposal: "SUFFICIENT",
              reason: "users.csv covers it: Every field is there.",
              follow_ups: [],
            },
          }),
          requirement({
            id: "i2",
            phase: "INTERIM",
            title: "How the list was produced",
            state: "PARTIALLY_RECEIVED",
            request_id: "r-interim",
            files: [
              {
                file_id: "f-users",
                name: "users.csv",
                via: "REQUEST",
                coverage: "PARTIAL",
              },
            ],
            assessment: {
              proposal: "FOLLOW_UP",
              reason: "users.csv covers it in part.",
              follow_ups: ["Ask for the report parameters."],
            },
          }),
          requirement({
            id: "i3",
            phase: "INTERIM",
            title: "Already accepted",
            state: "ACCEPTED",
            request_id: "r-interim",
            assessment: { proposal: "SUFFICIENT", reason: "Covered." },
          }),
          requirement({
            id: "i4",
            phase: "INTERIM",
            title: "Sample evidence",
            state: "AWAITING_DEPENDENCY",
            status: "AWAITING_DEPENDENCY",
          }),
        ],
      },
      {
        phase: "ROLLFORWARD",
        label: "Roll-forward operating effectiveness",
        applicability: "PENDING",
        open_question: "Is interim testing signed off effective?",
        state: "AWAITING_CLARIFICATION",
        requirements: [
          requirement({
            id: "f1",
            phase: "ROLLFORWARD",
            title: "Changes since interim",
            status: "PLANNED",
            state: "RECEIVED",
            files: [
              {
                file_id: "f-policy",
                name: "policy.pdf",
                via: "LINK",
                link_id: LINK,
                linked_by: "Pat Preparer",
                reason: "The policy covers the whole year.",
                link_version: 1,
              },
            ],
          }),
          requirement({
            id: "f2",
            phase: "ROLLFORWARD",
            title: "Removed item",
            state: "REMOVED",
          }),
        ],
      },
    ],
  });
  assert.ok(parsed !== null);
  return parsed;
}

const request = (
  id: string,
  status: string,
  phase: string,
): ControlRequest => ({
  id,
  kind: "EVIDENCE",
  title: `${phase} evidence`,
  status,
  dueAt: "2027-01-10T00:00:00Z",
  version: 1,
  phase,
});

const files = {
  files: [
    {
      id: "f-users",
      fileName: "users.csv",
      readStatus: "READY",
      request: { id: "r-interim", status: "RECEIVED", providedDirectly: false },
    },
    {
      id: "f-policy",
      fileName: "policy.pdf",
      readStatus: "FAILED",
      request: { id: "r-design", status: "DRAFT", providedDirectly: false },
    },
    { id: "f-new", fileName: "new.csv", readStatus: "WORKING", request: null },
  ],
  applications: [],
  analyses: [],
  reviews: [],
} as unknown as ControlFiles;

describe("the evidence workspace", () => {
  it("parses each requirement's files and the reader's assessment", () => {
    const item = plan().phases[2]?.requirements[0];
    assert.ok(item);
    assert.deepEqual(
      [
        item.files[0]?.via,
        item.files[0]?.linkId,
        item.files[0]?.linkedBy,
        item.files[0]?.coverage,
      ],
      ["LINK", LINK, "Pat Preparer", null],
    );
    // No assessment from the API reads as no view, never as a judgment.
    assert.deepEqual(item.assessment, {
      proposal: "NONE",
      reason: "",
      followUps: [],
    });
  });

  it("sums where the evidence stands and what holds it up", () => {
    const summary = evidenceSummary(
      plan(),
      [
        request("r-design", "DRAFT", "DESIGN"),
        request("r-interim", "RECEIVED", "INTERIM"),
        request("r-late", "OVERDUE", "INTERIM"),
      ],
      files,
    );
    assert.deepEqual(summary.requirements, {
      total: 6,
      accepted: 1,
      toJudge: 3,
      gaps: 0,
      withOwner: 0,
      unsent: 1,
      notRequested: 1,
    });
    assert.deepEqual(summary.requests, {
      total: 3,
      drafted: 1,
      approval: 0,
      approved: 0,
      out: 1,
      overdue: 1,
      answered: 1,
    });
    assert.deepEqual(summary.files, {
      total: 3,
      read: 1,
      reading: 1,
      failed: 1,
    });
    assert.deepEqual(summary.blockers, [
      "Roll-forward operating effectiveness: Is interim testing signed off effective?",
      "Planning again proposes 1 change to decide",
      "1 request overdue with the owner",
      "1 file could not be read; a person reviews it",
    ]);
  });

  it("lists the reader's proposals only where a person has yet to decide", () => {
    const listed = proposals(plan());
    // Follow-up first, then sufficient; an accepted item and one with no view are not listed.
    assert.deepEqual(
      listed.map((item) => [item.requirement.id, item.assessment.proposal]),
      [
        ["i2", "FOLLOW_UP"],
        ["i1", "SUFFICIENT"],
      ],
    );
    assert.equal(listed[0]?.phaseLabel, "Interim");
  });

  it("opens the first phase that is not signed off", () => {
    const phase = (
      key: "DESIGN" | "INTERIM" | "ROLLFORWARD",
      state: "NOT_GENERATED" | "COMPLETE" | "NOT_APPLICABLE",
      testingComplete = false,
    ) => ({
      phase: key,
      applicability:
        state === "NOT_APPLICABLE"
          ? ("NOT_APPLICABLE" as const)
          : ("APPLICABLE" as const),
      state,
      testingComplete,
    });
    assert.equal(
      focusPhase([
        phase("DESIGN", "NOT_GENERATED"),
        phase("INTERIM", "NOT_GENERATED"),
        phase("ROLLFORWARD", "NOT_GENERATED"),
      ]),
      "DESIGN",
    );
    assert.equal(
      focusPhase([
        phase("DESIGN", "COMPLETE", true),
        phase("INTERIM", "NOT_GENERATED"),
        phase("ROLLFORWARD", "NOT_GENERATED"),
      ]),
      "INTERIM",
    );
    assert.equal(
      focusPhase([
        phase("DESIGN", "COMPLETE", true),
        phase("INTERIM", "NOT_APPLICABLE"),
        phase("ROLLFORWARD", "NOT_GENERATED"),
      ]),
      "ROLLFORWARD",
    );
  });

  it("filters the requirements by phase and status, and keeps removed items out", () => {
    const all = requirementGroups(plan(), "all", "all");
    assert.deepEqual(
      all.map((group) => [group.phase.phase, group.items.map((q) => q.id)]),
      [
        ["DESIGN", ["d1"]],
        ["INTERIM", ["i1", "i2", "i3", "i4"]],
        ["ROLLFORWARD", ["f1"]],
      ],
    );
    const decide = requirementGroups(plan(), "INTERIM", "decide");
    assert.deepEqual(
      decide.map((group) => group.items.map((q) => q.id)),
      [["i1", "i2"]],
    );
    const item = plan().phases[1]?.requirements[3];
    assert.ok(item);
    assert.equal(matchesStatus(item, "waiting"), true);
    assert.equal(matchesStatus(item, "accepted"), false);
  });

  it("gives each request what it carries and the files that came back", () => {
    const rows = requestRows(
      [
        request("r-interim", "RECEIVED", "INTERIM"),
        request("r-design", "DRAFT", "DESIGN"),
      ],
      plan(),
      files,
    );
    assert.deepEqual(
      rows.map((row) => [row.id, row.carries, row.files]),
      [
        ["r-design", ["How the control is performed"], 1],
        [
          "r-interim",
          [
            "Every grant in the window",
            "How the list was produced",
            "Already accepted",
          ],
          1,
        ],
      ],
    );
  });

  it("says which items each file serves, and how", () => {
    const serves = fileServes(plan());
    assert.deepEqual(serves.get("f-users"), [
      { label: "Interim: Every grant in the window, covered", via: "REQUEST" },
      {
        label: "Interim: How the list was produced, partly covered",
        via: "REQUEST",
      },
    ]);
    assert.deepEqual(serves.get("f-policy"), [
      { label: "Roll-forward: Changes since interim", via: "LINK" },
    ]);
  });

  it("offers only files that do not serve the item yet, and not those on its request", () => {
    const held = files.files.map((file) => ({
      id: file.id,
      fileName: file.fileName,
      requestId: file.request?.id ?? null,
    }));
    const design = plan().phases[0]?.requirements[0];
    const rolled = plan().phases[2]?.requirements[0];
    assert.ok(design && rolled);
    // policy.pdf is on the design request already; users.csv and new.csv can be linked.
    assert.deepEqual(
      linkableFiles(design, held).map((file) => file.id),
      ["f-users", "f-new"],
    );
    // The roll-forward item already has policy.pdf.
    assert.deepEqual(
      linkableFiles(rolled, held).map((file) => file.id),
      ["f-users", "f-new"],
    );
  });

  it("links and unlinks a file only with a reason, and says why one is refused", () => {
    const ids = {
      organization_id: ORG,
      project_id: PROJECT,
      control_id: CONTROL,
    };
    const base = `/organizations/${ORG}/projects/${PROJECT}/controls/${CONTROL}/evidence-requirements/${REQ}`;
    assert.deepEqual(
      planWrite({
        ...ids,
        intent: "link",
        requirement_id: REQ,
        file_id: FILE,
        reason: "Covers the year.",
        version: 2,
      }),
      {
        intent: "link",
        path: `${base}/files`,
        body: { file_id: FILE, reason: "Covers the year.", version: 2 },
        slow: false,
      },
    );
    assert.deepEqual(
      planWrite({
        ...ids,
        intent: "unlink",
        requirement_id: REQ,
        link_id: LINK,
        reason: "Changed.",
        version: 1,
      }),
      {
        intent: "unlink",
        path: `${base}/files/${LINK}/remove`,
        body: { reason: "Changed.", version: 1 },
        slow: false,
      },
    );
    assert.deepEqual(
      planWrite({
        ...ids,
        intent: "link",
        requirement_id: REQ,
        file_id: FILE,
        reason: "",
        version: 2,
      }),
      { error: "invalid" },
    );
    assert.deepEqual(
      planWrite({
        ...ids,
        intent: "link",
        requirement_id: REQ,
        file_id: FILE,
        reason: "password=hunter22 here",
        version: 2,
      }),
      { error: "invalid" },
    );
    assert.equal(
      planProblem(409, "the file already serves it through its request"),
      "That file already serves this item through its request.",
    );
    assert.equal(
      planProblem(409, "the file is not one of this control's evidence files"),
      "Only a file this control already holds can serve its items.",
    );
  });
});

describe("the evidence on one page", () => {
  const phaseOf = (states: string[], applicability = "APPLICABLE") => {
    const parsed = parsePlan({
      control_id: CONTROL,
      status: "APPROVED",
      phases: [
        {
          phase: "INTERIM",
          applicability,
          state: "OUTSTANDING",
          requirements: states.map((state, index) =>
            requirement({ id: `q${index}`, phase: "INTERIM", state }),
          ),
        },
      ],
    });
    const phase = parsed?.phases.find((item) => item.phase === "INTERIM");
    assert.ok(phase !== undefined);
    return phase;
  };

  it("waits on a person only for what arrived unjudged, a proposed change, or a flag", () => {
    const phase = phaseOf([
      "RECEIVED",
      "PARTIALLY_RECEIVED",
      "UNDER_REVIEW",
      "ACCEPTED",
      "INSUFFICIENT",
      "REQUESTED",
      "NOT_APPLICABLE",
    ]);
    assert.deepEqual(
      phase.requirements.map((item) => waitsOnPerson(item)),
      [true, true, true, false, false, false, false],
    );
    const [first] = phase.requirements;
    assert.ok(first !== undefined);
    assert.equal(
      waitsOnPerson({ ...first, state: "ACCEPTED", needsReview: true }),
      true,
    );
    assert.equal(
      waitsOnPerson({
        ...first,
        state: "ACCEPTED",
        pendingChange: { remove: true, title: "", description: "" },
      }),
      true,
    );
  });

  it("sums a phase in one line: items, accepted, and what is to review", () => {
    const phase = phaseOf([
      "ACCEPTED",
      "ACCEPTED",
      "RECEIVED",
      "NOT_APPLICABLE",
    ]);
    assert.deepEqual(phaseDigest(phase, phase.requirements), {
      total: 3,
      accepted: 2,
      waiting: 1,
      line: "3 items · 2 accepted · 1 to review",
    });
    const settled = phaseOf(["ACCEPTED"]);
    assert.equal(
      phaseDigest(settled, settled.requirements).line,
      "1 item · 1 accepted",
    );
    const none = phaseOf([], "NOT_APPLICABLE");
    assert.equal(phaseDigest(none, []).line, "Not applicable");
    const empty = phaseOf([]);
    assert.equal(phaseDigest(empty, []).line, "Nothing planned");
  });
});
