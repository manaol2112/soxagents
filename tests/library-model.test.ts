import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  approvable,
  canGovern,
  filterEntries,
  groupByDomain,
  libraryHref,
  libraryProblem,
  libraryWrite,
  parseLibraryEntry,
  parseLibraryIndex,
  parseLibraryTab,
  proceduresByPhase,
  referencesFor,
  statusActions,
  stepEvidence,
  suiteByPhase,
} from "../apps/web/src/library-model.ts";

const ORG = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";

function row(fields: Record<string, unknown>): Record<string, unknown> {
  return {
    library_key: "access-provisioning",
    control_ref: "ITGC-AC-01",
    title: "New user access is approved",
    category: "ITGC",
    domain: "ACCESS",
    domain_label: "Logical access",
    nature: "MANUAL",
    frequency: "EVENT_DRIVEN",
    control_type: "PREVENTIVE",
    objective: "Only access that an authorized person approved is granted.",
    procedures: 3,
    attributes_tested: 4,
    attributes_proposed: 0,
    evidence: 2,
    status: "PENDING_REVIEW",
    approved_version: null,
    decided_at: null,
    usage_engagements: 2,
    usage_controls: 5,
    open_requests: 1,
    ...fields,
  };
}

describe("the library index", () => {
  it("reads the API's entries, categories, and counts", () => {
    const index = parseLibraryIndex({
      library_version: 3,
      categories: [{ key: "ITGC", label: "IT general controls", entries: 19 }],
      counts: { PENDING_REVIEW: 52, APPROVED: 1, nonsense: 9 },
      entries: [row({}), row({ library_key: "x", status: "NOT_A_STATUS" })],
      new_requests: [],
    });
    assert.ok(index !== null);
    assert.equal(index.libraryVersion, 3);
    assert.deepEqual(index.counts, { PENDING_REVIEW: 52, APPROVED: 1 });
    assert.equal(index.entries[0]?.usageEngagements, 2);
    // An unknown status reads as pending review, never as approved.
    assert.equal(index.entries[1]?.status, "PENDING_REVIEW");
    assert.equal(parseLibraryIndex({ entries: "no" }), null);
  });

  it("filters by category, status, and words, and groups by area", () => {
    const index = parseLibraryIndex({
      entries: [
        row({}),
        row({
          library_key: "rtr-journal-review",
          control_ref: "RTR-01",
          title: "Manual journals are approved",
          category: "BUSINESS",
          domain: "RECORD_TO_REPORT",
          domain_label: "Record to report",
          status: "APPROVED",
        }),
        row({
          library_key: "access-review",
          control_ref: "ITGC-AC-03",
          title: "Access is reviewed each quarter",
        }),
      ],
    });
    assert.ok(index !== null);
    const all = { category: null, status: null, query: "" };
    assert.equal(filterEntries(index.entries, all).length, 3);
    assert.deepEqual(
      filterEntries(index.entries, { ...all, category: "ITGC" }).map(
        (entry) => entry.controlRef,
      ),
      ["ITGC-AC-01", "ITGC-AC-03"],
    );
    assert.deepEqual(
      filterEntries(index.entries, { ...all, status: "APPROVED" }).map(
        (entry) => entry.controlRef,
      ),
      ["RTR-01"],
    );
    assert.deepEqual(
      filterEntries(index.entries, { ...all, query: "quarter" }).map(
        (entry) => entry.controlRef,
      ),
      ["ITGC-AC-03"],
    );
    assert.deepEqual(
      groupByDomain(index.entries).map((group) => [
        group.label,
        group.entries.length,
      ]),
      [
        ["Logical access", 2],
        ["Record to report", 1],
      ],
    );
  });
});

