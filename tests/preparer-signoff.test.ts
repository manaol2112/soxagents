import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  ATTESTATION,
  NEEDS_CONCLUDED,
  NEEDS_CONCLUSION,
  NEEDS_DRAFT_DONE,
  NEEDS_LATEST,
  NEEDS_READ,
  NEEDS_SAVED,
  preparedLine,
  REOPENED_READING,
  SIGNED_READING,
  type SignOffFacts,
  signOffProblems,
  signOffRefusal,
  signOffRequest,
  signOffRereads,
  signOffWrite,
} from "../apps/web/src/preparer-signoff-model.ts";

// The preparer's sign-off of the design workpaper, at the end of section 7
// (docs/design-workpaper.md, section 3.7; product owner, 15 November 2026: "isn't there
// any separate requirement for D&I sign-off by the preparer? … I don't know how that
// sign-off works right now"). It must never be offered as ready while something it
// needs is missing, and what it sends is the existing prepare or reopen, validated as
// the form's are. Synthetic data only.

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ids = { organizationId: uuid(1), projectId: uuid(2), controlId: uuid(3) };
const ready: SignOffFacts = {
  status: "DRAFT",
  drafting: false,
  latest: true,
  choice: { kind: "EFFECTIVE" },
  unsaved: false,
  behind: false,
};

describe("what the sign-off needs", () => {
  it("is ready only on a draft with a conclusion recorded, nothing unsaved and the latest version", () => {
    assert.deepEqual(signOffProblems(ready), []);
    for (const kind of [
      "EXCEPTIONS_NOTED",
      "NOT_EFFECTIVE",
      "NO_INSTANCE",
    ] as const) {
      assert.deepEqual(
        signOffProblems({ ...ready, choice: { kind } }),
        [],
        kind,
      );
    }
    assert.deepEqual(signOffProblems({ ...ready, choice: null }), [
      NEEDS_CONCLUSION,
    ]);
    assert.deepEqual(
      signOffProblems({ ...ready, choice: { kind: "NOT_CONCLUDED" } }),
      [NEEDS_CONCLUDED],
    );
    assert.deepEqual(signOffProblems({ ...ready, unsaved: true }), [
      NEEDS_SAVED,
    ]);
    assert.deepEqual(signOffProblems({ ...ready, drafting: true }), [
      NEEDS_DRAFT_DONE,
    ]);
    assert.deepEqual(signOffProblems({ ...ready, latest: false }), [
      NEEDS_LATEST,
    ]);
    // Every missing thing is said, in the order to do them.
    assert.deepEqual(
      signOffProblems({
        ...ready,
        drafting: true,
        choice: null,
        unsaved: true,
      }),
      [NEEDS_DRAFT_DONE, NEEDS_CONCLUSION, NEEDS_SAVED],
    );
    // Records a version behind (a choice just confirmed): wait, said only where nothing
    // else is missing.
    assert.deepEqual(signOffProblems({ ...ready, behind: true }), [NEEDS_READ]);
    assert.deepEqual(
      signOffProblems({ ...ready, behind: true, choice: null }),
      [NEEDS_CONCLUSION],
    );
    // A prepared workpaper has nothing to sign.
    assert.deepEqual(
      signOffProblems({ ...ready, status: "PREPARED", choice: null }),
      [],
    );
  });

  it("says what it attests, and who signed when", () => {
    assert.match(
      ATTESTATION,
      /^I prepared this workpaper; the evidence, the testing and the conclusion above are complete and supported\.$/,
    );
    assert.equal(
      preparedLine("Dana Lee", "Nov 15, 2026", 4),
      "Prepared by Dana Lee on Nov 15, 2026 · version 4",
    );
    assert.equal(preparedLine(null, null, null), "Prepared by a team member");
    assert.equal(preparedLine(" ", "", 0), "Prepared by a team member");
  });
});

