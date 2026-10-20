import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CONTROL_CATEGORIES,
  categoryOf,
  DOMAINS,
  domainTester,
  engagementTypeLabel,
  families,
  kindForDomain,
  landingStep,
  launchNextSteps,
  parseLaunch as launchParse,
  parseImport,
  parseOnboarding,
  parsePreview,
  parseSetupNotice,
  parseStep,
  parseTemplateDraft,
  pendingSuggestions,
  periodStartFor,
  pickCategory,
  previewChoices,
  RCM_MAX_BYTES,
  rcmUploadNoticeFor,
  rcmUploadTarget,
  scopeCounts,
  setupAttention,
  setupNoticeFor,
  setupProgress,
  setupWrite,
  stepReadiness,
  stepStatusLabel,
  systemOffers,
  templateUploadNoticeFor,
  templateUploadTarget,
  uniqueKeys,
} from "../apps/web/src/onboarding-model.ts";

const organizationId = "11111111-1111-7111-8111-111111111111";
const projectId = "22222222-2222-7222-8222-222222222222";
const controlId = "33333333-3333-7333-8333-333333333333";
const appId = "44444444-4444-7444-8444-444444444444";
const ids = { organization_id: organizationId, project_id: projectId };
const base = `/organizations/${organizationId}/projects/${projectId}/onboarding`;

function onboarding(
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    project_id: projectId,
    project_name: "SOX 2027",
    project_status: "DRAFT",
    scope: "ITGCs",
    settings: {
      period_end: "2027-12-31",
      client_coordinator_name: "Pat",
      client_coordinator_email: "pbc@client.example",
      client_domains: ["client.example"],
      pbc_due_days: 10,
      pbc_follow_up_days: 3,
      pbc_max_follow_ups: 2,
      templates_confirmed_at: null,
      kicked_off_at: null,
      version: 3,
    },
    applications: [{ id: appId, name: "SAP ERP", description: "" }],
    team: [],
    candidates: [],
    controls: [
      {
        id: controlId,
        control_ref: "ITGC-AC-01",
        domain: "ACCESS",
        title: "New user access is approved",
        risk: "r",
        activity: "a",
        frequency: "EVENT_DRIVEN",
        nature: "MANUAL",
        key_control: true,
        included: true,
        owner_name: "Dana",
        owner_email: "dana@client.example",
        application_ids: [appId],
        test_attributes: ["A request exists"],
        pbc_items: ["Population of new users"],
        template_key: "itgc",
        agent_key: "itgc-access-tester",
        sample_size: 25,
        version: 2,
      },
    ],
    templates: [],
    agents: [],
    readiness: [
      {
        step: "scope",
        title: "Scope",
        complete: true,
        issues: [],
        advisories: [],
      },
      {
        step: "team",
        title: "Team",
        complete: false,
        issues: ["Name a lead."],
      },
      { step: "agents", title: "AI workforce", complete: true, issues: [] },
    ],
    ready: false,
    plan: null,
    started: false,
    ...extra,
  };
}

describe("period start from the period end", () => {
  it("starts a calendar year on 1 January and a fiscal year the day after last year's end", () => {
    assert.equal(periodStartFor("2026-12-31"), "2026-01-01");
    assert.equal(periodStartFor("2027-03-31"), "2026-04-01");
    assert.equal(periodStartFor("2024-02-29"), "2023-03-01");
    assert.equal(periodStartFor("2026-02-31"), null);
    assert.equal(periodStartFor(""), null);
  });
});

