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
  type SignOffFacts,
  signOffProblems,
  signOffRefusal,
  signOffRequest,
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
    assert.match(signOffRefusal("prepare", 0, ""), /could not be reached/);
    assert.match(signOffRefusal("reopen", 422, ""), /at least 3 characters/);
  });
});

describe("the screen", () => {
  const read = (path: string) => readFileSync(path, "utf8");
  const view = read("apps/web/src/design-workpaper-view.tsx");
  const card = read("apps/web/src/workpaper-view.tsx");
  const panel = read("apps/web/src/design-conclusion-panel.tsx");
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
    // The review step names the preparer's signature and links to where it is made.
    assert.match(panel, /<dt>Preparer's sign-off<\/dt>/);
    assert.match(panel, /the preparer signs at the end of section 7/);
  });

  it("shows done only after the server confirmed, and never sets HTML", () => {
    assert.match(
      widget,
      /const said = signOffRefusal\(intent, answer\.status, answer\.detail\);\s*if \(said !== ""\) \{[\s\S]*?return;\s*\}\s*setText\(""\);\s*setReopening\(false\);\s*onDone\(\);/,
    );
    assert.match(widget, /aria-disabled=\{!ready \|\| sending\}/);
    assert.equal(/innerHTML|dangerouslySetInnerHTML/.test(widget), false);
    assert.match(route, /const write = signOffWrite\(fields\);/);
    assert.equal(
      /redirect|console\./.test(route.replace(/\/\*\*[\s\S]*?\*\//, "")),
      false,
    );
  });
});
