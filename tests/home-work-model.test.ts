import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  clearable,
  daysUntil,
  dueWords,
  groupAction,
  headerAction,
  heldRecipients,
  holdCounts,
  holdsOf,
  homeWork,
  stageHref,
  systemConditions,
  whoseSummary,
} from "../apps/web/src/home-work-model.ts";
import {
  groupCount,
  linkHref,
  parseQueue,
  type Queue,
  whereWords,
} from "../apps/web/src/queue-model.ts";

const org = "11111111-1111-7111-8111-111111111111";
const project = "22222222-2222-7222-8222-222222222222";

function item(
  id: string,
  bucket: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    kind: "control-step",
    obligation: "CONTROL_STEP",
    source: { type: "engagement_control", id },
    stage: "EVIDENCE",
    title: `Item ${id}`,
    reason: "Because.",
    owner: { role: "PREPARER", names: [] },
    authorized: bucket === "MINE",
    ready: bucket !== "BLOCKED",
    blockers: [],
    blocks: false,
    bucket,
    link: { section: "controls", query: {} },
    ...extra,
  };
}

function queue(items: Array<Record<string, unknown>>): Queue {
  const parsed = parseQueue({ items, counts: {}, total: items.length });
  assert.ok(parsed !== null);
  return parsed;
}

