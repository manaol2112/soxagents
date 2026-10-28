import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { statusActions } from "../apps/web/src/engagement-lifecycle.ts";
import {
  placeSetup,
  setupPlacement,
  setupReturn,
} from "../apps/web/src/routes.ts";
import {
  canManageAgents,
  canManageProjects,
  chosenOrganizationId,
  DESTINATIONS,
  deriveShell,
  destinationHref,
  homePlacement,
  lockedBeforeLaunch,
  type Organization,
  type Project,
  projectIdInList,
  projectLabels,
  resolveRoute,
  shownInMenu,
  showsSignInPrompt,
  switcherProjects,
  taskStatusChoices,
  type WorkspaceSnapshot,
  workspaceHref,
} from "../apps/web/src/shell-model.ts";

const organization: Organization = {
  id: "11111111-1111-7111-8111-111111111111",
  name: "Acme",
  slug: "acme",
  role: "OWNER",
};

const other: Organization = {
  id: "22222222-2222-7222-8222-222222222222",
  name: "Beta",
  slug: "beta",
  role: "REVIEWER",
};

const project: Project = {
  id: "33333333-3333-7333-8333-333333333333",
  name: "SOX 2026",
  slug: "sox-2026",
  status: "ACTIVE",
  clientName: "Acme",
  kind: "SOX_ITGC",
  periodEnd: "2027-12-31",
  ownerName: "Pat Lee",
  controls: 16,
  openDeficiencies: 1,
  clientId: null,
  progress: [],
  overdueRequests: 0,
  nextMilestone: null,
  missedMilestones: 0,
  lastActivityAt: null,
  team: ["Pat Lee"],
};

function snapshot(
  overrides: Partial<WorkspaceSnapshot> = {},
): WorkspaceSnapshot {
  return {
    meStatus: 200,
    me: { id: "user-1", email: "owner@example.com" },
    organizationsStatus: 200,
    organizations: [organization, other],
    projectsStatus: 200,
    projects: [project],
    requestedOrganizationId: organization.id,
    requestedProjectId: project.id,
    requestedSection: "overview",
    notifications: "empty",
    canManageProjects: false,
    members: [],
    projectDetail: null,
    notice: null,
    agentsStatus: 200,
    agents: [],
    requestedAgentId: null,
    agentDetail: null,
    tasksStatus: 200,
    tasks: [],
    requestedTaskId: null,
    taskDetail: null,
    canManageTasks: false,
    taskAssignees: [],
    agentInstances: [],
    ...overrides,
  };
}

