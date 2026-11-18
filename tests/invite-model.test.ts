import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  customCandidate,
  filterSystems,
  inviteEmail,
  knownSystemGroups,
  parseOnboarding,
  parseSetupNotice,
  setupNoticeFor,
  setupProblem,
  setupWrite,
  teamPeople,
} from "../apps/web/src/onboarding-model.ts";

const ORG = "01a13253-ec1a-7604-8944-a06dd7633ce0";
const PROJECT = "01a1327d-b92a-7bd1-b34b-845a8d89c879";
const BASE = `/organizations/${ORG}/projects/${PROJECT}/onboarding`;

function fields(extra: Record<string, string>): Record<string, string> {
  return { organization_id: ORG, project_id: PROJECT, ...extra };
}

describe("inviting people from the team step", () => {
  it("sends a well-formed invitation to the API", () => {
    const write = setupWrite(
      fields({
        intent: "invite-member",
        email: "  dana.ruiz@firm.example ",
        display_name: " Dana Ruiz ",
        engagement_role: "PREPARER",
      }),
    );
    assert.deepEqual(write, {
      intent: "invite-member",
      step: "team",
      method: "POST",
      path: `${BASE}/team/invite`,
      body: {
        email: "dana.ruiz@firm.example",
        display_name: "Dana Ruiz",
        engagement_role: "PREPARER",
      },
    });
  });

  it("filters out addresses that are plainly not email before they leave", () => {
    for (const bad of [
      "",
      "dana",
      "dana@",
      "@firm.example",
      "dana@@firm.example",
      "dana..ruiz@firm.example",
      "dana@firm",
      "dana ruiz@firm.example",
      "<dana@firm.example>",
      `${"a".repeat(250)}@firm.example`,
    ]) {
      assert.equal(inviteEmail(bad), null, bad);
      assert.deepEqual(
        setupWrite(
          fields({
            intent: "invite-member",
            email: bad,
            engagement_role: "PREPARER",
          }),
        ),
        { error: "invalid" },
      );
    }
    assert.deepEqual(
      setupWrite(
        fields({
          intent: "invite-member",
          email: "dana@firm.example",
          engagement_role: "OWNER",
        }),
      ),
      { error: "invalid" },
    );
  });

  it("adds and removes a firm email domain", () => {
    assert.deepEqual(
      setupWrite(fields({ intent: "add-domain", domain: "@firm.example" })),
      {
        intent: "add-domain",
        step: "team",
        method: "POST",
        path: `/organizations/${ORG}/email-domains`,
        body: { domain: "@firm.example" },
      },
    );
    const removed = setupWrite(
      fields({ intent: "remove-domain", domain: "firm.example" }),
    );
    assert.ok(!("error" in removed));
    assert.equal(removed.path, `/organizations/${ORG}/email-domains/remove`);
    assert.deepEqual(
      setupWrite(fields({ intent: "add-domain", domain: "not a domain" })),
      { error: "invalid" },
    );
  });

  it("explains each refusal in plain words", () => {
    const cases: Array<[number, string, string]> = [
      [200, "", "invite-sent"],
      [422, "email is not valid", "invite-email"],
      [422, "email domain is not the firm's", "invite-domain"],
      [422, "email domain is disposable", "invite-disposable"],
      [422, "email domain does not accept mail", "invite-no-mail"],
      [503, "email domain could not be checked", "invite-unchecked"],
      [409, "firm has no email domains", "invite-no-domains"],
      [429, "invitation limit reached", "invite-limit"],
      [409, "person is disabled", "invite-disabled"],
    ];
    for (const [status, detail, notice] of cases) {
      assert.equal(setupNoticeFor("invite-member", status, detail), notice);
      assert.equal(parseSetupNotice(notice), notice);
    }
    assert.equal(setupNoticeFor("add-domain", 200, ""), "domain-saved");
    assert.equal(
      setupNoticeFor("add-domain", 422, "domain is a public mail service"),
      "domain-public",
    );
    assert.equal(
      setupNoticeFor("add-domain", 422, "email domain does not accept mail"),
      "domain-no-mail",
    );
    assert.equal(
      setupNoticeFor("add-domain", 422, "email domain is disposable"),
      "domain-disposable",
    );
    // Other steps keep their own notices.
    assert.equal(setupNoticeFor("profile", 200, ""), "setup-saved");
  });

  it("reads each person's validation status and the firm domains", () => {
    const parsed = parseOnboarding({
      project_id: PROJECT,
      project_name: "SOX FY27",
      project_status: "DRAFT",
      scope: "",
      settings: {},
      team: [
        {
          user_id: "u-1",
          display_name: "Dana Ruiz",
          email: "dana@firm.example",
          engagement_role: "PREPARER",
          organization_role: "CONTRIBUTOR",
          validated: false,
          welcome_held: true,
        },
        {
          user_id: "u-2",
          display_name: "Lee",
          email: "lee@firm.example",
          engagement_role: "LEAD",
          organization_role: "OWNER",
        },
      ],
      firm_domains: ["firm.example"],
      controls: [],
      readiness: [],
      ready: false,
    });
    assert.ok(parsed !== null);
    assert.deepEqual(
      parsed.team.map((m) => [m.email, m.validated, m.welcomeHeld]),
      [
        ["dana@firm.example", false, true],
        ["lee@firm.example", true, false],
      ],
    );
    assert.deepEqual(parsed.firmDomains, ["firm.example"]);
  });
});