describe("engagement setup model", () => {
  it("parses the setup and counts progress without the agents step", () => {
    const parsed = parseOnboarding(onboarding());
    assert.ok(parsed !== null);
    assert.equal(parsed.periodEnd, "2027-12-31");
    assert.equal(parsed.controls[0]?.sampleSize, 25);
    assert.equal(parsed.templatesConfirmed, false);
    // Four work steps (requests are drafted after a plan is approved, not set up):
    // the profile is ready, the team is next, controls and workpapers are untouched.
    assert.deepEqual(setupProgress(parsed), {
      done: 1,
      total: 4,
      next: "team",
    });
    assert.deepEqual(stepReadiness(parsed, "controls"), {
      complete: false,
      issues: [],
      advisories: [],
    });
    assert.equal(parsed.engagementType, "SOX_ITGC");
    assert.equal(parsed.setupDraft, null);
    assert.deepEqual(parsed.ownerSuggestions, []);
    assert.equal(parseOnboarding({ project_id: projectId }), null);
  });

  it("names a step from where the engagement is, and keeps open points after launch", () => {
    const draft = parseOnboarding(onboarding());
    assert.ok(draft !== null);
    assert.equal(
      stepStatusLabel(draft, "overview", "setup"),
      "Where setup stands",
    );
    assert.equal(stepStatusLabel(draft, "profile", "setup"), "Ready");
    assert.equal(stepStatusLabel(draft, "team", "setup"), "1 to do");
    assert.equal(stepStatusLabel(draft, "launch", "setup"), "Not ready");
    const ready = parseOnboarding(onboarding({ ready: true }));
    assert.ok(ready !== null);
    assert.equal(stepStatusLabel(ready, "launch", "ready"), "Ready to launch");

    const running = parseOnboarding(
      onboarding({
        started: true,
        ready: true,
        project_status: "ACTIVE",
        readiness: [
          {
            step: "scope",
            title: "Profile",
            complete: false,
            issues: [
              "The engagement's name points to 2029, but the period ends 31 December 2027.",
              "The scope names fiscal year 2029, but the period ends 31 December 2027.",
              "The fiscal year is FY2029, but the period ends 31 December 2027.",
            ],
          },
          { step: "team", title: "Team", complete: true, issues: [] },
          { step: "rcm", title: "Controls", complete: true, issues: [] },
          {
            step: "workpapers",
            title: "Workpapers",
            complete: true,
            issues: [],
          },
        ],
      }),
    );
    assert.ok(running !== null);
    assert.equal(
      stepStatusLabel(running, "overview", "running"),
      "Where the work stands",
    );
    assert.equal(stepStatusLabel(running, "profile", "running"), "3 open");
    assert.equal(stepStatusLabel(running, "team", "running"), "Ready");
    assert.equal(stepStatusLabel(running, "launch", "running"), "Running");
    assert.equal(stepStatusLabel(running, "launch", "paused"), "Paused");
    assert.equal(stepStatusLabel(running, "launch", "completed"), "Completed");
    assert.equal(stepStatusLabel(running, "launch", "closed"), "Archived");
    const open = setupAttention(running);
    assert.equal(open.length, 1);
    assert.equal(open[0]?.step, "profile");
    assert.equal(open[0]?.title, "Engagement profile: 3 open");
    assert.match(open[0]?.detail ?? "", /points to 2029.*And 2 more/);
    assert.deepEqual(
      setupAttention(draft).map((item) => item.step),
      ["team"],
    );
  });

  it("parses a workpaper preview", () => {
    const parsed = parsePreview({
      reference: "ITGC-AC-01",
      title: "ITGC-AC-01 New user access is approved",
      template_title: "IT general control",
      template_version: 2,
      kind: "ITGC",
      purpose: "p",
      tabs: [
        {
          key: "interim",
          title: "Interim testing",
          period: "interim",
          reference: "ITGC-AC-01-TOE",
          sections: [
            {
              title: "Testing matrix",
              kind: "matrix",
              guidance: "",
              fields: [],
              columns: ["Sample", "A. A request exists"],
              rows: [["Sample 1", ""]],
            },
          ],
        },
      ],
    });
    assert.equal(parsed?.kind, "ITGC");
    assert.equal(parsed?.tabs[0]?.reference, "ITGC-AC-01-TOE");
    assert.equal(parsed?.tabs[0]?.sections[0]?.rows[0]?.[0], "Sample 1");
    assert.equal(parsePreview({ title: "x" }), null);
    assert.equal(parsePreview({ reference: "x", sections: [] }), null);
  });

  it("opens on the overview, keeps old step links, and ignores unknown notices", () => {
    // Evidence requests left setup: old links land on launch.
    assert.equal(parseStep("requests"), "launch");
    // A launched engagement opens where the work stands; a named step always wins.
    assert.equal(landingStep(null, true), "launch");
    assert.equal(landingStep("", true), "launch");
    assert.equal(landingStep(null, false), "overview");
    assert.equal(landingStep("overview", true), "overview");
    assert.equal(landingStep("team", true), "team");
    assert.equal(parseStep("pbc"), "launch");
    assert.equal(parseStep("rcm"), "controls");
    // Workpaper templates are their own step now.
    assert.equal(parseStep("workpapers"), "workpapers");
    assert.equal(parseStep("start"), "launch");
    assert.equal(parseStep("drop table"), "overview");
    assert.equal(parseStep(null), "overview");
    assert.equal(parseSetupNotice("setup-launched"), "setup-launched");
    assert.equal(parseSetupNotice("whatever"), null);
  });

  it("builds each setup write and refuses bad input", () => {
    assert.deepEqual(
      setupWrite({
        ...ids,
        intent: "scope",
        scope: " ITGCs ",
        period_end: "2027-12-31",
      }),
      {
        intent: "scope",
        step: "profile",
        method: "PATCH",
        path: `${base}/scope`,
        body: { scope: "ITGCs", period_end: "2027-12-31" },
      },
    );
    const control = setupWrite(
      {
        ...ids,
        intent: "control",
        control_id: controlId,
        version: "2",
        included: "on",
        owner_name: "Dana",
        owner_email: "Dana@Client.Example",
        frequency: "QUARTERLY",
        nature: "MANUAL",
        template_key: "itgc",
      },
      { application_ids: [appId] },
    );
    assert.ok(!("error" in control));
    assert.deepEqual(control.body, {
      version: 2,
      included: true,
      key_control: false,
      owner_name: "Dana",
      owner_email: "dana@client.example",
      frequency: "QUARTERLY",
      nature: "MANUAL",
      application_ids: [appId],
      template_key: "itgc",
      acknowledge_testing: false,
    });
    // Setup saves the cadence only; the client contacts are set in Evidence.
    const pbc = setupWrite({
      ...ids,
      intent: "pbc",
      client_coordinator_email: "pbc@client.example",
      pbc_due_days: "10",
      pbc_follow_up_days: "3",
      pbc_max_follow_ups: "2",
    });
    assert.ok(!("error" in pbc));
    assert.deepEqual(pbc.body, {
      pbc_due_days: 10,
      pbc_follow_up_days: 3,
      pbc_max_follow_ups: 2,
    });
    const contacts = setupWrite({
      ...ids,
      intent: "evidence-contacts",
      client_coordinator_name: "Pat",
      client_coordinator_email: "PBC@client.example",
      client_domains: "Client.Example, it.client.example",
    });
    assert.ok(!("error" in contacts));
    assert.equal(contacts.method, "PATCH");
    assert.ok(contacts.path.endsWith("/onboarding/evidence-contacts"));
    assert.deepEqual(contacts.body, {
      client_coordinator_name: "Pat",
      client_coordinator_email: "pbc@client.example",
      client_domains: ["client.example", "it.client.example"],
    });
    assert.deepEqual(
      setupWrite({
        ...ids,
        intent: "evidence-contacts",
        client_coordinator_email: "nope",
      }),
      { error: "invalid" },
    );
    for (const bad of [
      { ...ids, intent: "scope", scope: "password: hunter2", period_end: "" },
      { ...ids, intent: "scope", scope: "x", period_end: "31/12/2027" },
      {
        ...ids,
        intent: "add-member",
        user_id: appId,
        engagement_role: "OWNER",
      },
      {
        ...ids,
        intent: "bulk-owner",
        domain: "HR",
        owner_name: "x",
        owner_email: "a@b.co",
      },
      { ...ids, intent: "approve", plan_id: appId, fingerprint: "short" },
      { ...ids, intent: "launch", fingerprint: "short" },
      { ...ids, intent: "remove-application", application_id: "../team" },
      { ...ids, intent: "pbc", pbc_due_days: "200" },
      { ...ids, intent: "drop" },
      { organization_id: "x", project_id: projectId, intent: "propose" },
    ]) {
      assert.deepEqual(setupWrite(bad), { error: "invalid" });
    }
    assert.deepEqual(
      setupWrite(
        {
          ...ids,
          intent: "control",
          control_id: controlId,
          version: "2",
          owner_name: "",
          owner_email: "",
          frequency: "DAILY",
          nature: "MANUAL",
        },
        { application_ids: ["not-a-uuid"] },
      ),
      { error: "invalid" },
    );
  });

  it("maps API results to notices", () => {
    assert.equal(setupNoticeFor("scope", 200, ""), "setup-saved");
    assert.equal(setupNoticeFor("approve", 200, ""), "setup-launched");
    assert.equal(setupNoticeFor("launch", 200, ""), "setup-launched");
    assert.equal(
      setupNoticeFor("launch", 409, "setup changed since the plan was shown"),
      "setup-changed",
    );
    assert.equal(
      setupNoticeFor("scope", 409, "engagement has started"),
      "setup-started",
    );
    assert.equal(
      setupNoticeFor("propose", 409, "setup is not complete"),
      "setup-incomplete",
    );
    assert.equal(
      setupNoticeFor("approve", 409, "plan is not the current proposal"),
      "setup-changed",
    );
    assert.equal(setupNoticeFor("scope", 403, ""), "setup-denied");
    assert.equal(setupNoticeFor("scope", 422, ""), "setup-invalid");
    assert.equal(setupNoticeFor("scope", 0, ""), "setup-unavailable");
  });
});

