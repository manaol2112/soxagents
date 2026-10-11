import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CONTROL_CATEGORIES,
  categoryOf,
  DOMAINS,
  domainTester,
  parseImport,
  parseOnboarding,
  parsePreview,
  parseSetupNotice,
  parseStep,
  pickCategory,
  RCM_MAX_BYTES,
  rcmUploadNoticeFor,
  rcmUploadTarget,
  setupNoticeFor,
  setupProgress,
  setupWrite,
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
        design_template_key: "design-walkthrough",
        effectiveness_template_key: "oe-manual",
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

describe("engagement setup model", () => {
  it("parses the setup and counts progress without the agents step", () => {
    const parsed = parseOnboarding(onboarding());
    assert.ok(parsed !== null);
    assert.equal(parsed.periodEnd, "2027-12-31");
    assert.equal(parsed.controls[0]?.sampleSize, 25);
    assert.equal(parsed.templatesConfirmed, false);
    assert.deepEqual(setupProgress(parsed), { done: 1, total: 2 });
    assert.equal(parseOnboarding({ project_id: projectId }), null);
  });

  it("parses a workpaper preview", () => {
    const parsed = parsePreview({
      reference: "ITGC-AC-01-TOE",
      title: "ITGC-AC-01 New user access is approved",
      template_title: "Operating effectiveness: manual control",
      template_version: 1,
      stage: "effectiveness",
      purpose: "p",
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
    });
    assert.equal(parsed?.sections[0]?.rows[0]?.[0], "Sample 1");
    assert.equal(parsePreview({ title: "x" }), null);
  });

  it("falls back to the first step and ignores unknown notices", () => {
    assert.equal(parseStep("pbc"), "pbc");
    assert.equal(parseStep("drop table"), "scope");
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
        step: "scope",
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
        design_template_key: "design-walkthrough",
        effectiveness_template_key: "oe-manual",
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
      design_template_key: "design-walkthrough",
      effectiveness_template_key: "oe-manual",
    });
    const pbc = setupWrite({
      ...ids,
      intent: "pbc",
      client_coordinator_name: "Pat",
      client_coordinator_email: "pbc@client.example",
      client_domains: "Client.Example, it.client.example",
      pbc_due_days: "10",
      pbc_follow_up_days: "3",
      pbc_max_follow_ups: "2",
    });
    assert.ok(!("error" in pbc));
    assert.deepEqual(pbc.body.client_domains, [
      "client.example",
      "it.client.example",
    ]);
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
      step: "rcm",
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
        step: "rcm",
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
      step: "rcm",
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
    assert.equal(added.step, "rcm");
    const removed = setupWrite({
      ...ids,
      intent: "remove-application",
      application_id: appId,
    });
    assert.ok(!("error" in removed));
    assert.equal(removed.step, "rcm");
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
        step: "rcm",
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
