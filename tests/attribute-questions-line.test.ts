import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { openAttributeQuestionsLine } from "../apps/web/src/control-context-model.ts";

// Product owner, 14 November 2026: "I already accepted the attributes. Why a new question
// showed up after I accepted the attributes??" and "I don't want to have any follow-up
// questions when the attributes are already approved and accepted." The planner raised three
// questions when it followed the walkthrough answers, three minutes before the attributes were
// accepted; the guided setup asks them in Control Understanding, so the Attributes step never
// said so. Accepting now closes them on the server; this line says so before the decision.

type Issue = Parameters<typeof openAttributeQuestionsLine>[0][number];

const issue = (topic: string, over: Partial<Issue> = {}): Issue => ({
  origin: "ATTRIBUTES",
  status: "OPEN",
  raisedBy: "AGENT",
  topic,
  ...over,
});

describe("the agents' open questions, said where the attributes are accepted", () => {
  it("says nothing when no question is open", () => {
    assert.equal(openAttributeQuestionsLine([], true), null);
    assert.equal(
      openAttributeQuestionsLine(
        [
          issue("Answered", { status: "RESOLVED" }),
          issue("Dismissed", { status: "DISMISSED" }),
        ],
        true,
      ),
      null,
    );
  });

  it("counts only the questions accepting closes: the agents' own", () => {
    assert.equal(
      openAttributeQuestionsLine(
        [issue("A rule's finding", { raisedBy: "RULES" })],
        true,
      ),
      null,
    );
    assert.match(
      openAttributeQuestionsLine(
        [issue("Who raises the access request", { origin: "PROCESS" })],
        true,
      ) ?? "",
      /Who raises the access request/,
    );
  });

  it("names the open questions and says accepting closes them", () => {
    assert.equal(
      openAttributeQuestionsLine(
        [
          issue("Record of access actually granted and who granted it"),
          issue("Completeness of the population of grants", {
            origin: "SOURCES",
          }),
        ],
        true,
      ),
      "The agents raised 2 questions that can change these attributes (Record of access actually granted and who granted it; Completeness of the population of grants). Answer them in Control Understanding, or accept the attributes as they are: accepting closes them.",
    );
    assert.equal(
      openAttributeQuestionsLine([issue("Emergency access approval")], true),
      "The agents raised a question that can change these attributes (Emergency access approval). Answer it in Control Understanding, or accept the attributes as they are: accepting closes it.",
    );
  });

  it("with nothing to accept, only points to Control Understanding", () => {
    assert.equal(
      openAttributeQuestionsLine([issue("Emergency access approval")], false),
      "The agents raised a question that can change these attributes (Emergency access approval). Answer it in Control Understanding.",
    );
  });

  it("names at most three, and says there are more", () => {
    const line = openAttributeQuestionsLine(
      [issue("A"), issue("B"), issue("C"), issue("D")],
      true,
    );
    assert.match(
      line ?? "",
      /^The agents raised 4 questions .*\(A; B; C; and more\)\./,
    );
  });

  it("is shown on the guided setup's Attributes step, with a link to Control Understanding", () => {
    const view = readFileSync(
      new URL("../apps/web/src/controls-view.tsx", import.meta.url),
      "utf8",
    );
    assert.match(
      view,
      /<AttributesPanel[\s\S]*?showQuestions=\{false\}\s*questionsHref=\{stepHrefsWf\.understanding \?\? null\}/,
    );
    const panel = readFileSync(
      new URL("../apps/web/src/control-context-view.tsx", import.meta.url),
      "utf8",
    );
    assert.match(
      panel,
      /openAttributeQuestionsLine\(context\.issues, toAccept\.length > 0\)/,
    );
    assert.match(panel, /href=\{href\}[\s\S]{0,80}Answer the questions/);
    // Both lists say it: the Attributes step's panel and the full list.
    assert.equal(
      panel.match(/<OpenQuestionsNote\b/g)?.length,
      2,
      "the embedded and the full list each show the note",
    );
    assert.match(
      panel,
      /showQuestions=\{showQuestions\}\s*questionsHref=\{questionsHref\}/,
    );
  });
});