describe("the planner's setup draft", () => {
  it("parses the draft and the owner suggestions, and says what is still pending", () => {
    const parsed = parseOnboarding(
      onboarding({
        setup_draft: {
          status: "IDLE",
          drafting: false,
          note: "",
          source: "AGENT",
          scope_text: "The engagement covers Acme's ITGCs.",
          period_end: "2027-12-31",
          pbc_due_days: 12,
          pbc_follow_up_days: 4,
          pbc_max_follow_ups: 3,
          reasons: { scope: "From the records.", cadence: "Many controls." },
          drafted_at: "2026-10-12T10:00:00Z",
          version: 3,
        },
        owner_suggestions: [
          {
            owner_name: "Lee Park",
            owner_email: "lee.park@client.example",
            control_refs: ["ITGC-CM-01"],
            pattern: "first.last",
          },
        ],
      }),
    );
    assert.ok(parsed !== null);
    assert.equal(parsed.setupDraft?.source, "AGENT");
    assert.equal(parsed.setupDraft?.version, 3);
    assert.equal(parsed.setupDraft?.reasons.cadence, "Many controls.");
    assert.equal(
      parsed.ownerSuggestions[0]?.ownerEmail,
      "lee.park@client.example",
    );
    // The scope differs from the draft; the period end already matches.
    assert.deepEqual(pendingSuggestions(parsed), {
      scope: true,
      periodEnd: false,
      cadence: true,
    });
    const drafting = parseOnboarding(
      onboarding({ setup_draft: { status: "WORKING", source: "NONE" } }),
    );
    assert.equal(drafting?.setupDraft?.drafting, true);
    assert.deepEqual(pendingSuggestions(drafting ?? parsed), {
      scope: false,
      periodEnd: false,
      cadence: false,
    });
  });

  it("builds the profile, draft, and accept writes", () => {
    assert.deepEqual(
      setupWrite({
        ...ids,
        intent: "profile",
        client_name: " Acme Corp ",
        engagement_type: "SOX_FULL",
        period_end: "",
      }),
      {
        intent: "profile",
        step: "profile",
        method: "PATCH",
        path: `${base}/profile`,
        body: {
          client_name: "Acme Corp",
          engagement_type: "SOX_FULL",
          period_end: null,
        },
      },
    );
    assert.deepEqual(
      setupWrite({
        ...ids,
        intent: "profile",
        client_name: "x",
        engagement_type: "OTHER",
      }),
      { error: "invalid" },
    );
    const asked = setupWrite({ ...ids, intent: "suggest", step: "team" });
    assert.ok(!("error" in asked));
    assert.equal(asked.path, `${base}/suggestions/draft`);
    assert.equal(asked.step, "team");
    assert.deepEqual(
      setupWrite(
        {
          ...ids,
          intent: "accept-suggestions",
          step: "profile",
          draft_version: "3",
        },
        { field: ["scope", "scope", "period_end", "bogus"] },
      ),
      {
        intent: "accept-suggestions",
        step: "profile",
        method: "POST",
        path: `${base}/suggestions/accept`,
        body: { version: 3, fields: ["scope", "period_end"] },
      },
    );
    assert.deepEqual(
      setupWrite(
        { ...ids, intent: "accept-suggestions", draft_version: "3" },
        {},
      ),
      { error: "invalid" },
    );
    assert.equal(setupNoticeFor("suggest", 200, ""), "setup-drafting");
    assert.equal(
      setupNoticeFor("accept-suggestions", 200, ""),
      "setup-accepted",
    );
    assert.equal(engagementTypeLabel("IT_AUDIT"), "IT audit (non-SOX)");
  });
});

