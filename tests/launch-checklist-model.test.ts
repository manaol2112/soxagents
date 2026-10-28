import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { launchChecklist } from "../apps/web/src/launch-checklist-model.ts";
import {
  type Onboarding,
  parseOnboarding,
} from "../apps/web/src/onboarding-model.ts";
import type {
  Policy,
  PriorYearReference,
} from "../apps/web/src/references-model.ts";

// Right after launch, the five foundations of the scope (the product owner's reference,
// 27 October 2026), each read from the records.

function launched(extra: Record<string, unknown> = {}): Onboarding {
  const parsed = parseOnboarding({
    project_id: "33333333-3333-7333-8333-333333333333",
    project_name: "SOX FY27",
    project_status: "ACTIVE",
    scope: "SOX testing",
    settings: { period_end: "2027-12-31", version: 3 },
    applications: [],
    team: [],
    candidates: [],
    controls: [],
    templates: [],
    agents: [],
    library: [],
    readiness: [],
    ready: false,
    plan: null,
    started: true,
    ...extra,
  });
  assert.ok(parsed);
  return parsed;
}

const policy = (kind: Policy["kind"]): Policy => ({
  id: `p-${kind}`,
  kind,
  title: kind,
  fileName: "",
  excerpt: "",
  createdBy: null,
  createdAt: "2026-10-27T10:00:00Z",
  systemIds: [],
  processIds: [],
  controls: 0,
  excluded: 0,
});

const priorYear = (
  runStatus: PriorYearReference["runStatus"],
): PriorYearReference => ({
  id: `py-${runStatus}`,
  title: "FY26 workpapers",
  fileName: "fy26.zip",
  createdBy: null,
  createdAt: "2026-10-27T10:00:00Z",
  runStatus,
  runNote: "",
  matches: [],
});

describe("the launch checklist", () => {
  it("lists the five foundations in the recommended order, none started", () => {
    const checklist = launchChecklist(launched(), {
      policies: [],
      priorYear: [],
    });
    assert.deepEqual(
      checklist.foundations.map((item) => [item.title, item.status]),
      [
        ["Systems", "NOT_STARTED"],
        ["Processes", "NOT_STARTED"],
        ["Controls", "NOT_STARTED"],
        ["Prior-year workpapers", "NOT_STARTED"],
        ["Policies", "NOT_STARTED"],
      ],
    );
    assert.equal(checklist.done, 0);
    assert.equal(checklist.next?.key, "systems");
  });

  it("opens each where it is set up", () => {
    const targets = launchChecklist(launched(), {
      policies: [],
      priorYear: [],
    }).foundations.map((item) => item.target);
    assert.deepEqual(targets, [
      { section: "controls", pane: "systems" },
      { section: "controls", pane: "processes" },
      { section: "register" },
      { section: "controls", pane: "references" },
      { section: "controls", pane: "policies" },
    ]);
  });

  it("counts policies, not narratives, and a prior year still being read", () => {
    const checklist = launchChecklist(launched(), {
      policies: [policy("NARRATIVE"), policy("PROCEDURE")],
      priorYear: [priorYear("WORKING")],
    });
    const status = Object.fromEntries(
      checklist.foundations.map((item) => [item.key, item.status]),
    );
    assert.equal(status.policies, "DONE");
    assert.equal(status["prior-year"], "IN_PROGRESS");
    assert.equal(checklist.done, 1);
    // Only narratives: no policy yet.
    const narratives = launchChecklist(launched(), {
      policies: [policy("NARRATIVE")],
      priorYear: [priorYear("IDLE")],
    });
    assert.deepEqual(
      narratives.foundations
        .filter((item) => item.key !== "systems")
        .map((item) => [item.key, item.status]),
      [
        ["processes", "NOT_STARTED"],
        ["controls", "NOT_STARTED"],
        ["prior-year", "DONE"],
        ["policies", "NOT_STARTED"],
      ],
    );
  });

  it("moves to the next foundation once systems are in scope", () => {
    const checklist = launchChecklist(
      launched({
        applications: [
          {
            id: "44444444-4444-7444-8444-444444444444",
            name: "SAP ERP",
            description: "",
          },
        ],
      }),
      { policies: [], priorYear: [] },
    );
    assert.equal(checklist.foundations[0]?.status, "DONE");
    assert.equal(checklist.done, 1);
    assert.equal(checklist.next?.key, "processes");
  });
});

describe("the launch checklist's styles", () => {
  const globals = readFileSync("apps/web/app/globals.css", "utf8");
  const block = globals.slice(globals.indexOf(".record-dialog.lc-dialog {"));

  it("uses tokens only and stacks on a phone", () => {
    assert.doesNotMatch(block, /#[0-9a-f]{3,8}\b/i);
    assert.match(
      block,
      /@media \(max-width: 820px\)[\s\S]*?\.lc-grid \{\s*grid-template-columns: minmax\(0, 1fr\);/,
    );
  });

  it("drops the old What to do next dialog's rules", () => {
    assert.doesNotMatch(globals, /\.launch-dialog-(steps|foot)\b/);
  });
});
