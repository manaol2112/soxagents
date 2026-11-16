import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import type { DesignWorkpaper } from "../apps/web/src/design-workpaper-model.ts";
import {
  draftOf,
  type EditSource,
  editorFor,
  type GridEditor,
  type NotesEditor,
  saveRequest,
  setCell,
  type TextEditor,
} from "../apps/web/src/section-edit-model.ts";
import {
  CONTINUE_EDITING,
  copiesPath,
  copiesQuery,
  copyFor,
  copyIsStale,
  copyWrite,
  discardRequest,
  HAS_COPY,
  KEEP_AFTER_MS,
  KEEP_RETRY_MS,
  KEEPING,
  keepAction,
  keepingWords,
  keepProblem,
  keepRequest,
  keptWhen,
  LEAVE,
  NOT_KEPT,
  parseWorkingCopies,
  restoredDraft,
  restoredWords,
  STALE_COPY,
  type WorkingCopy,
} from "../apps/web/src/working-copy-model.ts";
import type { WorkpaperSection } from "../apps/web/src/workpaper-model.ts";

// A person's working copy of a section (docs/design-workpaper.md, section 3.4; product
// owner, 15 November 2026: "I want to automatically save the updates that the user has
// typed in", decided as a working copy on the server with a version only on Save). The
// model must never: say a working copy is saved to the workpaper, open an editor with a
// copy of another section or kind, lose what was typed on the way back into the editor,
// or send anything a save would not be allowed to send. Synthetic data only.

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [ORG, PROJECT, PAPER] = [uuid(1), uuid(2), uuid(7)] as const;
const scope = { organizationId: ORG, projectId: PROJECT };

const section = (over: Partial<WorkpaperSection>): WorkpaperSection => ({
  key: "",
  title: "",
  kind: "text",
  guidance: "",
  fields: [],
  text: "",
  citations: [],
  columns: [],
  rows: [],
  source: "AGENT",
  tab: "design",
  period: "design",
  review: null,
  ...over,
});
const SOURCE: EditSource = {
  workpaperId: PAPER,
  basedOn: 3,
  sections: [
    section({
      key: "design-conclusion",
      title: "Design conclusion",
      text: "The control is designed to address the risk.",
    }),
    section({
      key: "walkthrough-of-one-instance",
      title: "Walkthrough of one instance",
      kind: "table",
      columns: ["Step", "Who", "Result"],
      rows: [["HR starts the termination", "L. Moreno", "Initiated"]],
    }),
    section({
      key: "design-attributes",
      title: "Design attributes",
      kind: "table",
      columns: ["Attribute", "Designed", "Notes"],
      rows: [
        ["A. Access is disabled", "Yes", "Stored note"],
        ["B. Every account is removed", "Yes", ""],
      ],
    }),
  ],
};
const paper = {
  attributes: [
    { id: uuid(11), code: "A", text: "Access is disabled" },
    { id: uuid(12), code: "B", text: "Every account is removed" },
  ] as unknown as DesignWorkpaper["attributes"],
};
const conclusion = editorFor("conclusion", SOURCE, paper) as TextEditor;
const walk = editorFor("walkthrough", SOURCE, paper) as GridEditor;
const notes = editorFor("attributes", SOURCE, paper) as NotesEditor;

const sent = (over: Record<string, unknown> = {}) => ({
  section: "design-conclusion",
  based_on: 3,
  text: "Typed, not saved.",
  rows: null,
  updated_at: "2026-11-15T10:42:00Z",
  ...over,
});