describe("client RCM upload model", () => {
  const importId = "55555555-5555-7555-8555-555555555555";
  const uploadBase = `${base}/rcm/uploads/${importId}`;

  it("reads where the RCM came from and the open upload", () => {
    const parsed = parseOnboarding(
      onboarding({
        rcm_source: "UPLOAD",
        rcm_file_name: "Acme RCM.xlsx",
        open_import_id: importId,
      }),
    );
    assert.equal(parsed?.rcmSource, "UPLOAD");
    assert.equal(parsed?.rcmFileName, "Acme RCM.xlsx");
    assert.equal(parsed?.openImportId, importId);
    const odd = parseOnboarding(
      onboarding({ rcm_source: "SOMETHING", open_import_id: "../x" }),
    );
    assert.equal(odd?.rcmSource, "NONE");
    assert.equal(odd?.openImportId, null);
  });

  it("parses an upload with its columns, client terms, and preview", () => {
    const parsed = parseImport({
      id: importId,
      status: "MAPPING",
      file_name: "Acme RCM.csv",
      file_kind: "CSV",
      size_bytes: 2048,
      version: 2,
      sheets: [{ index: 0, name: "RCM", rows: 40 }],
      sheet_index: 0,
      header_row: 2,
      data_rows: 38,
      columns: [
        {
          index: 0,
          header: "Ctrl #",
          samples: ["AC 1.01"],
          field: "control_ref",
          suggested: "control_ref",
        },
      ],
      fields: [{ key: "control_ref", label: "Control ID", required: true }],
      values: {
        frequency: [
          {
            value: "As needed",
            count: 4,
            mapped: null,
            suggested: "EVENT_DRIVEN",
          },
        ],
      },
      preview: {
        importable: 37,
        skipped: [{ row: 9, reason: "No control ID." }],
        skipped_count: 1,
        warnings: [],
        problems: ['Map frequency values "As needed".'],
        controls: [],
        new_applications: ["SAP ERP"],
      },
      ready: false,
      replaces: 16,
    });
    assert.ok(parsed !== null);
    assert.equal(parsed.columns[0]?.header, "Ctrl #");
    assert.equal(parsed.values.frequency[0]?.suggested, "EVENT_DRIVEN");
    assert.equal(parsed.values.frequency[0]?.mapped, null);
    assert.deepEqual(parsed.values.domain, []);
    assert.equal(parsed.preview.skipped[0]?.row, 9);
    assert.equal(parsed.replaces, 16);
    assert.equal(parseImport({ id: importId }), null);
  });

  it("builds the mapping write from the column and term choices", () => {
    const write = setupWrite({
      ...ids,
      intent: "rcm-mapping",
      import_id: importId,
      version: "2",
      column_0: "control_ref",
      column_1: "activity",
      column_2: "custom",
      column_3: "frequency",
      value_field_0: "frequency",
      value_raw_0: "As needed",
      value_mapped_0: "EVENT_DRIVEN",
      value_field_1: "domain",
      value_raw_1: "",
      value_mapped_1: "",
    });
    assert.deepEqual(write, {
      intent: "rcm-mapping",
      step: "controls",
      method: "PATCH",
      path: `${uploadBase}/mapping`,
      body: {
        version: 2,
        column_fields: ["control_ref", "activity", "custom", "frequency"],
        values: [
          { field: "frequency", value: "As needed", mapped: "EVENT_DRIVEN" },
          { field: "domain", value: "", mapped: "" },
        ],
      },
    });
    assert.deepEqual(
      setupWrite({
        ...ids,
        intent: "rcm-layout",
        import_id: importId,
        version: "2",
        sheet_index: "1",
        header_row: "3",
      }),
      {
        intent: "rcm-layout",
        step: "controls",
        method: "PATCH",
        path: `${uploadBase}/layout`,
        body: { version: 2, sheet_index: 1, header_row: 3 },
      },
    );
    const imported = setupWrite({
      ...ids,
      intent: "rcm-import",
      import_id: importId,
      version: "3",
    });
    assert.ok(!("error" in imported));
    assert.equal(imported.path, `${uploadBase}/import`);
    const emails = setupWrite({
      ...ids,
      intent: "owner-emails",
      owner_name_0: "Dana Ruiz",
      owner_email_0: "Dana@Client.Example",
      owner_name_1: "Lee Park",
      owner_email_1: "",
    });
    assert.ok(!("error" in emails));
    assert.deepEqual(emails.body, {
      entries: [
        { owner_name: "Dana Ruiz", owner_email: "dana@client.example" },
      ],
    });
    for (const bad of [
      {
        ...ids,
        intent: "rcm-mapping",
        import_id: importId,
        version: "2",
        column_0: "control_ref",
        column_1: "control_ref",
      },
      {
        ...ids,
        intent: "rcm-mapping",
        import_id: importId,
        version: "2",
        column_0: "drop_table",
      },
      {
        ...ids,
        intent: "rcm-mapping",
        import_id: importId,
        version: "2",
        column_0: "control_ref",
        value_field_0: "frequency",
        value_raw_0: "Daily",
        value_mapped_0: "HOURLY",
      },
      {
        ...ids,
        intent: "rcm-mapping",
        import_id: importId,
        version: "2",
        column_0: "control_ref",
        value_field_0: "owner",
        value_raw_0: "x",
        value_mapped_0: "",
      },
      { ...ids, intent: "rcm-import", import_id: "../x", version: "2" },
      { ...ids, intent: "rcm-import", import_id: importId },
      {
        ...ids,
        intent: "rcm-layout",
        import_id: importId,
        version: "2",
        sheet_index: "0",
        header_row: "0",
      },
      {
        ...ids,
        intent: "owner-emails",
        owner_name_0: "Dana",
        owner_email_0: "",
      },
      {
        ...ids,
        intent: "owner-emails",
        owner_name_0: "Dana",
        owner_email_0: "not-an-email",
      },
    ]) {
      assert.deepEqual(setupWrite(bad), { error: "invalid" });
    }
  });

  it("checks an upload before it is sent and names the file only", () => {
    const target = rcmUploadTarget(ids, {
      name: "C:\\fakepath\\Acme RCM FY27.xlsx",
      size: 1200,
    });
    assert.deepEqual(target, {
      fileName: "Acme RCM FY27.xlsx",
      path: `${base}/rcm/uploads?file_name=Acme%20RCM%20FY27.xlsx`,
    });
    assert.equal(rcmUploadTarget(ids, { name: "rcm.exe", size: 10 }), null);
    assert.equal(rcmUploadTarget(ids, { name: "rcm.csv", size: 0 }), null);
    assert.equal(
      rcmUploadTarget(ids, { name: "rcm.csv", size: RCM_MAX_BYTES + 1 }),
      null,
    );
    assert.equal(rcmUploadTarget(ids, null), null);
    assert.equal(
      rcmUploadTarget(
        { organization_id: "x", project_id: projectId },
        { name: "rcm.csv", size: 10 },
      ),
      null,
    );
  });

  it("maps upload and import results to notices", () => {
    assert.equal(rcmUploadNoticeFor(200), "setup-rcm-uploaded");
    assert.equal(rcmUploadNoticeFor(413), "setup-rcm-large");
    assert.equal(rcmUploadNoticeFor(422), "setup-rcm-unreadable");
    assert.equal(rcmUploadNoticeFor(409), "setup-started");
    assert.equal(rcmUploadNoticeFor(403), "setup-denied");
    assert.equal(rcmUploadNoticeFor(0), "setup-unavailable");
    assert.equal(setupNoticeFor("rcm-import", 200, ""), "setup-rcm-imported");
    assert.equal(
      setupNoticeFor("rcm-import", 409, "mapping is incomplete"),
      "setup-rcm-incomplete",
    );
    assert.equal(parseSetupNotice("setup-rcm-imported"), "setup-rcm-imported");
  });
});

describe("client text keys", () => {
  it("keeps repeated client text distinct", () => {
    assert.deepEqual(
      uniqueKeys(["Risk", "Owner", "Risk", "Risk"], (item) => item).map(
        ([key]) => key,
      ),
      ["Risk", "Owner", "Risk#2", "Risk#3"],
    );
  });
});