describe("one standard control", () => {
  it("reads its procedures by phase, attributes, statement, and review", () => {
    const entry = parseLibraryEntry({
      row: row({}),
      risk: "Users receive access they do not need.",
      activity: "Access is requested and approved before it is granted.",
      procedures: [
        {
          key: "O1",
          phase: "OPERATING",
          objective: "Each grant was approved",
          action: "Compare",
          evidence: ["The request"],
          attributes: ["A1"],
          limitation: "",
          steps: [
            {
              action: "Find the request.",
              evidence: ["e1"],
              record: "Request ID.",
              exception: "No request is an exception.",
            },
            { action: "Compare.", evidence: ["e1", "e9"], record: "Both." },
          ],
        },
        {
          key: "D1",
          phase: "DESIGN",
          objective: "Walk through one grant",
          action: "Ask",
          evidence: [],
          attributes: [],
          limitation: "",
        },
      ],
      attributes: [
        {
          key: "A1",
          text: "A request exists",
          confidence: "HIGH",
          tested: true,
          condition: "c",
          why: "w",
          evidence: ["e"],
          extract: ["x"],
          compare: "cmp",
          passes: "p",
          fails: "f",
          insufficient: "i",
          review: "r",
          not_infer: "n",
          basis: ["AS 2201.44"],
          assumptions: [],
          question: "",
          blocks: false,
        },
        {
          key: "A5",
          text: "Access was granted within the policy's days",
          confidence: "LOW",
          tested: false,
          question: "How many days does the policy allow?",
          blocks: true,
        },
      ],
      retired: [],
      evidence: ["Population of new users"],
      evidence_suite: [
        {
          key: "e1",
          name: "Access request for each selected grant",
          form: "TICKET",
          provider: "The access administrator",
          phases: ["OPERATING", "ROLLFORWARD"],
          purpose: "ATTRIBUTE",
          period: "Each selected grant",
          contents: ["Request ID", "User"],
          completeness: "",
          not_acceptable: "An email that does not name the access.",
          alternatives: [],
          attributes: ["A1"],
        },
        {
          key: "e2",
          name: "Access management policy",
          form: "POLICY",
          provider: "The control owner",
          phases: ["DESIGN"],
          purpose: "DESIGN",
          period: "In force during the period",
          contents: ["Who approves"],
        },
      ],
      definition_version: 4,
      statement: {
        text: "[The approver] approves each request.",
        risk: "r",
        assertions: [],
        control_type: "PREVENTIVE",
        nature: "MANUAL",
        frequency: "EVENT_DRIVEN",
        operator: "[The approver]",
        reviewer: "",
        owner: "",
        authority: "",
        judgment: "LOW",
        judgment_note: "",
        precision: "",
        investigation: "",
        information: [],
        itgcs: [],
        evidence: "",
        slots: [
          {
            key: "approver",
            label: "The approver",
            kind: "ROLE",
            why: "",
            example: "",
            blocks: false,
          },
        ],
        it_risk: "",
        principle: "",
        applies_when: "",
      },
      sources: [
        { ref: "AS 2201.44", title: "PCAOB", kind: "STANDARD", says: "..." },
      ],
      governance: {
        status: "SUPERSEDED",
        stored_status: "APPROVED",
        library_version: 3,
        note: "",
        decided_by: "Dana",
        decided_at: "2026-10-01T00:00:00Z",
        approved_by: "Dana",
        approved_at: "2026-10-01T00:00:00Z",
        approved_version: 2,
        can_decide: true,
      },
      usage: [
        {
          project_id: PROJECT,
          project_name: "SOX",
          project_status: "ACTIVE",
          controls: 3,
        },
      ],
      change_requests: [],
    });
    assert.ok(entry !== null);
    assert.deepEqual(
      proceduresByPhase(entry.procedures).map((group) => [
        group.phase,
        group.items.map((item) => item.key),
      ]),
      [
        ["DESIGN", ["D1"]],
        ["OPERATING", ["O1"]],
      ],
    );
    // Version 4: numbered steps that name suite items by key, and the suite by phase.
    assert.equal(entry.definitionVersion, 4);
    const stepped = entry.procedures.find((item) => item.key === "O1");
    assert.equal(stepped?.steps.length, 2);
    assert.equal(stepped?.steps[1]?.exception, "");
    assert.deepEqual(
      stepEvidence(
        stepped?.steps[1] ?? {
          action: "",
          evidence: [],
          record: "",
          exception: "",
        },
        entry.evidenceSuite,
      ),
      [
        { key: "e1", name: "Access request for each selected grant" },
        { key: "e9", name: "e9" },
      ],
    );
    assert.deepEqual(
      suiteByPhase(entry.evidenceSuite).map((group) => [
        group.phase,
        group.items.map((item) => item.key),
      ]),
      [
        ["DESIGN", ["e2"]],
        ["OPERATING", ["e1"]],
        ["ROLLFORWARD", ["e1"]],
      ],
    );
    assert.equal(entry.evidenceSuite[1]?.notAcceptable, "");
    assert.equal(entry.procedures[1]?.steps.length, 0);
    assert.equal(entry.attributes[1]?.tested, false);
    assert.equal(
      entry.attributes[1]?.question,
      "How many days does the policy allow?",
    );
    assert.equal(entry.statement?.slots[0]?.label, "The approver");
    assert.equal(entry.governance.status, "SUPERSEDED");
    assert.equal(entry.governance.canDecide, true);
    assert.equal(entry.usage[0]?.controls, 3);
    assert.equal(parseLibraryEntry({ row: {} }), null);
  });

  it("offers the decisions a reviewer can record from where the entry stands", () => {
    const labels = (status: Parameters<typeof statusActions>[0]) =>
      statusActions(status).map((item) => [item.status, item.primary]);
    assert.deepEqual(labels("PENDING_REVIEW"), [
      ["APPROVED", true],
      ["DRAFT", false],
      ["RETIRED", false],
    ]);
    assert.deepEqual(labels("SUPERSEDED")[0], ["APPROVED", true]);
    assert.deepEqual(labels("APPROVED"), [
      ["PENDING_REVIEW", false],
      ["RETIRED", false],
    ]);
    assert.deepEqual(labels("RETIRED"), [["PENDING_REVIEW", true]]);
    // Taking an approval back, or retiring, needs its reason on the record.
    assert.ok(statusActions("APPROVED").every((item) => item.needsNote));
    assert.equal(
      statusActions("PENDING_REVIEW").find((item) => item.status === "APPROVED")
        ?.needsNote,
      false,
    );
  });
});

