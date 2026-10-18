import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseWorkpaperNotice,
  parseWorkpapers,
  rowsToText,
  textToRows,
  workpaperNoticeFor,
  workpaperTabs,
  workpaperWrite,
} from "../apps/web/src/workpaper-model.ts";

const org = "11111111-1111-7111-8111-111111111111";
const project = "22222222-2222-7222-8222-222222222222";
const control = "44444444-4444-7444-8444-444444444444";
const paper = "77777777-7777-7777-8777-777777777777";
const file = "66666666-6666-7666-8666-666666666666";

function raw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: paper,
    control_id: control,
    stage: "EFFECTIVENESS",
    status: "DRAFT",
    drafting: false,
    draft_note: "",
    current_version: 2,
    shown_version: 2,
    version: 3,
    prepared_by: null,
    prepared_at: null,
    prepared_version: null,
    content: {
      reference: "WP-ITGC-AC-01-OE",
      title: "ITGC-AC-01",
      template_title: "Operating effectiveness",
      purpose: "Test the control",
      kind: "ITGC",
      tabs: [
        {
          key: "interim",
          title: "Interim testing",
          period: "interim",
          reference: "WP-TOE",
        },
        {
          key: "rollforward",
          title: "Roll-forward",
          period: "rollforward",
          reference: "WP-RF",
        },
        { title: "no key" },
      ],
      sections: [
        {
          key: "control",
          title: "Control",
          kind: "fields",
          fields: [{ label: "Owner", value: "IT" }],
          source: "RECORDS",
          tab: "interim",
          period: "interim",
        },
        {
          key: "conclusion-narrative",
          title: "Conclusion",
          kind: "text",
          text: "Approved before access.[^1]",
          citations: [
            {
              number: 1,
              evidence_file_id: file,
              file_name: "tickets.csv",
              quote: "approved",
              location: "Sheet 1",
            },
            { number: 2, evidence_file_id: "not-a-uuid" },
          ],
          source: "AGENT",
        },
        {
          key: "results",
          title: "Results",
          kind: "table",
          columns: ["Sample", "Result"],
          rows: [["1", "Pass"], "junk"],
          source: "PERSON",
          tab: "rollforward",
          period: "rollforward",
        },
        { title: "no key" },
      ],
    },
    versions: [
      {
        number: 1,
        source: "AGENT",
        created_by: null,
        created_at: "2026-10-01T00:00:00Z",
        note: "",
      },
    ],
    ...overrides,
  };
}

describe("workpaper parsing", () => {
  it("reads the sections, citations and versions", () => {
    const [parsed] = parseWorkpapers([raw()]) ?? [];
    assert.ok(parsed !== undefined);
    assert.equal(parsed.reference, "WP-ITGC-AC-01-OE");
    assert.equal(parsed.sections.length, 3);
    const text = parsed.sections[1];
    assert.equal(text?.source, "AGENT");
    assert.deepEqual(
      text?.citations.map((citation) => citation.fileId),
      [file],
    );
    assert.deepEqual(parsed.sections[2]?.rows, [["1", "Pass"]]);
    assert.equal(parsed.versions[0]?.createdBy, null);
  });

  it("refuses a list with a bad id or a non-list", () => {
    assert.equal(parseWorkpapers([raw({ id: "x" })]), null);
    assert.equal(parseWorkpapers({}), null);
    assert.deepEqual(parseWorkpapers([]), []);
  });

  it("defaults unknown stage, status and source safely", () => {
    const [parsed] =
      parseWorkpapers([raw({ stage: "OTHER", status: "OTHER" })]) ?? [];
    assert.equal(parsed?.stage, "EFFECTIVENESS");
    assert.equal(parsed?.status, "DRAFT");
  });
});

describe("workpaper tabs", () => {
  it("groups the sections under the template's tabs", () => {
    const [paper] = parseWorkpapers([raw()]) ?? [];
    assert.ok(paper !== undefined);
    assert.equal(paper.kind, "ITGC");
    assert.deepEqual(
      paper.tabs.map((tab) => [tab.key, tab.reference]),
      [
        ["interim", "WP-TOE"],
        ["rollforward", "WP-RF"],
      ],
    );
    const tabs = workpaperTabs(paper);
    assert.deepEqual(
      tabs.map((tab) => [tab.key, tab.sections.map((s) => s.key)]),
      [
        ["interim", ["control"]],
        ["rollforward", ["results"]],
      ],
    );
    // The conclusion names no tab (drafted before tabs), so it is shown under none;
    // a workpaper without tabs at all shows everything under its stage.
    const old = workpaperTabs({ ...paper, tabs: [] });
    assert.equal(old.length, 1);
    assert.equal(old[0]?.title, "Operating effectiveness");
    assert.equal(old[0]?.sections.length, 3);
  });
});

