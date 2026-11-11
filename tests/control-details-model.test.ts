import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  type DetailRow,
  detailsRequest,
  offerFor,
  ownerText,
  parseDetails,
  recordWith,
  toAsk,
} from "../apps/web/src/control-details-model.ts";

const ORG = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const CONTROL = "33333333-3333-4333-8333-333333333333";
const ORACLE = "44444444-4444-4444-8444-444444444444";
const FREQUENCIES = ["QUARTERLY", "MONTHLY"];
const NATURES = ["MANUAL", "AUTOMATED"];
const ids = { organization_id: ORG, project_id: PROJECT, control_id: CONTROL };
const path = `/organizations/${ORG}/projects/${PROJECT}/controls/${CONTROL}/details`;

const request = (fields: Record<string, unknown>) =>
  detailsRequest(fields, FREQUENCIES, NATURES);

const rows: DetailRow[] = [
  {
    key: "description",
    label: "Description",
    value: "Leavers are removed.",
    missing: false,
    editable: false,
  },
  {
    key: "objective",
    label: "Objective",
    value: "",
    missing: true,
    editable: false,
  },
  {
    key: "risk",
    label: "Risk",
    value: "Leavers keep access.",
    missing: false,
    editable: false,
  },
  { key: "owner", label: "Owner", value: "", missing: true, editable: true },
  {
    key: "frequency",
    label: "Frequency",
    value: "Quarterly",
    missing: false,
    editable: true,
  },
  {
    key: "nature",
    label: "Nature",
    value: "Manual",
    missing: false,
    editable: true,
  },
];

describe("step 01: the control's details (product owner, 10 November 2026)", () => {
  it("reads, and saves only the details given, checked before they are sent", () => {
    assert.deepEqual(request({ ...ids, intent: "read" }), {
      method: "GET",
      path,
      body: null,
    });
    assert.deepEqual(
      request({
        ...ids,
        intent: "save",
        version: 3,
        owner_name: "  Access Owner ",
        owner_email: "Access.Owner@Client.example",
        copy_to: [ORACLE, ORACLE, "not-a-uuid"],
      }),
      {
        method: "PUT",
        path,
        body: {
          version: 3,
          owner_name: "Access Owner",
          owner_email: "access.owner@client.example",
          copy_to: [ORACLE],
        },
      },
    );
    assert.deepEqual(
      request({ ...ids, intent: "save", version: 3, frequency: "MONTHLY" }),
      {
        method: "PUT",
        path,
        body: { version: 3, frequency: "MONTHLY" },
      },
    );
    for (const bad of [
      { intent: "save", version: 3 },
      { intent: "save", version: 0, nature: "MANUAL" },
      { intent: "save", version: 3, frequency: "SOMETIMES" },
      { intent: "save", version: 3, nature: "MAGIC" },
      { intent: "save", version: 3, owner_email: "not-an-email" },
      { intent: "save", version: 3, owner_name: "password=Hunter2Hunter2" },
      { intent: "delete" },
    ]) {
      assert.deepEqual(
        request({ ...ids, ...bad }),
        { error: "invalid" },
        JSON.stringify(bad),
      );
    }
    assert.deepEqual(request({ ...ids, control_id: "x", intent: "read" }), {
      error: "invalid",
    });
  });

  it("reads the API's answer, and offers a detail only to systems that lack it", () => {
    const details = parseDetails({
      version: 4,
      owner_name: "",
      owner_email: "",
      frequency: "QUARTERLY",
      nature: "MANUAL",
      can_edit: true,
      targets: [
        {
          control_id: ORACLE,
          system: "Oracle EBS",
          fills: [],
          lacks: ["owner", "bogus"],
        },
        { system: "no id" },
      ],
    });
    assert.ok(details !== null);
    assert.deepEqual(details.targets, [
      { controlId: ORACLE, system: "Oracle EBS", fills: [], lacks: ["owner"] },
    ]);
    assert.deepEqual(
      offerFor(details, "owner").map((t) => t.system),
      ["Oracle EBS"],
    );
    assert.deepEqual(offerFor(details, "frequency"), []);
    assert.equal(parseDetails({ version: "4" }), null);
    assert.equal(parseDetails(null), null);
  });

  it("asks what is missing, those recorded here first, and keeps the record current after a save", () => {
    assert.deepEqual(
      toAsk(rows).map((row) => row.key),
      ["owner", "objective"],
    );
    const options = [
      ["QUARTERLY", "Quarterly"],
      ["MONTHLY", "Monthly"],
    ] as const;
    const natures = [["MANUAL", "Manual"]] as const;
    const after = recordWith(
      rows,
      {
        version: 5,
        ownerName: "Access Owner",
        ownerEmail: "owner@client.example",
        frequency: "MONTHLY",
        nature: "MANUAL",
        canEdit: true,
        targets: [],
      },
      options,
      natures,
    );
    const by = (key: string) => after.find((row) => row.key === key);
    assert.deepEqual(
      [by("owner")?.value, by("owner")?.missing],
      ["Access Owner (owner@client.example)", false],
    );
    assert.equal(by("frequency")?.value, "Monthly");
    // What comes from the RCM stays as the page read it.
    assert.equal(by("objective")?.missing, true);
    assert.deepEqual(recordWith(rows, null, options, natures), rows);
  });

  it("writes the owner as one line", () => {
    assert.equal(
      ownerText("Ann", "ann@client.example"),
      "Ann (ann@client.example)",
    );
    assert.equal(ownerText(" Ann ", ""), "Ann");
    assert.equal(ownerText("", "ann@client.example"), "ann@client.example");
    assert.equal(ownerText("", ""), "");
  });
});
