import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import * as model from "../apps/web/src/control-context-model.ts";
import { DRAFTED_ONCE_COMPLETE } from "../apps/web/src/understanding-once-model.ts";

// Product owner, 14 November 2026: "I already accepted the attributes. Why a new question
// showed up after I accepted the attributes??" and "I don't want to have any follow-up
// questions when the attributes are already approved and accepted." Accepting closes them on
// the server (control_attributes.close_questions_once_accepted), which still holds.
//
// Rewritten for B1j (docs/control-workflow-plan.md; product owner, 16 November 2026, on
// ITGC-CM-06: "Keeps going back and forth to the control understanding and attributes ...
// This could be a never ending loop"):
// - Old expectation: the Attributes step showed a warning banner, "The agents raised N
//   questions that can change these attributes (...). Answer them in Control Understanding,
//   or accept the attributes as they are: accepting closes them.", with an "Answer the
//   questions" link back to Control Understanding (openAttributeQuestionsLine,
//   OpenQuestionsNote).
// - New expectation: the banner is gone. The understanding is asked once: the agents' questions
//   are asked in Control Understanding's one pass, and once it is complete a later gap is the
//   agent's assumption on the attribute, decided there. Nothing on the Attributes step sends the
//   person back; before completion the step says, quietly and with no link, that the
//   attributes are drafted once the understanding is complete.
// - Methodology: one traceable decision where the work is (AGENTS.md, "The agent prepares the
//   work first"); a question can no longer reopen a settled step, so the banner's two
//   contradictory next actions (answer there, or accept here) cannot both be offered.

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

describe("the Attributes step never sends the person back to Control Understanding (B1j)", () => {
  it("has no line that counts the agents' questions for the attributes", () => {
    assert.equal(
      "openAttributeQuestionsLine" in model,
      false,
      "the banner's sentence is gone from the model",
    );
  });

  it("shows no banner and no 'Answer the questions' link on either list", () => {
    const panel = read("../apps/web/src/control-context-view.tsx");
    assert.doesNotMatch(panel, /OpenQuestionsNote/);
    assert.doesNotMatch(panel, /Answer the questions/);
    assert.doesNotMatch(panel, /questionsHref/);
    assert.doesNotMatch(panel, /can change these attributes/);
  });

  it("is mounted on the guided setup's Attributes step with no way back to step 2", () => {
    const view = read("../apps/web/src/controls-view.tsx");
    assert.match(
      view,
      /<AttributesPanel[\s\S]*?showQuestions=\{false\}\s*embedded=\{embedded\}/,
    );
    assert.doesNotMatch(
      view,
      /<AttributesPanel[^>]*questionsHref/,
      "the panel is given no link to Control Understanding",
    );
  });

  it("before completion says quietly that the attributes are drafted once it is complete", () => {
    assert.equal(
      DRAFTED_ONCE_COMPLETE,
      "The attributes are drafted once the understanding is complete.",
    );
    const panel = read("../apps/web/src/control-context-view.tsx");
    // A quiet note, never the warning tone and never a link.
    assert.match(
      panel,
      /beforeComplete && working === null \? \(\s*<p className="ta-run-note" role="status">\s*<UiIcon name="info" size=\{13\} \/>\s*<span>\{DRAFTED_ONCE_COMPLETE\}<\/span>\s*<\/p>/,
    );
    assert.match(
      panel,
      /const beforeComplete =\s*\(context\.understandingCompletedAt \?\? null\) === null &&\s*\(context\.questionPass === "WAITING" \|\| context\.questionPass === "CHECKING"\);/,
    );
  });
});
