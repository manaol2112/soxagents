import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseSheetNotice,
  parseSheets,
  RESULT_LABELS,
  sheetFor,
  sheetHeadline,
  sheetNoticeFor,
  sheetWrite,
} from "../apps/web/src/sheet-model.ts";

const org = "11111111-1111-7111-8111-111111111111";
const project = "22222222-2222-7222-8222-222222222222";
const sheet = "33333333-3333-7333-8333-333333333333";
const control = "44444444-4444-7444-8444-444444444444";
const item = "55555555-5555-7555-8555-555555555555";
const file = "66666666-6666-7666-8666-666666666666";

function raw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: sheet,
    control_id: control,
    control_ref: "ITGC-AC-01",
    method: "SAMPLE",
    attributes: ["Approved before access", "Approver is independent"],
    status: "OPEN",
    running: false,
    proposed_conclusion: "NOT_EFFECTIVE",
    conclusion: null,
    items: [
      {
        id: item,
        position: 1,
        label: "u0001",
        detail: [{ column: "User ID", value: "u0001" }],
        files: [{ id: file, file_name: "approvals.csv" }],
        state: "TESTED",
        source: "MODEL",
        note: "",
        cells: [
          { index: 0, proposed: "EXCEPTION", note: "Late", final: "EXCEPTION" },
          {
            index: 1,
            proposed: "UNABLE",
            note: "",
            final: "PASS",
            override_reason: "Seen in the ticket",
            overridden_by: "Preview owner",
          },
        ],
        version: 4,
      },
    ],
    placements: [
      {
        file_id: file,
        file_name: "approvals.csv",
        placement: "PLACED",
        placed_by: "AGENT",
      },
    ],
    counts: {
      items: 1,
      tested: 1,
      no_evidence: 0,
      exceptions: 1,
      unable: 0,
      review: 2,
      unplaced: 0,
    },
    blocking: [],
    proposal: null,
    proposal_status: "NONE",
    version: 7,
    ...overrides,
  };
}