describe("workspace shell", () => {
  it("asks an anonymous caller to sign in", () => {
    assert.equal(
      deriveShell(snapshot({ meStatus: 401, me: null })).status,
      "denied",
    );
  });

  it("treats a failed workspace load as unavailable", () => {
    assert.equal(
      deriveShell(snapshot({ meStatus: 0, me: null })).status,
      "error",
    );
    assert.equal(
      deriveShell(snapshot({ organizationsStatus: 503, organizations: null }))
        .status,
      "error",
    );
  });

  it("reads where each engagement's work stands, for its card", () => {
    const model = deriveShell(
      snapshot({
        projects: [
          {
            id: project.id,
            name: project.name,
            slug: project.slug,
            status: "ACTIVE",
            client_id: "55555555-5555-7555-8555-555555555555",
            progress: [
              { status: "SUCCEEDED", count: 3 },
              { status: "READY", count: "nine" },
            ],
            overdue_requests: 2,
            next_milestone: {
              name: "Walkthroughs complete",
              due: "2026-11-26",
            },
            missed_milestones: 1,
            last_activity_at: "2026-10-16T21:03:30+00:00",
          },
          // An older API, or a malformed reply, leaves the card's extras empty.
          {
            id: "44444444-4444-7444-8444-444444444444",
            name: "Old",
            slug: "old",
            status: "ACTIVE",
            next_milestone: { name: "No date" },
          },
        ],
      }),
    );
    assert.equal(model.status, "ready");
    if (model.status !== "ready") {
      return;
    }
    const [card, old] = model.projects;
    assert.deepEqual(card?.progress, [{ status: "SUCCEEDED", count: 3 }]);
    assert.equal(card?.clientId, "55555555-5555-7555-8555-555555555555");
    assert.equal(card?.overdueRequests, 2);
    assert.deepEqual(card?.nextMilestone, {
      name: "Walkthroughs complete",
      due: "2026-11-26",
    });
    assert.equal(card?.missedMilestones, 1);
    assert.equal(card?.lastActivityAt, "2026-10-16T21:03:30+00:00");
    assert.deepEqual(old?.progress, []);
    assert.equal(old?.overdueRequests, 0);
    assert.equal(old?.nextMilestone, null);
    assert.equal(old?.lastActivityAt, null);
  });

  it("shows an empty state when the caller has no organization", () => {
    const model = deriveShell(snapshot({ organizations: [] }));
    assert.deepEqual(model, { status: "empty", email: "owner@example.com" });
  });

  it("ignores an organization or project the caller cannot access", () => {
    const model = deriveShell(
      snapshot({
        requestedOrganizationId: "99999999-9999-7999-8999-999999999999",
        requestedProjectId: "88888888-8888-7888-8888-888888888888",
        requestedSection: "billing",
      }),
    );
    assert.equal(model.status, "ready");
    if (model.status !== "ready") {
      return;
    }
    assert.equal(model.organization.id, organization.id);
    assert.equal(model.selectedProject?.id, project.id);
    // An unknown section falls back to the engagement's home: where it stands and what
    // to do next.
    assert.equal(model.section, "overview");
  });

  it("links to the console explicitly, since Home is the default", () => {
    const agents = new URL(
      workspaceHref("console", organization.id, project.id),
      "http://x",
    );
    assert.equal(agents.searchParams.get("section"), "console");
    const model = deriveShell(
      snapshot({ requestedSection: agents.searchParams.get("section") }),
    );
    assert.equal(model.status === "ready" && model.section, "console");
    const home = new URL(
      workspaceHref("overview", organization.id, project.id),
      "http://x",
    );
    assert.equal(home.searchParams.get("section"), null);
    const opened = deriveShell(snapshot({ requestedSection: null }));
    assert.equal(opened.status === "ready" && opened.section, "overview");
  });

  it("keeps a requested organization that is in the membership list", () => {
    const chosen = chosenOrganizationId([organization, other], other.id);
    assert.equal(chosen, other.id);
    const model = deriveShell(
      snapshot({
        requestedOrganizationId: other.id,
        requestedSection: "tasks",
      }),
    );
    assert.equal(model.status, "ready");
    if (model.status !== "ready") {
      return;
    }
    assert.equal(model.organization.id, other.id);
    assert.equal(model.section, "tasks");
    assert.equal(
      workspaceHref("projects", other.id, project.id),
      `/?organization=${other.id}&project=${project.id}&section=projects`,
    );
  });

  it("offers only legal project status changes", () => {
    assert.deepEqual(statusActions("ACTIVE"), ["pause", "archive"]);
    assert.deepEqual(statusActions("ARCHIVED"), []);
    assert.deepEqual(taskStatusChoices("CANCELLED"), ["CANCELLED"]);
    assert.equal(taskStatusChoices("RUNNING").includes("DRAFT"), false);
    assert.equal(canManageProjects("PROJECT_MANAGER"), true);
    assert.equal(canManageProjects("REVIEWER"), false);
    assert.equal(canManageAgents("OWNER"), true);
    assert.equal(canManageAgents("ADMIN"), true);
    assert.equal(canManageAgents("PROJECT_MANAGER"), false);
    assert.equal(canManageAgents("CONTRIBUTOR"), false);
  });

  it("shows an agent that belongs to the organization", () => {
    const agent = {
      id: "44444444-4444-7444-8444-444444444444",
      agent_key: "evidence-request",
      name: "Evidence request",
      role: "Requests population files",
      status: "ACTIVE",
    };
    const model = deriveShell(
      snapshot({
        requestedSection: "agents",
        requestedAgentId: agent.id,
        agents: [agent],
        agentDetail: {
          ...agent,
          description: "Asks for the listed evidence.",
          revision: 1,
          input_schema: { type: "object" },
          output_schema: { type: "object" },
          allowed_tool_ids: ["mail.draft"],
          model_config_ref: "audit-model",
          max_iterations: 4,
          time_budget_seconds: 600,
          version: 1,
        },
      }),
    );
    assert.equal(model.status, "ready");
    if (model.status !== "ready") {
      return;
    }
    assert.equal(model.selectedAgent?.name, "Evidence request");
    assert.equal(model.canManageAgents, true);
    assert.equal(model.agentDetail?.revision, 1);
    const hidden = deriveShell(
      snapshot({
        requestedSection: "agents",
        requestedAgentId: "55555555-5555-7555-8555-555555555555",
        agents: [agent],
      }),
    );
    if (hidden.status === "ready") {
      assert.equal(hidden.selectedAgent, null);
    }
  });

  it("keeps project tasks on the overview", () => {
    const model = deriveShell(
      snapshot({
        requestedSection: "overview",
        tasks: [
          {
            id: "44444444-4444-7444-8444-444444444444",
            title: "Collect population",
            status: "BLOCKED",
            priority: "HIGH",
            deadline: "2026-12-01T00:00:00Z",
            assignee_name: null,
          },
        ],
      }),
    );
    assert.equal(model.status, "ready");
    if (model.status === "ready") {
      assert.equal(model.tasks[0]?.status, "BLOCKED");
      assert.equal(model.taskDetail, null);
    }
  });

  it("can show that notifications are unavailable", () => {
    const model = deriveShell(snapshot({ notifications: "unavailable" }));
    assert.equal(model.status, "ready");
    if (model.status === "ready") {
      assert.equal(model.notifications, "unavailable");
    }
  });
});

