import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  rowPills,
  testingSubject,
} from "../apps/web/src/controls-page-model.ts";
import { reopenedPrefix } from "../apps/web/src/design-evidence-model.ts";
import {
  answersInPlace,
  asSentence,
  CHANGE_NOTICES,
  changeBlocked,
  changeLanding,
  changeNoticeFor,
  changeNoticeOk,
  changeNoticeParam,
  changeProblem,
  changeReturn,
  changeWrite,
  cleanReason,
  nextOpenForm,
  noWithdrawnMatch,
  parseChangeNotice,
  reasonReady,
  replaceTarget,
  restoredLine,
  withdrawnCountLine,
} from "../apps/web/src/evidence-change-model.ts";
import {
  CHOOSE_FILE_FIRST,
  CHOOSE_FIRST,
  impactItemName,
  moveConfirmTitle,
  moveHeldLine,
  RETURNS_TO_NOT_REVIEWED,
  refParts,
  resetLine,
  STILL_READING_FILE,
} from "../apps/web/src/evidence-impact-model.ts";
import {
  filingWhy,
  filterWithdrawn,
  followUpPoints,
  parseRegister,
  reviewFeedback,
  sameSystem,
} from "../apps/web/src/evidence-model.ts";
import {
  analyzedLine,
  finishedAt,
  formatDuration,
  resultsNote,
  resultsSummary,
} from "../apps/web/src/evidence-wizard-model.ts";
import {
  closesForm,
  ESCAPE_FORMS,
  FOCUS_ANSWERS,
  keeperTarget,
} from "../apps/web/src/focus-return.ts";
import {
  actionName,
  heldControl,
  heldNames,
  heldReasons,
  menuIcons,
  reasonHolder,
  sharedReason,
} from "../apps/web/src/row-menu-model.ts";

const org = "11111111-1111-7111-8111-111111111111";
const project = "22222222-2222-7222-8222-222222222222";
const file = "66666666-6666-7666-8666-666666666666";
const newer = "77777777-7777-7777-8777-777777777777";
const control = "44444444-4444-7444-8444-444444444444";

describe("reasons", () => {
  it("keeps one plain line of 3 to 500 characters, never a secret", () => {
    assert.equal(cleanReason("  Wrong\nperiod\t "), "Wrong period");
    assert.equal(cleanReason("no"), null);
    assert.equal(cleanReason("x".repeat(501)), null);
    assert.equal(cleanReason("password: hunter2"), null);
  });
});

