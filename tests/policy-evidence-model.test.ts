import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  choosable,
  decisionProblem,
  documentLine,
  kindLabel,
  parsePolicyEvidence,
  policiesHref,
  proposalsFor,
  stillChecking,
} from "../apps/web/src/policy-evidence-model.ts";

// A policy on file proposed as evidence for a request's item; a person decides (decided by
// the product owner on 28 October 2026).

const answer = {
  checking: false,
  proposals: [
    {
      id: "p1",
      requirement_id: "i1",
      document_id: "d1",
      document_title: "IT Access Management Standard v4.2",
      document_kind: "POLICY",
      file_name: "IT_Access_Management_Standard_v4.2.docx",
      reason: "It sets that the Application Owner approves access.",
      quote: "granted only after the Application Owner approves the request",
      usable: true,
      effective: "1 Oct 2024",
    },
    { id: "", requirement_id: "i2", document_title: "No id" },
    "not a proposal",
  ],
};

describe("a policy on file proposed for an item (28 October 2026)", () => {
  it("reads the API's answer and drops what is not a proposal", () => {
    const read = parsePolicyEvidence(answer);
    assert.ok(read !== null);
    assert.equal(read.checking, false);
    assert.deepEqual(
      read.proposals.map((p) => [p.id, p.itemId, p.title, p.kind, p.usable]),
      [["p1", "i1", "IT Access Management Standard v4.2", "POLICY", true]],
    );
    assert.equal(parsePolicyEvidence(null), null);
    assert.equal(parsePolicyEvidence({ proposals: "x" }), null);
  });

  it("shows each item its own, and says it is checking only where it waits", () => {
    const read = parsePolicyEvidence({ ...answer, checking: true });
    assert.ok(read !== null);
    assert.deepEqual(
      proposalsFor(read, "i1").map((p) => p.id),
      ["p1"],
    );
    assert.deepEqual(proposalsFor(read, "i9"), []);
    const policyItem = { id: "i9", categories: ["PROCESS_DOCUMENTATION"] };
    assert.equal(stillChecking(read, policyItem), true);
    // Already proposed, or an item not asking for a document: nothing to wait for.
    assert.equal(
      stillChecking(read, { id: "i1", categories: ["PROCESS_DOCUMENTATION"] }),
      false,
    );
    assert.equal(
      stillChecking(read, { id: "i9", categories: ["POPULATION"] }),
      false,
    );
    const done = parsePolicyEvidence(answer);
    assert.ok(done !== null);
    assert.equal(stillChecking(done, policyItem), false);
  });

  it("names the kind, links to where it is replaced, and says why a decision failed", () => {
    assert.equal(kindLabel("PROCEDURE"), "Procedure");
    assert.equal(kindLabel("POLICY"), "Policy");
    assert.equal(
      policiesHref({ organizationId: "o", projectId: "p" }),
      "/?organization=o&project=p&section=controls&pane=policies",
    );
    // View document opens the list on that document.
    assert.equal(
      policiesHref({ organizationId: "o", projectId: "p" }, "d1"),
      "/?organization=o&project=p&section=controls&pane=policies&document=d1",
    );
    assert.equal(
      decisionProblem(409, "This proposal was already decided."),
      "This proposal was already decided.",
    );
    assert.equal(
      decisionProblem(404, ""),
      "Only the engagement team can use a policy as evidence.",
    );
    assert.equal(decisionProblem(503, ""), "That did not work. Try again.");
  });

  it("says what the document is, when it took effect, and whether its file is kept", () => {
    const read = parsePolicyEvidence(answer);
    assert.ok(read !== null);
    const [proposal] = read.proposals;
    assert.ok(proposal !== undefined);
    assert.equal(
      documentLine(proposal),
      "Policy · Effective 1 Oct 2024 · On file",
    );
    assert.equal(
      documentLine({ ...proposal, effective: "", usable: false }),
      "Policy · Text only",
    );
  });

  it("is offered on the item, used only when a person says so", () => {
    const view = readFileSync(
      "apps/web/src/evidence-requests-view.tsx",
      "utf8",
    );
    assert.match(view, /<PolicyOnFile/);
    assert.match(view, /usePolicyEvidence\(ids\)/);
    const card = readFileSync("apps/web/src/policy-on-file.tsx", "utf8");
    // The product owner's reference (28 October 2026): Add evidence files the policy
    // (was "Use as evidence"); Not relevant dismisses it (was "Not this one").
    assert.match(
      card,
      /Related \{kindLabel\(proposal\.kind\)\.toLowerCase\(\)\} on file/,
    );
    assert.match(card, /Relevant excerpt/);
    assert.match(card, /Reference available/);
    assert.match(card, /Not relevant/);
    assert.match(card, /Review mapping/);
    assert.match(card, /Add evidence\s*<UiIcon name="arrow"/);
    assert.match(card, /void decide\("accept"\)/);
    // A related policy takes the place of the item's own upload.
    assert.match(view, /!related &&/);
    // The facts in one row only beside a related policy; every other item keeps its list
    // (product owner, 28 October 2026: "I don't need this section in all my evidence
    // request").
    assert.match(
      view,
      /\{related \? \(\s*\/\/[^\n]*\n\s*<dl className="er-facts is-row">/,
    );
    assert.match(view, /<dl className="er-facts">\s*<dt>Phase<\/dt>/);
    assert.match(view, /<dt>Owner\/Recipient<\/dt>/);
    // An audit-critical action shows only once the server confirms it.
    assert.match(card, /if \(answer\.status !== 200\)/);
    assert.match(card, /router\.refresh\(\)/);
  });
});

describe("Add evidence as a choice (28 October 2026)", () => {
  const read = parsePolicyEvidence({
    ...answer,
    documents: [
      {
        id: "d2",
        title: "IT Change Management Standard v3.1",
        kind: "POLICY",
        usable: false,
        effective: "",
      },
      {
        id: "d1",
        title: "IT Access Management Standard v4.2",
        kind: "POLICY",
        usable: true,
        effective: "1 Oct 2024",
      },
      {
        id: "d3",
        title: "Leaver Procedure",
        kind: "PROCEDURE",
        usable: true,
        effective: "",
      },
      { title: "No id" },
    ],
  });

  it("offers the policies on file that apply, kept files first, none already proposed", () => {
    assert.ok(read !== null);
    assert.deepEqual(
      read.documents.map((d) => d.id),
      ["d2", "d1", "d3"],
    );
    // d1 is proposed for i1 already: the proposal card offers it there.
    assert.deepEqual(
      choosable(read, "i1").map((d) => d.id),
      ["d3", "d2"],
    );
    assert.deepEqual(
      choosable(read, "i9").map((d) => d.id),
      ["d1", "d3", "d2"],
    );
  });

  it("offers upload, a policy on file, or a file the control holds, on each item", () => {
    const menu = readFileSync("apps/web/src/add-evidence-menu.tsx", "utf8");
    assert.match(menu, /"Upload files"/);
    assert.match(menu, /"Use a policy on file"/);
    assert.match(menu, /"Use a file the control holds"/);
    assert.match(menu, /decision: "choose"/);
    const view = readFileSync(
      "apps/web/src/evidence-requests-view.tsx",
      "utf8",
    );
    assert.match(view, /chooser=\{\(pick, running\) => \(/);
    assert.match(view, /intent: "link"/);
  });
});