describe("projectLabels", () => {
  const project = (
    id: string,
    name: string,
    clientName: string,
    periodEnd: string | null,
  ) => ({ id, name, clientName, periodEnd }) as Project;

  it("puts the client first, and tells apart engagements that still match", () => {
    const labels = projectLabels([
      project("a", "SOX FY 2027", "Contoso Ltd", "2027-03-31"),
      project("b", "SOX FY 2027", "Northwind", "2027-06-30"),
      project("c", "SOX FY 2027", "Contoso Ltd", "2027-12-31"),
      project("d", "Internal review", "", null),
    ]);
    assert.equal(labels.get("b"), "Northwind · SOX FY 2027");
    assert.equal(
      labels.get("a"),
      "Contoso Ltd · SOX FY 2027 (period end 2027-03-31)",
    );
    assert.equal(
      labels.get("c"),
      "Contoso Ltd · SOX FY 2027 (period end 2027-12-31)",
    );
    assert.equal(labels.get("d"), "Internal review");
  });
});

describe("the engagement opened by default", () => {
  const archived = {
    ...project,
    id: "44444444-4444-7444-8444-444444444444",
    name: "SOX 2025",
    status: "ARCHIVED",
  };

  it("opens one still in use, never an archived one while another is open", () => {
    const model = deriveShell(
      snapshot({ projects: [archived, project], requestedProjectId: null }),
    );
    assert.equal(
      model.status === "ready" && model.selectedProject?.id,
      project.id,
    );
    assert.equal(projectIdInList([archived, project], null), project.id);
    // The page's data and the header agree on it.
    assert.equal(projectIdInList([archived, project], "unknown"), project.id);
  });

  it("still opens an archived engagement when it is asked for, or when all are", () => {
    const asked = deriveShell(
      snapshot({
        projects: [archived, project],
        requestedProjectId: archived.id,
      }),
    );
    assert.equal(
      asked.status === "ready" && asked.selectedProject?.id,
      archived.id,
    );
    assert.equal(
      projectIdInList([archived, project], archived.id),
      archived.id,
    );
    assert.equal(projectIdInList([archived], null), archived.id);
  });
});

describe("switcherProjects", () => {
  const project = (id: string, status: string) => ({ id, status }) as Project;
  const all = [
    project("a", "ACTIVE"),
    project("b", "ARCHIVED"),
    project("c", "COMPLETED"),
    project("d", "DRAFT"),
  ];

  it("leaves archived engagements out of the switcher", () => {
    assert.deepEqual(
      switcherProjects(all, "a").map((item) => item.id),
      ["a", "c", "d"],
    );
    assert.deepEqual(
      switcherProjects(all, null).map((item) => item.id),
      ["a", "c", "d"],
    );
  });

  it("keeps the open engagement in place even when it is archived", () => {
    assert.deepEqual(
      switcherProjects(all, "b").map((item) => item.id),
      ["a", "b", "c", "d"],
    );
  });
});

