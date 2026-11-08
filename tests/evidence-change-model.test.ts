import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  answersInPlace,
  changeBlocked,
  changeNoticeFor,
  changeNoticeOk,
  changeNoticeParam,
  changeReturn,
  changeWrite,
  cleanReason,
  parseChangeNotice,
  replaceTarget,
} from "../apps/web/src/evidence-change-model.ts";
import {
  filterWithdrawn,
  parseRegister,
} from "../apps/web/src/evidence-model.ts";

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
      ["this file is already withdrawn", "already"],
    ];
    for (const [detail, notice] of cases) {
      assert.equal(changeNoticeFor("withdraw", 409, detail), notice, detail);
    }
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
    assert.match(route, /searchParams\.set\("ev", "files"\)/);
  });
});