describe("table text", () => {
  it("round-trips rows and pads or clips to the width", () => {
    const rows = [
      ["1", "Pass"],
      ["2", "Exception"],
    ];
    assert.deepEqual(textToRows(rowsToText(rows), 2), rows);
    assert.deepEqual(textToRows("a\r\n\nb | c | d", 2), [
      ["a", ""],
      ["b", "c"],
    ]);
  });
});

describe("workpaper writes", () => {
  const ids = {
    organization_id: org,
    project_id: project,
    control_id: control,
  };
  const base = `/organizations/${org}/projects/${project}/workpapers`;

  it("builds a draft request", () => {
    assert.deepEqual(workpaperWrite({ ...ids, intent: "draft" }), {
      intent: "draft",
      path: `${base}/draft`,
      body: { control_id: control },
      controlId: control,
    });
  });

  it("builds text and table edits against the shown version", () => {
    const text = workpaperWrite({
      ...ids,
      intent: "edit",
      workpaper_id: paper,
      version: "2",
      section: "conclusion-narrative",
      kind: "text",
      value: "Edited.",
    });
    assert.ok(!("error" in text));
    assert.equal(text.path, `${base}/${paper}/sections/conclusion-narrative`);
    assert.deepEqual(text.body, { based_on: 2, text: "Edited." });
    const table = workpaperWrite({
      ...ids,
      intent: "edit",
      workpaper_id: paper,
      version: "2",
      section: "results",
      kind: "table",
      width: "2",
      value: "1 | Pass",
    });
    assert.ok(!("error" in table));
    assert.deepEqual(table.body, { based_on: 2, rows: [["1", "Pass"]] });
  });

  it("builds prepare and reopen requests", () => {
    const prepare = workpaperWrite({
      ...ids,
      intent: "prepare",
      workpaper_id: paper,
      version: "3",
    });
    assert.ok(!("error" in prepare));
    assert.deepEqual(prepare.body, { version: 3, note: "" });
    const reopen = workpaperWrite({
      ...ids,
      intent: "reopen",
      workpaper_id: paper,
      version: "3",
      reason: "Fix the sample list",
    });
    assert.ok(!("error" in reopen));
    assert.equal(reopen.path, `${base}/${paper}/reopen`);
  });

  it("refuses bad ids, versions, sections, secrets and short reasons", () => {
    const edit = {
      ...ids,
      intent: "edit",
      workpaper_id: paper,
      version: "2",
      section: "results",
      kind: "text",
      value: "ok",
    };
    const cases: Record<string, string>[] = [
      { ...ids, organization_id: "x", intent: "draft" },
      { ...ids, intent: "other", workpaper_id: paper, version: "1" },
      { ...edit, workpaper_id: "x" },
      { ...edit, version: "0" },
      { ...edit, section: "../x" },
      { ...edit, kind: "fields" },
      { ...edit, kind: "table", width: "0" },
      { ...edit, value: "password: hunter2" },
      { ...edit, value: "x".repeat(12_001) },
      {
        ...ids,
        intent: "reopen",
        workpaper_id: paper,
        version: "1",
        reason: "no",
      },
    ];
    for (const fields of cases) {
      assert.deepEqual(workpaperWrite(fields), { error: "invalid" });
    }
  });
});

describe("workpaper notices", () => {
  it("maps statuses and parses only known notices", () => {
    assert.equal(workpaperNoticeFor("prepare", 200), "wp-prepared");
    assert.equal(workpaperNoticeFor("edit", 409), "wp-blocked");
    assert.equal(workpaperNoticeFor("edit", 403), "wp-denied");
    assert.equal(workpaperNoticeFor("edit", 422), "wp-invalid");
    assert.equal(workpaperNoticeFor("draft", 500), "wp-unavailable");
    assert.equal(parseWorkpaperNotice("wp-saved"), "wp-saved");
    assert.equal(parseWorkpaperNotice("sheet-saved"), null);
    assert.equal(parseWorkpaperNotice(null), null);
  });
});