describe("lockedBeforeLaunch", () => {
  it("keeps the engagement sections closed until the engagement launches", () => {
    const draft = { status: "DRAFT" };
    const active = { status: "ACTIVE" };
    const sections = [
      "controls",
      "evidence",
      "plan",
      "timeline",
      "approvals",
      "overview",
      "console",
      "deficiencies",
    ] as const;
    for (const section of sections) {
      assert.equal(lockedBeforeLaunch(section, draft), true, section);
      assert.equal(lockedBeforeLaunch(section, active), false, section);
    }
    // Setup, the workforce, and the engagements list stay open.
    assert.equal(lockedBeforeLaunch("setup", draft), false);
    assert.equal(lockedBeforeLaunch("agents", draft), false);
    assert.equal(lockedBeforeLaunch("projects", draft), false);
    assert.equal(lockedBeforeLaunch("controls", null), false);
  });
});

describe("sign-in prompt", () => {
  it("never asks a member to sign in while a page is loading", () => {
    assert.equal(showsSignInPrompt({ status: "loading" }), false);
    assert.equal(showsSignInPrompt({ status: "denied" }), true);
    assert.equal(showsSignInPrompt({ status: "error" }), true);
    assert.equal(
      showsSignInPrompt({ status: "empty", email: "a@example.com" }),
      true,
    );
  });
});