describe("business process areas", () => {
  it("loads the chosen library areas and defaults to IT general controls", () => {
    const chosen = setupWrite(
      { ...ids, intent: "load-library" },
      { domains: ["ORDER_TO_CASH", "ITAC", "ORDER_TO_CASH"] },
    );
    assert.ok(!("error" in chosen));
    assert.deepEqual(chosen.body, { domains: ["ORDER_TO_CASH", "ITAC"] });
    const fallback = setupWrite({ ...ids, intent: "load-library" });
    assert.ok(!("error" in fallback));
    assert.deepEqual(fallback.body, {
      domains: ["ACCESS", "CHANGE", "OPERATIONS"],
    });
    assert.deepEqual(
      setupWrite({ ...ids, intent: "load-library" }, { domains: ["PAYROLL"] }),
      { error: "invalid" },
    );
  });

  it("sends a control's area and chosen tester, and refuses unknown ones", () => {
    const control = {
      ...ids,
      intent: "control",
      control_id: controlId,
      version: "2",
      owner_name: "",
      owner_email: "",
      frequency: "QUARTERLY",
      nature: "MANUAL",
    };
    const moved = setupWrite({
      ...control,
      domain: "PROCURE_TO_PAY",
      agent_key: "",
    });
    assert.ok(!("error" in moved));
    assert.equal(moved.body.domain, "PROCURE_TO_PAY");
    assert.equal("agent_key" in moved.body, false);
    const picked = setupWrite({
      ...control,
      domain: "ITAC",
      agent_key: "itgc-change-tester",
    });
    assert.ok(!("error" in picked));
    assert.equal(picked.body.agent_key, "itgc-change-tester");
    assert.deepEqual(setupWrite({ ...control, domain: "SALES" }), {
      error: "invalid",
    });
    assert.deepEqual(
      setupWrite({ ...control, agent_key: "reporting-analyst" }),
      {
        error: "invalid",
      },
    );
  });

  it("lists every standard area once and routes business cycles to the business tester", () => {
    const keys = DOMAINS.map(([key]) => key);
    assert.equal(keys.length, 15);
    assert.equal(new Set(keys).size, keys.length);
    assert.equal(domainTester("ACCESS"), "itgc-access-tester");
    assert.equal(domainTester("ORDER_TO_CASH"), "business-process-tester");
    assert.equal(domainTester("ITAC"), "business-process-tester");
  });

  it("parses the library areas", () => {
    const parsed = parseOnboarding(
      onboarding({
        library: [{ domain: "TAX", controls: 2, loaded: 1 }],
      }),
    );
    assert.deepEqual(parsed?.library, [
      { domain: "TAX", controls: 2, loaded: 1 },
    ]);
  });
});

describe("RCM control types", () => {
  it("puts every area in exactly one of IT, business process, or key reports", () => {
    const seen = CONTROL_CATEGORIES.flatMap((category) =>
      category.domains.map(([key]) => key),
    );
    assert.equal(seen.length, DOMAINS.length);
    assert.equal(new Set(seen).size, seen.length);
    assert.equal(categoryOf("ACCESS"), "it");
    assert.equal(categoryOf("ITAC"), "it");
    assert.equal(categoryOf("ORDER_TO_CASH"), "business");
    assert.equal(categoryOf("ENTITY"), "business");
    assert.equal(categoryOf("IPE"), "reports");
  });

  it("opens the asked tab, else the selected control's, else the first with controls", () => {
    const controls = [
      { id: "a", domain: "TAX" },
      { id: "b", domain: "IPE" },
    ];
    assert.equal(pickCategory("reports", controls, null), "reports");
    assert.equal(pickCategory(null, controls, "b"), "reports");
    assert.equal(pickCategory("drop", controls, null), "business");
    assert.equal(pickCategory(null, [], null), "it");
  });
});

describe("in-scope systems from the RCM", () => {
  const importId = "66666666-6666-7666-8666-666666666666";
  const upload = (systems: unknown) => ({
    id: importId,
    columns: [],
    values: {},
    preview: {},
    systems,
  });

  it("parses the agent's proposals", () => {
    const parsed = parseImport(
      upload({
        status: "READY",
        source: "MODEL",
        note: "",
        version: 4,
        proposals: [
          {
            key: "sap-ecc",
            name: "SAP ECC",
            layer: "APPLICATION",
            aliases: ["SAP ECC 6.0"],
            control_refs: ["AC-01", "AC-02"],
            controls: 2,
            evidence: "SAP ECC 6.0",
            found_in: "both",
            included: true,
          },
        ],
      }),
    );
    assert.equal(parsed?.systems.status, "READY");
    assert.equal(parsed?.systems.source, "MODEL");
    assert.equal(parsed?.systems.proposals[0]?.foundIn, "both");
    assert.deepEqual(parsed?.systems.proposals[0]?.controlRefs, [
      "AC-01",
      "AC-02",
    ]);
    const pending = parseImport(upload(undefined));
    assert.equal(pending?.systems.status, "PENDING");
    assert.deepEqual(pending?.systems.proposals, []);
  });

  it("builds the confirm and rescan writes and refuses bad choices", () => {
    const saved = setupWrite({
      ...ids,
      intent: "rcm-systems",
      import_id: importId,
      systems_version: "4",
      system_key_0: "sap-ecc",
      system_name_0: " SAP ECC (prod) ",
      system_layer_0: "APPLICATION",
      system_included_0: "on",
      system_key_1: "workday",
      system_name_1: "Workday",
      system_layer_1: "APPLICATION",
    });
    assert.deepEqual(saved, {
      intent: "rcm-systems",
      step: "controls",
      method: "PATCH",
      path: `${base}/rcm/uploads/${importId}/systems`,
      body: {
        systems_version: 4,
        choices: [
          {
            key: "sap-ecc",
            name: "SAP ECC (prod)",
            layer: "APPLICATION",
            included: true,
          },
          {
            key: "workday",
            name: "Workday",
            layer: "APPLICATION",
            included: false,
          },
        ],
      },
    });
    const rescan = setupWrite({
      ...ids,
      intent: "rcm-rescan",
      import_id: importId,
    });
    assert.ok(!("error" in rescan));
    assert.equal(rescan.path, `${base}/rcm/uploads/${importId}/systems/rescan`);
    for (const bad of [
      {
        system_key_0: "sap",
        system_name_0: "<b>x</b>",
        system_layer_0: "APPLICATION",
      },
      {
        system_key_0: "sap",
        system_name_0: "See https://x.example",
        system_layer_0: "TOOL",
      },
      { system_key_0: "sap", system_name_0: "SAP", system_layer_0: "NETWORK" },
      { system_key_0: "../x", system_name_0: "SAP", system_layer_0: "TOOL" },
    ]) {
      assert.deepEqual(
        setupWrite({
          ...ids,
          intent: "rcm-systems",
          import_id: importId,
          systems_version: "4",
          ...bad,
        }),
        { error: "invalid" },
      );
    }
  });
});