describe("reading the working copies", () => {
  it("reads the caller's own, one per section, exactly one of a text or rows", () => {
    assert.deepEqual(
      parseWorkingCopies([
        sent(),
        sent({
          section: "walkthrough-of-one-instance",
          text: null,
          rows: [["a", "b", "c"]],
        }),
      ]),
      [
        {
          section: "design-conclusion",
          basedOn: 3,
          text: "Typed, not saved.",
          rows: null,
          updatedAt: "2026-11-15T10:42:00Z",
        },
        {
          section: "walkthrough-of-one-instance",
          basedOn: 3,
          text: null,
          rows: [["a", "b", "c"]],
          updatedAt: "2026-11-15T10:42:00Z",
        },
      ],
    );
  });

  it("leaves out what is not a working copy, and never guesses", () => {
    for (const value of [null, {}, "x", 3]) {
      assert.deepEqual(parseWorkingCopies(value), []);
    }
    assert.deepEqual(
      parseWorkingCopies([
        null,
        "x",
        sent({ section: "../x" }),
        sent({ section: 7 }),
        sent({ based_on: 0 }),
        sent({ based_on: "3" }),
        sent({ updated_at: null }),
        sent({ text: null }),
        sent({ rows: [["a"]] }),
        sent({ text: 7 }),
        sent({ text: null, rows: "a | b" }),
        sent({ text: null, rows: [[1]] }),
        sent({ text: "x".repeat(12_001) }),
        sent({ text: null, rows: Array.from({ length: 301 }, () => ["a"]) }),
      ]),
      [],
    );
    // A second copy of the same section is not read: the first stands.
    assert.equal(
      parseWorkingCopies([sent(), sent({ text: "Another." })])[0]?.text,
      "Typed, not saved.",
    );
  });
});

describe("opening an editor with a working copy", () => {
  const copies = parseWorkingCopies([
    sent(),
    sent({
      section: "walkthrough-of-one-instance",
      text: null,
      rows: [
        ["Changed step", "L. Moreno"],
        ["A new step", "", "", "too wide"],
      ],
    }),
    sent({
      section: "design-attributes",
      text: null,
      rows: [
        ["A. Access is disabled", "Yes", "Typed note"],
        ["B. Every account is removed", "Yes", "Another typed note"],
      ],
    }),
  ]);

  it("finds the copy of the editor's own section and kind, and no other", () => {
    assert.equal(copyFor(conclusion, copies)?.text, "Typed, not saved.");
    assert.equal(copyFor(walk, copies)?.rows?.length, 2);
    assert.equal(copyFor(conclusion, []), null);
    // A text kept for a section that is now a table (or the reverse) is not opened.
    assert.equal(
      copyFor(walk, parseWorkingCopies([sent({ section: walk.key })])),
      null,
    );
    assert.equal(
      copyFor(
        conclusion,
        parseWorkingCopies([sent({ text: null, rows: [["a"]] })]),
      ),
      null,
    );
  });

  it("shows what the person had typed: the text, the rows as wide as the columns, each note", () => {
    const [text, grid, noted] = copies as [
      WorkingCopy,
      WorkingCopy,
      WorkingCopy,
    ];
    assert.deepEqual(restoredDraft(conclusion, text), {
      kind: "text",
      text: "Typed, not saved.",
    });
    assert.deepEqual(restoredDraft(walk, grid), {
      kind: "grid",
      rows: [
        ["Changed step", "L. Moreno", ""],
        ["A new step", "", ""],
      ],
    });
    assert.deepEqual(restoredDraft(notes, noted), {
      kind: "notes",
      notes: { [uuid(11)]: "Typed note", [uuid(12)]: "Another typed note" },
    });
    // What goes back to the server from a restored editor is what was kept.
    assert.deepEqual(
      saveRequest(scope, SOURCE, notes, restoredDraft(notes, noted)).rows,
      noted.rows,
    );
  });

  it("says a copy started on another version may be out of date", () => {
    assert.equal(copyIsStale({ basedOn: 3 }, SOURCE), false);
    assert.equal(copyIsStale({ basedOn: 2 }, SOURCE), true);
    assert.equal(
      STALE_COPY,
      "This section may have changed since. Saving replaces it with what is here.",
    );
  });
});

