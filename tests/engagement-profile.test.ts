import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseDashboard } from "../apps/web/src/engagement-model.ts";
import {
  launchReport,
  methodologyLabel,
  openConflicts,
  parseOnboarding,
  parsePeriod,
  setupNoticeFor,
  setupWrite,
} from "../apps/web/src/onboarding-model.ts";
import {
  impactHref,
  impactPath,
  scopeImpact,
  teamImpact,
} from "../apps/web/src/setup-impact-model.ts";

const organizationId = "11111111-1111-7111-8111-111111111111";
const projectId = "22222222-2222-7222-8222-222222222222";
const controlId = "33333333-3333-7333-8333-333333333333";
const ids = { organization_id: organizationId, project_id: projectId };
const base = `/organizations/${organizationId}/projects/${projectId}/onboarding`;
const BASIS = "0123456789abcdef0123456789abcdef";

const CONFLICTS = [
  {
    kind: "NAME_YEAR",
    message:
      "The engagement's name points to 2027, but the period ends 31 December 2026.",
    blocking: true,
  },
  {
    kind: "PERIOD_LENGTH",
    message: "The period is 184 days long.",
    blocking: false,
  },
];

function onboarding(extra: Record<string, unknown> = {}) {
  return {
    project_id: projectId,
    project_name: "2027 SOX Audit",
    project_status: "DRAFT",
    scope: "ITGCs",
    settings: {
      period_end: "2026-12-31",
      period_start: "2026-07-01",
      fiscal_year: "FY2026",
      methodology: "MANAGEMENT_404",
      reporting_objectives: "Management's assessment.",
      client_domains: [],
      version: 3,
    },
    period: { conflicts: CONFLICTS, basis: BASIS, confirmed: false },
    controls: [],
    readiness: [
      {
        step: "scope",
        title: "Profile and period",
        complete: false,
        issues: [CONFLICTS[0]?.message],
        advisories: ["The period is 184 days long."],
      },
      {
        step: "team",
        title: "Team and access",
        complete: true,
        issues: [],
        advisories: [
          "Development mode: reviewer independence is not enforced.",
        ],
      },
      {
        step: "agents",
        title: "AI workforce",
        complete: false,
        issues: ["Activate the testers."],
        advisories: [],
      },
    ],
    ready: false,
    started: false,
    ...extra,
  };
}