describe("in-scope systems live in the RCM step", () => {
  it("adds and removes systems from the RCM step", () => {
    const added = setupWrite({
      ...ids,
      intent: "add-application",
      name: "SAP S/4HANA",
      description: "",
    });
    assert.ok(!("error" in added));
    assert.equal(added.step, "controls");
    const removed = setupWrite({
      ...ids,
      intent: "remove-application",
      application_id: appId,
    });
    assert.ok(!("error" in removed));
    assert.equal(removed.step, "controls");
  });
});

describe("client terms mapped by the agent", () => {
  const importId = "77777777-7777-7777-8777-777777777777";

  it("parses each term's reason and the mapping status", () => {
    const parsed = parseImport({
      id: importId,
      columns: [],
      preview: {},
      values: {
        domain: [
          {
            value: "IT",
            count: 3,
            mapped: "ACCESS",
            suggested: null,
            reason: "Both controls are access.",
            mapped_by: "MODEL",
          },
        ],
      },
      terms: {
        status: "WORKING",
        mode: "REMAP",
        source: null,
        note: "",
        model_available: true,
      },
    });
    assert.equal(parsed?.values.domain[0]?.mappedBy, "MODEL");
    assert.equal(parsed?.values.domain[0]?.reason, "Both controls are access.");
    assert.deepEqual(parsed?.terms, {
      status: "WORKING",
      mode: "REMAP",
      source: null,
      note: "",
      modelAvailable: true,
    });
    const older = parseImport({
      id: importId,
      columns: [],
      values: {},
      preview: {},
    });
    assert.equal(older?.terms.status, "READY");
    assert.equal(older?.terms.modelAvailable, false);
  });

  it("asks the agent to remap every term", () => {
    assert.deepEqual(
      setupWrite({ ...ids, intent: "rcm-remap-terms", import_id: importId }),
      {
        intent: "rcm-remap-terms",
        step: "controls",
        method: "POST",
        path: `${base}/rcm/uploads/${importId}/terms/remap`,
        body: {},
      },
    );
    assert.deepEqual(
      setupWrite({ ...ids, intent: "rcm-remap-terms", import_id: "x" }),
      { error: "invalid" },
    );
  });
});

describe("controls per application", () => {
  it("shows one row per control ID with every system its instances cover", () => {
    const rows = [
      {
        id: "1",
        control_ref: "ITGC-AC-01",
        application_ids: ["sap"],
        application_id: "sap",
        application_name: "SAP ERP",
      },
      {
        id: "2",
        control_ref: "ITGC-AC-01",
        application_ids: ["oracle"],
        application_id: "oracle",
        application_name: "Oracle",
      },
      { id: "3", control_ref: "ITGC-CM-01", application_ids: [] },
    ];
    const parsed = parseOnboarding(onboarding({ controls: rows }));
    assert.ok(parsed !== null);
    assert.equal(parsed.controls[1]?.applicationName, "Oracle");
    assert.deepEqual(
      families(parsed.controls).map((control) => [
        control.id,
        control.controlRef,
        control.applicationIds,
      ]),
      [
        ["1", "ITGC-AC-01", ["sap", "oracle"]],
        ["3", "ITGC-CM-01", []],
      ],
    );
  });
});

describe("the Controls step's counts", () => {
  it("counts each system's copy, so a removed system leaves the counts", () => {
    const row = (
      id: string,
      ref: string,
      app: string,
      included: boolean,
    ): Record<string, unknown> => ({
      id,
      control_ref: ref,
      domain: "ACCESS",
      application_ids: [app],
      application_id: app,
      application_name: app,
      included,
      key_control: true,
      sample_size: 25,
    });
    const both = parseOnboarding(
      onboarding({
        controls: [
          row("1", "ITGC-AC-01", "sap", false),
          row("2", "ITGC-AC-01", "oracle", true),
          row("3", "ITGC-AC-02", "sap", true),
          row("4", "ITGC-AC-02", "oracle", true),
        ],
      }),
    );
    assert.ok(both !== null);
    assert.deepEqual(scopeCounts(both.controls, "it"), {
      inScope: 3,
      total: 4,
      ids: 2,
      key: 3,
      samples: 75,
    });
    // A control in scope on any system reads as in scope in the list.
    assert.equal(families(both.controls)[0]?.included, true);
    const oneSystem = parseOnboarding(
      onboarding({
        controls: [
          row("1", "ITGC-AC-01", "sap", false),
          row("3", "ITGC-AC-02", "sap", true),
        ],
      }),
    );
    assert.ok(oneSystem !== null);
    assert.equal(scopeCounts(oneSystem.controls, "it").inScope, 1);
    assert.equal(scopeCounts(oneSystem.controls, "it").samples, 25);
    // With its last system removed, a system control is kept for the next system but is
    // not tested, so it is not counted; a business control never has a system and counts.
    const noSystem = parseOnboarding(
      onboarding({
        controls: [
          {
            ...row("1", "ITGC-AC-01", "x", false),
            application_ids: [],
            application_id: null,
          },
          {
            id: "9",
            control_ref: "OTC-01",
            domain: "ORDER_TO_CASH",
            application_ids: [],
            included: true,
            sample_size: 25,
          },
        ],
      }),
    );
    assert.ok(noSystem !== null);
    assert.deepEqual(
      [
        scopeCounts(noSystem.controls, "it").total,
        scopeCounts(noSystem.controls, "business").inScope,
      ],
      [0, 1],
    );
  });
});

describe("matching the client's columns", () => {
  const ids = {
    organization_id: "01a13253-ec1a-7604-8944-a06dd7633ce0",
    project_id: "01a1327d-b92a-7bd1-b34b-845a8d89c879",
    import_id: "01a13300-0000-7000-8000-000000000003",
    version: "2",
    intent: "rcm-mapping",
  };
  it("lets the area come from two columns, and no other field from more than one", () => {
    const two = setupWrite(
      {
        ...ids,
        column_0: "control_ref",
        column_1: "domain",
        column_2: "domain",
        column_3: "activity",
      },
      {},
    );
    assert.ok(!("error" in two));
    assert.deepEqual(
      setupWrite(
        {
          ...ids,
          column_0: "control_ref",
          column_1: "domain",
          column_2: "domain",
          column_3: "domain",
        },
        {},
      ),
      { error: "invalid" },
    );
    assert.deepEqual(
      setupWrite(
        {
          ...ids,
          column_0: "control_ref",
          column_1: "nature",
          column_2: "nature",
        },
        {},
      ),
      { error: "invalid" },
    );
  });
});

