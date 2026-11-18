import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DESCRIPTION_KINDS,
  fileLineOf,
  governedNames,
  matchGroups,
  parsePolicies,
  parseReferences,
  policiesTile,
  policyFileHref,
  previewOf,
  priorYearTile,
  proposalGroups,
  referencesTile,
  summarize,
} from "../apps/web/src/references-model.ts";

// Policies and procedures, and prior-year references, on Systems & Processes (decided by
// the product owner on 25 October 2026).

const SYSTEM = "11111111-1111-7111-8111-111111111111";
const PROCESS = "22222222-2222-7222-8222-222222222222";

function proposal(id: string, kind: string, status = "PROPOSED") {
  return {
    id,
    match_id: "m",
    control_id: "c",
    kind,
    slot_key: kind === "ANSWER" ? "admin-role" : "",
    value: kind === "ANSWER" ? "IT Security Manager" : "",
    title: `Title ${id}`,
    detail: "",
    quote: "approved by the IT Security Manager",
    status,
    decided_by: null,
    version: 1,
  };
}

function match(
  id: string,
  status: string,
  basis: string,
  proposals: unknown[] = [],
) {
  return {
    id,
    prior_ref: "ITGC-AC-01",
    prior_title: "",
    excerpt: "Control ITGC-AC-01",
    control_id: status === "UNMATCHED" ? null : `control-${id}`,
    control_ref: status === "UNMATCHED" ? "" : "ITGC-AC-01",
    control_title: "User access provisioning",
    system_name: "SAP ERP",
    basis,
    status,
    analysis_status: "DONE",
    version: 1,
    proposals,
  };
}

function reference(matches: unknown[], runStatus = "IDLE") {
  return {
    id: "r1",
    title: "FY2025 ITGC workpapers",
    file_name: "fy25.xlsx",
    created_by: "Avery Brooks",
    created_at: "2026-10-25T10:00:00Z",
    run_status: runStatus,
    run_note: "Matched to 2 controls.",
    matches,
  };
}

describe("policies and procedures", () => {
  it("reads what each governs and names it, systems first", () => {
    const [policy] = parsePolicies([
      {
        id: "p1",
        kind: "PROCEDURE",
        title: "Access procedure",
        file_name: "access.docx",
        excerpt: "",
        created_by: null,
        created_at: "",
        system_ids: [SYSTEM, "gone"],
        process_ids: [PROCESS],
        controls: 4,
        excluded: 1,
      },
      { nothing: true },
    ]);
    assert.ok(policy);
    assert.equal(policy.kind, "PROCEDURE");
    assert.deepEqual(
      governedNames(
        policy,
        [{ id: SYSTEM, name: "SAP ERP" }],
        [{ id: PROCESS, name: "Procure to pay" }],
      ),
      ["SAP ERP", "Procure to pay"],
    );
  });

  it("says on the tile how many there are and whether they govern controls", () => {
    assert.deepEqual(policiesTile([]), { count: 0, status: "None added" });
    const policies = parsePolicies([
      { id: "p1", kind: "POLICY", controls: 0 },
      { id: "p2", kind: "POLICY", controls: 3 },
    ]);
    assert.deepEqual(policiesTile(policies), {
      count: 2,
      status: "In use",
    });
  });
});

