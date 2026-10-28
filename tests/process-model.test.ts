import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  type Onboarding,
  processRows,
  reportOffers,
  reportRows,
  type SetupControl,
  type SetupSystem,
  setupWrite,
} from "../apps/web/src/onboarding-model.ts";

const ORG = "01a13253-ec1a-7604-8944-a06dd7633ce0";
const PROJECT = "01a1327d-b92a-7bd1-b34b-845a8d89c879";
const CONTROL = "01a13300-0000-7000-8000-000000000002";
const BASE = `/organizations/${ORG}/projects/${PROJECT}/onboarding`;

function control(overrides: Partial<SetupControl>): SetupControl {
  return {
    id: "c",
    controlRef: "X-01",
    domain: "ENTITY",
    title: "",
    risk: "",
    activity: "",
    frequency: "ANNUAL",
    nature: "MANUAL",
    keyControl: false,
    included: true,
    ownerName: "",
    ownerEmail: "",
    applicationIds: [],
    applicationId: null,
    applicationName: "",
    processId: null,
    testAttributes: [],
    pbcItems: [],
    templateKey: "",
    agentKey: "",
    sampleSize: 1,
    version: 1,
    source: "LIBRARY",
    domainLabel: "",
    frequencyLabel: "",
    natureLabel: "",
    customFields: [],
    tested: false,
    ...overrides,
  };
}

function system(
  id: string,
  name: string,
  otherControls: SetupSystem["otherControls"] = [],
): SetupSystem {
  return { id, name, otherControls } as unknown as SetupSystem;
}

function onboarding(parts: Partial<Onboarding>): Onboarding {
  return {
    controls: [],
    applications: [],
    processes: [],
    processOffers: [],
    ...parts,
  } as unknown as Onboarding;
}

describe("business processes", () => {
  it("lists each process with its controls in and out of scope and the library's offers", () => {
    const rows = processRows(
      onboarding({
        controls: [
          control({ id: "e2", controlRef: "ELC-02", included: false }),
          control({ id: "e1", controlRef: "ELC-01" }),
          control({ id: "a1", controlRef: "ITGC-AC-01", domain: "ACCESS" }),
        ],
        processOffers: [
          {
            libraryKey: "ptp-vendor-master",
            controlRef: "PTP-01",
            title: "Vendor master changes are approved",
            domain: "PROCURE_TO_PAY",
            controlId: null,
          },
        ],
      }),
    );
    assert.deepEqual(
      rows.map((row) => [
        row.domain,
        row.inScope.map((c) => c.id),
        row.outOfScope.map((c) => c.id),
        row.offers.map((o) => o.controlRef),
      ]),
      [
        ["ENTITY", ["e1"], ["e2"], []],
        ["PROCURE_TO_PAY", [], [], ["PTP-01"]],
      ],
    );
    assert.equal(rows[1]?.label, "Procure to pay / purchasing");
  });

  it("lists the processes the team named after the cycles, with their own controls", () => {
    const rows = processRows(
      onboarding({
        controls: [
          control({ id: "e1", controlRef: "ELC-01" }),
          control({
            id: "l1",
            controlRef: "LEASE-01",
            domain: "FIXED_ASSETS",
            processId: "p1",
          }),
          control({
            id: "l2",
            controlRef: "LEASE-02",
            domain: "FIXED_ASSETS",
            processId: "p1",
            included: false,
          }),
        ],
        processes: [
          {
            id: "p1",
            name: "Lease accounting",
            domain: "FIXED_ASSETS",
            domainLabel: "Fixed assets and leases",
            version: 1,
            controlsInScope: 1,
            systemIds: [],
            primarySystemId: null,
            description: "",
            owner: "",
            controlAreas: null,
            controlAreasSuggested: null,
            controlAreasDecidedAt: null,
          },
          {
            id: "p2",
            name: "Royalties",
            domain: "OTHER_BUSINESS",
            domainLabel: "Other business process",
            version: 1,
            controlsInScope: 0,
            systemIds: [],
            primarySystemId: null,
            description: "",
            owner: "",
            controlAreas: null,
            controlAreasSuggested: null,
            controlAreasDecidedAt: null,
          },
        ],
      }),
    );
    assert.deepEqual(
      rows.map((row) => [
        row.processId,
        row.label,
        row.inScope.map((c) => c.id),
        row.outOfScope.map((c) => c.id),
      ]),
      [
        [null, "Entity-level controls", ["e1"], []],
        ["p1", "Lease accounting", ["l1"], ["l2"]],
        ["p2", "Royalties", [], []],
      ],
    );
    // A named process's controls do not also show under the cycle it is based on.
    assert.equal(
      rows.some(
        (row) => row.domain === "FIXED_ASSETS" && row.processId === null,
      ),
      false,
    );
  });

  it("names a process, removes an empty one, and writes a control for one", () => {
    const fields = { organization_id: ORG, project_id: PROJECT };
    assert.deepEqual(
      setupWrite(
        {
          ...fields,
          intent: "process-new",
          name: " Lease accounting ",
          domain: "FIXED_ASSETS",
        },
        {},
      ),
      {
        intent: "process-new",
        step: "controls",
        method: "POST",
        path: `${BASE}/processes`,
        body: { name: "Lease accounting", domain: "FIXED_ASSETS" },
      },
    );
    // A process is based on a business cycle, never an IT area.
    assert.deepEqual(
      setupWrite(
        { ...fields, intent: "process-new", name: "Leases", domain: "ACCESS" },
        {},
      ),
      { error: "invalid" },
    );
    assert.deepEqual(
      setupWrite(
        { ...fields, intent: "process-remove", process_id: CONTROL },
        {},
      ),
      {
        intent: "process-remove",
        step: "controls",
        method: "POST",
        path: `${BASE}/processes/${CONTROL}/remove`,
        body: {},
      },
    );
    const written = {
      ...fields,
      intent: "control-new",
      control_ref: "LEASE-01",
      title: "Lease schedules are reviewed",
      activity: "The controller reviews the lease schedule each month.",
      frequency: "MONTHLY",
      nature: "MANUAL",
      test_attributes: "Reviewer signs the schedule",
    };
    const sent = (write: ReturnType<typeof setupWrite>) =>
      "body" in write ? [write.body.process_id, write.body.domain] : write;
    // Inside a named process the form fixes the process; the area comes from it.
    assert.deepEqual(
      sent(setupWrite({ ...written, process_id: CONTROL }, {})),
      [CONTROL, ""],
    );
    // The card-level form offers one pick: a named process or a standard cycle.
    assert.deepEqual(
      sent(setupWrite({ ...written, process: `process:${CONTROL}` }, {})),
      [CONTROL, ""],
    );
    assert.deepEqual(
      sent(setupWrite({ ...written, process: "domain:TAX" }, {})),
      [null, "TAX"],
    );
    assert.deepEqual(setupWrite({ ...written, process: "process:nope" }, {}), {
      error: "invalid",
    });
  });

  it("puts one control in or out of scope, and adds one from the library", () => {
    const fields = { organization_id: ORG, project_id: PROJECT };
    assert.deepEqual(
      setupWrite(
        {
          ...fields,
          intent: "control-scope",
          control_id: CONTROL,
          included: "false",
        },
        {},
      ),
      {
        intent: "control-scope",
        step: "controls",
        method: "POST",
        path: `${BASE}/controls/${CONTROL}/scope`,
        body: { included: false },
      },
    );
    assert.deepEqual(
      setupWrite(
        {
          ...fields,
          intent: "control-scope",
          control_id: CONTROL,
          included: "maybe",
        },
        {},
      ),
      { error: "invalid" },
    );
    assert.deepEqual(
      setupWrite(
        {
          ...fields,
          intent: "process-add-control",
          library_key: "ptp-vendor-master",
        },
        {},
      ),
      {
        intent: "process-add-control",
        step: "controls",
        method: "POST",
        path: `${BASE}/controls/add`,
        body: { library_key: "ptp-vendor-master" },
      },
    );
  });
});