describe("a firm's workpaper template", () => {
  const ids = {
    organization_id: "01a13253-ec1a-7604-8944-a06dd7633ce0",
    project_id: "01a1327d-b92a-7bd1-b34b-845a8d89c879",
  };
  it("uploads a Word or Excel file for one kind of control", () => {
    const target = templateUploadTarget(
      { ...ids, kind: "ITGC", part: "interim" },
      { name: "C:\\firm\\OE workpaper.docx", size: 1200 },
    );
    assert.ok(target !== null);
    assert.equal(target.fileName, "OE workpaper.docx");
    assert.ok(
      target.path.endsWith(
        "/onboarding/workpaper-templates?file_name=OE%20workpaper.docx&kind=ITGC&part=interim",
      ),
    );
    // A whole workbook is the default part.
    const whole = templateUploadTarget(
      { ...ids, kind: "KEY_REPORT" },
      { name: "reports.xlsx", size: 10 },
    );
    assert.ok(whole?.path.endsWith("&kind=KEY_REPORT&part=whole"));
    assert.equal(
      templateUploadTarget(
        { ...ids, kind: "ITGC" },
        { name: "notes.pdf", size: 10 },
      ),
      null,
    );
    assert.equal(
      templateUploadTarget(
        { ...ids, kind: "OTHER" },
        { name: "a.docx", size: 10 },
      ),
      null,
    );
    assert.equal(
      templateUploadTarget(
        { ...ids, kind: "ITGC", part: "later" },
        { name: "a.docx", size: 10 },
      ),
      null,
    );
    assert.equal(templateUploadNoticeFor(200), "setup-template-uploaded");
    assert.equal(templateUploadNoticeFor(422), "setup-template-unreadable");
  });

  it("applies or removes a template by its id, on the workpapers step", () => {
    const id = "01a13300-0000-7000-8000-000000000009";
    const applied = setupWrite({
      ...ids,
      intent: "workpaper-template-apply",
      template_id: id,
    });
    assert.ok(!("error" in applied));
    assert.equal(applied.step, "workpapers");
    assert.ok(applied.path.endsWith(`/workpaper-templates/${id}/apply`));
    const removed = setupWrite({
      ...ids,
      intent: "workpaper-template-remove",
      template_id: id,
    });
    assert.ok(!("error" in removed));
    assert.ok(removed.path.endsWith(`/workpaper-templates/${id}/remove`));
    assert.deepEqual(
      setupWrite({
        ...ids,
        intent: "workpaper-template-apply",
        template_id: "x",
      }),
      { error: "invalid" },
    );
    assert.equal(parseStep("workpapers"), "workpapers");
  });

  it("writes a new control from the form, lines split and the system required", () => {
    const made = setupWrite({
      ...ids,
      intent: "control-new",
      control_ref: " REV-09 ",
      title: "Credit notes are approved",
      risk: "",
      activity: "The finance manager approves every credit note.",
      domain: "ORDER_TO_CASH",
      frequency: "WEEKLY",
      nature: "MANUAL",
      key_control: "on",
      test_attributes:
        "Approved by the manager\r\n\nApproval precedes posting\n",
      pbc_items: "",
    });
    assert.ok(!("error" in made));
    assert.ok(made.path.endsWith("/controls/new"));
    assert.deepEqual(made.body, {
      control_ref: "REV-09",
      title: "Credit notes are approved",
      risk: "",
      activity: "The finance manager approves every credit note.",
      domain: "ORDER_TO_CASH",
      frequency: "WEEKLY",
      nature: "MANUAL",
      key_control: true,
      test_attributes: ["Approved by the manager", "Approval precedes posting"],
      pbc_items: [],
      application_id: null,
      process_id: null,
    });
    const report = setupWrite({
      ...ids,
      intent: "control-new",
      control_ref: "KR-09",
      title: "Aged debtors report",
      activity: "The report is run monthly.",
      domain: "IPE",
      frequency: "MONTHLY",
      nature: "IT_DEPENDENT_MANUAL",
      test_attributes: "Report ties to the ledger",
      application_id: appId,
    });
    assert.ok(!("error" in report));
    assert.equal(report.body.application_id, appId);
    for (const bad of [
      { domain: "IPE" },
      { domain: "NOPE" },
      { control_ref: "../x" },
      { test_attributes: "" },
      { activity: "password: hunter2" },
      { frequency: "SOMETIMES" },
    ]) {
      assert.deepEqual(
        setupWrite({
          ...ids,
          intent: "control-new",
          control_ref: "REV-10",
          title: "t",
          activity: "a",
          domain: "ORDER_TO_CASH",
          frequency: "WEEKLY",
          nature: "MANUAL",
          test_attributes: "x",
          ...bad,
        }),
        { error: "invalid" },
      );
    }
    assert.equal(
      setupNoticeFor("control-new", 409, "control ID exists"),
      "setup-control-exists",
    );
  });

  it("customises a template and saves the editor's draft", () => {
    const customised = setupWrite({
      ...ids,
      intent: "workpaper-template-customize",
      base_key: "business",
    });
    assert.ok(!("error" in customised));
    assert.equal(customised.method, "POST");
    assert.ok(customised.path.endsWith("/workpaper-templates/customize"));
    assert.deepEqual(customised.body, { base_key: "business" });
    assert.deepEqual(
      setupWrite({
        ...ids,
        intent: "workpaper-template-customize",
        base_key: "../x",
      }),
      { error: "invalid" },
    );
    const id = "01a13300-0000-7000-8000-000000000009";
    const draft = {
      title: " Our BP workpaper ",
      tabs: [
        {
          title: "Design",
          period: "design",
          sections: [
            {
              title: "Control",
              kind: "fields",
              guidance: "",
              columns: [],
              rows: [],
            },
            {
              title: "Procedures",
              kind: "table",
              guidance: "Perform each.",
              columns: ["Procedure", "", "Result"],
              rows: [
                ["Inspect", "", "x"],
                ["", ""],
              ],
            },
            {
              title: "Testing matrix",
              kind: "matrix",
              guidance: "",
              columns: ["ignored"],
              rows: [["dropped"]],
            },
          ],
        },
      ],
    };
    const saved = setupWrite({
      ...ids,
      intent: "workpaper-template-save",
      template_id: id,
      version: "3",
      template: JSON.stringify(draft),
    });
    assert.ok(!("error" in saved));
    assert.equal(saved.method, "PUT");
    assert.ok(saved.path.endsWith(`/workpaper-templates/${id}`));
    assert.deepEqual(saved.body, {
      title: "Our BP workpaper",
      version: 3,
      tabs: [
        {
          title: "Design",
          period: "design",
          sections: [
            {
              title: "Control",
              kind: "fields",
              guidance: "",
              columns: [],
              rows: [],
            },
            {
              title: "Procedures",
              kind: "table",
              guidance: "Perform each.",
              columns: ["Procedure", "Result"],
              rows: [["Inspect", ""]],
            },
            {
              title: "Testing matrix",
              kind: "matrix",
              guidance: "",
              columns: ["ignored"],
              rows: [],
            },
          ],
        },
      ],
    });
    // A table without columns, an unknown kind or period, an empty tab, or a secret is refused.
    const refused = (template: unknown) =>
      setupWrite({
        ...ids,
        intent: "workpaper-template-save",
        template_id: id,
        version: "3",
        template: JSON.stringify(template),
      });
    assert.deepEqual(parseTemplateDraft({ title: "x", tabs: [] }), null);
    assert.deepEqual(
      refused({
        title: "x",
        tabs: [
          {
            title: "T",
            period: "interim",
            sections: [{ title: "A", kind: "table" }],
          },
        ],
      }),
      { error: "invalid" },
    );
    assert.deepEqual(
      refused({
        title: "x",
        tabs: [
          {
            title: "T",
            period: "later",
            sections: [{ title: "A", kind: "guidance" }],
          },
        ],
      }),
      { error: "invalid" },
    );
    assert.deepEqual(
      refused({
        title: "x",
        tabs: [
          {
            title: "T",
            period: "interim",
            sections: [{ title: "A", kind: "other" }],
          },
        ],
      }),
      { error: "invalid" },
    );
    assert.deepEqual(
      refused({
        title: "x",
        tabs: [
          {
            title: "T",
            period: "interim",
            sections: [
              { title: "A", kind: "guidance", guidance: "password: hunter2" },
            ],
          },
        ],
      }),
      { error: "invalid" },
    );
    assert.deepEqual(refused("not json"), { error: "invalid" });
  });

  it("names the kind of workpaper each area uses", () => {
    assert.equal(kindForDomain("ACCESS"), "ITGC");
    assert.equal(kindForDomain("CHANGE"), "ITGC");
    assert.equal(kindForDomain("ITAC"), "ITAC");
    assert.equal(kindForDomain("IPE"), "KEY_REPORT");
    assert.equal(kindForDomain("ORDER_TO_CASH"), "BUSINESS");
  });
});