describe("when a working copy is kept", () => {
  it("keeps what was changed, drops a copy of what was changed back, and otherwise does nothing", () => {
    const typed = { kind: "text", text: "Other words." } as const;
    assert.equal(keepAction(conclusion, typed, false), "keep");
    assert.equal(keepAction(conclusion, typed, true), "keep");
    assert.equal(keepAction(conclusion, draftOf(conclusion), true), "discard");
    assert.equal(keepAction(conclusion, draftOf(conclusion), false), "none");
    // Spaces the server would drop are not a change worth keeping.
    assert.equal(
      keepAction(
        conclusion,
        { kind: "text", text: `${conclusion.text}  ` },
        false,
      ),
      "none",
    );
    assert.equal(KEEP_AFTER_MS, 1500);
    assert.equal(KEEP_RETRY_MS, 15_000);
  });

  it("never keeps what a save could not send: a credential, or a limit passed", () => {
    // Found while wiring the page (15 November 2026): `keepAction` said "keep" for any
    // change, so a draft holding a credential, or over 12,000 characters, was sent to the
    // route (which refuses it, and the refusal then stopped keeping for the editor).
    // What a save may not send is not sent as a working copy either; a copy already
    // there stays as it was.
    const secret = { kind: "text", text: "password: hunter2hunter2" } as const;
    assert.equal(keepAction(conclusion, secret, false), "none");
    assert.equal(keepAction(conclusion, secret, true), "none");
    const long = { kind: "text", text: "x".repeat(12_001) } as const;
    assert.equal(keepAction(conclusion, long, false), "none");
    const cell = {
      kind: "grid",
      rows: setCell(walk.rows, 0, 2, "api_key=abcdefabcdefabcdef"),
    } as const;
    assert.equal(keepAction(walk, cell, true), "none");
    // Within the limits it is kept as before.
    assert.equal(
      keepAction(conclusion, { kind: "text", text: "x".repeat(12_000) }, false),
      "keep",
    );
  });

  it("posts a save's own body with the intent, and a discard with the ids and the key", () => {
    const draft = {
      kind: "grid",
      rows: setCell(walk.rows, 0, 2, "Done"),
    } as const;
    const keep = keepRequest(scope, SOURCE, walk, draft);
    assert.deepEqual(keep, {
      intent: "keep",
      ...saveRequest(scope, SOURCE, walk, draft),
    });
    assert.deepEqual(discardRequest(scope, SOURCE, walk), {
      intent: "discard",
      organization_id: ORG,
      project_id: PROJECT,
      workpaper_id: PAPER,
      section: "walkthrough-of-one-instance",
    });
    // What the page posts is what the route takes: the seam, crossed.
    const base = `/organizations/${ORG}/projects/${PROJECT}/workpapers/${PAPER}`;
    assert.deepEqual(copyWrite(JSON.parse(JSON.stringify(keep))), {
      method: "PUT",
      path: `${base}/sections/walkthrough-of-one-instance/draft`,
      body: {
        based_on: 3,
        rows: [["HR starts the termination", "L. Moreno", "Done"]],
      },
    });
    assert.deepEqual(copyWrite(discardRequest(scope, SOURCE, walk)), {
      method: "DELETE",
      path: `${base}/sections/walkthrough-of-one-instance/draft`,
    });
    assert.equal(
      copiesPath(new URLSearchParams(copiesQuery(scope, PAPER))),
      `${base}/drafts`,
    );
  });

  it("refuses what a save would refuse, and anything that is not keep or discard", () => {
    const keep = keepRequest(scope, SOURCE, conclusion, {
      kind: "text",
      text: "Words.",
    });
    for (const fields of [
      {},
      { ...keep, intent: "save" },
      { ...keep, intent: undefined },
      { ...keep, workpaper_id: "7" },
      { ...keep, section: "../prepare" },
      { ...keep, based_on: 0 },
      { ...keep, text: "the password: hunter2" },
      { ...keep, text: "x".repeat(12_001) },
      { ...keep, rows: [["a"]] },
      {
        intent: "discard",
        ...discardRequest(scope, SOURCE, conclusion),
        section: "a/b",
      },
      { ...discardRequest(scope, SOURCE, conclusion), project_id: "x" },
    ] as Array<Record<string, unknown>>) {
      assert.deepEqual(
        copyWrite(fields),
        { error: "invalid" },
        JSON.stringify(fields).slice(0, 90),
      );
    }
    for (const query of [
      "",
      "organization=1&project=2&workpaper=3",
      `organization=${ORG}&project=${PROJECT}`,
    ]) {
      assert.equal(copiesPath(new URLSearchParams(query)), null);
    }
  });
});