describe("the six destinations and the older addresses (M2c)", () => {
  const org = "01a15b1a-5bec-7b26-aab2-4c7f84a889b4";
  const project = "01a15b1a-5d67-7fde-8120-1314701cbb30";
  const control = "01a15ad5-b710-7e67-9620-4c226f5f27c1";
  const route = (query: Record<string, string | string[]>) =>
    resolveRoute({ organization: org, project, ...query });
  const target = (query: Record<string, string | string[]>) => {
    const found = route(query).redirect;
    assert.ok(found !== null, `no redirect for ${JSON.stringify(query)}`);
    const params = new URLSearchParams(found.slice(2));
    return Object.fromEntries(params.entries());
  };

  it("keeps the destinations and the retained pages where they are", () => {
    for (const section of [
      "overview",
      "controls",
      "planning",
      "testing",
      "review",
      "evidence",
      "reports",
      "settings",
      "console",
      "approvals",
      "projects",
    ] as const) {
      const found = route({ section });
      assert.equal(found.redirect, null, section);
      assert.equal(found.section, section);
    }
    assert.equal(route({}).section, "overview");
    assert.equal(route({ section: "nowhere" }).section, "overview");
  });

  it("redirects every moved section with its record kept", () => {
    // Testing's plans and reviews (until 25 October 2026): a control's plan on its
    // tab, the phases view, and the reviews open Planning and Review.
    assert.deepEqual(
      target({
        section: "testing",
        control,
        tab: "evidence",
        filter: "APPROVED",
      }),
      {
        organization: org,
        project,
        control,
        tab: "evidence",
        filter: "APPROVED",
        section: "planning",
      },
    );
    assert.deepEqual(target({ section: "testing", view: "phases" }), {
      organization: org,
      project,
      view: "phases",
      section: "planning",
    });
    assert.deepEqual(target({ section: "testing", view: "plans" }), {
      organization: org,
      project,
      section: "planning",
    });
    assert.deepEqual(
      target({ section: "testing", view: "review", filter: "mine" }),
      {
        organization: org,
        project,
        filter: "mine",
        section: "review",
      },
    );
    // Testing itself stands, on its results.
    assert.equal(route({ section: "testing", view: "results" }).redirect, null);
    // Project plan and Timeline: Reports' schedule tabs.
    assert.deepEqual(target({ section: "plan" }), {
      organization: org,
      project,
      section: "reports",
      view: "schedule",
    });
    assert.deepEqual(target({ section: "timeline" }), {
      organization: org,
      project,
      section: "reports",
      view: "timeline",
    });
    // Deficiencies: the register and one deficiency, the log dialog for a control.
    assert.deepEqual(target({ section: "deficiencies", deficiency: control }), {
      organization: org,
      project,
      deficiency: control,
      section: "reports",
      view: "deficiencies",
    });
    assert.deepEqual(target({ section: "deficiencies", new: control }), {
      organization: org,
      project,
      new: control,
      section: "reports",
      view: "deficiencies",
    });
    // Engagement settings: an agent; a task. Setup is no longer moved by its address:
    // where it lives follows the engagement's status (setupPlacement, below).
    assert.equal(route({ section: "setup", step: "team" }).redirect, null);
    // The firm's Engagements and Library left Settings for the menu (decided by the
    // product owner): their own addresses stand, and an address stored when they were
    // Settings tabs opens them with its record kept.
    assert.equal(
      route({ section: "library", control: "ITGC-AC-01", tab: "attributes" })
        .redirect,
      null,
    );
    assert.equal(
      route({ section: "projects", view: "clients" }).redirect,
      null,
    );
    assert.deepEqual(
      target({
        section: "settings",
        view: "library",
        control: "ITGC-AC-01",
        tab: "attributes",
      }),
      {
        organization: org,
        project,
        control: "ITGC-AC-01",
        tab: "attributes",
        section: "library",
      },
    );
    assert.deepEqual(
      target({
        section: "settings",
        view: "engagements",
        manage: "engagement",
      }),
      {
        organization: org,
        project,
        manage: "engagement",
        section: "projects",
      },
    );
    assert.deepEqual(target({ section: "agents", agent: control }), {
      organization: org,
      project,
      agent: control,
      section: "settings",
      view: "workforce",
    });
    assert.deepEqual(target({ section: "tasks", task: control }), {
      organization: org,
      project,
      task: control,
      section: "settings",
      view: "tasks",
    });
    // A repeated parameter travels whole.
    const found = route({
      section: "plan",
      stage: ["PLANNED", "TESTING"],
    }).redirect;
    assert.ok(found !== null);
    assert.deepEqual(new URLSearchParams(found.slice(2)).getAll("stage"), [
      "PLANNED",
      "TESTING",
    ]);
  });

  it("keeps setup as onboarding until launch, and in Settings after", () => {
    const query = {
      organization: org,
      project,
      section: "setup",
      step: "team",
    };
    // A draft: onboarding stands; Settings' setup tab sends it back to onboarding.
    assert.equal(setupPlacement(route(query), "DRAFT", query), null);
    const settingsTab = {
      organization: org,
      project,
      section: "settings",
      view: "engagement",
      step: "team",
    };
    assert.equal(
      setupPlacement(route(settingsTab), "DRAFT", settingsTab),
      `/?organization=${org}&project=${project}&step=team&section=setup`,
    );
    // Launched: onboarding's address opens Settings' setup tab, the step kept.
    assert.equal(
      setupPlacement(route(query), "ACTIVE", query),
      `/?organization=${org}&project=${project}&step=team&section=settings&view=engagement`,
    );
    assert.equal(
      setupPlacement(route(settingsTab), "ACTIVE", settingsTab),
      null,
    );
    // No engagement open, or another page: nothing moves.
    assert.equal(setupPlacement(route(query), null, query), null);
    const home = { organization: org, project, section: "overview" };
    assert.equal(setupPlacement(route(home), "DRAFT", home), null);
  });

  it("links to setup where it lives, so no page takes the redirect", () => {
    // A redirect issued once the page streams is reported as a failed server render.
    const setup = () =>
      new URLSearchParams({ organization: org, section: "setup", step: "rcm" });
    assert.equal(
      placeSetup(setup(), "ACTIVE").toString(),
      `organization=${org}&section=settings&step=rcm&view=engagement`,
    );
    assert.equal(
      placeSetup(setup(), "DRAFT").toString(),
      `organization=${org}&section=setup&step=rcm`,
    );
    assert.equal(
      placeSetup(setup(), null).toString(),
      `organization=${org}&section=setup&step=rcm`,
    );
    const controls = new URLSearchParams({ section: "controls" });
    assert.equal(placeSetup(controls, "ACTIVE").get("section"), "controls");
  });

  it("returns a posted setup form to the page it came from", () => {
    const back = (referer: string | null) =>
      setupReturn(new URLSearchParams(), referer).toString();
    const from = (section: string) =>
      `http://localhost:3000/?organization=${org}&section=${section}`;
    assert.equal(back(from("controls")), "section=controls");
    assert.equal(back(from("settings")), "section=settings&view=engagement");
    assert.equal(back(from("setup")), "section=setup");
    assert.equal(back(null), "section=setup");
    assert.equal(back("not a url"), "section=setup");
  });

  it("names the page a destination's tab renders", () => {
    assert.deepEqual(route({ section: "reports" }), {
      section: "reports",
      page: "deficiencies",
      tab: "deficiencies",
      redirect: null,
    });
    assert.equal(route({ section: "reports", view: "schedule" }).page, "plan");
    assert.equal(
      route({ section: "reports", view: "timeline" }).page,
      "timeline",
    );
    assert.equal(route({ section: "reports", view: "status" }).page, "reports");
    assert.equal(route({ section: "reports", view: "x" }).page, "deficiencies");
    assert.equal(route({ section: "settings" }).page, "setup");
    assert.equal(
      route({ section: "settings", view: "workforce" }).page,
      "agents",
    );
    assert.equal(route({ section: "settings", view: "tasks" }).page, "tasks");
    assert.deepEqual(route({ section: "library" }), {
      section: "library",
      page: "library",
      tab: null,
      redirect: null,
    });
    assert.equal(route({ section: "projects" }).page, "projects");
    assert.equal(
      destinationHref("reports", "schedule", org, project),
      `/?organization=${org}&project=${project}&section=reports&view=schedule`,
    );
    assert.deepEqual(DESTINATIONS, [
      "overview",
      "controls",
      "register",
      "planning",
      "evidence",
      "testing",
      "review",
      "reports",
      "settings",
      "projects",
      "library",
    ]);
  });
});