describe("engagement profile", () => {
  it("reads the profile and the period check", () => {
    const parsed = parseOnboarding(onboarding());
    assert.equal(parsed?.periodStart, "2026-07-01");
    assert.equal(parsed?.fiscalYear, "FY2026");
    assert.equal(parsed?.methodology, "MANAGEMENT_404");
    assert.equal(parsed?.reportingObjectives, "Management's assessment.");
    assert.equal(parsed?.period?.basis, BASIS);
    assert.equal(parsed?.period?.conflicts.length, 2);
    // Only the blocking disagreement holds launch, until it is confirmed.
    assert.deepEqual(openConflicts(parsed?.period ?? null), [
      CONFLICTS[0]?.message,
    ]);
    const confirmed = parsePeriod({
      conflicts: CONFLICTS,
      basis: BASIS,
      confirmed: true,
      confirmed_by: "Robin Lead",
      confirmed_at: "2026-10-17T10:00:00Z",
    });
    assert.deepEqual(openConflicts(confirmed), []);
    assert.equal(confirmed?.confirmedBy, "Robin Lead");
    // An older API without the profile reads as not chosen and unchecked.
    const older = parseOnboarding(
      onboarding({ period: undefined, settings: { period_end: null } }),
    );
    assert.equal(older?.methodology, null);
    assert.equal(older?.period, null);
    assert.equal(methodologyLabel(null), "Not chosen yet");
    assert.equal(methodologyLabel("EXTERNAL_ICFR"), "External audit of ICFR");
  });

  it("gives a person several roles in one step, and refuses a role that is not one", () => {
    const person = "33333333-3333-7333-8333-333333333333";
    const add = (roles: string[]) =>
      setupWrite(
        {
          ...ids,
          intent: "add-member",
          user_id: person,
          engagement_role: roles.at(-1) ?? "",
        },
        { engagement_role: roles },
      );
    assert.deepEqual(
      "error" in add(["PREPARER"]) ? null : add(["PREPARER"]).body,
      {
        user_id: person,
        engagement_role: "PREPARER",
      },
    );
    const both = add(["PREPARER", "REVIEWER", "PREPARER"]);
    assert.deepEqual("error" in both ? null : both.body, {
      user_id: person,
      engagement_role: "PREPARER",
      additional_roles: ["REVIEWER"],
    });
    assert.deepEqual(add([]), { error: "invalid" });
    assert.deepEqual(add(["PREPARER", "OWNER"]), { error: "invalid" });
    const invited = setupWrite(
      {
        ...ids,
        intent: "invite-member",
        email: "new@firm.example",
        display_name: "",
        engagement_role: "REVIEWER",
      },
      { engagement_role: ["LEAD", "REVIEWER"] },
    );
    assert.deepEqual("error" in invited ? null : invited.body, {
      email: "new@firm.example",
      display_name: "",
      engagement_role: "LEAD",
      additional_roles: ["REVIEWER"],
    });
  });

  it("sends the whole profile and refuses a bad one", () => {
    const profile = {
      ...ids,
      intent: "profile",
      client_name: "Acme",
      engagement_type: "SOX_ITGC",
      period_end: "2027-12-31",
      period_start: "2027-01-01",
      methodology: "EXTERNAL_ICFR",
      fiscal_year: " FY2027 ",
      reporting_objectives: "ICFR opinion.",
    };
    assert.deepEqual(setupWrite(profile), {
      intent: "profile",
      step: "profile",
      method: "PATCH",
      path: `${base}/profile`,
      body: {
        client_name: "Acme",
        engagement_type: "SOX_ITGC",
        period_end: "2027-12-31",
        period_start: "2027-01-01",
        methodology: "EXTERNAL_ICFR",
        fiscal_year: "FY2027",
        reporting_objectives: "ICFR opinion.",
      },
    });
    for (const bad of [
      { methodology: "GUESSWORK" },
      { period_start: "2028-01-01" },
      { period_start: "2027-12-31" },
      { fiscal_year: "x".repeat(21) },
      { reporting_objectives: "password: hunter2" },
    ]) {
      assert.deepEqual(setupWrite({ ...profile, ...bad }), {
        error: "invalid",
      });
    }
    // The step's one Save carries the scope with the profile; a bad scope refuses both.
    const withScope = setupWrite({ ...profile, scope: "  ITGCs over SAP.  " });
    assert.ok(!("error" in withScope));
    assert.equal(
      "error" in withScope ? null : withScope.path,
      `${base}/profile`,
    );
    assert.equal(
      "error" in withScope ? null : withScope.body.scope,
      "ITGCs over SAP.",
    );
    for (const scope of ["x".repeat(4001), "api_key: abc"]) {
      assert.deepEqual(setupWrite({ ...profile, scope }), { error: "invalid" });
    }
    // Fields left off the form are kept as they are.
    const short = setupWrite({
      ...ids,
      intent: "profile",
      client_name: "Acme",
      engagement_type: "SOX_ITGC",
      period_end: "",
    });
    assert.ok(!("error" in short));
    assert.deepEqual("error" in short ? null : short.body, {
      client_name: "Acme",
      engagement_type: "SOX_ITGC",
      period_end: null,
    });
    const cleared = setupWrite({
      ...profile,
      period_end: "",
      period_start: "",
    });
    assert.ok(!("error" in cleared));
    assert.deepEqual("error" in cleared ? null : cleared.body, {
      client_name: "Acme",
      engagement_type: "SOX_ITGC",
      period_end: null,
      period_start: null,
      methodology: "EXTERNAL_ICFR",
      fiscal_year: "FY2027",
      reporting_objectives: "ICFR opinion.",
    });
  });

  it("confirms the period it was shown, and maps the outcomes", () => {
    assert.deepEqual(
      setupWrite({ ...ids, intent: "period-confirm", basis: BASIS }),
      {
        intent: "period-confirm",
        step: "profile",
        method: "POST",
        path: `${base}/period/confirm`,
        body: { basis: BASIS },
      },
    );
    assert.deepEqual(
      setupWrite({ ...ids, intent: "period-confirm", basis: "nope" }),
      { error: "invalid" },
    );
    assert.equal(
      setupNoticeFor("period-confirm", 200, ""),
      "setup-period-confirmed",
    );
    assert.equal(
      setupNoticeFor("period-confirm", 409, "the period changed"),
      "setup-period-changed",
    );
    assert.equal(
      setupNoticeFor("control-scope", 409, "say why: this has work on record"),
      "setup-needs-reason",
    );
    assert.equal(
      setupNoticeFor("remove-member", 409, "name another reviewer first"),
      "setup-last-reviewer",
    );
  });

  it("carries the reason for a scope change", () => {
    const write = setupWrite({
      ...ids,
      intent: "control-scope",
      control_id: controlId,
      included: "false",
      reason: " Retired in Q3. ",
    });
    assert.deepEqual("error" in write ? null : write.body, {
      included: false,
      reason: "Retired in Q3.",
    });
    const plain = setupWrite({
      ...ids,
      intent: "control-scope",
      control_id: controlId,
      included: "false",
    });
    assert.deepEqual("error" in plain ? null : plain.body, { included: false });
    const system = setupWrite({
      ...ids,
      intent: "remove-application",
      application_id: controlId,
      reason: "Decommissioned.",
    });
    assert.deepEqual("error" in system ? null : system.body, {
      reason: "Decommissioned.",
    });
  });

  it("reports what holds launch apart from what is worth knowing", () => {
    const parsed = parseOnboarding(onboarding());
    assert.ok(parsed !== null);
    const report = launchReport(parsed);
    assert.deepEqual(
      report.blocking.map((line) => [line.step, line.title]),
      [
        ["profile", "Engagement profile"],
        [null, "AI workforce"],
      ],
    );
    assert.deepEqual(
      report.warnings.map((line) => line.step),
      ["profile", "team"],
    );
  });

  it("says what a change affects in plain words", () => {
    const quiet = scopeImpact({
      controls: 1,
      open_tasks: 4,
      unsent_requests: 1,
      sent_requests: 0,
      tested: 0,
      workpapers: 0,
      reviews: 0,
      deficiencies: 0,
      material: false,
    });
    assert.deepEqual(quiet, {
      lines: [
        "4 open tasks are cancelled.",
        "1 unsent evidence request is withdrawn.",
      ],
      material: false,
      blocked: null,
    });
    const material = scopeImpact({
      sent_requests: 2,
      deficiencies: 1,
      material: true,
    });
    assert.equal(material?.material, true);
    assert.equal(material?.lines.length, 2);
    assert.match(material?.lines[0] ?? "", /2 requests have already been sent/);
    assert.equal(scopeImpact({ open_tasks: 1 }), null);
    assert.deepEqual(teamImpact({ assigned_tasks: 3, last_reviewer: true }), {
      lines: [
        "3 open tasks assigned to this person are returned to the team unassigned.",
      ],
      material: false,
      blocked:
        "This person is the only independent reviewer. Assign another reviewer first.",
    });
    assert.deepEqual(teamImpact({ assigned_tasks: 0, last_reviewer: false }), {
      lines: [],
      material: false,
      blocked: null,
    });
  });

  it("asks the API only for well-formed targets", () => {
    assert.equal(
      impactPath(organizationId, projectId, { kind: "control", id: controlId }),
      `${base}/scope-impact?control_id=${controlId}`,
    );
    assert.equal(
      impactPath(organizationId, projectId, { kind: "member", id: controlId }),
      `${base}/team/${controlId}/impact`,
    );
    assert.equal(
      impactPath(organizationId, projectId, {
        kind: "application",
        id: "../../admin",
      }),
      null,
    );
    assert.equal(
      impactHref(organizationId, projectId, { kind: "control", id: controlId }),
      `/workspace/setup-impact?organization=${organizationId}&project=${projectId}&kind=control&id=${controlId}`,
    );
  });

  it("puts a running engagement's period disagreement on the dashboard", () => {
    const dashboard = parseDashboard({
      started: true,
      controls: { in_scope: 1 },
      period_conflicts: [CONFLICTS[0]?.message],
    });
    assert.deepEqual(dashboard?.periodConflicts, [CONFLICTS[0]?.message]);
    assert.deepEqual(
      parseDashboard({ controls: { in_scope: 1 } })?.periodConflicts,
      [],
    );
  });
});
