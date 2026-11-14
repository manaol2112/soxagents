import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  acceptNote,
  STATE_WORDS,
} from "../apps/web/src/evidence-assurance-model.ts";
import { WAITING_LABEL } from "../apps/web/src/evidence-wizard-model.ts";

// Product owner, 14 November 2026, on ITGC-AC-02's D&I check: "What do you mean a file on
// this request has not been checked? The explanation should be very clear." One file was
// held (its type not confirmed) and left out of the check, so nothing could be concluded as
// missing. Every attribute then read "Your judgment needed: The two readings do not agree",
// though both readings said the same. Such an attribute now waits on the file, and says so.

describe("an attribute that waits on a file not read yet", () => {
  it("has its own state in words: the file is waited on, not the person's judgment", () => {
    assert.deepEqual(STATE_WORDS.WAITING, {
      label: "Waiting on a file",
      icon: "clock",
      tone: "warning",
    });
    assert.equal(WAITING_LABEL, "Waiting on a file");
    const model = readFileSync(
      new URL("../apps/web/src/evidence-assurance-model.ts", import.meta.url),
      "utf8",
    );
    assert.match(
      model,
      /return item\.pending === "FILE_NOT_READ" \? "WAITING" : "JUDGMENT";/,
    );
  });

  it("is said beside Accept, apart from what needs a judgment", () => {
    const span = (letters: readonly string[]) => letters.join(", ");
    assert.equal(
      acceptNote({
        standing: "REVIEWED",
        implemented: ["A"],
        design: [],
        unstated: [],
        issues: [],
        judged: ["E"],
        waiting: ["B", "C", "D"],
        decided: [],
        leftOut: 1,
        span,
      }),
      "Accepting marks attribute A as evidenced. Your judgment is needed on E. B, C, D are not concluded: a file of this request has not been read yet. You can still accept; accepting does not settle these. 1 file was not part of the check.",
    );
  });
});

describe("a file's name in the D&I evidence list", () => {
  it("is a link by its own class, never the default filled button", () => {
    // The names showed dark ink on the accent (about 2:1): the reset lived in each older
    // list's container, and this list has another.
    const css = readFileSync(
      new URL("../apps/web/app/design-evidence.css", import.meta.url),
      "utf8",
    );
    const rule = css.slice(css.indexOf("button.ep-file-open {"));
    const body = rule.slice(0, rule.indexOf("}"));
    assert.match(body, /background: none;/);
    assert.match(body, /color: var\(--text-strong\);/);
    assert.match(body, /border: 0;/);
    assert.match(
      css,
      /button\.ep-file-open:hover,\s*button\.ep-file-open:focus-visible \{[^}]*background: none;/,
    );
  });
});