describe("Home's work (docs/home-plan.md)", () => {
  const work = queue([
    item("held-mine", "BLOCKED", {
      authorized: true,
      blockers: ["Assign a recipient."],
      owner: { role: "PREPARER", names: [] },
    }),
    item("mine-1", "MINE"),
    item("held-other", "BLOCKED", {
      owner: { role: "AGENT", names: [] },
      blockers: ["Automation unavailable"],
    }),
    item("wait-1", "WAITING", { owner: { role: "CLIENT", names: [] } }),
    item("wait-2", "WAITING", { owner: { role: "PREPARER", names: [] } }),
    item("wait-3", "WAITING", { owner: { role: "CLIENT", names: [] } }),
    item("later", "UPCOMING"),
  ]);

  it("puts the viewer's own work first, then the holds the viewer can clear", () => {
    const sections = homeWork(work);
    assert.deepEqual(
      sections.needsYou.map((entry) => entry.id),
      ["mine-1", "held-mine"],
    );
    assert.deepEqual(
      sections.blocked.map((entry) => entry.id),
      ["held-other"],
    );
    assert.equal(sections.waiting.length, 3);
    assert.equal(sections.upcoming.length, 1);
    // Nothing is lost or counted twice: every item is in exactly one section.
    const all = [
      ...sections.needsYou,
      ...sections.blocked,
      ...sections.waiting,
      ...sections.upcoming,
    ].map((entry) => entry.id);
    assert.equal(new Set(all).size, work.items.length);
    // The queue's own buckets are untouched (Milestone 2's one queue).
    assert.equal(
      work.items.find((entry) => entry.id === "held-mine")?.bucket,
      "BLOCKED",
    );
  });

  it("names the viewer's next action, or none", () => {
    const query = (href: string) => new URLSearchParams(href.slice(2));
    assert.equal(headerAction(work, org, project)?.label, "Item mine-1");
    assert.equal(
      headerAction(queue([item("w", "WAITING")]), org, project),
      null,
    );
    assert.equal(headerAction(null, org, project), null);
    const onlyHold = queue([
      item("h", "BLOCKED", {
        authorized: true,
        blockers: ["Assign a recipient."],
      }),
    ]);
    assert.equal(headerAction(onlyHold, org, project)?.label, "Item h");
    assert.equal(clearable(onlyHold.items[0] as Queue["items"][number]), true);
    // A repeated plan approval leads to where the plans are approved together.
    const plans = queue(
      ["a", "b", "c"].map((id) =>
        item(`p-${id}`, "MINE", {
          title: "Approve the test plan",
          obligation: "PLAN_APPROVAL",
          stage: "PLANS",
        }),
      ),
    );
    const top = headerAction(plans, org, project);
    assert.equal(top?.label, "Approve the test plan (3)");
    assert.equal(query(top?.href ?? "").get("section"), "testing");
  });

  it("does a repeated plan approval on the Test plans page, and nothing else there", () => {
    const query = (href: string) => new URLSearchParams(href.slice(2));
    const plan = (id: string) =>
      item(id, "MINE", {
        title: "Approve the test plan",
        obligation: "PLAN_APPROVAL",
      });
    const action = groupAction(
      queue([plan("x"), plan("y")]).items,
      org,
      project,
    );
    assert.equal(action?.label, "Review all 2 plans");
    const params = query(action?.href ?? "");
    assert.equal(params.get("organization"), org);
    assert.equal(params.get("project"), project);
    assert.equal(params.get("section"), "testing");
    assert.equal(params.get("view"), null);
    assert.deepEqual(params.get("filter")?.split(",").sort(), [
      "CHANGES_REQUESTED",
      "DRAFT_READY",
      "NEEDS_CLARIFICATION",
      "PENDING_REVIEW",
    ]);
    // One plan opens on its own; other steps have no page that does them together.
    assert.equal(groupAction(queue([plan("x")]).items, org, project), null);
    assert.equal(
      groupAction(
        queue([item("r1", "MINE"), item("r2", "MINE")]).items,
        org,
        project,
      ),
      null,
    );
  });

  it("counts a group by what it holds: drafted requests, or controls", () => {
    const drafts = queue([
      item("d1", "BLOCKED", { kind: "request-draft" }),
      item("d2", "BLOCKED", { kind: "request-draft" }),
    ]).items;
    assert.equal(groupCount(drafts), "2 requests");
    assert.equal(groupCount(queue([item("c1", "MINE")]).items), "1 control");
    assert.equal(
      groupCount(queue([item("c1", "MINE"), item("c2", "MINE")]).items),
      "2 controls",
    );
  });

  it("names each control instance with its application, as every page does", () => {
    const [sap, oracle, bare] = queue([
      item("s", "MINE", {
        control_ref: "ITGC-AC-06",
        control_label: "ITGC-AC-06 · SAP ECC",
        phase: "INTERIM",
      }),
      item("o", "MINE", {
        control_ref: "ITGC-AC-06",
        control_label: "ITGC-AC-06 · Oracle EBS",
        phase: "INTERIM",
      }),
      // An older API without the label: the ID alone.
      item("b", "MINE", { control_ref: "ITGC-AC-07" }),
    ]).items;
    assert.equal(
      whereWords(sap as Queue["items"][number]),
      "ITGC-AC-06 · SAP ECC · Interim",
    );
    assert.equal(
      whereWords(oracle as Queue["items"][number]),
      "ITGC-AC-06 · Oracle EBS · Interim",
    );
    assert.equal(whereWords(bare as Queue["items"][number]), "ITGC-AC-07");
  });

  it("says whose turn the waiting work is, largest first", () => {
    assert.equal(
      whoseSummary(homeWork(work).waiting),
      "2 with the client · 1 with the preparer",
    );
    assert.equal(whoseSummary([]), "");
  });

  it("says how far a date is in plain words", () => {
    assert.equal(daysUntil("2026-10-31", "2026-10-21"), 10);
    assert.equal(dueWords("2026-10-21", "2026-10-21"), "today");
    assert.equal(dueWords("2026-10-22", "2026-10-21"), "tomorrow");
    assert.equal(dueWords("2026-10-31", "2026-10-21"), "in 10 days");
    assert.equal(dueWords("2026-10-20", "2026-10-21"), "1 day overdue");
    assert.equal(dueWords("2026-10-18", "2026-10-21"), "3 days overdue");
  });

  it("opens each stage where its work is done", () => {
    const query = (href: string) => new URLSearchParams(href.slice(2));
    assert.equal(
      query(stageHref("SETUP", org, project)).get("section"),
      "settings",
    );
    assert.equal(
      query(stageHref("PLANS", org, project)).get("section"),
      "testing",
    );
    assert.equal(
      query(stageHref("EVIDENCE", org, project)).get("section"),
      "evidence",
    );
    assert.equal(
      query(stageHref("TESTING", org, project)).get("view"),
      "results",
    );
    assert.equal(
      query(stageHref("REVIEW", org, project)).get("view"),
      "review",
    );
    assert.equal(
      query(stageHref("CLOSE", org, project)).get("section"),
      "reports",
    );
    for (const stage of [
      "SETUP",
      "PLANS",
      "EVIDENCE",
      "TESTING",
      "REVIEW",
      "CLOSE",
    ] as const) {
      const params = query(stageHref(stage, org, project));
      assert.equal(params.get("organization"), org);
      assert.equal(params.get("project"), project);
    }
  });

  it("names each distinct hold once, with how many items it holds", () => {
    const held = queue([
      item("a", "BLOCKED", {
        blockers: ["x@client.example cannot receive evidence requests."],
      }),
      item("b", "BLOCKED", {
        blockers: ["y@client.example cannot receive evidence requests."],
      }),
      item("c", "BLOCKED", {
        blockers: ["x@client.example cannot receive evidence requests."],
      }),
      item("d", "BLOCKED", { blockers: [] }),
    ]);
    // Items without coded holds (an older API) fall back to their blockers.
    assert.deepEqual(holdCounts(held.items), [
      {
        hold: "x@client.example cannot receive evidence requests.",
        count: 2,
        fix: null,
        system: false,
      },
      {
        hold: "y@client.example cannot receive evidence requests.",
        count: 1,
        fix: null,
        system: false,
      },
    ]);
    assert.deepEqual(holdCounts([]), []);
  });

  // H2: each hold carries a code, where it is cleared, and whether it is the system's.
  const notAllowed = (address: string) => ({
    code: "RECIPIENT_NOT_ALLOWED",
    text: `${address} cannot receive evidence requests.`,
    fix: null,
    system: true,
  });
  const missing = {
    code: "RECIPIENT_MISSING",
    text: "Assign a recipient.",
    fix: { section: "evidence", query: { tab: "requests" } },
    system: false,
  };
  const coded = queue([
    item("sys-1", "BLOCKED", {
      authorized: true,
      blockers: [notAllowed("x@client.example").text],
      holds: [notAllowed("x@client.example")],
    }),
    item("sys-2", "BLOCKED", {
      authorized: true,
      blockers: [notAllowed("y@client.example").text],
      holds: [notAllowed("y@client.example")],
    }),
    item("mixed", "BLOCKED", {
      authorized: true,
      blockers: [notAllowed("x@client.example").text, missing.text],
      holds: [notAllowed("x@client.example"), missing],
    }),
    item("worker", "BLOCKED", {
      owner: { role: "AGENT", names: [] },
      blockers: ["No worker is configured."],
      holds: [
        {
          code: "NO_WORKER",
          text: "No worker is configured.",
          fix: null,
          system: true,
        },
      ],
    }),
  ]);

  it("keeps work held only by the system out of Needs you", () => {
    const byId = (id: string) =>
      coded.items.find((entry) => entry.id === id) as Queue["items"][number];
    assert.equal(clearable(byId("sys-1")), false);
    assert.equal(clearable(byId("mixed")), true);
    assert.deepEqual(
      homeWork(coded).needsYou.map((entry) => entry.id),
      ["mixed"],
    );
    // Held by the system and authorized: not the viewer's to clear, but not lost
    // either. It is listed under Blocked, and every item is in exactly one section.
    const sections = homeWork(coded);
    assert.deepEqual(
      sections.blocked.map((entry) => entry.id),
      ["sys-1", "sys-2", "worker"],
    );
    const placed = [
      ...sections.needsYou,
      ...sections.blocked,
      ...sections.waiting,
      ...sections.upcoming,
    ].map((entry) => entry.id);
    assert.equal(placed.length, coded.items.length);
    assert.equal(new Set(placed).size, coded.items.length);
    assert.equal(byId("sys-1").bucket, "BLOCKED");
  });

  it("parses each hold with its fix and reads blockers as holds when none are coded", () => {
    const mixed = coded.items.find((entry) => entry.id === "mixed");
    assert.deepEqual(holdsOf(mixed as Queue["items"][number]), [
      notAllowed("x@client.example"),
      missing,
    ]);
    const old = queue([item("old", "BLOCKED", { blockers: ["Held."] })]);
    assert.deepEqual(holdsOf(old.items[0] as Queue["items"][number]), [
      { code: "STEP", text: "Held.", fix: null, system: false },
    ]);
    assert.deepEqual(
      holdCounts(coded.items).find((cause) => cause.hold === missing.text),
      { hold: missing.text, count: 1, fix: missing.fix, system: false },
    );
  });

  it("names each system condition once, with how many items it holds", () => {
    assert.deepEqual(systemConditions(coded), [
      { code: "NO_WORKER", items: 1, texts: ["No worker is configured."] },
      {
        code: "RECIPIENT_NOT_ALLOWED",
        items: 3,
        texts: [
          "x@client.example cannot receive evidence requests.",
          "y@client.example cannot receive evidence requests.",
        ],
      },
    ]);
    assert.deepEqual(systemConditions(null), []);
    assert.deepEqual(systemConditions(work), []);
  });

  it("names each recipient an allowlist holds once, keeping other wording whole", () => {
    assert.deepEqual(
      heldRecipients([
        "x@client.example cannot receive evidence requests.",
        "y@client.example cannot receive evidence requests.",
        "x@client.example cannot receive evidence requests.",
        "Recipients are restricted.",
      ]),
      ["x@client.example", "y@client.example", "Recipients are restricted."],
    );
    assert.deepEqual(heldRecipients([]), []);
  });

  it("builds a fix's address in the engagement it belongs to", () => {
    const params = new URLSearchParams(
      linkHref(missing.fix, org, project).slice(2),
    );
    assert.equal(params.get("organization"), org);
    assert.equal(params.get("project"), project);
    assert.equal(params.get("section"), "evidence");
    assert.equal(params.get("tab"), "requests");
  });
});
