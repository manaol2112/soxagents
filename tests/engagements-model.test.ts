import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Client } from "../apps/web/src/client-model.ts";
import {
  atRisk,
  auditPeriod,
  cardEntry,
  cardSignals,
  clientRows,
  engagementTypeShort,
  foldActivity,
  inFilter,
  isPastDue,
  matchesFilter,
  nameMark,
  openEngagements,
  parseEngagementSort,
  parseEngagementsView,
  portfolioCounts,
  portfolioLine,
  riskReason,
  sortBy,
  sortEngagements,
  updatedLabel,
  workSummary,
} from "../apps/web/src/engagements-model.ts";

const engagement = (
  name: string,
  clientName: string,
  status = "ACTIVE",
  periodEnd: string | null = "2026-12-31",
) => ({ name, clientName, status, periodEnd });

describe("the engagements page", () => {
  it("opens on engagements unless clients are asked for", () => {
    assert.equal(parseEngagementsView("clients"), "clients");
    assert.equal(parseEngagementsView("anything"), "engagements");
    assert.equal(parseEngagementsView(null), "engagements");
    assert.equal(parseEngagementsView(undefined), "engagements");
  });

  it("says how many engagements there are, for how many clients", () => {
    assert.equal(portfolioLine([]), "No audits in this firm yet.");
    assert.equal(
      portfolioLine([
        engagement("FY 2026 Audit", "Rosa Corp"),
        engagement("FY 2027 Audit", " rosa corp"),
        engagement("SOX FY27", "Raul Corp"),
      ]),
      "3 engagements across 2 clients",
    );
    assert.equal(portfolioLine([engagement("SOX", "")]), "1 engagement");
    assert.equal(
      portfolioLine([engagement("SOX", "Raul Corp")]),
      "1 engagement across 1 client",
    );
  });

  it("orders open work first, then by client, then the latest period", () => {
    const sorted = sortEngagements([
      engagement("FY 2026 Audit", "Rosa Corp", "ACTIVE", "2026-12-31"),
      engagement("Old", "Archived Co", "ARCHIVED"),
      engagement("No client", "", "ACTIVE"),
      engagement("FY 2027 Audit", "Rosa Corp", "ACTIVE", "2027-12-31"),
      engagement("SOX", "eladriel corp", "ACTIVE"),
    ]);
    assert.deepEqual(
      sorted.map((item) => item.name),
      ["SOX", "FY 2027 Audit", "FY 2026 Audit", "No client", "Old"],
    );
  });
});

describe("archived engagements", () => {
  it("stay out of All and show under Archived", () => {
    assert.equal(inFilter("ACTIVE", "ALL"), true);
    assert.equal(inFilter("DRAFT", "ALL"), true);
    assert.equal(inFilter("COMPLETED", "ALL"), true);
    assert.equal(inFilter("ARCHIVED", "ALL"), false);
    assert.equal(inFilter("ARCHIVED", "ARCHIVED"), true);
    assert.equal(inFilter("ACTIVE", "ARCHIVED"), false);
    assert.deepEqual(
      openEngagements([
        engagement("Open", "Rosa Corp"),
        engagement("Old", "Robert Corp", "ARCHIVED"),
      ]).map((item) => item.name),
      ["Open"],
    );
  });

  it("are counted apart in the summary", () => {
    assert.equal(
      portfolioLine([
        engagement("FY 2027 Audit", "Rosa Corp"),
        engagement("FY 2027 Audit", "Robert Corp", "ARCHIVED"),
      ]),
      "1 engagement across 1 client · 1 archived",
    );
    assert.equal(
      portfolioLine([engagement("Old", "Robert Corp", "ARCHIVED")]),
      "No open engagements · 1 archived",
    );
  });
});