describe("what the bar says of a working copy", () => {
  const now = new Date(2026, 10, 15, 11, 0, 0);
  const at = (hour: number, minute: number, day = 15) =>
    new Date(2026, 10, day, hour, minute, 0).toISOString();

  it("says when it was kept, and never that it is saved", () => {
    assert.equal(keepingWords({ state: "none" }, now), "");
    assert.equal(keepingWords({ state: "keeping" }, now), KEEPING);
    assert.equal(
      keepingWords({ state: "kept", at: at(10, 42) }, now),
      "Changes kept at 10:42 AM. Not in the workpaper until you save.",
    );
    assert.equal(
      keepingWords({ state: "kept", at: "not a time" }, now),
      "Changes kept. Not in the workpaper until you save.",
    );
    assert.equal(keepingWords({ state: "failed", detail: "" }, now), NOT_KEPT);
    assert.equal(
      keepingWords(
        {
          state: "failed",
          detail: "the workpaper is prepared; reopen it to change it.",
        },
        now,
      ),
      "Your changes are not kept: the workpaper is prepared; reopen it to change it.",
    );
    for (const keeping of [
      { state: "keeping" },
      { state: "kept", at: at(10, 42) },
      { state: "failed", detail: "" },
    ] as const) {
      assert.equal(/\bsaved\b/i.test(keepingWords(keeping, now)), false);
    }
  });

  it("says the day too where it was not today", () => {
    assert.equal(keptWhen(at(10, 42), now), "10:42 AM");
    assert.equal(keptWhen(at(16, 5, 14), now), "14 Nov, 4:05 PM");
    assert.equal(keptWhen("", now), "");
    assert.equal(
      restoredWords({ updatedAt: at(16, 5, 14) }, now),
      "Your changes from 14 Nov, 4:05 PM are restored.",
    );
    assert.equal(
      restoredWords({ updatedAt: "x" }, now),
      "Your earlier changes are restored.",
    );
  });

  it("tries again what may pass, and not what the server will not take", () => {
    assert.equal(keepProblem(200, ""), null);
    assert.deepEqual(keepProblem(0, ""), { detail: "", retry: true });
    assert.deepEqual(keepProblem(502, "x"), { detail: "", retry: true });
    assert.equal(keepProblem(401, "")?.retry, true);
    assert.match(keepProblem(401, "")?.detail ?? "", /session has ended/);
    assert.deepEqual(
      keepProblem(409, "the workpaper is prepared; reopen it to change it"),
      {
        detail: "the workpaper is prepared; reopen it to change it.",
        retry: false,
      },
    );
    assert.deepEqual(keepProblem(409, ""), {
      detail: "the workpaper cannot be changed now.",
      retry: false,
    });
    for (const status of [403, 404, 422]) {
      assert.equal(keepProblem(status, "")?.retry, false);
    }
  });

  it("asks before leaving in words that say what each choice does", () => {
    assert.equal(
      LEAVE.title("Design conclusion"),
      "Save your changes to Design conclusion?",
    );
    assert.match(LEAVE.body, /kept as your working copy either way/);
    assert.deepEqual(
      [LEAVE.save, LEAVE.leave, LEAVE.stay],
      ["Save", "Leave without saving", "Keep editing"],
    );
    assert.equal(HAS_COPY, "Unsaved changes");
    assert.equal(CONTINUE_EDITING, "Continue editing");
    const model = readFileSync("apps/web/src/working-copy-model.ts", "utf8");
    assert.equal(/the client/i.test(model), false);
  });
});

describe("the route", () => {
  const route = readFileSync(
    "apps/web/app/workspace/workpapers/draft/route.ts",
    "utf8",
  );

  it("validates with the model, answers as JSON, and never redirects or logs", () => {
    assert.match(
      route,
      /const path = copiesPath\(new URL\(request\.url\)\.searchParams\);/,
    );
    assert.match(route, /const write = copyWrite\(fields\);/);
    assert.match(
      route,
      /if \("error" in write\) \{\s*return NextResponse\.json\(\{ status: 422, detail: "", updated_at: null \}\);/,
    );
    assert.match(route, /method: write\.method,/);
    assert.match(route, /status = response\.ok \? 200 : response\.status;/);
    assert.equal(
      /redirect/.test(route.replace(/\/\*\*[\s\S]*?\*\//, "")),
      false,
    );
    assert.equal(/console\./.test(route), false);
    assert.equal(/request\.headers/.test(route), false);
    assert.match(route, /headers\.set\("cookie", `aw_session=\$\{token\}`\);/);
  });
});