describe("key reports", () => {
  const systems = [
    system("a", "Workday"),
    system("b", "SAP ECC"),
    system("c", "Okta"),
  ];

  it("lists each report with the systems it is tested for and the ones left", () => {
    const rows = reportRows(
      onboarding({
        applications: systems,
        controls: [
          control({
            id: "r1",
            controlRef: "IPE-01",
            domain: "IPE",
            title: "Aged receivables",
            applicationId: "a",
          }),
          control({
            id: "r2",
            controlRef: "IPE-01",
            domain: "IPE",
            title: "Aged receivables",
            applicationId: "b",
            included: false,
          }),
          control({
            id: "a1",
            controlRef: "ITGC-AC-01",
            domain: "ACCESS",
            applicationId: "a",
          }),
        ],
      }),
    );
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row?.title, "Aged receivables");
    assert.deepEqual(
      row?.inScope.map((i) => i.systemName),
      ["Workday"],
    );
    assert.deepEqual(
      row?.outOfScope.map((i) => i.systemName),
      ["SAP ECC"],
    );
    assert.deepEqual(
      row?.uncovered.map((s) => s.name),
      ["Okta"],
    );
    assert.equal(row?.control.id, "r1");
  });

  it("offers the library's reports not loaded for any system, once each", () => {
    const offer = (controlRef: string, libraryKey: string) => ({
      libraryKey,
      controlRef,
      title: "",
      domain: "IPE",
      controlId: null,
    });
    const offers = reportOffers(
      onboarding({
        applications: [
          system("a", "Workday", [
            offer("IPE-02", "ipe-journal-listing"),
            offer("IPE-01", "ipe-aged-receivables"),
          ]),
          system("b", "SAP ECC", [
            offer("IPE-02", "ipe-journal-listing"),
            { ...offer("ITGC-AC-03", "access-review"), domain: "ACCESS" },
          ]),
        ],
        controls: [
          control({
            id: "r1",
            controlRef: "IPE-01",
            domain: "IPE",
            applicationId: "a",
            included: false,
          }),
        ],
      }),
    );
    assert.deepEqual(
      offers.map((o) => o.libraryKey),
      ["ipe-journal-listing"],
    );
  });
});

describe("importing a sheet of the client's RCM", () => {
  const IMPORT = "01a13300-0000-7000-8000-000000000003";
  const fields = (mode?: string) => ({
    organization_id: ORG,
    project_id: PROJECT,
    intent: "rcm-import",
    import_id: IMPORT,
    version: "2",
    ...(mode === undefined ? {} : { mode }),
  });

  it("adds the sheet to the controls already imported, or replaces them", () => {
    assert.deepEqual(setupWrite(fields("ADD"), {}), {
      intent: "rcm-import",
      step: "controls",
      method: "POST",
      path: `${BASE}/rcm/uploads/${IMPORT}/import`,
      body: { version: 2, mode: "ADD" },
    });
    const plain = setupWrite(fields(), {});
    assert.ok(!("error" in plain));
    assert.deepEqual(plain.body, { version: 2, mode: "REPLACE" });
    assert.deepEqual(setupWrite(fields("MERGE"), {}), { error: "invalid" });
  });
});