describe("the clients table", () => {
  const clients: Client[] = [
    {
      id: "c2",
      name: "Rosa Corp",
      version: 1,
      engagements: [
        {
          id: "e2",
          name: "FY 2027 Audit",
          status: "ACTIVE",
          periodEnd: "2027-12-31",
          launched: true,
        },
        {
          id: "e1",
          name: "FY 2026 Audit",
          status: "COMPLETED",
          periodEnd: "2026-12-31",
          launched: true,
        },
      ],
    },
    { id: "c1", name: "Initech", version: 3, engagements: [] },
  ];

  it("lists clients by name with their latest engagement", () => {
    const rows = clientRows(clients);
    assert.deepEqual(
      rows.map((row) => [row.name, row.count, row.latest?.name ?? null]),
      [
        ["Initech", 0, null],
        ["Rosa Corp", 2, "FY 2027 Audit"],
      ],
    );
    assert.equal(rows[0]?.version, 3);
  });

  it("finds a client by its name or one of its engagements", () => {
    assert.deepEqual(
      clientRows(clients, "  init ").map((row) => row.id),
      ["c1"],
    );
    assert.deepEqual(
      clientRows(clients, "fy 2026").map((row) => row.id),
      ["c2"],
    );
    assert.deepEqual(clientRows(clients, "globex"), []);
  });
});

describe("an engagement's agent work", () => {
  it("counts done, under way, needing attention, and still to do", () => {
    const work = workSummary([
      { status: "SUCCEEDED", count: 30 },
      { status: "RUNNING", count: 5 },
      { status: "REVIEW", count: 5 },
      { status: "BLOCKED", count: 2 },
      { status: "FAILED", count: 1 },
      { status: "READY", count: 57 },
      { status: "CANCELLED", count: 40 },
    ]);
    assert.deepEqual(work, {
      total: 100,
      done: 30,
      moving: 10,
      stuck: 3,
      toDo: 57,
      percent: 30,
    });
  });

  it("has nothing to show before any work", () => {
    assert.equal(workSummary([]).percent, 0);
    assert.equal(workSummary([{ status: "CANCELLED", count: 4 }]).total, 0);
  });
});

describe("an engagement's recent activity", () => {
  const at = (minute: number) =>
    `2026-10-16T10:${String(minute).padStart(2, "0")}:00Z`;

  it("folds the same action by the same person into one line", () => {
    const folded = foldActivity([
      {
        action: "onboarding.template_removed",
        occurredAt: at(9),
        actorName: "Rob",
      },
      {
        action: "onboarding.template_removed",
        occurredAt: at(8),
        actorName: "Rob",
      },
      {
        action: "onboarding.template_removed",
        occurredAt: at(7),
        actorName: "Rob",
      },
      {
        action: "onboarding.template_customized",
        occurredAt: at(6),
        actorName: "Rob",
      },
      {
        action: "onboarding.template_removed",
        occurredAt: at(5),
        actorName: "Ana",
      },
    ]);
    assert.deepEqual(
      folded.map((item) => [
        item.action,
        item.actorName,
        item.times,
        item.occurredAt,
      ]),
      [
        ["onboarding.template_removed", "Rob", 3, at(9)],
        ["onboarding.template_customized", "Rob", 1, at(6)],
        ["onboarding.template_removed", "Ana", 1, at(5)],
      ],
    );
  });

  it("keeps the latest few lines and still counts their repeats", () => {
    const activity = [
      { action: "a", occurredAt: at(5), actorName: "Rob" },
      { action: "b", occurredAt: at(4), actorName: "Rob" },
      { action: "c", occurredAt: at(3), actorName: "Rob" },
      { action: "b", occurredAt: at(2), actorName: "Rob" },
    ];
    const folded = foldActivity(activity, 2);
    assert.deepEqual(
      folded.map((item) => [item.action, item.times]),
      [
        ["a", 1],
        ["b", 2],
      ],
    );
  });

  it("folds work that alternates, and leaves out the system's own bookkeeping", () => {
    const activity = [
      { action: "pbc.drafted", occurredAt: at(9), actorName: "Planner" },
      { action: "model.called", occurredAt: at(9), actorName: "Planner" },
      { action: "pbc.drafted", occurredAt: at(8), actorName: "Planner" },
      { action: "model.called", occurredAt: at(8), actorName: "Planner" },
      { action: "agent_instance.staffed", occurredAt: at(7), actorName: "Rob" },
      {
        action: "pbc.drafted",
        occurredAt: "2026-10-15T09:00:00Z",
        actorName: "Planner",
      },
    ];
    assert.deepEqual(
      foldActivity(activity).map((item) => [item.action, item.times]),
      [
        ["pbc.drafted", 2],
        ["pbc.drafted", 1],
      ],
    );
    // With nothing else to show, the bookkeeping is better than an empty list.
    assert.equal(foldActivity(activity.slice(1, 2))[0]?.action, "model.called");
  });
});