describe("Controls on a page of its own (26 October 2026)", () => {
  const route = (params: Record<string, string>) => resolveRoute(params);
  it("sends the Controls tab's address to Controls, with its filter", () => {
    const found = route({
      section: "controls",
      pane: "controls",
      for: "system:abc",
    });
    assert.ok(found.redirect !== null);
    const params = new URLSearchParams(found.redirect.slice(2));
    assert.equal(params.get("section"), "register");
    assert.equal(params.get("for"), "system:abc");
    assert.equal(params.get("pane"), null);
    // A control's own page stays where it is.
    assert.equal(
      route({ section: "controls", pane: "controls", control: "c1" }).redirect,
      null,
    );
  });

  it("sends Planning's prior year back to Systems & Processes' References", () => {
    const found = route({ section: "planning", view: "prior-year" });
    assert.ok(found.redirect !== null);
    const params = new URLSearchParams(found.redirect.slice(2));
    assert.equal(params.get("section"), "controls");
    assert.equal(params.get("pane"), "references");
    assert.equal(params.get("view"), null);
  });
});

describe("the menu before the first engagement (27 October 2026)", () => {
  const engagementPages = [
    "controls",
    "register",
    "planning",
    "evidence",
    "testing",
    "review",
    "reports",
    "settings",
  ] as const;

  it("keeps Home and the firm's pages with no engagement open", () => {
    for (const section of ["overview", "projects", "library"] as const) {
      assert.equal(shownInMenu(section, false), true, section);
    }
  });

  it("hides the engagement's own pages until there is one", () => {
    for (const section of engagementPages) {
      assert.equal(shownInMenu(section, false), false, section);
    }
  });

  it("lists every page once an engagement is open", () => {
    for (const section of [
      ...engagementPages,
      "overview",
      "projects",
      "library",
    ] as const) {
      assert.equal(shownInMenu(section, true), true, section);
    }
  });
});

describe("Home with nothing in scope yet (27 October 2026)", () => {
  const org = "11111111-1111-7111-8111-111111111111";
  const engagement = (status: string, controls: number) => ({
    id: "22222222-2222-7222-8222-222222222222",
    status,
    controls,
  });

  it("opens a launched engagement without controls on Systems & Processes", () => {
    const href = homePlacement("overview", org, engagement("ACTIVE", 0));
    assert.ok(href !== null);
    const params = new URLSearchParams(href.slice(href.indexOf("?") + 1));
    assert.equal(params.get("section"), "controls");
    assert.equal(params.get("project"), engagement("ACTIVE", 0).id);
    assert.equal(params.get("organization"), org);
  });

  it("is where signing in lands: the address with no section is Home", () => {
    assert.equal(resolveRoute({}).section, "overview");
  });

  it("keeps Home once there are controls, before launch, and when closed", () => {
    assert.equal(homePlacement("overview", org, engagement("ACTIVE", 3)), null);
    assert.equal(homePlacement("overview", org, engagement("DRAFT", 0)), null);
    assert.equal(
      homePlacement("overview", org, engagement("COMPLETED", 0)),
      null,
    );
    assert.equal(
      homePlacement("overview", org, engagement("ARCHIVED", 0)),
      null,
    );
    assert.equal(homePlacement("overview", org, null), null);
  });

  it("leaves every other page where it is", () => {
    assert.equal(homePlacement("evidence", org, engagement("ACTIVE", 0)), null);
    assert.equal(homePlacement("controls", org, engagement("ACTIVE", 0)), null);
  });
});
