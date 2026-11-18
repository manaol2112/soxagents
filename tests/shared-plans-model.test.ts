import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  approveLabel,
  type Family,
  familiesIn,
  groupApproveBody,
  groupItems,
  implementationName,
  implementationsLine,
  namesSentence,
  parseFamilies,
  parseScopeUnits,
  sharedPlanTitle,
} from "../apps/web/src/shared-plans-model.ts";

const AD = "01a13300-0000-7000-8000-000000000011";
const SAP = "01a13300-0000-7000-8000-000000000012";
const AWS = "01a13300-0000-7000-8000-000000000013";
const UNIT = "01a13300-0000-7000-8000-000000000021";
const HASH = "a".repeat(64);

const implementation = (
  id: string,
  label: string,
  extra: Record<string, unknown> = {},
) => ({
  control_id: id,
  label,
  scope: { application: label, operates: [], covers: [] },
  lead: false,
  applicability: "SAME_PLAN",
  applicability_label: "Same plan",
  reason: "",
  state_label: "Ready for review",
  approved: false,
  version: 2,
  differences: [],
  ...extra,
});

const payload = {
  families: [
    {
      control_ref: "ITGC-AC-01",
      title: "User Access Provisioning",
      area: "Logical access",
      classifications: ["ITGC"],
      group: "TOGETHER",
      implementations: [
        implementation(AD, "Active Directory", { lead: true }),
        implementation(SAP, "SAP S/4HANA", { version: 3 }),
        implementation(AWS, "AWS IAM", {
          applicability: "DIFFERENT_PLAN",
          applicability_label: "Different plan",
          reason: "1 procedure differs.",
          differences: [
            {
              section: "procedures",
              section_label: "Procedures",
              item: "P2",
              change: "CHANGED",
              fields: ["text"],
              shared: "Inspect the ticket.",
              this: "Inspect the IAM policy.",
            },
          ],
        }),
        { control_id: "not-an-id", label: "Dropped" },
      ],
      ready: [AD, SAP, "not-an-id"],
      presented_hash: HASH,
      reference_basis: "LARGEST_GROUP",
      reference_note: "Proposed: the plan 2 of 3 implementations share.",
      shared: {
        procedures: [{ code: "P1", text: "Inquire." }],
        attributes: [],
        evidence: [{ code: "E1", text: "Ticket" }],
      },
      last_group_decision_by: null,
      last_group_decision_at: null,
    },
    {
      control_ref: "RTR-01",
      title: "Account reconciliations",
      area: "Record to report",
      classifications: ["BUSINESS_PROCESS", "MANAGEMENT_REVIEW"],
      group: "something new",
      implementations: [
        implementation(AD, "Germany GmbH", {
          scope: { application: null, operates: ["Germany GmbH"], covers: [] },
        }),
        implementation(SAP, "France SAS", {
          scope: { application: null, operates: ["France SAS"], covers: [] },
          applicability: "NEEDS_INFORMATION",
        }),
      ],
      ready: [],
      presented_hash: "not a hash",
      reference_basis: "FIRST_ALPHABETICALLY",
      shared: null,
    },
    { control_ref: "", title: "No reference" },
  ],
  counts: { TOGETHER: 1, SEPARATE: 1, WAITING: 1, DONE: 0 },
  decisions: 3,
  plans: 5,
  viewer_can_decide: true,
};

function parsed(): Family[] {
  const families = parseFamilies(payload);
  assert.ok(families);
  return families.families;
}