describe("an engagement card", () => {
  const quiet = {
    overdueRequests: 0,
    missedMilestones: 0,
    nextMilestone: null,
  };

  it("flags late evidence and missed milestones before anything else", () => {
    assert.deepEqual(
      cardSignals({
        overdueRequests: 3,
        missedMilestones: 1,
        nextMilestone: { name: "Walkthroughs complete", due: "2026-10-15" },
      }),
      [
        { tone: "warn", text: "3 evidence requests overdue" },
        { tone: "warn", text: "1 milestone missed" },
      ],
    );
    assert.deepEqual(cardSignals({ ...quiet, overdueRequests: 1 }), [
      { tone: "warn", text: "1 evidence request overdue" },
    ]);
  });

  it("says what is coming when nothing is late, and nothing when nothing is planned", () => {
    assert.deepEqual(
      cardSignals({
        ...quiet,
        nextMilestone: { name: "Walkthroughs complete", due: "2026-11-26" },
      }),
      [{ tone: "plain", text: "Next: Walkthroughs complete, Nov 26, 2026" }],
    );
    assert.deepEqual(cardSignals(quiet), []);
  });

  it("says when anything last happened, as people say it", () => {
    const now = "2026-10-16T21:00:00Z";
    assert.equal(updatedLabel(null, now), "No activity yet");
    assert.equal(updatedLabel("2026-10-16T20:59:40Z", now), "Updated just now");
    assert.equal(
      updatedLabel("2026-10-16T20:35:00Z", now),
      "Updated 25 min ago",
    );
    assert.equal(updatedLabel("2026-10-16T18:00:00Z", now), "Updated 3h ago");
    assert.equal(
      updatedLabel("2026-10-15T20:00:00Z", now),
      "Updated 1 day ago",
    );
    assert.equal(
      updatedLabel("2026-10-12T09:00:00Z", now),
      "Updated 4 days ago",
    );
    assert.equal(
      updatedLabel("2026-09-01T09:00:00Z", now),
      "Updated Sep 1, 2026",
    );
    assert.equal(updatedLabel("not a time", now), "");
  });

  it("opens a draft back in setup and anything launched at its overview", () => {
    assert.deepEqual(cardEntry("DRAFT"), {
      section: "setup",
      label: "Continue setup",
    });
    for (const status of ["ACTIVE", "PAUSED", "COMPLETED", "ARCHIVED"]) {
      assert.deepEqual(cardEntry(status), {
        section: "overview",
        label: "Open the engagement",
      });
    }
  });
});