describe("withdraw and restore writes", () => {
  const fields = {
    organization_id: org,
    project_id: project,
    file_id: file,
    intent: "withdraw",
    reason: "Uploaded the wrong period",
  };

  it("withdraws without a reason when none is given", () => {
    const quiet = changeWrite({ ...fields, reason: "  " });
    assert.ok(!("error" in quiet));
    assert.deepEqual(quiet.body, { reason: "" });
  });

  it("builds the call with the reason", () => {
    assert.deepEqual(changeWrite(fields), {
      intent: "withdraw",
      path: `/organizations/${org}/projects/${project}/evidence-files/${file}/withdraw`,
      body: { reason: "Uploaded the wrong period" },
    });
    const restore = changeWrite({ ...fields, intent: "restore" });
    assert.ok(!("error" in restore));
    assert.ok(restore.path.endsWith("/restore"));
  });

  it("refuses other intents, bad ids, and missing reasons", () => {
    for (const bad of [
      { ...fields, intent: "delete" },
      { ...fields, file_id: "../x" },
      { ...fields, organization_id: "x" },
      { ...fields, intent: "restore", reason: "" },
    ]) {
      assert.deepEqual(changeWrite(bad), { error: "invalid" });
    }
  });

  it("returns to the control's tab or to the evidence page", () => {
    assert.deepEqual(changeReturn({ ...fields, control_id: control }), {
      to: "control",
      control,
    });
    assert.deepEqual(
      changeReturn({ ...fields, queue: "agent", q: "users", junk: "x" }),
      { to: "evidence", file, keep: { queue: "agent", q: "users" } },
    );
  });

  it("keeps the person on the Evidence Library, with the notice (E1, 18 November 2026)", () => {
    // Before: the Library's forms kept the queue but not the tab, so a withdrawal landed
    // on Requests ("section=evidence&notice=change-withdrawn") and a restoration too,
    // where the Library's banner is not shown.
    const library = { tab: "files", queue: "withdrawn", q: "users" };
    const withdrawn = new URLSearchParams(
      changeLanding({ ...fields, tab: "files" }, "withdrawn", null).slice(2),
    );
    // Changed 18 November 2026 (E1 design review, round 5). Old: no `file` after a
    // withdrawal, so the banner could only say "The file was withdrawn". New: the file
    // comes back named (a withdrawn file is not in the Library, so no panel opens), and
    // the banner names it from the server's own Withdrawn list.
    assert.deepEqual(Object.fromEntries(withdrawn), {
      organization: org,
      project,
      section: "evidence",
      tab: "files",
      file,
      notice: "change-withdrawn",
    });
    const restored = new URLSearchParams(
      changeLanding(
        { ...fields, intent: "restore", ...library },
        "restored",
        null,
      ).slice(2),
    );
    assert.deepEqual(Object.fromEntries(restored), {
      organization: org,
      project,
      section: "evidence",
      tab: "files",
      queue: "withdrawn",
      q: "users",
      file,
      notice: "change-restored",
    });
    // A control's step, with its files open.
    const step = new URLSearchParams(
      changeLanding(
        { ...fields, control_id: control },
        "withdrawn",
        "request",
      ).slice(2),
    );
    assert.equal(step.get("section"), "controls");
    assert.equal(step.get("step"), "request");
    assert.equal(step.get("ev"), "files");
    assert.equal(step.get("tab"), null);
    // Every form of the Library carries its tab; the filing route keeps it too.
    const view = readFileSync(
      new URL("../apps/web/src/evidence-view.tsx", import.meta.url),
      "utf8",
    );
    assert.match(
      view,
      /function keepOf\(view: EvidenceView\): Keep \{[\s\S]{0,300}tab: "files",/,
    );
    assert.match(view, /<input type="hidden" name="tab" value="files" \/>/);
    const filing = readFileSync(
      new URL(
        "../apps/web/app/workspace/evidence-filing/route.ts",
        import.meta.url,
      ),
      "utf8",
    );
    assert.match(filing, /\["tab", "tab"\],/);
  });
});

describe("replacement uploads", () => {
  const params = (extra: Record<string, string> = {}) =>
    new URLSearchParams({
      organization: org,
      project,
      file,
      name: "users v2.csv",
      reason: "Corrected export",
      ...extra,
    });

  it("builds the call with the new name and reason", () => {
    const target = replaceTarget(params());
    assert.ok(!("error" in target));
    assert.equal(
      target.path,
      `/organizations/${org}/projects/${project}/evidence-files/${file}/replace`,
    );
    assert.equal(new URLSearchParams(target.query).get("name"), "users v2.csv");
  });

  it("refuses a missing name, a bad id, or no reason", () => {
    for (const bad of [
      params({ name: " " }),
      params({ file: "x" }),
      params({ reason: "x" }),
      params({ name: "a".repeat(201) }),
    ]) {
      assert.deepEqual(replaceTarget(bad), { error: "invalid" });
    }
  });
});

describe("notices", () => {
  it("names why a change was refused, from the API's own words", () => {
    const cases: Array<[string, string]> = [
      [
        "the file cannot be withdrawn: the agent is still reading this file; try again in a moment",
        "reading",
      ],
      [
        "the file cannot be withdrawn: its screenshot review is signed off",
        "review-signed",
      ],
      [
        "the file cannot be withdrawn: the approved sample for ITGC-AC-01 was drawn from it",
        "sample-drawn",
      ],
      // Since 31 October 2026 only reliance on the file itself keeps it.
      [
        'the file cannot be withdrawn: the evidence item "Access policy" was accepted with it; change that decision first',
        "item-accepted",
      ],
      [
        "the file cannot be replaced: testing for ITGC-AC-01 is signed off on it; reopen it first",
        "testing-signed",
      ],
      [
        "the file cannot be withdrawn: the prepared design workpaper for ITGC-AC-01 cites it; reopen it first",
        "workpaper-prepared",
      ],
      ["this is the same file; nothing to replace", "same-file"],
      [
        "this file was replaced; withdraw the newer version to use this one again",
        "was-replaced",
      ],
      // The API's sentence since E1 (18 November 2026).
      [
        "This file was replaced. A replaced file stays in its version history and cannot be restored; to use it again, upload it again under another file name.",
        "was-replaced",
      ],
      // The reliances E1 added, for a page reloaded with its notice.
      [
        'the file cannot be withdrawn: an attribute of "Access policy" for ITGC-AC-01 is shown on a tickmark a person made on it; reopen that decision first',
        "tickmark",
      ],
      [
        'the file cannot be replaced: a person\'s decision on whether it is reliable stands for "User list" for ITGC-AC-01; reopen that decision first',
        "reliability",
      ],
      [
        'the file cannot be withdrawn: the walkthrough instance for "Change ticket" for ITGC-CM-01 was picked from it; pick it again from another file first',
        "walkthrough-pick",
      ],
      [
        "the file cannot be withdrawn: the signed design conclusion for ITGC-AC-01 rests on it; reopen that conclusion first",
        "conclusion-signed",
      ],
      [
        'the file cannot be withdrawn: the finding "Missing approval" for ITGC-AC-01 was sent to the client on it; close that finding first',
        "finding-held",
      ],
      [
        'the file cannot be withdrawn: a person decided the finding "Missing approval" for ITGC-AC-01 on it; close that finding first',
        "finding-held",
      ],
      ["this file is already withdrawn", "already"],
    ];
    for (const [detail, notice] of cases) {
      assert.equal(changeNoticeFor("withdraw", 409, detail), notice, detail);
    }
  });

  it("says a refusal in place in the server's own sentence (E1, 18 November 2026)", () => {
    // Changed 18 November 2026. Old: a form that withdrew in place showed the notice's
    // canned words for every refusal. New: the server's sentence, which names the
    // reliance and how to clear it; the canned words only where it sent none.
    assert.equal(
      changeProblem(
        "item-accepted",
        'the file cannot be withdrawn: the evidence item "Access policy" was accepted with it; change that decision first',
      ),
      'The file cannot be withdrawn: the evidence item "Access policy" was accepted with it; change that decision first.',
    );
    assert.equal(changeProblem("unavailable", ""), CHANGE_NOTICES.unavailable);
    // A sentence that ends itself keeps its own full stop.
    assert.equal(
      asSentence("This file was replaced. It cannot be restored."),
      "This file was replaced. It cannot be restored.",
    );
    assert.equal(asSentence("  "), "");
  });

  it("claims a reason and a restoration only as the API now has them", () => {
    // Changed 18 November 2026 (E1). Old withdrawn notice: "... kept under Withdrawn with
    // your reason", said also when none was given. Old was-replaced notice: "Withdraw its
    // newer version to use this one again", which never restored it.
    assert.doesNotMatch(CHANGE_NOTICES.withdrawn, /your reason/);
    assert.equal(
      CHANGE_NOTICES["was-replaced"],
      "This file was replaced. A replaced file stays in its version history and cannot be restored; to use it again, upload it again under another file name.",
    );
  });

  it("maps success and other statuses", () => {
    assert.equal(changeNoticeFor("withdraw", 200, ""), "withdrawn");
    assert.equal(changeNoticeFor("restore", 200, ""), "restored");
    assert.equal(changeNoticeFor("replace", 200, ""), "replaced");
    assert.equal(changeNoticeFor("replace", 404, ""), "denied");
    assert.equal(changeNoticeFor("replace", 422, ""), "invalid");
    assert.equal(changeNoticeFor("replace", 503, ""), "unavailable");
    assert.ok(changeNoticeOk("replaced"));
    assert.ok(!changeNoticeOk("testing-signed"));
  });

  it("parses only its own notices", () => {
    assert.equal(
      parseChangeNotice(changeNoticeParam("withdrawn")),
      "withdrawn",
    );
    assert.equal(parseChangeNotice("filing-filed"), null);
    assert.equal(parseChangeNotice("change-anything"), null);
  });

  it("says when a file cannot change from the page", () => {
    const base = { state: "FILED", readStatus: "READY", reviewDecision: null };
    assert.equal(changeBlocked(base), null);
    assert.match(
      changeBlocked({ ...base, readStatus: "WORKING" }) ?? "",
      /reading/,
    );
    assert.match(
      changeBlocked({ ...base, reviewDecision: "EFFECTIVE" }) ?? "",
      /signed off/,
    );
  });
});

describe("withdrawn files in the register", () => {
  it("lists them apart, with who withdrew them, why, and any replacement", () => {
    const register = parseRegister({
      files: [],
      controls: [],
      withdrawn: [
        {
          id: file,
          file_name: "users.csv",
          folder_path: "Access",
          source: "UPLOAD",
          size_bytes: 120,
          created_at: "2026-10-01T00:00:00Z",
          added_by: "Ann",
          reason: "Wrong period",
          withdrawn_by: "Bo",
          withdrawn_at: "2026-10-02T00:00:00Z",
          replaced_by: newer,
          replaced_by_name: "users v2.csv",
          control: { id: control, control_ref: "ITGC-AC-01", title: "Access" },
        },
        { id: "not-a-uuid", file_name: "x" },
      ],
    });
    assert.ok(register !== null);
    assert.equal(register.withdrawn.length, 1);
    const [kept] = register.withdrawn;
    assert.equal(kept?.replacedBy, newer);
    assert.equal(kept?.control?.controlRef, "ITGC-AC-01");
    assert.equal(filterWithdrawn(register.withdrawn, "wrong").length, 1);
    assert.equal(filterWithdrawn(register.withdrawn, "payroll").length, 0);
    // A word with an "s" in it, and two words, are found (17 November 2026: the query was
    // split on the letter "s", so "users" and "access" found nothing).
    assert.equal(filterWithdrawn(register.withdrawn, "users").length, 1);
    assert.equal(
      filterWithdrawn(register.withdrawn, "access  ITGC-AC-01").length,
      1,
    );
    // An older API without the list still parses.
    assert.deepEqual(parseRegister({ files: [], controls: [] })?.withdrawn, []);
  });
});

describe("withdrawing in place", () => {
  it("answers with JSON only when the form asks for it", () => {
    assert.equal(answersInPlace("application/json"), true);
    assert.equal(answersInPlace("text/html,application/json;q=0.9"), true);
    assert.equal(answersInPlace("text/html,application/xhtml+xml"), false);
    assert.equal(answersInPlace(null), false);
  });

  it("shows a refusal in the form on a control page, not after a reload", () => {
    // 31 Oct 2026: a withdrawal refused because the workpaper was prepared reloaded
    // the page with its notice inside the closed Files received section.
    const form = readFileSync(
      new URL("../apps/web/src/evidence-change.tsx", import.meta.url),
      "utf8",
    );
    assert.match(form, /onSubmit=\{withdraw\}/);
    assert.match(form, /Withdrawing…/);
    const line = readFileSync(
      new URL("../apps/web/src/evidence-workspace-view.tsx", import.meta.url),
      "utf8",
    );
    assert.match(line, /onDone=\{/);
    const route = readFileSync(
      new URL(
        "../apps/web/app/workspace/evidence-change/route.ts",
        import.meta.url,
      ),
      "utf8",
    );
    // Changed 18 November 2026 (E1). Old: the route set `ev=files` itself. New: the
    // landing is the model's (changeLanding, tested below), which still opens the files.
    assert.match(
      route,
      /changeLanding\(fields, notice, returnStep\(fields\.step\)\)/,
    );
    assert.equal(
      new URLSearchParams(
        changeLanding(
          {
            organization_id: org,
            project_id: project,
            file_id: file,
            control_id: control,
          },
          "withdrawn",
          null,
        ).slice(2),
      ).get("ev"),
      "files",
    );
    // E1 (18 November 2026): the in-place answer carries the server's sentence and the
    // page a reload would land on, as a path on this app only.
    assert.match(
      route,
      /NextResponse\.json\(\{\s*notice,\s*detail,\s*location:/,
    );
    assert.match(form, /localPath\(body\.location\)/);
  });

  it("withdraws and restores in place everywhere, never by a page reload (E1)", () => {
    // Changed 18 November 2026. Old: the Evidence Library and a control's file list
    // posted the withdrawal, and the Withdrawn list the restoration, reloading the page
    // (303). New: every form sends in place; where its row leaves the list, the page
    // comes back in place (router.replace) with the notice.
    const form = readFileSync(
      new URL("../apps/web/src/evidence-change.tsx", import.meta.url),
      "utf8",
    );
    assert.match(form, /router\.replace\(location, \{ scroll: false \}\)/);
    assert.doesNotMatch(form, /\/\/ The page's own form post/);
    const library = readFileSync(
      new URL("../apps/web/src/evidence-view.tsx", import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(library, /name="intent" value="restore"/);
    // Changed again 18 November 2026 (E1 design review). Old: Restore opened a popover
    // (it clipped at the card's bottom and hid the row) and, once confirmed, the page
    // came back with a banner over "Nothing withdrawn". New: the Withdrawn list's rows
    // are their own (WithdrawnRows): the form, then its confirmation, as a full-width
    // row under the file's row, which stays while the person is there; the page is read
    // again in place, with no notice.
    assert.match(library, /<WithdrawnRows/);
    assert.match(form, /export function WithdrawnRows\(/);
    const rows = form.slice(
      form.indexOf("export function WithdrawnRows("),
      form.indexOf("export function InPlaceForm("),
    );
    // Changed 18 November 2026 (E1 design review, round 4). Old: the rows were drawn here
    // (`<td colSpan={columns}>`), their body sized to the window, and cut off at 390 px.
    // New: the shared full-width row (RowExtra), sized to the table's scroll box.
    assert.match(
      rows,
      /<RowExtra\s+key=\{`\$\{row\.id\}-restore`\}\s+columns=\{columns\}/,
    );
    assert.match(rows, /<p className="ep-done" role="status">/);
    assert.match(
      rows,
      /onDone\(restoredMessage\(fileName\)\);\s*router\.refresh\(\);/,
    );
    assert.doesNotMatch(rows, /router\.replace/);
    // Restore names the file, says what restoring does, and has Cancel.
    assert.match(rows, /Restore <strong>\{fileName\}<\/strong>/);
    assert.match(rows, /action: "RESTORE"/);
    assert.match(rows, />\s*Cancel\s*</);
    // The popover's overflow rules are gone.
    const css = readFileSync(
      new URL("../apps/web/app/globals.css", import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(css, /restore-menu/);
  });

  it("offers only what can succeed: a held change is its reason and Close", () => {
    // E1 design review, 18 November 2026: a held form still showed its Why field, the
    // file chooser and a greyed primary under the amber box; after a refusal the
    // preview was stale and the button armed, with a red line beside the same reason.
    const form = readFileSync(
      new URL("../apps/web/src/evidence-change.tsx", import.meta.url),
      "utf8",
    );
    const changes = form.slice(
      form.indexOf("export function FileChanges("),
      form.indexOf("export function FileCardActions("),
    );
    assert.match(
      changes,
      /if \(held && action !== null\) \{\s*return \(\s*<div className="file-changes">\s*<HeldChange/,
    );
    const held = form.slice(
      form.indexOf("function HeldChange("),
      form.indexOf("export function FileChanges("),
    );
    assert.doesNotMatch(held, /<textarea|<input|type="submit"/);
    assert.match(held, />\s*Close\s*</);
    // A refusal reads the impact again (a new attempt), and its sentence is said only
    // where that read does not hold the change.
    assert.match(changes, /setAttempt\(\(count\) => count \+ 1\)/);
    assert.match(
      changes,
      /refused !== null && impact\?\.status !== "loading" && !held/,
    );
    assert.match(changes, /useImpact\(\s*ids,[\s\S]*?attempt,\s*\)/);
  });

  it("says the same words for a withdrawal where it was made and on the page", () => {
    assert.equal(
      CHANGE_NOTICES.withdrawn,
      "The file was withdrawn. It is kept under Withdrawn and can be restored.",
    );
    assert.equal(
      CHANGE_NOTICES.restored,
      "The file was restored. It is back on its control and is tested again.",
    );
  });
});

describe("E1 design review, round 4 (18 November 2026)", () => {
  const read = (path: string) =>
    readFileSync(
      new URL(`../apps/web/${path}`, import.meta.url),
      "utf8",
    ).replace(/\r\n/g, "\n");
  const change = read("src/evidence-change.tsx");
  const css = read("app/globals.css");

  it("keeps a form opened under a table's row inside the table's scroll box", () => {
    // Blocking at 390 px: the Withdrawn list's restore form was sized to the window
    // (`calc(100vw - 3rem)`), wider than the table's scroll box (325 px), so at any
    // sideways scroll it was cut off on the left. Every row that opens a form or a
    // notice under it is the one shared row (RowExtra), sized to the scroll box.
    const extra = read("src/row-extra.tsx");
    assert.match(extra, /<td colSpan=\{columns\} className="row-extra-cell">/);
    assert.match(extra, /<div className="row-extra-body">\{children\}<\/div>/);
    const rows = change.slice(
      change.indexOf("export function WithdrawnRows("),
      change.indexOf("function RestoreForm("),
    );
    // Round 5 added a third, the full reason under its row; the design review removed it
    // again (the reason showed twice): it opens in its own cell.
    assert.equal(rows.match(/<RowExtra\b/g)?.length, 2);
    assert.doesNotMatch(rows, /<td colSpan/);
    // The table's parent, its scroll box, is the size the body is measured against.
    assert.match(
      css,
      /:has\(> table > tbody > tr\.row-extra\) \{\n {2}container-type: inline-size;\n\}/,
    );
    assert.match(
      css,
      /\.row-extra-body \{\n {2}position: sticky;\n {2}left: 0;\n {2}box-sizing: border-box;\n {2}max-width: 100cqi;/,
    );
    assert.doesNotMatch(css, /withdrawn-row-body/);
    assert.doesNotMatch(css, /calc\(100vw - 3rem\)/);
    // No other evidence table draws a full-width row of its own.
    for (const path of ["src/evidence-view.tsx", "src/evidence-change.tsx"]) {
      assert.doesNotMatch(
        read(path).replace(/<th scope="colgroup" colSpan=\{6\}>/g, ""),
        /<td colSpan=/,
        path,
      );
    }
  });

  it("gives keyboard focus back after Close, Cancel, a confirmation and a refusal", () => {
    // Focus fell to the page's body after every form action, in every area. One
    // mechanism (use-focus-return.ts) in the shared forms, never a call site's own.
    const changes = change.slice(
      change.indexOf("export function FileChanges("),
      change.indexOf("export function FileCardActions("),
    );
    assert.match(
      changes,
      /const close = \(\) => \{[\s\S]{0,200}focus\.returnFocus\("back"\);/,
    );
    assert.match(
      changes,
      /const confirmed = [\s\S]{0,120}focus\.returnFocus\("answer"\);/,
    );
    assert.match(
      changes,
      /const refusedWith = [\s\S]{0,260}focus\.returnFocus\("answer"\);/,
    );
    assert.equal(changes.match(/ref=\{focus\.ref\}/g)?.length, 3);
    assert.match(changes, /focusRef=\{focus\.ref\}/);
    const restore = change.slice(
      change.indexOf("function RestoreForm("),
      change.indexOf("export function InPlaceForm("),
    );
    assert.match(restore, /focus\.returnFocus\("back"\);\s*onCancel\(\);/);
    assert.equal(restore.match(/focus\.returnFocus\("answer"\);/g)?.length, 2);
    const inPlace = change.slice(
      change.indexOf("export function InPlaceForm("),
    );
    assert.match(inPlace, /focus\.returnFocus\("answer"\);\s*onDone\(\);/);
    assert.match(inPlace, /focus\.returnFocus\("back"\);\s*onCancel\(\);/);
    // The control a person pressed is never switched off under them while the change
    // is on its way (that drops focus to the body): it is busy, and a second press does
    // nothing.
    assert.doesNotMatch(change, /(?<!aria-)disabled=\{sending/);
    assert.doesNotMatch(change, /<fieldset className="move-guard" disabled/);
    // The held box's one way out is where a refusal puts the focus, named by the box.
    assert.match(
      change,
      /data-focus-return=""\s*aria-describedby=\{`\$\{uid\}-title \$\{uid\}-why`\}/,
    );
    // A menu's choice keeps focus on the menu's button, for the form to give it back.
    const menu = read("src/row-menu.tsx");
    assert.match(
      menu,
      /setOpen\(false\);\s*(\/\/[^\n]*\n\s*)*button\.current\?\.focus\(\);\s*item\.onSelect\?\.\(\);/,
    );
  });

  it("keeps a held action reachable by keyboard, its reason its description", () => {
    // Held menu items were `disabled` buttons, so Tab skipped them and the reason was
    // only visible text and a title; the About tab's held buttons, the Library's held
    // Move and Take off and the wizard's Withdraw the same. Each item a shared reason
    // holds is described by the one line it is said under.
    const reason = "The agent is still reading this file.";
    assert.deepEqual(
      reasonHolder([
        { unavailable: reason },
        {},
        { unavailable: reason },
        { unavailable: "Other." },
      ]),
      [2, null, 2, 3],
    );
    assert.deepEqual(heldControl(false, "why"), {});
    assert.deepEqual(heldControl(true, "why"), {
      "aria-disabled": true,
      "aria-describedby": "why",
    });
    const menu = read("src/row-menu.tsx");
    assert.match(
      menu,
      /aria-disabled=\{item\.unavailable \? true : undefined\}/,
    );
    assert.match(menu, /\$\{uid\}-why-\$\{holders\[index\] \?\? index\}/);
    assert.match(menu, /<small id=\{`\$\{uid\}-why-\$\{index\}`\}>/);
    assert.match(menu, /if \(item\.unavailable\) \{\s*return;\s*\}/);
    const about = read("src/evidence-about.tsx");
    const impact = read("src/evidence-impact.tsx");
    const wizard = read("src/evidence-wizard.tsx");
    for (const [name, source] of [
      ["row-menu.tsx", menu],
      ["evidence-about.tsx", about],
      ["evidence-impact.tsx", impact],
    ] as const) {
      assert.doesNotMatch(
        source,
        /(?<!aria-)disabled=\{[^}]*(unavailable|held)/,
        `${name} switches a held control off with disabled`,
      );
    }
    assert.match(about, /\{\.\.\.heldControl\(\s*helds\[index\] !== null,/);
    assert.match(about, /if \(helds\[index\] === null\) \{\s*setChanging/);
    assert.doesNotMatch(wizard, /disabled=\{busy \|\| remove\.unavailable/);
    assert.match(
      impact,
      /\{\.\.\.heldControl\(off, held \? check\?\.heldId : `\$\{uid\}-choose`\)\}/,
    );
    assert.match(
      css,
      // Design review: the Library panel's resting presses are in it too.
      /:is\(\n {4}\.ea-about-change,\n {4}\.filing-form,\n {4}\.filing-secondary,\n {4}\.change-form,\n {4}\.file-changes-rest\n {2}\)\n {2}button\[aria-disabled="true"\]/,
    );
  });

  it("offers Move only once a control is chosen, and confirms Move and Take off alike", () => {
    // Move with no control chosen raised only the browser's own "Please select an item
    // in the list." bubble. The press waits (aria-disabled, CHOOSE_FIRST its
    // description) until a control is chosen, and a press then does nothing.
    const impact = read("src/evidence-impact.tsx");
    assert.match(impact, /form\?\.elements\.namedItem\("control_id"\)/);
    assert.match(impact, /const off = held \|\| !chosen;/);
    assert.match(
      impact,
      /onClick=\{\(event\) => \{\s*if \(off\) \{\s*event\.preventDefault\(\);/,
    );
    const library = read("src/evidence-view.tsx");
    assert.match(
      library,
      /<MoveSubmit label=\{file\.control === null \? "File" : "Move"\} \/>/,
    );
    assert.match(library, /<MoveSubmit\s+label="Take off this control"/);
    assert.match(library, /<MoveGuard action="move">/);
    assert.match(library, /<MoveGuard action="takeoff">/);
    assert.equal(CHOOSE_FIRST, "Choose a control first.");
    // Changed 18 November 2026 (E1 design review, round 5). Old: a first press said
    // "This is what the move does. Press it again to make it." (moveHint), hard to read
    // and to find. New: it opens a confirm block under the press (its title, the
    // preview, the press that makes it and Cancel); the two sentences are gone.
    assert.doesNotMatch(
      read("src/evidence-impact-model.ts"),
      /Press it again|Press Move/,
    );
    assert.equal(
      moveConfirmTitle("takeoff", "a.png", "ITGC-AC-01 · SAP", null),
      "Take a.png off ITGC-AC-01 · SAP",
    );
    assert.equal(
      moveConfirmTitle("move", "a.png", "ITGC-AC-01 · SAP", "ITGC-AC-02 · SAP"),
      "Move a.png to ITGC-AC-02 · SAP",
    );
    assert.match(impact, /!check\.intended\(action\) &&/);
    assert.match(impact, /check\.ask\(action, event\.target\);/);
    assert.match(
      impact,
      /className=\{action === "takeoff" \? "btn-danger btn-sm" : "btn-sm"\}/,
    );
  });

  it("names each item with its phase where a change resets or retests it", () => {
    // The preview listed "Population of accounts …" and "Evidence for each selected
    // grant" twice (the interim's and the roll-forward's) with nothing apart, and the
    // reset sentence named an item without its phase. The phase is the impact's own.
    assert.equal(
      impactItemName({ title: "Population of accounts", phase: "INTERIM" }),
      "Population of accounts (Interim)",
    );
    assert.equal(
      impactItemName({ title: "Population of accounts", phase: "ROLLFORWARD" }),
      "Population of accounts (Roll-forward)",
    );
    assert.equal(
      impactItemName({ title: "Access policy", phase: "DESIGN" }),
      "Access policy (Design)",
    );
    assert.equal(impactItemName({ title: "Other", phase: "" }), "Other");
    // Changed 18 November 2026 (round 5): the reset sentence counts the items, and the
    // list marks each whose decision returns (evidence-impact-model.test.ts).
    const impact = read("src/evidence-impact-model.ts");
    assert.match(impact, /impactItemName\(item\),/);
  });

  it("reads what holds a menu's actions each time it opens, never a kept answer", () => {
    // After an acceptance and a reopening made elsewhere, the wizard's Move menu kept a
    // held reason until the window was refreshed: it held from the window's own copy of
    // the items, and the lists' menus kept an answer for 15 seconds.
    const impact = read("src/evidence-impact.tsx");
    assert.doesNotMatch(impact, /FRESH_MS/);
    assert.match(
      impact,
      /\/\/ The last ask's answer only\.\s*if \(turns\.current\.get\(key\) === turn\)/,
    );
    const wizard = read("src/evidence-wizard.tsx");
    const menu = wizard.slice(
      wizard.indexOf("function MoveMenu("),
      wizard.indexOf("function Withdraw("),
    );
    assert.match(menu, /const impacts = useImpacts\(view\.ids\);/);
    assert.match(menu, /action: "UNLINK" as const,/);
    assert.match(menu, /impacts\.prefetch\(ask\);/);
    assert.doesNotMatch(menu, /item\.accepted/);
  });
});

describe("E1 design review, round 5 (18 November 2026)", () => {
  const read = (path: string) =>
    readFileSync(
      new URL(`../apps/web/${path}`, import.meta.url),
      "utf8",
    ).replace(/\r\n/g, "\n");
  const change = read("src/evidence-change.tsx");
  const css = read("app/globals.css");
  /** The body of every `@media (max-width: N)` block, joined. */
  const phone = (text: string, width: number) => {
    const opener = `@media (max-width: ${width}px) {`;
    const bodies: string[] = [];
    let from = text.indexOf(opener);
    while (from >= 0) {
      let depth = 0;
      let end = from + opener.length - 1;
      for (; end < text.length; end += 1) {
        if (text[end] === "{") depth += 1;
        if (text[end] === "}") {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      bodies.push(text.slice(from + opener.length, end));
      from = text.indexOf(opener, end);
    }
    return bodies.join("\n");
  };
  const rem = (selector: string) => {
    const at = css.indexOf(`${selector} {`);
    assert.ok(at >= 0, `no rule for ${selector}`);
    const width = /width: ([\d.]+)rem;/.exec(
      css.slice(at, css.indexOf("}", at)),
    );
    assert.ok(width !== null, `no width for ${selector}`);
    return Number(width[1]);
  };

  it("keeps one change form open in a list, owned by the list", () => {
    // Two change forms could be open at once (two items' forms, a card's and another's).
    assert.deepEqual(nextOpenForm(null, "a", "replace"), {
      owner: "a",
      value: "replace",
    });
    // Opening one takes the place of the other; closing closes only one's own.
    assert.deepEqual(nextOpenForm({ owner: "a", value: "x" }, "b", "y"), {
      owner: "b",
      value: "y",
    });
    assert.deepEqual(nextOpenForm({ owner: "a", value: "x" }, "b", null), {
      owner: "a",
      value: "x",
    });
    assert.equal(nextOpenForm({ owner: "a", value: "x" }, "a", null), null);
    // Every row and card that opens one uses the list's owner, never its own state.
    assert.match(change, /export function useChangeForm<T>\(\)/);
    const cards = change.slice(
      change.indexOf("export function FileCardActions("),
    );
    assert.match(cards, /useChangeForm<"replace" \| "withdraw">\(\)/);
    assert.match(
      change,
      /const \[open, setOpen\] = useChangeForm<string>\(\);/,
    );
    for (const path of [
      "src/design-evidence.tsx",
      "src/evidence-plan-view.tsx",
    ]) {
      const source = read(path);
      assert.match(
        source,
        /const \[fileForm, setFileForm\] = useChangeForm</,
        path,
      );
      assert.doesNotMatch(source, /fileForm, setFileForm\] = useState/, path);
    }
    assert.match(read("src/controls-view.tsx"), /<ChangeList>/);
  });

  it("stacks the Withdrawn list's rows under 640 px, so no column measures 0", () => {
    // At 390 px the fixed Control, Withdrawn and actions columns (36.5rem) left the File
    // and Why columns 0 wide. A fixed grid whose fixed columns are wider than a phone's
    // content box (about 22rem) stacks its rows there.
    const fixed =
      rem(".evidence-grid .col-control") +
      rem(".evidence-grid .col-added") +
      rem(".withdrawn-grid .col-restore");
    assert.ok(fixed > 22, "the fixed columns fit a phone: the rule is moot");
    const small = phone(css, 640);
    assert.match(
      small,
      /\.withdrawn-grid,\n {2}\.withdrawn-grid tbody,\n {2}\.withdrawn-grid tr,\n {2}\.withdrawn-grid td \{\n {4}display: block;/,
    );
    assert.match(
      small,
      /\.withdrawn-grid thead,\n {2}\.withdrawn-grid td\.col-control \{\n {4}display: none;/,
    );
    // "Withdrawn {date} by {name}" on one line, its label shown only there.
    assert.match(
      change,
      /<span className="withdrawn-label">Withdrawn <\/span>/,
    );
    assert.match(small, /\.withdrawn-label \{\n {4}display: inline;/);
    for (const cell of [
      "col-file",
      "col-control",
      "col-why",
      "col-added",
      "col-restore",
    ]) {
      assert.match(change, new RegExp(`<td className="${cell}">`), cell);
    }
  });

  it("opens a long reason in full under its row, two lines on the row", () => {
    assert.match(
      css,
      /\.withdrawn-grid \.withdrawn-why \{[^}]*-webkit-line-clamp: 2;/,
    );
    assert.match(change, /aria-expanded=\{open\}\s+aria-controls=\{controls\}/);
    assert.match(change, /\{open \? "Hide reason" : "Show reason"\}/);
    assert.match(change, /element\.scrollHeight > element\.clientHeight \+ 1/);
    // Changed (E1 design review): the reason opens in full in its own cell, unclamped,
    // never again in a row under it (it showed twice).
    assert.match(
      change,
      /className=\{open \? "withdrawn-why is-open" : "withdrawn-why"\}\s+id=\{controls\}/,
    );
    assert.doesNotMatch(change, /withdrawn-why-full/);
    assert.match(
      read("app/globals.css"),
      /\.withdrawn-grid \.withdrawn-why\.is-open \{\n {2}display: block;\n {2}-webkit-line-clamp: unset;/,
    );
  });

  it("says a restored row's new state, and counts it, while the person is there", () => {
    assert.equal(
      restoredLine("ITGC-AC-01 · SAP ERP"),
      "Restored just now · back on ITGC-AC-01 · SAP ERP",
    );
    assert.equal(restoredLine(null), "Restored just now");
    assert.equal(withdrawnCountLine(0, 1), "0 withdrawn · 1 restored just now");
    assert.equal(withdrawnCountLine(3, 0), "3 withdrawn");
    assert.match(change, /\{restoredLine\(row\.control\)\}/);
    const library = read("src/evidence-view.tsx");
    assert.match(
      library,
      /<WithdrawnCount ids=\{withdrawn\.map\(\(file\) => file\.id\)\} \/>/,
    );
    assert.match(library, /<WithdrawnScope>/);
    // A row the person acts on stays while the page is read again, so a refusal (the
    // file was restored meanwhile) stays on its row and takes the focus.
    assert.match(
      change,
      /const keptOpen =\s+open !== null && pinned !== null && pinned\.row\.id === open/,
    );
    assert.match(
      change,
      /!rows\.some\(\(row\) => row\.id === keptOpen\.row\.id\)/,
    );
    // The filtered empty queue: one line.
    assert.equal(
      noWithdrawnMatch(" users "),
      "No withdrawn file matches ‘users’.",
    );
    assert.match(
      library,
      /<p className="withdrawn-none">\{noWithdrawnMatch\(query\)\}<\/p>/,
    );
  });

  it("holds the Library's Replace, Withdraw, Move and Take off as the menus do", () => {
    // The panel offered Replace and Withdraw that the menu and the viewer held.
    assert.match(
      change,
      /const replaceCheck = useImpact\(ids, atRest\("REPLACE"\), attempt\);/,
    );
    assert.match(
      change,
      /const withdrawCheck = useImpact\(ids, atRest\("WITHDRAW"\), attempt\);/,
    );
    assert.match(change, /const reasons = heldReasons\(presses\);/);
    assert.match(
      change,
      /\{\.\.\.heldControl\(presses\[0\]\?\.unavailable != null, said\(0\)\)\}/,
    );
    assert.equal(moveHeldLine(true), "It cannot be moved or taken off now.");
    assert.equal(moveHeldLine(false), "It cannot be moved now.");
    assert.match(
      read("src/evidence-view.tsx"),
      /takeOff=\{file\.filingVersion !== null\}/,
    );
  });

  it("names the held actions once, under a divider, in a menu wide enough", () => {
    assert.equal(
      heldNames([
        { label: "Replace file" },
        { label: "Remove from this request" },
      ]),
      "Replace and remove",
    );
    // Changed 19 November 2026 (E1 design review, round 6). Old: each item named by its
    // label's first word, so the wizard's "Not D&I evidence: keep in the control's
    // files" read "Not and withdraw are held". New: an item's short action name where it
    // has one (actionName), each name once.
    assert.equal(
      heldNames([
        { label: "Move to X", action: "move" },
        { label: "Move to Y", action: "move" },
        { label: "Not D&I evidence: keep", action: "keep out of D&I" },
        { label: "Withdraw from the engagement…", action: "withdraw" },
      ]),
      "Move, keep out of D&I and withdraw",
    );
    assert.equal(actionName({ label: "Not D&I evidence: keep" }), "not");
    assert.equal(
      actionName({
        label: "Not D&I evidence: keep",
        action: "keep out of D&I",
      }),
      "keep out of D&I",
    );
    const wizard = read("src/evidence-wizard.tsx");
    for (const name of ['"move"', '"keep out of D&I"', '"withdraw"']) {
      assert.match(wizard, new RegExp(`action: ${name},`), name);
    }
    const reason =
      "The evidence item was accepted with it; change that decision first.";
    assert.deepEqual(
      heldReasons([
        { label: "Replace file", unavailable: reason },
        { label: "Remove from this request", unavailable: reason },
      ]),
      [
        null,
        `Replace and remove are held: the evidence item was accepted with it; change that decision first.`,
      ],
    );
    assert.deepEqual(
      sharedReason([{ unavailable: reason }, { unavailable: reason }]),
      [false, true],
    );
    const menu = read("src/row-menu.tsx");
    assert.match(menu, /className="row-menu-held"/);
    assert.match(menu, /reasons\[index\] !== null && !shared\[index\]/);
    assert.match(
      css,
      /\.row-menu-held \{[^}]*border-top: 1px solid var\(--border\);/,
    );
    assert.match(css, /\.row-menu-list\.has-held \{\n {2}min-width: 18rem;/);
    assert.match(css, /\.row-menu-list \{[^}]*min-width: 16.5rem;/);
    // One icon rule: every item has its icon, or none shows.
    assert.equal(menuIcons([{ icon: "upload" }, {}]), false);
    assert.equal(menuIcons([{ icon: "upload" }, { icon: "trash" }]), true);
    assert.match(menu, /\{icons && item\.icon \? \(/);
    assert.match(change, /label: "Download",\s+icon: "arrowDown" as const,/);
  });

  it("offers each change's press only once it can be sent, saying why it waits", () => {
    assert.equal(reasonReady("", false), true);
    assert.equal(reasonReady("ab", false), false);
    assert.equal(reasonReady("", true), false);
    assert.equal(reasonReady("Wrong control", true), true);
    assert.match(change, /\(mode === "replace" && picked === null\)/);
    assert.match(change, /\{CHOOSE_FILE_FIRST\}/);
    assert.equal(CHOOSE_FILE_FIRST, "Choose the corrected file first.");
    assert.ok(
      (change.match(/\{\.\.\.heldControl\(off, offWhy\)\}/g) ?? []).length >= 3,
    );
    // What a change does, not read: an amber notice with Check again, never a grey
    // hint to refresh the page; a removal that cannot be sent shows no Why and no press.
    const impact = read("src/evidence-impact.tsx");
    // Round 6: the notice also takes the focus after Check again (data-focus-return).
    assert.match(impact, /<div\s+className="ip-unchecked"\s+role="status"/);
    assert.match(impact, /Check again/);
    assert.doesNotMatch(change, /Refresh the page and try again/);
    assert.match(change, /\{unchecked \? null : \(\s*<ReasonField/);
    assert.match(css, /\.ip-held,\n\.ip-unchecked \{\n {2}padding/);
  });

  it("says each sentence the review asked for, exactly", () => {
    assert.match(
      change,
      /The new file replaces this one on its control, request and samples,\s+and the agent reads it again\. This file is kept under Withdrawn\./,
    );
    assert.match(
      change,
      /The file is removed from this request only\. It stays on its control\s+and on any other request it serves, and is not withdrawn\./,
    );
    assert.equal(
      filingWhy({ filedBy: "PERSON", matchReason: "Placed by a person." }),
      "",
    );
    assert.equal(
      filingWhy({ filedBy: "AGENT", matchReason: "Matched by name." }),
      "Matched by name.",
    );
    assert.equal(
      resetLine(2),
      "2 evidence item decisions return to Not reviewed.",
    );
    assert.equal(
      resetLine(1),
      "1 evidence item decision returns to Not reviewed.",
    );
    assert.equal(resetLine(0), null);
    assert.equal(reopenedPrefix("Reopened for the design review.", false), "");
    assert.equal(
      reopenedPrefix("Needs the approver.", false),
      "Decision reopened: ",
    );
    assert.equal(
      reviewFeedback(
        "The agent could not review this screenshot: No model is configured, so screenshots are not reviewed by the agent. A person reviews it.",
      ),
      "Screenshots are reviewed by a person.",
    );
    assert.equal(followUpPoints(0), "");
    assert.equal(followUpPoints(2), " · 2 follow-up points");
  });

  it("draws the impact's list with the product chevron and its marks", () => {
    const impact = read("src/evidence-impact.tsx");
    assert.match(impact, /<summary>\s*<UiIcon name="chevron" size=\{13\} \/>/);
    assert.match(
      css,
      /\.ip-used > summary::-webkit-details-marker \{\n {2}display: none;/,
    );
    assert.match(
      css,
      /\.ip-used\[open\] > summary > svg \{\n {2}transform: rotate\(90deg\);/,
    );
    assert.equal(RETURNS_TO_NOT_REVIEWED, "returns to Not reviewed");
  });

  it("keeps the card's menu beside Preview, and the Library's controls even", () => {
    assert.match(
      css,
      /\.evidence-file-item > \.evidence-file-tools:not\(\.is-open\) \{\n {2}position: absolute;/,
    );
    assert.match(
      css,
      /\.filing-form select,\n\.filing-form button \{\n {2}height: 32px;/,
    );
    assert.equal(
      sameSystem({
        applicationScope: "ONE",
        application: { id: "a", name: "SAP ERP" },
        control: {
          id: "c",
          controlRef: "ITGC-AC-01",
          title: "",
          application: "SAP ERP",
        },
      } as unknown as Parameters<typeof sameSystem>[0]),
      true,
    );
    const library = read("src/evidence-view.tsx");
    assert.match(
      library,
      /applicationLabel\(file\) !== "" && !sameSystem\(file\)/,
    );
    // The withdrawal's banner: success, naming the file from the server's own list.
    assert.match(
      library,
      /workflow\.changeNotice === "withdrawn"\s+\? "success"/,
    );
    assert.match(library, /\? withdrawnMessage\(withdrewName\)/);
    assert.match(css, /\.withdrawn-actions \.btn\[aria-expanded="true"\] \{/);
  });

  it("holds the dialog's withdraw while the file is read, and says reading once", () => {
    const dialog = read("src/evidence-dialog.tsx");
    assert.match(
      dialog,
      /\{\.\.\.heldControl\(reading, `\$\{uid\}-reading`\)\}/,
    );
    assert.match(dialog, /\{STILL_READING\}/);
    assert.equal(STILL_READING_FILE, "The agent is still reading this file.");
    assert.doesNotMatch(dialog, /: "Being read"\}/);
    assert.doesNotMatch(dialog, /The agent is reading the document/);
    assert.doesNotMatch(
      read("src/evidence-dialog-model.ts"),
      /The agent is reading the file/,
    );
    // The file's history: who, on its own line.
    const history = read("src/evidence-history.tsx");
    assert.match(
      history,
      /<small className="ea-history-by">by \{line\.by\}<\/small>/,
    );
    assert.doesNotMatch(history, /` by \$\{line\.by\}`/);
  });

  it("tells one story on the D&I Evidence step", () => {
    const list = read("src/design-evidence.tsx");
    assert.match(
      list,
      /row\.reading === 0 &&\s+row\.letters\.length > 0 \? \(/,
    );
    assert.match(
      list,
      /againReading && again !== null && again\.fileIds\.length > 0/,
    );
    assert.doesNotMatch(
      read("src/design-evidence-model.ts"),
      /Agent is reading|The agent is reading \$/,
    );
    assert.doesNotMatch(
      read("src/evidence-wizard-model.ts"),
      /`Analyzing \$\{plural/,
    );
    const facts = read("app/design-evidence.css");
    assert.match(
      facts,
      /\.de-body \.tc\.is-flat \.tc-rules \{\n {2}grid-template-columns: max-content minmax\(0, 1fr\);/,
    );
  });

  it("gives focus to the answer after a card's withdrawal, a viewer's removal and Take off", () => {
    // Focus fell to the body: the card went with its confirmation, the viewer closed
    // with the form, and the page came back with its notice after Take off.
    assert.match(FOCUS_ANSWERS, /\.banner\[role="status"\]/);
    const hook = read("src/use-focus-return.ts");
    assert.match(hook, /return fresh\(document\);/);
    assert.match(hook, /\.at\(-1\) \?\? null/);
    assert.match(
      change,
      /\/\/ The page's notice, once it is back, takes the focus\.\s+focus\.returnFocus\("answer"\);\s+router\.replace\(location/,
    );
    assert.match(
      change,
      /onDone: \(message: string\) => \{\s+setForm\(null\);\s+say\(message\);/,
    );
  });
});

describe("E1 design review, round 6 (19 November 2026)", () => {
  const read = (path: string) =>
    readFileSync(
      new URL(`../apps/web/${path}`, import.meta.url),
      "utf8",
    ).replace(/\r\n/g, "\n");

  it("routes every confirmation or notice that replaces a control through the one focus mechanism", () => {
    // Focus fell to the body after a viewer's confirmed removal, a wizard's confirmed
    // withdrawal, a Library withdrawal (its banner), Check again, the Controls page's Try
    // again, and the plan's Remove and Undo: some did not use the mechanism, and the
    // mechanism missed a confirmation line the page reuses (only its words change) and
    // a first answer the page then takes away.
    const hook = read("src/use-focus-return.ts");
    assert.match(hook, /before\.get\(each\) !== \(each\.textContent \?\? ""\)/);
    assert.match(hook, /placed = target;/);
    assert.match(FOCUS_ANSWERS, /\.ta-done\[role="status"\]/);
    const impact = read("src/evidence-impact.tsx");
    assert.match(impact, /focus\.returnFocus\("answer"\);\s*onRetry\(\);/);
    assert.match(impact, /<div className="ip-impact" data-focus-return="">/);
    const controls = read("src/controls-page.tsx");
    assert.match(controls, /focus\.returnFocus\("answer"\);\s*retry\(\);/);
    assert.match(controls, /<ul className="cpg-list" data-focus-return="">/);
    const planning = read("src/planning-view.tsx");
    const removal = planning.slice(
      planning.indexOf("function useEvidenceRemoval("),
      planning.indexOf("type EvidenceRemoval ="),
    );
    assert.equal(removal.match(/focus\.returnFocus\("answer"\);/g)?.length, 2);
    assert.match(
      planning,
      /<p className="pe-removed" role="status" data-focus-return="">/,
    );
    assert.match(
      planning,
      /data-focus-return=\{\s*removal\.restored === row\.id \? "" : undefined\s*\}/,
    );
    // A busy press is never switched off under the person (it would drop the focus).
    assert.doesNotMatch(planning, /disabled=\{removal\.action\.pending\}/);
  });

  it("keeps a reference whole where a sentence names it", () => {
    assert.deepEqual(
      refParts("Restored just now · back on ITGC-AC-01 · SAP ERP"),
      ["Restored just now · back on ", { ref: "ITGC-AC-01" }, " · SAP ERP"],
    );
    assert.deepEqual(refParts("No reference here."), ["No reference here."]);
    assert.deepEqual(refParts("NS-AC-06 and ITGC-AC-01"), [
      { ref: "NS-AC-06" },
      " and ",
      { ref: "ITGC-AC-01" },
    ]);
    assert.match(
      read("app/globals.css"),
      /\.ref-token \{\n {2}white-space: nowrap;\n\}/,
    );
    assert.match(
      read("src/evidence-change.tsx"),
      /<RefText text=\{restoredLine\(row\.control\)\} \/>/,
    );
    const impact = read("src/evidence-impact.tsx");
    assert.ok((impact.match(/<RefText text=/g) ?? []).length >= 5);
    assert.match(
      read("src/row-menu.tsx"),
      /<RefText text=\{reasons\[index\] \?\? ""\} \/>/,
    );
  });

  it("asks to remove an attribute on its own row, and gives that the focus", () => {
    const planning = read("src/planning-view.tsx");
    assert.doesNotMatch(
      planning,
      /<p className="pe-removed" role="alertdialog">/,
    );
    assert.match(
      planning,
      /\{removing === row\.id \? \([\s\S]{0,400}<RowExtra columns=\{8\} className="pp-detail">\s*<RemoveAttributeConfirm/,
    );
    const confirm = planning.slice(
      planning.indexOf("function RemoveAttributeConfirm("),
    );
    assert.match(confirm, /useEffect\(\(\) => \{\s*box\.current\?\.focus\(\);/);
    assert.match(confirm, /role="alertdialog"/);
    assert.match(confirm, /focus\.returnFocus\("back"\);\s*onCancel\(\);/);
  });
});

describe("E1 design review, round 7 (19 November 2026)", () => {
  it("keeps focus on a menu's button when a choice runs, in every menu", () => {
    // Cancel or Escape on the Planning attribute's removal confirm sent focus to the
    // table: the plan's menu closed without moving focus to its button, so the opener
    // the confirm remembered was the chosen item, gone with the menu. Every menu whose
    // item runs an action keeps focus on its button first (RowMenu does since round 4).
    const src = new URL("../apps/web/src/", import.meta.url);
    let menus = 0;
    for (const name of readdirSync(src).filter((each) =>
      each.endsWith(".tsx"),
    )) {
      const text = readFileSync(new URL(name, src), "utf8").replace(
        /\r\n/g,
        "\n",
      );
      for (const match of text.matchAll(
        /role="menuitem"[\s\S]{0,700}?onClick=\{\(\) => \{([\s\S]{0,500}?)\n\s*\}\}/g,
      )) {
        const body = match[1] ?? "";
        if (!/setOpen\(false\)/.test(body)) {
          continue;
        }
        menus += 1;
        assert.match(
          body,
          /\.current\?\.focus\(\);/,
          `${name}: a menu choice closes the menu without giving focus to its button`,
        );
      }
    }
    assert.ok(menus >= 2, "the menus were not found");
  });
});

describe("E1 design review, round 8 (19 November 2026)", () => {
  it("gives focus back after Cancel, Escape or Close on every in-row form, through the one keeper", () => {
    // Cancel on Planning's "Edit wording" left focus on the page's body: in-row forms on
    // many screens drop the focused control with the form, and only a few said where
    // focus goes. One focus keeper for the page (use-focus-return.ts, mounted in the
    // app's layout) gives it back to the control that opened the form, or that control
    // drawn again; a form that says where focus goes itself (returnFocus) is left to.
    const button = { name: "More for attribute 3" };
    const twin = { name: "the same button drawn again" };
    const href = "/?section=planning";
    const entry = (
      element: { name: string },
      usable: boolean,
      at = href,
      again: { name: string } | null = null,
    ) => ({ element, usable, twin: again, href: at });
    // The menu's button, a field of the form, its Cancel (gone with the form).
    assert.equal(
      keeperTarget(
        [
          entry(button, true),
          entry({ name: "textarea" }, false),
          entry({ name: "Cancel" }, false),
        ],
        href,
      ),
      button,
    );
    // The opener drawn anew: its twin.
    assert.equal(
      keeperTarget(
        [entry(button, false, href, twin), entry({ name: "Cancel" }, false)],
        href,
      ),
      twin,
    );
    // The person clicked elsewhere (the control is still there), or the page changed.
    assert.equal(
      keeperTarget(
        [entry(button, true), entry({ name: "Cancel" }, true)],
        href,
      ),
      null,
    );
    assert.equal(
      keeperTarget(
        [
          entry(button, true, "/other"),
          entry({ name: "Cancel" }, false, "/other"),
        ],
        href,
      ),
      null,
    );
    const hook = readFileSync(
      new URL("../apps/web/src/use-focus-return.ts", import.meta.url),
      "utf8",
    ).replace(/\r\n/g, "\n");
    assert.match(hook, /export function FocusKeeper\(\): null \{/);
    assert.match(
      hook,
      /observer\.observe\(document\.body, \{\s*childList: true,\s*subtree: true,/,
    );
    assert.match(
      hook,
      /if \(returning > 0 \|\| !focusLost\(document\.activeElement, document\.body\)\)/,
    );
    const layout = readFileSync(
      new URL("../apps/web/app/layout.tsx", import.meta.url),
      "utf8",
    );
    assert.match(
      layout,
      /import \{ FocusKeeper \} from "\.\.\/src\/use-focus-return";/,
    );
    assert.match(layout, /<FocusKeeper \/>/);
    // Every in-row form's Cancel routes through it: none takes focus away itself.
    const src = new URL("../apps/web/src/", import.meta.url);
    let cancels = 0;
    for (const name of readdirSync(src).filter((each) =>
      each.endsWith(".tsx"),
    )) {
      const text = readFileSync(new URL(name, src), "utf8").replace(
        /\r\n/g,
        "\n",
      );
      const found = text.match(/>\s*Cancel\s*</g)?.length ?? 0;
      cancels += found + (text.match(/\bonCancel=\{/g)?.length ?? 0);
      if (found > 0 || /\bonCancel=\{/.test(text)) {
        assert.doesNotMatch(
          text,
          /\.blur\(\)/,
          `${name}: a form takes the focus away`,
        );
      }
    }
    assert.ok(cancels > 40, `the scan found only ${cancels} Cancel buttons`);
  });
});

describe("E1 design review: the nine blocking items (19 November 2026)", () => {
  const read = (path: string) =>
    readFileSync(
      new URL(`../apps/web/${path}`, import.meta.url),
      "utf8",
    ).replace(/\r\n/g, "\n");
  const appDir = new URL("../apps/web/app/", import.meta.url);
  const allCss = readdirSync(appDir)
    .filter((name) => name.endsWith(".css"))
    .map(
      (name) =>
        [name, read(`app/${name}`).replace(/\/\*[\s\S]*?\*\//g, "")] as const,
    );

  it("1: no rule takes the focus ring from a held (aria-disabled) button", () => {
    for (const [name, text] of allCss) {
      for (const match of text.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
        const selector = match[1] ?? "";
        const body = match[2] ?? "";
        if (
          !/aria-disabled="true"\]/.test(selector) ||
          !/box-shadow: none/.test(body)
        ) {
          continue;
        }
        for (const part of selector.split(/,(?![^(]*\))/)) {
          if (/aria-disabled="true"\]/.test(part)) {
            assert.match(
              part,
              /:not\(:focus-visible\)/,
              `${name}: "${part.trim()}" removes the focus ring of a held button`,
            );
          }
        }
      }
    }
  });

  it("2: the Library panel's held presses and its control to choose look held", () => {
    assert.match(
      read("app/globals.css"),
      /\.file-changes-rest\n {2}\)\n {2}button\[aria-disabled="true"\],/,
    );
    const impact = read("src/evidence-impact.tsx");
    assert.match(impact, /field\.setAttribute\("aria-disabled", "true"\);/);
    assert.match(
      read("app/globals.css"),
      /\.filing-form select\[aria-disabled="true"\] \{/,
    );
  });

  it("3: the Add evidence dialog's held bin looks held, also on hover", () => {
    const dialog = read("app/evidence-dialog.css");
    assert.match(
      dialog,
      /\.ed-file-remove\[aria-disabled="true"\] \{\n {2}cursor: not-allowed;\n {2}opacity: 0\.5;/,
    );
    assert.match(
      dialog,
      /\.ed-file-remove\[aria-disabled="true"\]:hover \{\n {2}color: var\(--text-secondary\);/,
    );
    assert.match(
      dialog,
      /\.ed-file-remove:hover:not\(\[aria-disabled="true"\]\) \{/,
    );
  });

  it("5: the wizard's card and Move menu take an item's acceptance from the same record", () => {
    // Traced: the Move menu's hold was right (the item was accepted through the server,
    // outside the window); the card kept the window's own, older copy.
    const wizard = read("src/evidence-wizard.tsx");
    // The page's own read of the items resets the window's acceptances: keyed on what the
    // read says (the list itself is new on every render, which looped), and kept as it is
    // when nothing was accepted here.
    assert.match(
      wizard,
      /const itemsRead = setup\.items\s*\.map\(\(item\) => `\$\{item\.requirementId\}:\$\{item\.accepted \? 1 : 0\}`\)\s*\.join\("\|"\);/,
    );
    assert.match(
      wizard,
      /useEffect\(\(\) => \{[^}]*setAccepted\(\(now\) => \(now\.size === 0 \? now : new Set\(\)\)\);\s*\}, \[itemsRead\]\);/,
    );
    assert.match(
      wizard,
      /entry\.kind === "ACCEPTED_ITEM" &&\s*entry\.requirementId === ask\.requirementId/,
    );
    assert.match(wizard, /resync: \(\) => router\.refresh\(\),/);
  });

  it("6: an upload with no file left says so, with no clock and no note to accept", () => {
    const empty = {
      files: 0,
      secured: 0,
      notAdded: 0,
      read: 0,
      sorted: 0,
      needs: 0,
      notDesign: 0,
      placed: 0,
    } as unknown as Parameters<typeof resultsNote>[0];
    assert.equal(resultsNote(empty), "");
    assert.equal(analyzedLine(48, empty), "");
    assert.equal(
      resultsSummary(null, [], empty, 1).lead,
      "No files left in this upload · 1 withdrawn",
    );
    assert.equal(
      resultsSummary(null, [], empty, 0).lead,
      "No file has been added yet.",
    );
  });

  it("7: one editor on a Planning attribute row, owned with every other form", () => {
    const planning = read("src/planning-view.tsx");
    assert.match(
      planning,
      /const \[rowEditor, setRowEditor\] = useChangeForm<\{\s*id: string;\s*kind: "wording" \| "criteria";\s*\}>\(\);/,
    );
    assert.doesNotMatch(
      planning,
      /const \[editing, setEditing\] = useState<Set<string>>/,
    );
    // Round 9: not drawn at all while the row has an editor open (the `hidden` attribute
    // lost to the list's own display).
    assert.match(
      planning,
      /\{editing \|\| quiet \? null : \(\s*<dl className="pl-criteria">/,
    );
    assert.match(planning, /quiet=\{rowEditor\?\.id === row\.id\}/);
  });

  it("8: the status card and the row's pills name the testing branch", () => {
    const row = {
      step: "PLAN",
      testing: "IN_PROGRESS",
      plan: "PENDING",
    } as Parameters<typeof rowPills>[0];
    assert.equal(testingSubject(row), "D&I testing");
    assert.deepEqual(rowPills(row), {
      plan: "Plan to approve",
      testing: "D&I testing in progress",
    });
    assert.equal(
      testingSubject({ step: "TEST", testing: "IN_PROGRESS" } as Parameters<
        typeof testingSubject
      >[0]),
      "Testing",
    );
    assert.deepEqual(
      rowPills({
        step: "DONE",
        testing: "COMPLETED",
        plan: "APPROVED",
      } as Parameters<typeof rowPills>[0]),
      { plan: "Plan approved", testing: "Testing completed" },
    );
  });

  it("9: an open row's detail holds the one next action; Out of scope is said once", () => {
    const controls = read("src/controls-page.tsx");
    assert.match(
      controls,
      /<td className=\{isOpen \? "cpg-next-cell is-covered" : "cpg-next-cell"\}>/,
    );
    assert.match(
      read("app/controls-page.css"),
      // Round 9: the cell itself too, not only what it holds.
      /\.cpg-next-cell\.is-covered,\n\.cpg-next-cell\.is-covered \* \{\n {2}visibility: hidden;/,
    );
    assert.doesNotMatch(controls, /<strong>Out of scope<\/strong>/);
  });
});

describe("no inline callback ref sets state (19 November 2026)", () => {
  // The upload wizard crashed with "Maximum update depth exceeded": its dialog's ref was
  // an inline arrow that called setBox. An inline callback is a new function on every
  // render, so React detaches it (null) and attaches the new one each time, and a state
  // update inside loops without end. A ref that sets state must be stable (useCallback).
  it("finds no ref={(…) => …} whose body calls a state setter, in any component", () => {
    const dir = new URL("../apps/web/src/", import.meta.url);
    const offenders: string[] = [];
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".tsx")) continue;
      const text = readFileSync(new URL(name, dir), "utf8").replace(
        /\r\n/g,
        "\n",
      );
      const inline = /ref=\{\s*\(([^)]*)\)\s*=>\s*\{([\s\S]*?)\n\s*\}\s*\}/g;
      for (const match of text.matchAll(inline)) {
        if (/\bset[A-Z]\w*\(/.test(match[2] ?? "")) offenders.push(name);
      }
    }
    assert.deepEqual(offenders, []);
  });
});

/** The index just past the bracket that closes the one at `open` (strings and comments
 * skipped), or -1. */
function closing(text: string, open: number): number {
  const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  let depth = 0;
  for (let at = open; at < text.length; at += 1) {
    const ch = text[at] ?? "";
    if (ch === "/" && text[at + 1] === "/") {
      at = text.indexOf("\n", at);
      if (at === -1) return -1;
    } else if (ch === "/" && text[at + 1] === "*") {
      at = text.indexOf("*/", at) + 1;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      for (at += 1; at < text.length && text[at] !== ch; at += 1) {
        if (text[at] === "\\") at += 1;
      }
    } else if (pairs[ch] !== undefined) {
      depth += 1;
    } else if (ch === ")" || ch === "]" || ch === "}") {
      depth -= 1;
      if (depth === 0) return at + 1;
    }
  }
  return -1;
}

/**
 * Effects that set state to a fresh value (a new Set or Map, an array or object literal)
 * on every run: outside any nested function, outside any block, with no early return
 * before it. Such an effect keyed on a value the caller rebuilds each render sets a new
 * value each time, so each render schedules the next: "Maximum update depth exceeded".
 * A functional update that keeps the current value when nothing changed is the fix.
 */
function freshStateEffects(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/\buse(?:Layout)?Effect\(/g)) {
    const start = match.index + match[0].length - 1;
    const end = closing(text, start);
    if (end === -1) continue;
    const call = text.slice(start + 1, end - 1);
    const arrow = /^\s*\(\s*\)\s*=>\s*/.exec(call);
    if (arrow === null) continue;
    const from = arrow[0].length;
    let body: string;
    if (call[from] === "{") {
      body = call.slice(from + 1, closing(call, from) - 1);
    } else {
      // An expression body: up to the dependency list.
      const deps = call.search(/,\s*\[[^\]]*\]\s*,?\s*$/);
      body = call.slice(from, deps === -1 ? undefined : deps);
    }
    // Nested functions run later, not as the effect runs: their bodies are left out.
    for (;;) {
      const nested = body.search(/=>\s*\{|function\s*\w*\s*\([^)]*\)\s*\{/);
      if (nested === -1) break;
      const brace = body.indexOf("{", nested);
      body = `${body.slice(0, nested)} fn ${body.slice(closing(body, brace))}`;
    }
    body = body.replace(/=>\s*[^,;{}]+/g, " fn ");
    for (const set of body.matchAll(
      /\bset[A-Z]\w*\(\s*(?:new (?:Set|Map)\b|\[|\{)/g,
    )) {
      const before = body.slice(0, set.index);
      const depth =
        (before.match(/\{/g)?.length ?? 0) - (before.match(/\}/g)?.length ?? 0);
      if (depth === 0 && !/\breturn\b/.test(before)) {
        const line = text.slice(0, match.index).split("\n").length;
        found.push(`${line}: ${set[0]}`);
      }
    }
  }
  return found;
}

describe("no effect sets a fresh value on every run (19 November 2026)", () => {
  // The control page looped ("Maximum update depth exceeded. This can happen when a
  // component calls setState inside useEffect"): the upload wizard's
  // `useEffect(() => setAccepted(new Set()), [setup.items])` ran on every render, since
  // the caller builds the items anew each time, and each new Set scheduled the next.
  it("recognises the effect that looped, and the fixed one", () => {
    assert.deepEqual(
      freshStateEffects(
        "useEffect(() => setAccepted(new Set()), [setup.items]);\n",
      ),
      ["1: setAccepted(new Set"],
    );
    assert.deepEqual(
      freshStateEffects(
        "useEffect(() => {\n  setAccepted((now) => (now.size === 0 ? now : new Set()));\n}, [itemsRead]);\n",
      ),
      [],
    );
    // Guarded, or in a callback that runs later: not every run.
    assert.deepEqual(
      freshStateEffects(
        "useEffect(() => {\n  if (!open) {\n    setItems([]);\n    return;\n  }\n  setMore({ a: 1 });\n  const timer = setTimeout(() => setLate([]), 9);\n}, [open]);\n",
      ),
      [],
    );
  });

  it("finds none in any component or hook", () => {
    const dir = new URL("../apps/web/src/", import.meta.url);
    const offenders: string[] = [];
    for (const name of readdirSync(dir)) {
      if (!/\.tsx?$/.test(name)) continue;
      const text = readFileSync(new URL(name, dir), "utf8").replace(
        /\r\n/g,
        "\n",
      );
      for (const hit of freshStateEffects(text))
        offenders.push(`${name}:${hit}`);
    }
    assert.deepEqual(offenders, []);
  });
});

describe("E1 design review, round 9 (19 November 2026)", () => {
  const read = (path: string) =>
    readFileSync(
      new URL(`../apps/web/${path}`, import.meta.url),
      "utf8",
    ).replace(/\r\n/g, "\n");

  it("closes any in-row form on Escape, from any field of it, through one handler", () => {
    // Escape with focus in a field closed none of them (Planning wording, criteria,
    // procedure and evidence forms, D&I Replace and Remove).
    assert.equal(closesForm("Cancel"), true);
    assert.equal(closesForm(" Close "), true);
    assert.equal(closesForm("Cancel request"), false);
    for (const where of [
      "form",
      '[role="alertdialog"]',
      ".pl-edit",
      ".change-form",
      ".move-confirm",
    ]) {
      assert.ok(ESCAPE_FORMS.split(", ").includes(where), where);
    }
    const hook = read("src/use-focus-return.ts");
    assert.match(
      hook,
      /document\.addEventListener\("keydown", onEscape, true\);/,
    );
    assert.match(
      hook,
      /const cancel = escapeTarget\(active\);\s*if \(cancel !== null\) \{\s*event\.preventDefault\(\);\s*event\.stopPropagation\(\);\s*cancel\.click\(\);/,
    );
    // A menu or a list closes itself; an open dialog's own Escape is never taken.
    assert.match(
      hook,
      /active\.closest\('\[role="menu"\], \[role="listbox"\]'\) !== null/,
    );
    assert.match(
      hook,
      /if \(node\.matches\('\[role="dialog"\], dialog'\)\) \{\s*return null;/,
    );
  });

  it("closes the Controls row detail on Escape and gives focus back to its chevron", () => {
    const controls = read("src/controls-page.tsx");
    assert.match(controls, /id=\{`cpg-open-\$\{item\.id\}`\}/);
    assert.match(
      controls,
      /document\.getElementById\(`cpg-open-\$\{item\.id\}`\)\?\.focus\(\)/,
    );
    assert.match(
      controls,
      /if \(event\.key === "Escape" && !event\.defaultPrevented\) \{\s*event\.stopPropagation\(\);\s*onClose\(\);/,
    );
  });

  it("draws the focus ring at once, and no rule takes a held button's outline", () => {
    const css = read("app/globals.css");
    assert.match(
      css,
      /button:focus-visible:not\(:disabled\),\n\.btn:focus-visible:not\(:disabled\) \{\n {2}outline: 0;\n {2}box-shadow: var\(--ring\);\n[\s\S]{0,200}transition-property: background, border-color, color;/,
    );
    const app = new URL("../apps/web/app/", import.meta.url);
    for (const name of readdirSync(app).filter((each) =>
      each.endsWith(".css"),
    )) {
      const text = read(`app/${name}`).replace(/\/\*[\s\S]*?\*\//g, "");
      for (const match of text.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
        const selector = match[1] ?? "";
        if (!/outline: (none|0)\b/.test(match[2] ?? "")) {
          continue;
        }
        for (const part of selector.split(/,(?![^(]*\))/)) {
          if (/aria-disabled="true"\]/.test(part)) {
            assert.match(
              part,
              /:not\(:focus-visible\)/,
              `${name}: "${part.trim()}"`,
            );
          }
        }
      }
    }
  });

  it("says an analysis's time as a duration, from its own run only", () => {
    assert.equal(formatDuration(48), "48 s");
    assert.equal(formatDuration(125), "2 min 5 s");
    assert.equal(formatDuration(120), "2 min");
    assert.equal(formatDuration(3840), "1 h 4 min");
    // A check run again long after the session's last reading is not its analysis: it
    // made a 44-second session read "Analyzed in 11:44:30".
    const at = (minutes: number) =>
      new Date(Date.UTC(2026, 10, 19, 8, minutes)).toISOString();
    const batch = {
      files: [{ read: { finishedAt: Date.parse(at(1)) } }],
      items: [
        { check: { finishedAt: at(2) } },
        { check: { finishedAt: at(1 + 16 * 60) } },
      ],
    } as unknown as Parameters<typeof finishedAt>[0];
    assert.equal(finishedAt(batch), Date.parse(at(2)));
  });

  it("keeps focus in the guide's card across its steps, and the keeper inside an open layer", () => {
    const tour = read("src/spotlight-tour.tsx");
    assert.match(
      tour,
      /\(active instanceof HTMLButtonElement && active\.disabled\)\s*\) \{\s*card\.current\?\.focus\(\{ preventScroll: true \}\);/,
    );
    assert.match(tour, /\}, \[open, index\]\);/);
    const hook = read("src/use-focus-return.ts");
    assert.match(
      hook,
      /const layer = openLayer\(\);\s*if \(layer !== null && \(target === null \|\| !layer\.contains\(target\)\)\) \{\s*focusOn\(layer\);/,
    );
  });
});