describe("test sheet model", () => {
  it("parses a sheet and its cells", () => {
    const parsed = parseSheets([raw()]);
    assert.ok(parsed !== null);
    const found = sheetFor(parsed, control);
    assert.equal(found?.items[0]?.cells[1]?.final, "PASS");
    assert.equal(found?.items[0]?.cells[1]?.overriddenBy, "Preview owner");
    assert.equal(found?.counts.exceptions, 1);
    assert.equal(found?.counts.review, 2);
    assert.equal(sheetFor(parsed, sheet), null);
    assert.equal(parseSheets([{ id: "x" }]), null);
    assert.equal(parseSheets({}), null);
  });

  it("keeps insufficient evidence apart from human review", () => {
    const [found] =
      parseSheets([
        raw({
          items: [
            {
              id: item,
              position: 1,
              label: "u0001",
              detail: [],
              files: [],
              state: "TESTED",
              source: "MODEL",
              note: "",
              cells: [
                { index: 0, proposed: "UNABLE", note: "", final: "UNABLE" },
                { index: 1, proposed: "REVIEW", note: "", final: "REVIEW" },
              ],
              version: 1,
            },
          ],
          proposed_conclusion: "INCOMPLETE",
        }),
      ]) ?? [];
    const cells = found?.items[0]?.cells ?? [];
    assert.deepEqual(
      cells.map((cell) => cell.final),
      ["UNABLE", "REVIEW"],
    );
    assert.equal(RESULT_LABELS.UNABLE, "Insufficient evidence");
    assert.equal(RESULT_LABELS.REVIEW, "Human review required");
  });

  it("says where a sheet stands in one line", () => {
    const [ready] = parseSheets([raw()]) ?? [];
    assert.ok(ready !== undefined);
    assert.deepEqual(sheetHeadline(ready), {
      label: "Ready to sign off · exceptions found",
      tone: "danger",
    });
    const [signed] =
      parseSheets([raw({ status: "SIGNED_OFF", conclusion: "EFFECTIVE" })]) ??
      [];
    assert.ok(signed !== undefined);
    assert.equal(sheetHeadline(signed).label, "Signed off · effective");
    const [running] =
      parseSheets([raw({ running: true, run_state: "QUEUED" })]) ?? [];
    assert.ok(running !== undefined);
    // A queued or working run is "running" only when an agent worker exists; with
    // none (or unknown), the headline says automation is unavailable (M1d).
    assert.deepEqual(sheetHeadline(running), {
      label: "Run queued · automation unavailable",
      tone: "warning",
    });
    const local = { available: true, provider: "local", detail: "" } as const;
    assert.equal(sheetHeadline(running, local).label, "Queued for the tester");
    const [working] = parseSheets([raw({ running: true })]) ?? [];
    assert.ok(working !== undefined);
    assert.deepEqual(sheetHeadline(working, local), {
      label: "The tester is running",
      tone: "info",
    });
  });

  it("builds each write and refuses bad input", () => {
    const ids = { organization_id: org, project_id: project, sheet_id: sheet };
    const base = `/organizations/${org}/projects/${project}/test-sheets/${sheet}`;
    assert.deepEqual(sheetWrite({ ...ids, intent: "retest", version: "7" }), {
      intent: "retest",
      path: `${base}/retest`,
      body: { version: 7 },
      controlId: null,
    });
    assert.deepEqual(
      sheetWrite({
        ...ids,
        intent: "override",
        version: "4",
        item_id: item,
        index: "1",
        result: "PASS",
        reason: " Seen in the ticket ",
        control_id: control,
      }),
      {
        intent: "override",
        path: `${base}/items/${item}/override`,
        body: {
          version: 4,
          index: 1,
          result: "PASS",
          reason: "Seen in the ticket",
        },
        controlId: control,
      },
    );
    assert.deepEqual(
      sheetWrite({ ...ids, intent: "link", file_id: file, item_id: item }),
      {
        intent: "link",
        path: `${base}/links`,
        body: { file_id: file, item_id: item, action: "LINK", reason: "" },
        controlId: null,
      },
    );
    assert.deepEqual(
      sheetWrite({
        ...ids,
        intent: "exclude",
        file_id: file,
        reason: "Cover note",
      }),
      {
        intent: "exclude",
        path: `${base}/links`,
        body: {
          file_id: file,
          item_id: null,
          action: "EXCLUDE",
          reason: "Cover note",
        },
        controlId: null,
      },
    );
    assert.deepEqual(
      sheetWrite({
        ...ids,
        intent: "log",
        version: "7",
        title: "AC-01 exceptions",
        cause: "",
        severity: "SIGNIFICANT_DEFICIENCY",
      }),
      {
        intent: "log",
        path: `${base}/deficiency`,
        body: {
          version: 7,
          action: "LOG",
          title: "AC-01 exceptions",
          severity: "SIGNIFICANT_DEFICIENCY",
        },
        controlId: null,
      },
    );
    for (const bad of [
      {
        ...ids,
        intent: "override",
        version: "4",
        item_id: item,
        index: "1",
        result: "MAYBE",
        reason: "abc",
      },
      {
        ...ids,
        intent: "override",
        version: "4",
        item_id: item,
        index: "1",
        result: "PASS",
        reason: "x",
      },
      {
        ...ids,
        intent: "override",
        version: "4",
        item_id: item,
        index: "1",
        result: "PASS",
        reason: "password: hunter2",
      },
      { ...ids, intent: "dismiss", version: "7", reason: "" },
      { ...ids, intent: "reopen", version: "7", reason: "no" },
      { ...ids, intent: "log", version: "7", severity: "CATASTROPHE" },
      { ...ids, intent: "link", file_id: file },
      { ...ids, intent: "retest", version: "0" },
      { ...ids, sheet_id: "../x", intent: "retest", version: "1" },
      { ...ids, intent: "approve", version: "1" },
    ]) {
      assert.deepEqual(sheetWrite(bad), { error: "invalid" });
    }
  });

  it("names each outcome", () => {
    assert.equal(sheetNoticeFor("sign-off", 200), "sheet-signed");
    assert.equal(sheetNoticeFor("unlink", 200), "sheet-linked");
    assert.equal(sheetNoticeFor("sign-off", 409), "sheet-blocked");
    assert.equal(sheetNoticeFor("log", 403), "sheet-denied");
    assert.equal(sheetNoticeFor("override", 422), "sheet-invalid");
    assert.equal(sheetNoticeFor("retest", 0), "sheet-unavailable");
    assert.equal(parseSheetNotice("sheet-logged"), "sheet-logged");
    assert.equal(parseSheetNotice("logged"), null);
  });
});
