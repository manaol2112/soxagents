import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Need, Review } from "../apps/web/src/understanding-chat-model.ts";
import {
  carriedFromLastYear,
  documentMeta,
  factLabel,
  KEY_FACTS,
  keyFacts,
  sectionCount,
} from "../apps/web/src/understanding-document-model.ts";

function need(
  key: string,
  label: string,
  value: string,
  over: Partial<Need> = {},
): Need {
  return {
    key,
    kind: "ANSWER",
    label,
    question: `${label}?`,
    value,
    options: [],
    why: "",
    status: "CONFIRMED",
    source: "PERSON",
    neededFor: [],
    proposalId: null,
    required: true,
    multiple: false,
    ...over,
  };
}

function review(needs: Need[], statement: Review["statement"]): Review {
  return { needs, statement, narrative: [] } as unknown as Review;
}

describe("the understanding as a document (product owner, 17 November 2026)", () => {
  it("names a fact as a heading, not mid-sentence", () => {
    assert.equal(factLabel("the access request tool"), "Access request tool");
    assert.equal(factLabel("an approver"), "Approver");
    assert.equal(factLabel("Control owner"), "Control owner");
    assert.equal(factLabel("  "), "");
  });

  it("takes the key facts from the statement, in its order, once each, confirmed only", () => {
    const needs = [
      need("tool", "the access request tool", "ServiceNow"),
      need(
        "admin",
        "the role that administers user access",
        "System administrator",
        {
          source: "PRIOR_YEAR",
        },
      ),
      need("owner", "the control owner", "IT Security Manager", {
        status: "PROPOSED",
      }),
      need("empty", "the approver", ""),
    ];
    const facts = keyFacts(
      review(needs, [
        { text: "Access is requested in ", key: null },
        { text: "ServiceNow", key: "tool" },
        { text: " and granted by ", key: null },
        { text: "System administrator", key: "admin" },
        { text: ", owned by ", key: null },
        { text: "IT Security Manager", key: "owner" },
        { text: ", raised again in ", key: null },
        { text: "ServiceNow", key: "tool" },
        { text: "the approver", key: "empty" },
        { text: "a point nobody asked", key: "unknown" },
      ]),
    );
    assert.deepEqual(facts, [
      { key: "tool", label: "Access request tool", value: "ServiceNow" },
      {
        key: "admin",
        label: "Role that administers user access",
        value: "System administrator",
      },
    ]);
  });

  it("shows at most six facts: a glance, not the record", () => {
    const needs = Array.from({ length: 9 }, (_, at) =>
      need(`k${at}`, `point ${at}`, `answer ${at}`),
    );
    const facts = keyFacts(
      review(
        needs,
        needs.map((item) => ({ text: item.value, key: item.key })),
      ),
    );
    assert.equal(facts.length, KEY_FACTS);
    assert.equal(KEY_FACTS, 6);
  });

  it("counts a section's answers, each once", () => {
    assert.equal(
      sectionCount({
        topic: "APPROVAL",
        label: "Approval",
        parts: [
          { text: "Approved by ", key: null },
          { text: "the manager", key: "a" },
          { text: " in ", key: null },
          { text: "ServiceNow", key: "b" },
          { text: ", again ", key: null },
          { text: "the manager", key: "a" },
        ],
      }),
      "2 answers",
    );
    assert.equal(
      sectionCount({
        topic: "SCOPE",
        label: "Scope",
        parts: [{ text: "x", key: "a" }],
      }),
      "1 answer",
    );
    assert.equal(
      sectionCount({ topic: "SCOPE", label: "Scope", parts: [] }),
      "",
    );
  });

  it("marks an answer carried from last year's workpaper apart", () => {
    assert.equal(
      carriedFromLastYear(need("a", "x", "y", { source: "PRIOR_YEAR" })),
      true,
    );
    assert.equal(carriedFromLastYear(need("a", "x", "y")), false);
  });

  it("says when it was confirmed and how many answers are on record", () => {
    assert.deepEqual(documentMeta("2026-11-16T20:12:00Z", 14, "UTC"), {
      confirmed: "Confirmed Nov 16",
      answers: "14 answers",
    });
    assert.deepEqual(documentMeta(null, 1), {
      confirmed: "",
      answers: "1 answer",
    });
    assert.deepEqual(documentMeta("not a time", 0), {
      confirmed: "",
      answers: "",
    });
  });
});