describe("the engagements list (portfolio view)", () => {
  const row = (
    name: string,
    status: string,
    extra: Partial<{
      overdueRequests: number;
      missedMilestones: number;
      periodEnd: string | null;
      lastActivityAt: string | null;
      nextMilestone: { name: string; due: string } | null;
      progress: Array<{ status: string; count: number }>;
    }> = {},
  ) => ({
    name,
    status,
    clientName: "",
    periodEnd: "2027-12-31",
    overdueRequests: 0,
    missedMilestones: 0,
    lastActivityAt: null,
    nextMilestone: null,
    progress: [],
    ...extra,
  });

  it("names the audit period as the year that ends on the period end", () => {
    assert.equal(auditPeriod("2027-12-31"), "Jan – Dec 2027");
    assert.equal(auditPeriod("2027-06-30"), "Jul 2026 – Jun 2027");
    assert.equal(auditPeriod(null), "Not set");
    assert.equal(auditPeriod("soon"), "Not set");
  });

  it("calls running work at risk when evidence is late or a milestone was missed", () => {
    assert.equal(atRisk(row("A", "ACTIVE")), false);
    assert.equal(atRisk(row("A", "ACTIVE", { overdueRequests: 2 })), true);
    assert.equal(atRisk(row("A", "ACTIVE", { missedMilestones: 1 })), true);
    // Paused, completed or draft work is not flagged: nothing is expected of it now.
    assert.equal(atRisk(row("A", "PAUSED", { overdueRequests: 2 })), false);
    assert.equal(atRisk(row("A", "COMPLETED", { missedMilestones: 1 })), false);
    assert.equal(
      riskReason(
        row("A", "ACTIVE", { overdueRequests: 2, missedMilestones: 1 }),
      ),
      "2 evidence requests overdue · 1 milestone missed",
    );
    assert.equal(riskReason(row("A", "ACTIVE")), "");
  });

  it("counts the headline numbers and filters by them", () => {
    const projects = [
      row("A", "ACTIVE", { overdueRequests: 1 }),
      row("B", "ACTIVE"),
      row("C", "COMPLETED"),
      row("D", "DRAFT"),
      row("E", "ARCHIVED"),
    ];
    assert.deepEqual(portfolioCounts(projects), {
      open: 4,
      active: 2,
      completed: 1,
      atRisk: 1,
      draft: 1,
      paused: 0,
      archived: 1,
    });
    assert.deepEqual(
      projects.filter((p) => matchesFilter(p, "AT_RISK")).map((p) => p.name),
      ["A"],
    );
    assert.deepEqual(
      projects.filter((p) => matchesFilter(p, "ALL")).map((p) => p.name),
      ["A", "B", "C", "D"],
    );
  });

  it("sorts by the chosen column, with what has no value last", () => {
    const projects = [
      row("Old", "ACTIVE", {
        lastActivityAt: "2026-10-01T00:00:00Z",
        nextMilestone: { name: "x", due: "2026-12-01" },
        progress: [
          { status: "SUCCEEDED", count: 1 },
          { status: "READY", count: 3 },
        ],
      }),
      row("New", "ACTIVE", {
        lastActivityAt: "2026-10-20T00:00:00Z",
        nextMilestone: { name: "y", due: "2026-11-01" },
        progress: [
          { status: "SUCCEEDED", count: 3 },
          { status: "READY", count: 1 },
        ],
      }),
      row("Quiet", "ACTIVE"),
    ];
    const names = (sort: Parameters<typeof sortBy>[1]) =>
      sortBy(projects, sort).map((project) => project.name);
    assert.deepEqual(names("activity"), ["New", "Old", "Quiet"]);
    assert.deepEqual(names("milestone"), ["New", "Old", "Quiet"]);
    assert.deepEqual(names("progress"), ["New", "Old", "Quiet"]);
    assert.deepEqual(names("name"), ["New", "Old", "Quiet"]);
    assert.equal(parseEngagementSort("progress"), "progress");
    assert.equal(parseEngagementSort("nope"), "status");
  });

  it("knows a milestone date has passed", () => {
    assert.equal(isPastDue("2026-10-23", "2026-10-24T09:00:00Z"), true);
    assert.equal(isPastDue("2026-10-24", "2026-10-24T09:00:00Z"), false);
  });
});

describe("a list row's labels", () => {
  it("names the engagement type in a few words", () => {
    assert.equal(engagementTypeShort("SOX_ITGC"), "SOX: ITGC");
    assert.equal(engagementTypeShort("SOX_FULL"), "SOX: ITGC and BP");
    assert.equal(engagementTypeShort("IT_AUDIT"), "IT audit");
    assert.equal(engagementTypeShort("OTHER"), "OTHER");
  });

  it("marks a client or engagement with two letters", () => {
    assert.equal(nameMark("Contoso Ltd"), "CL");
    assert.equal(nameMark("Litware"), "LI");
    assert.equal(nameMark("SOX 2027"), "SO");
    assert.equal(nameMark("  "), "?");
  });
});