describe("prior-year references", () => {
  it("counts what waits for a person, and groups the matches by how they were found", () => {
    const [found] = parseReferences([
      reference([
        match("a", "PROPOSED", "REFERENCE"),
        match("b", "PROPOSED", "DESCRIPTION"),
        match("c", "UNMATCHED", "NONE"),
        match("d", "CONFIRMED", "REFERENCE", [
          proposal("x", "ANSWER"),
          proposal("y", "APPROACH", "ACCEPTED"),
        ]),
        match("e", "REJECTED", "REFERENCE", [
          proposal("z", "EXCEPTION", "DISMISSED"),
        ]),
      ]),
    ]);
    assert.ok(found);
    assert.deepEqual(summarize(found), {
      toConfirm: 2,
      confirmed: 1,
      unmatched: 1,
      toDecide: 1,
    });
    const groups = matchGroups(found);
    assert.deepEqual(
      [groups.byReference, groups.byDescription, groups.unmatched].map((list) =>
        list.map((item) => item.id),
      ),
      [["a"], ["b"], ["c"]],
    );
  });

  it("lists only the proposals of confirmed matches still waiting, by kind in order", () => {
    const references = parseReferences([
      reference([
        match("a", "CONFIRMED", "REFERENCE", [
          proposal("1", "DESIGN_CHANGE"),
          proposal("2", "ANSWER"),
          proposal("3", "EXCEPTION", "ACCEPTED"),
        ]),
        match("b", "PROPOSED", "REFERENCE", [proposal("4", "ANSWER")]),
      ]),
    ]);
    const groups = proposalGroups(references);
    assert.deepEqual(
      groups.map((group) => [group.kind, group.rows.map((row) => row.id)]),
      [
        ["ANSWER", ["2"]],
        ["DESIGN_CHANGE", ["1"]],
      ],
    );
    assert.equal(groups[0]?.rows[0]?.controlRef, "ITGC-AC-01");
  });

  it("says on the tile whether the agent is working or what is left to review", () => {
    assert.deepEqual(priorYearTile([]), { count: 0, status: "None added" });
    const working = parseReferences([reference([], "WORKING")]);
    assert.equal(priorYearTile(working).status, "Analysing");
    const waiting = parseReferences([
      reference([
        match("a", "PROPOSED", "REFERENCE"),
        match("c", "UNMATCHED", "NONE"),
      ]),
    ]);
    assert.equal(priorYearTile(waiting).status, "2 to review");
    const done = parseReferences([
      reference([match("a", "CONFIRMED", "REFERENCE")]),
    ]);
    assert.equal(priorYearTile(done).status, "Reviewed");
  });

  it("keeps unknown values to a safe default", () => {
    const [found] = parseReferences([
      reference(
        [{ ...match("a", "SOMETHING", "ODD"), analysis_status: "?" }],
        "?",
      ),
    ]);
    assert.ok(found);
    assert.equal(found.runStatus, "IDLE");
    assert.equal(found.matches[0]?.status, "PROPOSED");
    assert.equal(found.matches[0]?.basis, "NONE");
  });
});

describe("the References tab (26 October 2026)", () => {
  it("reads narratives and flow diagrams, and counts them with the prior year", () => {
    const documents = parsePolicies([
      { id: "n1", kind: "NARRATIVE", controls: 2 },
      { id: "f1", kind: "FLOWCHART", controls: 2 },
      { id: "p1", kind: "POLICY", controls: 4 },
    ]);
    assert.deepEqual(
      documents.map((item) => item.kind),
      ["NARRATIVE", "FLOWCHART", "POLICY"],
    );
    const described = documents.filter((item) =>
      DESCRIPTION_KINDS.includes(item.kind),
    );
    assert.deepEqual(referencesTile(described, []), {
      count: 2,
      status: "In use",
    });
    assert.deepEqual(referencesTile([], []), {
      count: 0,
      status: "None added",
    });
    const waiting = parseReferences([
      reference([match("a", "PROPOSED", "REFERENCE")]),
    ]);
    assert.deepEqual(referencesTile(described, waiting), {
      count: 3,
      status: "1 to review",
    });
  });
});

describe("a document's preview (28 October 2026)", () => {
  // Found by the product owner: the API sends the first 400 characters, and the preview
  // ended in the middle of a word ("for all Nor").
  it("ends a cut preview at its last whole word, with an ellipsis", () => {
    const cut =
      "applications, including SAP S/4HANA, Oracle EPM, Snowflake, and AWS, for all Nor";
    assert.equal(
      previewOf(cut, 5000),
      "applications, including SAP S/4HANA, Oracle EPM, Snowflake, and AWS, for all…",
    );
    assert.equal(
      previewOf("Access is approved, then granted.", 33),
      "Access is approved, then granted.",
    );
    assert.equal(previewOf("  Whole text  ", 14), "Whole text");
    assert.equal(previewOf("", 0), "");
  });
});

describe("a document's original file (28 October 2026)", () => {
  it("says what is kept, and opens the original through the page's route", () => {
    assert.equal(
      fileLineOf({
        fileKept: true,
        fileSize: 38398,
        fileType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
      "Original file · Word document · 37 KB",
    );
    assert.equal(
      fileLineOf({
        fileKept: true,
        fileSize: 3_400_000,
        fileType: "application/pdf",
      }),
      "Original file · PDF · 3.2 MB",
    );
    assert.equal(
      fileLineOf({ fileKept: false, fileSize: null, fileType: "" }),
      "Text only · replace the file to keep the original",
    );
    assert.equal(
      policyFileHref({ organizationId: "o", projectId: "p" }, "d1"),
      "/workspace/policy-file?organization=o&project=p&document=d1",
    );
  });
});