describe("what it sends", () => {
  it("is the existing prepare or reopen, through the form's own validation", () => {
    const prepare = signOffRequest(
      ids,
      uuid(7),
      5,
      "prepare",
      "Ready for review.",
    );
    const write = signOffWrite(prepare);
    assert.ok(!("error" in write));
    assert.equal(
      write.path,
      `/organizations/${uuid(1)}/projects/${uuid(2)}/workpapers/${uuid(7)}/prepare`,
    );
    assert.deepEqual(write.body, {
      version: 5,
      note: "Ready for review.",
      rationale_reviewed: false,
    });
    const reopen = signOffWrite(
      signOffRequest(ids, uuid(7), 6, "reopen", "Fix the date."),
    );
    assert.ok(!("error" in reopen));
    assert.deepEqual(reopen.body, { version: 6, reason: "Fix the date." });
  });

  it("refuses anything else, and what the form would refuse", () => {
    for (const fields of [
      {},
      { ...signOffRequest(ids, uuid(7), 5, "prepare", ""), intent: "draft" },
      { ...signOffRequest(ids, uuid(7), 5, "prepare", ""), intent: "edit" },
      { ...signOffRequest(ids, uuid(7), 5, "prepare", ""), workpaper_id: "x" },
      { ...signOffRequest(ids, uuid(7), 0, "prepare", "") },
      signOffRequest(ids, uuid(7), 5, "prepare", "the password: hunter2"),
      signOffRequest(ids, uuid(7), 5, "prepare", "x".repeat(501)),
      signOffRequest(ids, uuid(7), 5, "reopen", "no"),
    ] as Array<Record<string, unknown>>) {
      assert.ok(
        "error" in signOffWrite(fields),
        JSON.stringify(fields).slice(0, 80),
      );
    }
  });

  it("says why a press was not taken, in the server's words where it gives them", () => {
    assert.equal(signOffRefusal("prepare", 200, ""), "");
    assert.equal(
      signOffRefusal("prepare", 409, "record a conclusion first"),
      "Not signed: record a conclusion first.",
    );
    assert.equal(
      signOffRefusal("reopen", 403, "only the preparer or a lead reopens it."),
      "Not reopened: only the preparer or a lead reopens it.",
    );
    assert.match(signOffRefusal("prepare", 401, ""), /session has ended/);
    // Rewritten (independent review, 16 November 2026). Old: status 0 read "Not signed:
    // the server could not be reached. Try again.", while the prepare may be on record
    // (the route's timeout, or an answer lost after the commit). New: it may not have
    // been taken, and the workpaper is read again; never "Not signed".
    for (const status of [0, 500, 502, 504]) {
      for (const intent of ["prepare", "reopen"] as const) {
        const said = signOffRefusal(intent, status, "");
        assert.match(said, /may not have been/, `${intent} ${status}`);
        assert.match(
          said,
          /Reading the workpaper again/,
          `${intent} ${status}`,
        );
        assert.doesNotMatch(
          said,
          /^Not (signed|reopened)/,
          `${intent} ${status}`,
        );
      }
    }
    assert.match(signOffRefusal("reopen", 422, ""), /at least 3 characters/);
  });

  it("a 409 without the server's sentence has its own, and what leaves the workpaper in doubt reads it again", () => {
    assert.equal(
      signOffRefusal("prepare", 409, ""),
      "Not signed: the workpaper changed meanwhile. It is being read again: try once it is shown.",
    );
    assert.doesNotMatch(
      signOffRefusal("reopen", 409, " "),
      /could not be reached/,
    );
    for (const status of [409, 0, 500, 503]) {
      assert.equal(signOffRereads(status), true, String(status));
    }
    for (const status of [200, 401, 403, 404, 422]) {
      assert.equal(signOffRereads(status), false, String(status));
    }
    assert.equal(SIGNED_READING, "Signed. Reading the workpaper again…");
    assert.equal(REOPENED_READING, "Reopened. Reading the workpaper again…");
  });
});