describe("the library's addresses and calls", () => {
  it("keeps the engagement in the address and names the tab only off the first", () => {
    assert.equal(
      libraryHref(ORG, PROJECT, {
        control: "access-review",
        tab: "attributes",
      }),
      `/?organization=${ORG}&section=settings&view=library&project=${PROJECT}&control=access-review&tab=attributes`,
    );
    assert.equal(
      libraryHref(ORG, null, { control: "access-review", tab: "procedures" }),
      `/?organization=${ORG}&section=settings&view=library&control=access-review`,
    );
    assert.equal(parseLibraryTab("design"), "design");
    assert.equal(parseLibraryTab("nope"), "procedures");
  });

  it("builds the API call for each decision and refuses an invalid one", () => {
    assert.deepEqual(
      libraryWrite({
        organization_id: ORG,
        intent: "status",
        library_key: "access-review",
        status: "APPROVED",
        note: "Checked",
      }),
      {
        intent: "status",
        method: "PUT",
        path: `/organizations/${ORG}/library/access-review/status`,
        body: { status: "APPROVED", note: "Checked" },
      },
    );
    const request = libraryWrite({
      organization_id: ORG,
      intent: "request",
      kind: "NEW",
      library_key: "",
      title: "Firefighter access",
      detail: "Emergency access granted for one incident and removed after it.",
    });
    assert.ok(!("error" in request));
    assert.equal(request.body.library_key, null);
    const decide = libraryWrite({
      organization_id: ORG,
      intent: "decide",
      request_id: PROJECT,
      decision: "DECLINED",
      note: "Out of scope",
    });
    assert.ok(!("error" in decide));
    assert.equal(decide.method, "PUT");
    assert.deepEqual(libraryWrite({ organization_id: "x", intent: "status" }), {
      error: "invalid",
    });
    assert.deepEqual(
      libraryWrite({
        organization_id: ORG,
        intent: "status",
        library_key: "a",
        status: "YES",
      }),
      { error: "invalid" },
    );
    assert.deepEqual(
      libraryWrite({
        organization_id: ORG,
        intent: "request",
        kind: "CHANGE",
        library_key: "",
      }),
      { error: "invalid" },
    );
  });

  it("says what went wrong in the person's words", () => {
    assert.equal(libraryProblem(200, ""), null);
    assert.equal(libraryProblem(201, ""), null);
    assert.equal(
      libraryProblem(403, ""),
      "Only an owner or admin decides the library's methodology.",
    );
    assert.equal(
      libraryProblem(409, "the entry is already approved"),
      "The entry is already approved",
    );
    assert.match(libraryProblem(422, "") ?? "", /Check the fields/);
    assert.equal(canGovern("OWNER"), true);
    assert.equal(canGovern("ADMIN"), true);
    assert.equal(canGovern("CONTRIBUTOR"), false);
  });

  it("approves a selection in one call, each control named", () => {
    assert.deepEqual(
      libraryWrite({
        organization_id: ORG,
        intent: "status-many",
        library_keys: ["access-review", "change-approval"],
        status: "APPROVED",
        note: "Batch review",
      }),
      {
        intent: "status-many",
        method: "PUT",
        path: `/organizations/${ORG}/library/status`,
        body: {
          library_keys: ["access-review", "change-approval"],
          status: "APPROVED",
          note: "Batch review",
        },
      },
    );
    for (const library_keys of [[], ["Not A Key"], "access-review", [7]]) {
      assert.deepEqual(
        libraryWrite({
          organization_id: ORG,
          intent: "status-many",
          library_keys,
          status: "APPROVED",
        }),
        { error: "invalid" },
      );
    }
  });

  it("offers for approval together only what awaits it", () => {
    assert.equal(approvable({ status: "PENDING_REVIEW" }), true);
    assert.equal(approvable({ status: "SUPERSEDED" }), true);
    assert.equal(approvable({ status: "APPROVED" }), false);
    assert.equal(approvable({ status: "DRAFT" }), false);
    assert.equal(approvable({ status: "RETIRED" }), false);
  });
});

