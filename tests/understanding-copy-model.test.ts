import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  controlLabel,
  copyLabel,
  initialSelection,
  parseOffer,
  rowsFor,
  selectable,
  suggestedSource,
} from "../apps/web/src/understanding-copy-model.ts";

// Bringing forward another control's answers (the product owner's reference, 28 October
// 2026): reviewed and copied by choice, never applied by itself.

const offer = parseOffer({
  target: {
    control_ref: "ITGC-AC-01",
    title: "User Access Provisioning and Approval",
    system: "SAP S/4HANA",
    values: { "owner-role": "Head of IT", blank: "" },
  },
  sources: [
    {
      control_id: "c-ad",
      control_ref: "ITGC-AC-01",
      title: "User Access Provisioning and Approval",
      system: "Active Directory",
      same_control: true,
      answers: [
        {
          key: "admin-role",
          label: "the role that administers user access",
          kind: "ROLE",
          question: "Who grants access?",
          value: "System administrator",
          filled_by: "RJ",
        },
        {
          key: "request-tool",
          label: "the access request tool",
          kind: "SYSTEM",
          question: "Which tool?",
          value: "ServiceNow",
          filled_by: "RJ",
        },
        {
          key: "policy",
          label: "the access management policy",
          kind: "TEXT",
          question: "Which policy?",
          value: "Active Directory access standard",
          filled_by: null,
        },
        {
          key: "owner-role",
          label: "the control owner for user access",
          kind: "ROLE",
          question: "Who owns it?",
          value: "Application Owner",
          filled_by: "RJ",
        },
        {
          key: "approver",
          label: "the role that approves privileged access",
          kind: "ROLE",
          question: "Who approves?",
          value: "head of it ",
          filled_by: "RJ",
        },
      ],
    },
    {
      control_id: "c-other",
      control_ref: "ITGC-AC-02",
      title: "Leavers",
      system: "Active Directory",
      same_control: false,
      answers: [],
    },
  ],
});

describe("bring forward prior answers (28 October 2026)", () => {
  it("reads the offer and drops sources with nothing to copy", () => {
    assert.ok(offer !== null);
    assert.deepEqual(offer.target.values, { "owner-role": "Head of IT" });
    assert.deepEqual(
      offer.sources.map((s) => s.controlId),
      ["c-ad"],
    );
    assert.equal(parseOffer({ sources: [] }), null);
    assert.equal(suggestedSource(offer)?.controlId, "c-ad");
  });

  it("ticks the prior answers; one to check, to replace, or already the same waits", () => {
    assert.ok(offer !== null);
    const source = offer.sources[0];
    assert.ok(source !== undefined);
    const target = {
      ...offer.target,
      values: { ...offer.target.values, approver: "Head of IT" },
    };
    const rows = rowsFor(source, target);
    assert.deepEqual(
      rows.map((row) => [row.key, row.state]),
      [
        ["admin-role", "prior"],
        // A system may differ between systems; a value naming the source's system too.
        ["request-tool", "check"],
        ["policy", "check"],
        // This control answers it already, differently.
        ["owner-role", "replaces"],
        // The same answer, whatever its case and spaces.
        ["approver", "same"],
      ],
    );
    assert.equal(rows[3]?.current, "Head of IT");
    assert.deepEqual([...initialSelection(rows)], ["admin-role"]);
    assert.deepEqual(selectable(rows), [
      "admin-role",
      "request-tool",
      "policy",
      "owner-role",
    ]);
  });

  it("names the controls and the copy plainly", () => {
    assert.equal(
      controlLabel({
        system: "SAP S/4HANA",
        controlRef: "ITGC-AC-01",
        title: "x",
      }),
      "SAP S/4HANA · ITGC-AC-01",
    );
    assert.equal(copyLabel(1), "Copy 1 answer");
    assert.equal(copyLabel(3), "Copy 3 answers");
  });

  it("is offered on the walkthrough and copies through the API, as the reference", () => {
    const dialog = readFileSync("apps/web/src/bring-forward.tsx", "utf8");
    for (const words of [
      "Reuse control understanding",
      "Bring forward prior answers",
      "Select answers to bring forward",
      "Copy summary",
      "Prior answers are context, not verified evidence.",
      "Review required",
    ]) {
      assert.ok(dialog.includes(words), words);
    }
    // The answers are read by the API from the source; the page sends only which.
    assert.match(
      dialog,
      /source_control_id: source\.controlId,\s*keys: picked,/,
    );
    const walk = readFileSync("apps/web/src/client-walkthrough.tsx", "utf8");
    assert.ok(walk.includes("Copy from another system"));
    assert.ok(walk.includes("Bring forward its answers"));
  });
});