describe("previewChoices", () => {
  it("lists each control once, in order, with its preview link", () => {
    const choices = previewChoices(
      [
        { id: "a", controlRef: "ITGC-01", title: "User access" },
        { id: "b", controlRef: "ELC-01", title: "Code of conduct" },
        { id: "a", controlRef: "ITGC-01", title: "User access" },
      ],
      (id) => `/?step=workpapers&sample=${id}`,
    );
    assert.deepEqual(choices, [
      {
        id: "a",
        label: "ITGC-01 User access",
        href: "/?step=workpapers&sample=a",
      },
      {
        id: "b",
        label: "ELC-01 Code of conduct",
        href: "/?step=workpapers&sample=b",
      },
    ]);
  });
});

describe("the launched engagement", () => {
  const raw = {
    launched_at: "2026-10-12T14:00:00Z",
    launched_by: "Robert Manaol",
    controls: 19,
    plans_approved: 4,
    plans_proposed: 14,
    plans_working: 2,
    plans_missing: 1,
    requests_held: 5,
    requests_draft: 3,
    requests_awaiting_approval: 1,
    requests_with_client: 0,
    requests_received: 0,
    tasks_total: 13,
    tasks_done: 2,
    tasks_active: 10,
    tasks_attention: 1,
  };

  it("reads the summary and refuses what is not one", () => {
    const launch = launchParse(raw);
    assert.ok(launch !== null);
    assert.equal(launch.launchedBy, "Robert Manaol");
    assert.equal(launch.plansProposed, 14);
    assert.equal(launch.requestsHeld, 5);
    assert.equal(launchParse({ ...raw, tasks_done: -3 })?.tasksDone, 0);
    assert.equal(launchParse(null), null);
    assert.equal(launchParse({ controls: 3 }), null);
  });

  it("puts planning before requests, and agents' work last", () => {
    const launch = launchParse(raw);
    assert.ok(launch !== null);
    const steps = launchNextSteps(launch);
    assert.deepEqual(
      steps.map((step) => step.key),
      ["plans", "unplanned", "approve", "drafts", "tasks", "planner"],
    );
    assert.equal(steps[0]?.title, "Approve 14 evidence plans");
    assert.equal(steps[0]?.target, "controls");
    assert.equal(steps[2]?.title, "Approve 1 evidence request");
    assert.equal(steps[4]?.title, "1 agent task needs attention");
    assert.equal(steps[5]?.tone, "WAITING");
  });

  it("says when nothing waits for the team", () => {
    const launch = launchParse({
      ...raw,
      plans_proposed: 0,
      plans_working: 0,
      plans_missing: 0,
      requests_draft: 0,
      requests_awaiting_approval: 0,
      tasks_attention: 0,
    });
    assert.ok(launch !== null);
    assert.deepEqual(
      launchNextSteps(launch).map((step) => [step.key, step.tone]),
      [["clear", "DONE"]],
    );
  });
});

describe("the library's IT controls a person can add for a system", () => {
  it("groups them by area, in reference order, and leaves key reports to their card", () => {
    const offer = (
      controlRef: string,
      domain: string,
      controlId: string | null = null,
    ) => ({
      libraryKey: controlRef.toLowerCase(),
      controlRef,
      title: controlRef,
      domain,
      controlId,
    });
    const areas = systemOffers({
      otherControls: [
        offer("ITGC-CM-06", "CHANGE"),
        offer("ITGC-AC-09", "ACCESS"),
        offer("ITGC-AC-07", "ACCESS", "01a13300-0000-7000-8000-000000000002"),
        offer("IPE-03", "IPE"),
        offer("ITAC-03", "ITAC"),
      ],
    });
    assert.deepEqual(
      areas.map((area) => [
        area.label,
        area.offers.map((item) => item.controlRef),
      ]),
      [
        ["Logical access", ["ITGC-AC-07", "ITGC-AC-09"]],
        ["Change management", ["ITGC-CM-06"]],
        ["Application controls", ["ITAC-03"]],
      ],
    );
    // One loaded for the system but out of scope is brought back, not copied again.
    assert.equal(
      areas[0]?.offers[0]?.controlId,
      "01a13300-0000-7000-8000-000000000002",
    );
    assert.deepEqual(systemOffers({ otherControls: [] }), []);
  });
});