describe("references a person reads", () => {
  it("numbers procedures by phase, attributes tested first, and evidence in order", () => {
    const procedure = (key: string, phase: string) => ({
      key,
      phase,
      objective: "",
      action: "",
      evidence: [],
      attributes: [],
      limitation: "",
      steps: [],
    });
    const attribute = (key: string, tested: boolean) =>
      ({ key, text: key, tested }) as never;
    const refs = referencesFor({
      procedures: [
        procedure("d-1", "DESIGN"),
        procedure("d-2", "DESIGN"),
        procedure("o-1", "OPERATING"),
        procedure("o-2", "OPERATING"),
        procedure("rf-1", "ROLLFORWARD"),
      ],
      attributes: [
        attribute("ac02-timely", false),
        attribute("ac02-removed", true),
        attribute("ac02-accounts", true),
      ],
      evidenceSuite: [{ key: "ac02-e1" }, { key: "ac02-e2" }] as never,
    });
    assert.deepEqual(["d-1", "d-2", "o-1", "o-2", "rf-1"].map(refs.procedure), [
      "D1",
      "D2",
      "O1",
      "O2",
      "R1",
    ]);
    assert.deepEqual(
      ["ac02-removed", "ac02-accounts", "ac02-timely"].map(refs.attribute),
      ["A1", "A2", "A3"],
    );
    assert.equal(refs.evidence("ac02-e2"), "E2");
    // An unknown key is shown as it is rather than hidden.
    assert.equal(refs.attribute("other"), "other");
  });
});
