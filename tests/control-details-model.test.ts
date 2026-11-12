import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  appliedTo,
  type DetailRow,
  type Details,
  detailsRequest,
  initialOwnerForm,
  offerFor,
  ownerText,
  parseDetails,
  parseOwnerSuggestion,
  recordWith,
  savedNote,
  saveProblem,
  suggestionNote,
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
        // Old: the owner save carried no apply_to_system. New: every owner save says whether
        // the owner also goes to the other controls on the system without one, false unless
        // the person chose it. Why: product owner, 11 November 2026 (an owner is usually the
        // same for one system); sent explicitly so the request records the person's choice.
        body: {
          version: 3,
          owner_name: "Access Owner",
          owner_email: "access.owner@client.example",
          apply_to_system: false,
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
      { intent: "save", version: 3, owner_name: "Ann", apply_to_system: "yes" },
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
        ownerSuggestion: null,
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

const details = (overrides: Partial<Details> = {}): Details => ({
  version: 2,
  ownerName: "",
  ownerEmail: "",
  frequency: "",
  nature: "",
  canEdit: true,
  targets: [],
  ownerSuggestion: null,
  ...overrides,
});

describe("step 01: the owner suggested from the system (product owner, 11 November 2026)", () => {
  it("reads the suggestion defensively: good, absent and malformed", () => {
    assert.deepEqual(
      parseOwnerSuggestion({
        name: " Ann Owner ",
        email: "Ann@Client.example",
        controls: 8,
      }),
      { name: "Ann Owner", email: "ann@client.example", controls: 8 },
    );
    assert.deepEqual(
      parseOwnerSuggestion({
        name: "",
        email: "ann@client.example",
        controls: 1,
      }),
      { name: "", email: "ann@client.example", controls: 1 },
    );
    assert.equal(parseOwnerSuggestion(null), null);
    assert.equal(parseOwnerSuggestion(undefined), null);
    for (const bad of [
      "Ann",
      [],
      { name: "Ann", email: "ann@client.example" },
      { name: "Ann", email: "ann@client.example", controls: 0 },
      { name: "Ann", email: "ann@client.example", controls: 2.5 },
      { name: "Ann", email: "ann@client.example", controls: "8" },
      { name: "Ann", email: "not-an-email", controls: 3 },
      { name: "", email: "", controls: 3 },
      { name: 7, email: "ann@client.example", controls: 3 },
      { name: "token=abcdefabcdef", email: "", controls: 3 },
      { name: "A".repeat(201), email: "", controls: 3 },
    ]) {
      assert.equal(parseOwnerSuggestion(bad), null, JSON.stringify(bad));
    }
    const read = (owner_suggestion: unknown) =>
      parseDetails({ version: 1, targets: [], owner_suggestion });
    assert.deepEqual(
      read({ name: "Ann", email: "", controls: 8 })?.ownerSuggestion,
      { name: "Ann", email: "", controls: 8 },
    );
    assert.equal(read(null)?.ownerSuggestion, null);
    assert.equal(read({ name: "Ann" })?.ownerSuggestion, null);
    // An answer from before the suggestion existed still reads, with none.
    assert.equal(
      parseDetails({ version: 1, targets: [] })?.ownerSuggestion,
      null,
    );
  });

  it("opens the owner form on the suggestion, marked as one, only when there is no owner", () => {
    const suggestion = {
      name: "Ann",
      email: "ann@client.example",
      controls: 8,
    };
    assert.deepEqual(
      initialOwnerForm(details({ ownerSuggestion: suggestion })),
      {
        name: "Ann",
        email: "ann@client.example",
        suggestion,
      },
    );
    // A recorded owner is never replaced by a suggestion.
    assert.deepEqual(
      initialOwnerForm(
        details({ ownerName: "Bo", ownerSuggestion: suggestion }),
      ),
      { name: "Bo", email: "", suggestion: null },
    );
    assert.deepEqual(initialOwnerForm(details()), {
      name: "",
      email: "",
      suggestion: null,
    });
    assert.equal(
      suggestionNote(suggestion, "SAP S/4HANA"),
      "Owner of 8 other controls on SAP S/4HANA",
    );
    assert.equal(
      suggestionNote({ ...suggestion, controls: 1 }, " "),
      "Owner of 1 other control on this system",
    );
    // The suggestion is not the record: the owner stays missing until the server saves it.
    const record = recordWith(
      rows,
      details({ ownerSuggestion: suggestion }),
      [],
      [],
    );
    assert.equal(record.find((row) => row.key === "owner")?.missing, true);
  });

  it("says in the request whether the owner also goes to the system's other controls", () => {
    const save = (apply?: unknown) =>
      request({
        ...ids,
        intent: "save",
        version: 2,
        owner_name: "Ann",
        owner_email: "ann@client.example",
        ...(apply === undefined ? {} : { apply_to_system: apply }),
      });
    assert.deepEqual(save(true), {
      method: "PUT",
      path,
      body: {
        version: 2,
        owner_name: "Ann",
        owner_email: "ann@client.example",
        apply_to_system: true,
      },
    });
    const off = save(false);
    assert.ok(!("error" in off));
    assert.equal(off.body?.apply_to_system, false);
    const unsaid = save();
    assert.ok(!("error" in unsaid));
    assert.equal(unsaid.body?.apply_to_system, false);
    // Only an owner save carries it.
    const frequency = request({
      ...ids,
      intent: "save",
      version: 2,
      frequency: "MONTHLY",
      apply_to_system: true,
    });
    assert.ok(!("error" in frequency));
    assert.deepEqual(frequency.body, { version: 2, frequency: "MONTHLY" });
  });

  it("reads how many controls got the owner, and says so once the server confirms", () => {
    assert.equal(appliedTo({ applied_to: 6 }), 6);
    for (const bad of [
      null,
      {},
      { applied_to: -1 },
      { applied_to: "6" },
      { applied_to: 1.5 },
    ]) {
      assert.equal(appliedTo(bad), 0, JSON.stringify(bad));
    }
    const sap = "SAP S/4HANA";
    assert.equal(
      savedNote("owner", sap, 0, 0),
      "Owner recorded on SAP S/4HANA.",
    );
    assert.equal(
      savedNote("owner", sap, 0, 1),
      "Owner recorded on SAP S/4HANA, and on 1 other control on SAP S/4HANA that had none.",
    );
    assert.equal(
      savedNote("owner", sap, 0, 6),
      "Owner recorded on SAP S/4HANA, and on 6 other controls on SAP S/4HANA that had none.",
    );
    assert.equal(
      savedNote("owner", sap, 1, 0),
      "Owner recorded on SAP S/4HANA and 1 other system where it was empty.",
    );
    assert.equal(
      savedNote("owner", sap, 2, 6),
      "Owner recorded on SAP S/4HANA and 2 other systems where it was empty, and on 6 other controls on SAP S/4HANA that had none.",
    );
    assert.equal(
      savedNote("frequency", "", 2, 6),
      "Frequency recorded on this system and 2 other systems where it was empty.",
    );
  });

  it("shows the server's reason when a save is refused, and how to recover", () => {
    assert.equal(
      saveProblem(422, "The owner's email is not valid"),
      "The owner's email is not valid. Check it and try again.",
    );
    assert.equal(
      saveProblem(422, ""),
      "That detail cannot be recorded as given. Check it and try again.",
    );
    assert.equal(
      saveProblem(409, null),
      "The control changed since it was read. It is read again; check the detail and save it once more.",
    );
    assert.match(saveProblem(403, ""), /^Only an engagement owner/);
    assert.match(saveProblem(0, "ignored"), /did not answer.*try again/);
    assert.equal(
      saveProblem(500, "Line one\nline two."),
      "Line one line two. Try again.",
    );
    assert.ok(saveProblem(500, "x".repeat(1000)).length < 320);
  });
});

describe("the copy to other systems counts what the server copied (11 November 2026)", () => {
  it("reads copied_to, and says when the answer does not", async () => {
    const { copiedTo } = await import(
      "../apps/web/src/control-details-model.ts"
    );
    assert.equal(copiedTo({ copied_to: 2 }), 2);
    assert.equal(copiedTo({ copied_to: 0 }), 0);
    for (const odd of [
      {},
      { copied_to: -1 },
      { copied_to: 1.5 },
      { copied_to: "2" },
      null,
    ]) {
      assert.equal(copiedTo(odd), null);
    }
  });
});