describe("shared control plans", () => {
  it("reads the families and keeps only well-formed rows", () => {
    const result = parseFamilies(payload);
    assert.ok(result);
    assert.equal(result.families.length, 2);
    assert.equal(result.decisions, 3);
    assert.equal(result.plans, 5);
    assert.equal(result.viewerCanDecide, true);
    assert.deepEqual(result.counts, {
      TOGETHER: 1,
      SEPARATE: 1,
      WAITING: 1,
      DONE: 0,
    });
    const [access, reconciliations] = result.families;
    assert.ok(access && reconciliations);
    assert.equal(access.implementations.length, 3);
    assert.deepEqual(access.ready, [AD, SAP]);
    assert.equal(access.presentedHash, HASH);
    assert.equal(access.shared?.procedures[0]?.text, "Inquire.");
    const aws = access.implementations[2];
    assert.equal(aws?.applicability, "DIFFERENT_PLAN");
    assert.equal(aws?.differences[0]?.current, "Inspect the IAM policy.");
    // An unknown group waits rather than offering a decision; a bad hash is never sent.
    assert.equal(reconciliations.group, "WAITING");
    assert.equal(reconciliations.presentedHash, "");
    assert.equal(reconciliations.shared, null);
    // The shared plan is a proposal until a reviewer approves it; an unknown basis is none.
    assert.equal(access.referenceBasis, "LARGEST_GROUP");
    assert.equal(sharedPlanTitle(access), "Proposed shared plan");
    assert.equal(reconciliations.referenceBasis, "NONE");
    assert.equal(
      sharedPlanTitle({ ...access, referenceBasis: "APPROVED" }),
      "The shared plan",
    );
    assert.equal(reconciliations.implementations[0]?.scope.application, null);
    assert.equal(parseFamilies({}), null);
    assert.equal(parseFamilies(null), null);
  });

  it("describes who a control's implementations are", () => {
    const [access, reconciliations] = parsed();
    assert.ok(access && reconciliations);
    assert.equal(implementationsLine(access), "3 systems");
    assert.equal(implementationsLine(reconciliations), "2 units");
    assert.equal(
      implementationsLine({
        ...access,
        implementations: access.implementations.slice(0, 1),
      }),
      "Active Directory",
    );
    assert.equal(familiesIn(parsed(), "TOGETHER").length, 1);
    assert.equal(familiesIn(parsed(), "DONE").length, 0);
  });

  it("approves only the ready plans, each at the version shown", () => {
    const [access] = parsed();
    assert.ok(access);
    assert.equal(approveLabel(access), "Approve 2 plans");
    assert.equal(approveLabel({ ...access, ready: [AD] }), "Approve the plan");
    // The different plan is not in the group decision.
    assert.deepEqual(groupItems(access), [
      { control_id: AD, version: 2 },
      { control_id: SAP, version: 3 },
    ]);
  });

  it("checks a group decision before it is sent", () => {
    const fields = {
      control_ref: " ITGC-AC-01 ",
      items: [
        { control_id: AD, version: 2 },
        { control_id: SAP, version: 3 },
      ],
      presented_hash: HASH,
      comment: "Same procedure on both systems.",
    };
    assert.deepEqual(groupApproveBody(fields), {
      ...fields,
      control_ref: "ITGC-AC-01",
    });
    const refused = [
      { ...fields, control_ref: "" },
      { ...fields, presented_hash: "abc" },
      { ...fields, items: [] },
      // One malformed item refuses the whole decision rather than approving the rest.
      { ...fields, items: [...fields.items, { control_id: AWS }] },
      { ...fields, items: [{ control_id: AD, version: 0 }] },
      { ...fields, items: [{ control_id: "x", version: 1 }] },
      { ...fields, comment: "x".repeat(4001) },
      {
        ...fields,
        items: Array.from({ length: 101 }, () => ({
          control_id: AD,
          version: 1,
        })),
      },
    ];
    for (const body of refused) {
      assert.equal(groupApproveBody(body), null);
    }
  });

  it("names an implementation by its system, then its units", () => {
    assert.equal(implementationName("SAP ERP", ""), "SAP ERP");
    assert.equal(implementationName("", "Acme UK Ltd"), "Acme UK Ltd");
    assert.equal(
      implementationName("SAP ERP", "Acme UK Ltd"),
      "SAP ERP · Acme UK Ltd",
    );
    assert.equal(implementationName("", ""), "");
    // One full stop, even after a name that ends with its own.
    assert.equal(
      namesSentence(["Northwind UK Ltd", "Northwind US Inc."]),
      "Northwind UK Ltd, Northwind US Inc.",
    );
    assert.equal(namesSentence(["SAP ERP"]), "SAP ERP.");
  });

  it("reads the engagement's scope units", () => {
    assert.deepEqual(
      parseScopeUnits([
        { id: UNIT, kind: "SERVICE_CENTER", name: "Krakow SSC" },
        { id: UNIT, kind: "PLANET", name: "Unknown kind" },
        { id: "x", kind: "ENTITY", name: "No id" },
        "junk",
      ]),
      [{ id: UNIT, kind: "SERVICE_CENTER", name: "Krakow SSC" }],
    );
    assert.deepEqual(parseScopeUnits(null), []);
  });
});