describe("the screen", () => {
  const read = (path: string) => readFileSync(path, "utf8");
  const view = read("apps/web/src/design-workpaper-view.tsx");
  const card = read("apps/web/src/workpaper-view.tsx");
  // Rewritten. Old: the "D&I Conclusion and Review" step's panel. New: section 7's
  // Sign-off, which holds the preparer's row and the reviewer's (product owner, 16 November 2026, docs/design-workpaper.md section 3.8).
  const panel = read("apps/web/src/review-signoff.tsx");
  const widget = read("apps/web/src/preparer-signoff.tsx");
  const route = read("apps/web/app/workspace/workpapers/prepare/route.ts");

  it("signs at the end of section 7, and only there for the design workpaper", () => {
    assert.match(
      view,
      /<SignOffOf paper=\{paper\} actions=\{actions\} head=\{head\} \/>/,
    );
    assert.match(
      card,
      /paper\.stage !== "DESIGN" &&\s*paper\.status === "DRAFT"/,
    );
    // Rewritten. Old: the review step named the preparer's signature and linked to where
    // it is made. New: the two signatures are the two rows of one Sign-off, in order, the
    // preparer's first (product owner, 16 November 2026, docs/design-workpaper.md section 3.8).
    const first = panel.indexOf("<PreparerSignOff");
    const second = panel.indexOf("<ReviewRow");
    assert.ok(first > 0 && second > first);
    assert.match(panel, /<Mark n=\{1\} done=\{preparedDone\} \/>/);
  });

  it("shows done only after the server confirmed, and never sets HTML", () => {
    assert.match(
      widget,
      /const said = signOffRefusal\(intent, answer\.status, answer\.detail\);\s*if \(said !== ""\) \{[\s\S]*?return;\s*\}\s*setText\(""\);\s*setReopening\(false\);\s*onDone\(\);/,
    );
    // Rewritten (independent review, 16 November 2026). Old: `aria-disabled={!ready ||
    // sending}`. New: also off while a confirmed press waits for the workpaper read
    // again, so it is never pressed again on the state before.
    assert.match(
      widget,
      /aria-disabled=\{!ready \|\| sending \|\| confirmed !== null\}/,
    );
    assert.equal(/innerHTML|dangerouslySetInnerHTML/.test(widget), false);
    assert.match(route, /const write = signOffWrite\(fields\);/);
    // Confirmed: said in a status at once, and held until the workpaper read again shows
    // another status, which clears what was said before it (independent review, 16
    // November 2026).
    assert.match(
      widget,
      /onDone\(\);\s*\/\/[^\n]*\n\s*landing\.current = true;\s*setConfirmed\(intent\);/,
    );
    assert.match(widget, /<p className="ps-status" role="status">/);
    assert.match(
      widget,
      /if \(busy\.current \|\| confirmed !== null\) \{\s*return;/,
    );
    assert.match(
      widget,
      /status\.current = facts\.status;\s*setRefusal\(""\);\s*setConfirmed\(null\);/,
    );
    assert.match(widget, /mayAct && !reopening && confirmed === null \?/);
    // A refusal as changed, or an answer in doubt, reads the workpaper again.
    assert.match(
      widget,
      /if \(signOffRereads\(answer\.status\)\) \{[\s\S]*?onDone\(\);\s*\}\s*return;/,
    );
    assert.equal(
      /redirect|console\./.test(route.replace(/\/\*\*[\s\S]*?\*\//, "")),
      false,
    );
  });

  it("never drops the focus: into the reason, back to Reopen to change, then to the heading", () => {
    // "Reopen to change" opens the reason and moves the focus into it.
    assert.match(
      widget,
      /setReopening\(true\);[\s\S]{0,200}?requestAnimationFrame\(\(\) =>\s*document\.getElementById\(`\$\{uid\}-r`\)\?\.focus\(\),?\s*\)/,
    );
    // Cancel gives it back to "Reopen to change".
    assert.match(
      widget,
      /setReopening\(false\);\s*setText\(""\);\s*setRefusal\(""\);\s*window\.requestAnimationFrame\(\(\) =>\s*reopenButton\.current\?\.focus\(\),?\s*\);/,
    );
    // Once the press is shown, the heading (focusable from script only) takes it.
    assert.equal(
      (widget.match(/ref=\{heading\} tabIndex=\{-1\}/g) ?? []).length,
      2,
    );
    assert.match(
      widget,
      /if \(landing\.current\) \{\s*landing\.current = false;\s*window\.requestAnimationFrame\(\(\) => heading\.current\?\.focus\(\)\);/,
    );
  });
});