describe("several roles for one person", () => {
  it("removes one role, or the whole person when no role is named", () => {
    const user = "01a13253-ec1a-7604-8944-a06dd7633ce1";
    const one = setupWrite(
      fields({
        intent: "remove-member",
        user_id: user,
        engagement_role: "REVIEWER",
      }),
    );
    assert.ok(!("error" in one));
    assert.deepEqual(one.body, { engagement_role: "REVIEWER" });
    const all = setupWrite(fields({ intent: "remove-member", user_id: user }));
    assert.ok(!("error" in all));
    assert.deepEqual(all.body, {});
    assert.deepEqual(
      setupWrite(
        fields({
          intent: "remove-member",
          user_id: user,
          engagement_role: "OWNER",
        }),
      ),
      { error: "invalid" },
    );
  });

  it("counts each person once", () => {
    const team = [
      { userId: "a", role: "LEAD" },
      { userId: "a", role: "REVIEWER" },
      { userId: "b", role: "PREPARER" },
    ];
    assert.deepEqual(
      teamPeople(team).map((m) => m.userId),
      ["a", "b"],
    );
  });
});

describe("choosing known systems", () => {
  it("sends the ticked systems once each", () => {
    const write = setupWrite(fields({ intent: "add-known-systems" }), {
      systems: ["Workday", " Okta ", "Workday"],
    });
    assert.ok(!("error" in write));
    assert.equal(write.path, `${BASE}/applications/known`);
    assert.deepEqual(write.body, { names: ["Workday", "Okta"], custom: [] });
    assert.deepEqual(setupWrite(fields({ intent: "add-known-systems" }), {}), {
      error: "invalid",
    });
  });

  it("groups the catalog by layer in a fixed order", () => {
    const groups = knownSystemGroups([
      { name: "Okta", layer: "INFRASTRUCTURE" },
      { name: "Workday", layer: "APPLICATION" },
      { name: "Snowflake", layer: "DATABASE" },
    ]);
    assert.deepEqual(
      groups.map((g) => [g.label, g.names]),
      [
        ["Application", ["Workday"]],
        ["Database", ["Snowflake"]],
        ["Infrastructure", ["Okta"]],
      ],
    );
  });
});

describe("searching common systems", () => {
  const catalog = [
    { name: "SAP S/4HANA", layer: "APPLICATION" },
    { name: "SAP Ariba", layer: "APPLICATION" },
    { name: "Oracle Database", layer: "DATABASE" },
    { name: "Okta", layer: "INFRASTRUCTURE" },
  ];

  it("matches every word, in any case, within a kind", () => {
    assert.deepEqual(
      filterSystems(catalog, "sap", "ALL").map((s) => s.name),
      ["SAP S/4HANA", "SAP Ariba"],
    );
    assert.deepEqual(
      filterSystems(catalog, "  sap  ariba ", "ALL").map((s) => s.name),
      ["SAP Ariba"],
    );
    assert.deepEqual(
      filterSystems(catalog, "", "DATABASE").map((s) => s.name),
      ["Oracle Database"],
    );
    assert.deepEqual(filterSystems(catalog, "oracle", "INFRASTRUCTURE"), []);
  });
});

describe("adding a custom system from the search", () => {
  it("offers the typed name, tidied, unless it is taken or too short", () => {
    assert.equal(
      customCandidate("  Halvorsen   Billing ", ["Workday"]),
      "Halvorsen Billing",
    );
    assert.equal(customCandidate("workday", ["Workday"]), null);
    assert.equal(customCandidate("a", []), null);
    assert.equal(customCandidate("password=hunter2", []), null);
  });

  it("sends custom systems with their kind beside known ones", () => {
    const write = setupWrite(fields({ intent: "add-known-systems" }), {
      systems: ["Okta"],
      custom_name: ["Halvorsen   Billing"],
      custom_layer: ["DATABASE"],
    });
    assert.ok(!("error" in write));
    assert.deepEqual(write.body, {
      names: ["Okta"],
      custom: [{ name: "Halvorsen Billing", layer: "DATABASE" }],
    });
    assert.deepEqual(
      setupWrite(fields({ intent: "add-known-systems" }), {
        custom_name: ["Halvorsen Billing"],
        custom_layer: ["SPACESHIP"],
      }),
      { error: "invalid" },
    );
  });
});

describe("held welcome emails", () => {
  it("sends them through the team route and says how it went", () => {
    const write = setupWrite(fields({ intent: "send-welcomes" }));
    assert.ok(!("error" in write));
    assert.equal(write.method, "POST");
    assert.match(write.path, /\/onboarding\/team\/welcomes\/send$/);
    assert.deepEqual(write.body, {});
    assert.equal(setupNoticeFor("send-welcomes", 200, ""), "welcomes-sent");
    assert.equal(
      setupNoticeFor("send-welcomes", 409, "live email is off"),
      "live-email-off",
    );
    assert.equal(setupProblem("welcomes-sent"), null);
    assert.equal(
      setupProblem("live-email-off"),
      "Email sending is off, so the welcome emails still wait.",
    );
  });
});
