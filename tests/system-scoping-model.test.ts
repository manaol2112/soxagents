import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  addableControls,
  addableOthers,
  applySuggestion,
  basisLabel,
  type Candidate,
  candidateSections,
  cuecRows,
  filterOffers,
  initialSelection,
  needsReason,
  otherRecommendations,
  parseOnboarding,
  parseSuggestion,
  reliedOnSoc,
  returnAnchor,
  type SetupSystem,
  type SocCuec,
  type SocReport,
  type SystemAssessment,
  type SystemRecommendation,
  setupNoticeFor,
  setupProblem,
  setupWrite,
  socOverview,
  suggestedCode,
  suggestionSummary,
  systemControls,
  systemStatus,
  wizardProblem,
  wizardWrite,
} from "../apps/web/src/onboarding-model.ts";

const ORG = "01a13253-ec1a-7604-8944-a06dd7633ce0";
const PROJECT = "01a1327d-b92a-7bd1-b34b-845a8d89c879";
const SYSTEM = "01a13300-0000-7000-8000-000000000001";
const REC = "01a13300-0000-7000-8000-000000000002";
const BASE = `/organizations/${ORG}/projects/${PROJECT}/onboarding/systems/${SYSTEM}`;

function fields(extra: Record<string, string>): Record<string, string> {
  return {
    organization_id: ORG,
    project_id: PROJECT,
    system_id: SYSTEM,
    ...extra,
  };
}

const REVIEW: NonNullable<SetupSystem["review"]> = {
  status: "IDLE",
  source: "AGENT",
  summary: "",
  coverage: "",
  cuecs: [],
  note: "",
};

function system(overrides: Partial<SetupSystem> = {}): SetupSystem {
  return {
    id: SYSTEM,
    name: "Workday",
    description: "",
    layer: "APPLICATION",
    hosting: "SAAS",
    socExpected: true,
    factsSource: "AGENT",
    factsReason: "",
    factsConfirmed: false,
    version: 1,
    review: {
      status: "IDLE",
      source: "AGENT",
      summary: "",
      coverage: "",
      cuecs: [],
      note: "",
    },
    recommendations: [],
    controlsInScope: 1,
    otherControls: [],
    purpose: "",
    processes: "",
    owner: "",
    assessment: null,
    socReports: [],
    refCode: "",
    ...overrides,
  };
}

function assessment(
  overrides: Partial<SystemAssessment> = {},
): SystemAssessment {
  return {
    status: "IDLE",
    source: "AGENT",
    reviewedAt: null,
    summary: "",
    note: "",
    socStatus: "UNDETERMINED",
    socAvailability: "NOT_RESEARCHED",
    socProvider: "",
    socBasis: "",
    socSources: [],
    assumptions: [],
    questions: [],
    candidates: [],
    decided: false,
    refCode: "",
    ...overrides,
  };
}

describe("scoping each system", () => {
  it("reads a system's facts, review, and recommendations", () => {
    const parsed = parseOnboarding({
      project_id: PROJECT,
      settings: {},
      controls: [],
      readiness: [],
      ready: false,
      applications: [
        {
          id: SYSTEM,
          name: "Workday",
          description: "",
          layer: "APPLICATION",
          hosting: "SAAS",
          soc_expected: true,
          facts_source: "AGENT",
          facts_reason: "Workday is SaaS.",
          facts_confirmed: false,
          version: 3,
          review: {
            status: "IDLE",
            source: "AGENT",
            basis: "KNOWLEDGE",
            summary: "First guess.",
            coverage: "Program changes.",
            cuecs: [
              {
                ref: "CUEC-1",
                text: "Access is approved.",
                control_id: null,
                control_ref: "ITGC-AC-01",
                in_scope: false,
              },
            ],
            note: "",
          },
          recommendations: [
            {
              id: REC,
              kind: "EXCLUDE",
              control_id: "c-1",
              control_ref: "ITGC-CM-01",
              control_title: "Changes are tested and approved",
              cuec: "",
              reason: "The vendor runs it.",
              status: "PROPOSED",
            },
            {
              id: "y",
              kind: "INCLUDE",
              control_id: null,
              library_key: "access-provisioning",
              control_ref: "ITGC-AC-01",
              control_title: "New user access is approved",
              cuec: "",
              reason: "Workday relies on the client to approve new users.",
              cuec_refs: ["CUEC-1"],
              status: "PROPOSED",
            },
            { id: "x", kind: "SOMETHING_ELSE", status: "PROPOSED" },
          ],
        },
      ],
    });
    assert.ok(parsed !== null);
    const [workday] = parsed.applications;
    assert.ok(workday);
    assert.equal(workday.hosting, "SAAS");
    assert.equal(workday.socExpected, true);
    assert.equal(workday.version, 3);
    assert.equal(workday.review?.summary, "First guess.");
    // An unknown kind is dropped rather than shown.
    assert.deepEqual(
      workday.recommendations.map((r) => [r.kind, r.controlRef]),
      [
        ["EXCLUDE", "ITGC-CM-01"],
        ["INCLUDE", "ITGC-AC-01"],
      ],
    );
    const include = workday.recommendations[1];
    assert.equal(include?.libraryKey, "access-provisioning");
    assert.deepEqual(include?.cuecRefs, ["CUEC-1"]);
    assert.deepEqual(workday.review?.cuecs[0], {
      ref: "CUEC-1",
      text: "Access is approved.",
      controlId: null,
      controlRef: "ITGC-AC-01",
      inScope: false,
    });
  });

  it("names where each system stands", () => {
    assert.equal(
      systemStatus(system({ assessment: assessment({ status: "WORKING" }) })),
      "reviewing",
    );
    // The agent recommended, and the team has not saved a selection yet.
    assert.equal(
      systemStatus(system({ assessment: assessment() })),
      "to-decide",
    );
    assert.equal(
      systemStatus(system({ assessment: assessment({ decided: true }) })),
      "scoped",
    );
    // Nothing asks how the system is run: a system with no assessment is just scoped.
    assert.equal(systemStatus(system()), "scoped");
    // A system with nothing in scope is not scoped: nothing would be tested for it.
    assert.equal(systemStatus(system({ controlsInScope: 0 })), "no-controls");
  });

  it("sends the team's facts, a re-review, and decisions", () => {
    assert.deepEqual(
      setupWrite(
        fields({
          intent: "system-facts",
          version: "3",
          hosting: "ON_PREMISES",
          soc_expected: "no",
        }),
      ),
      {
        intent: "system-facts",
        step: "controls",
        method: "PATCH",
        path: `${BASE}/facts`,
        body: { version: 3, hosting: "ON_PREMISES", soc_expected: false },
      },
    );
    const unsure = setupWrite(
      fields({
        intent: "system-facts",
        version: "1",
        hosting: "",
        soc_expected: "",
      }),
    );
    assert.ok(!("error" in unsure));
    assert.deepEqual(unsure.body, {
      version: 1,
      hosting: null,
      soc_expected: null,
    });
    assert.deepEqual(
      setupWrite(
        fields({ intent: "system-facts", version: "1", hosting: "CLOUD" }),
      ),
      { error: "invalid" },
    );
    const again = setupWrite(fields({ intent: "system-review" }));
    assert.ok(!("error" in again));
    assert.equal(again.path, `${BASE}/review`);
    assert.deepEqual(
      setupWrite(fields({ intent: "system-decide", action: "ACCEPT" }), {
        recommendation: [REC, REC],
      }),
      {
        intent: "system-decide",
        step: "controls",
        method: "POST",
        path: `${BASE}/recommendations/decide`,
        body: { ids: [REC], action: "ACCEPT" },
      },
    );
    assert.deepEqual(
      setupWrite(fields({ intent: "system-decide", action: "ACCEPT" }), {}),
      { error: "invalid" },
    );
    // Keeping a control the SOC report covers in scope after all.
    assert.deepEqual(
      setupWrite(fields({ intent: "system-decide", action: "KEEP" }), {
        recommendation: [REC],
      }),
      {
        intent: "system-decide",
        step: "controls",
        method: "POST",
        path: `${BASE}/recommendations/decide`,
        body: { ids: [REC], action: "KEEP" },
      },
    );
    assert.deepEqual(
      setupWrite(fields({ intent: "system-decide", action: "DELETE" }), {
        recommendation: [REC],
      }),
      { error: "invalid" },
    );
  });
});

describe("a refusal the API can still give", () => {
  it("explains a refusal to decide before the facts are confirmed", () => {
    assert.equal(
      setupNoticeFor(
        "system-decide",
        409,
        "confirm how the system is run first",
      ),
      "system-needs-facts",
    );
    assert.equal(
      setupNoticeFor("system-decide", 409, "recommendations changed"),
      "setup-changed",
    );
  });
});

describe("returnAnchor", () => {
  it("lands on a system's recommendations after a decision", () => {
    const anchor = "recs-01a13327-1594-73e6-a373-93c8ba6c56bf";
    assert.equal(returnAnchor(anchor), anchor);
  });

  it("ignores anything that is not a section of a system", () => {
    assert.equal(returnAnchor(undefined), null);
    assert.equal(returnAnchor(""), null);
    assert.equal(returnAnchor("recs-x"), null);
    assert.equal(
      returnAnchor('recs-01a13327-1594-73e6-a373-93c8ba6c56bf"><script>'),
      null,
    );
  });
});

describe("cuecRows", () => {
  const cuec = (ref: string, controlRef: string | null, inScope = false) => ({
    ref,
    text: `What ${ref} asks of the client.`,
    controlId: null,
    controlRef,
    inScope,
  });
  const rec = (
    id: string,
    kind: SystemRecommendation["kind"],
    status: SystemRecommendation["status"],
    cuecRefs: string[],
    controlRef = "",
  ): SystemRecommendation => ({
    id,
    kind,
    controlId: null,
    libraryKey: null,
    controlRef,
    controlTitle: "",
    cuec: "",
    reason: "Because.",
    cuecRefs,
    status,
  });
  const scoped = (
    cuecs: ReturnType<typeof cuec>[],
    recommendations: SystemRecommendation[],
  ) =>
    system({
      factsConfirmed: true,
      review: { ...REVIEW, cuecs },
      recommendations,
    });

  it("shows a control as in scope from the controls now, whatever was decided", () => {
    const rows = cuecRows(
      scoped(
        [cuec("CUEC-1", "ITGC-AC-01", true)],
        [rec("r1", "INCLUDE", "ACCEPTED", ["CUEC-1"], "ITGC-AC-01")],
      ),
    );
    assert.deepEqual(
      rows.map((row) => [row.state, row.decideHere]),
      [["in-scope", false]],
    );
  });

  it("an open recommendation is decided on the first CUEC it cites", () => {
    const rows = cuecRows(
      scoped(
        [cuec("CUEC-1", "ITGC-AC-03"), cuec("CUEC-2", "ITGC-AC-03")],
        [rec("r1", "INCLUDE", "PROPOSED", ["CUEC-1", "CUEC-2"], "ITGC-AC-03")],
      ),
    );
    assert.deepEqual(
      rows.map((row) => [row.state, row.decideHere, row.sharedWith]),
      [
        ["recommended", true, null],
        ["recommended", false, "CUEC-1"],
      ],
    );
  });

  it("names a dismissed control, a control out of scope, and gaps", () => {
    const rows = cuecRows(
      scoped(
        [
          cuec("CUEC-1", "ITGC-AC-03"),
          cuec("CUEC-2", "ITGC-AC-04"),
          cuec("CUEC-3", null),
          cuec("CUEC-4", null),
        ],
        [
          rec("r1", "INCLUDE", "DISMISSED", ["CUEC-1"], "ITGC-AC-03"),
          rec("r2", "CUEC_GAP", "PROPOSED", ["CUEC-3"]),
          rec("r3", "CUEC_GAP", "ACCEPTED", ["CUEC-4"]),
        ],
      ),
    );
    assert.deepEqual(
      rows.map((row) => row.state),
      ["not-added", "out-of-scope", "gap", "gap-recorded"],
    );
    assert.equal(rows[2]?.decideHere, true);
  });

  it("lists only open recommendations no CUEC row carries, and no SOC report review", () => {
    const item = scoped(
      [cuec("CUEC-1", "ITGC-AC-03")],
      [
        rec("r1", "INCLUDE", "PROPOSED", ["CUEC-1"], "ITGC-AC-03"),
        rec("r2", "ADD_SOC_REVIEW", "PROPOSED", []),
        rec("r3", "EXCLUDE", "PROPOSED", [], "ITGC-CM-01"),
        rec("r4", "INCLUDE", "PROPOSED", ["CUEC-9"], "IPE-01"),
        // Decided before CUECs were numbered: nothing left to do, so not listed.
        rec("r5", "CUEC_GAP", "ACCEPTED", []),
        rec("r6", "EXCLUDE", "DISMISSED", [], "ITGC-CM-02"),
      ],
    );
    assert.deepEqual(
      otherRecommendations(item).map((r) => r.id),
      ["r3", "r4"],
    );
  });

  it("lists the controls out of scope because the SOC report covers them", () => {
    const item = scoped(
      [],
      [
        rec("r1", "EXCLUDE", "ACCEPTED", [], "ITGC-OP-05"),
        rec("r2", "EXCLUDE", "PROPOSED", [], "ITGC-CM-01"),
        rec("r3", "EXCLUDE", "DISMISSED", [], "ITGC-CM-02"),
        rec("r4", "EXCLUDE", "ACCEPTED", [], "ITGC-CM-03"),
        rec("r5", "CUEC_GAP", "ACCEPTED", []),
      ],
    );
    assert.deepEqual(
      reliedOnSoc(item).map((r) => r.id),
      ["r4", "r1"],
    );
  });
});

describe("saving a decision in the background", () => {
  it("adds every open recommended control once, and nothing else", () => {
    const item = {
      id: "r1",
      kind: "INCLUDE",
      controlId: null,
      libraryKey: null,
      controlRef: "ITGC-AC-04",
      controlTitle: "",
      cuec: "",
      reason: "",
      cuecRefs: ["CUEC-1", "CUEC-2"],
      status: "PROPOSED",
    } satisfies SystemRecommendation;
    const rows = cuecRows(
      system({
        factsConfirmed: true,
        review: {
          ...REVIEW,
          cuecs: ["CUEC-1", "CUEC-2", "CUEC-3"].map((ref) => ({
            ref,
            text: "",
            controlId: null,
            controlRef: ref === "CUEC-3" ? null : "ITGC-AC-04",
            inScope: false,
          })),
        },
        recommendations: [
          item,
          { ...item, id: "r2", kind: "CUEC_GAP", cuecRefs: ["CUEC-3"] },
        ],
      }),
    );
    assert.deepEqual(addableControls(rows), ["r1"]);
  });

  it("says nothing when it saved and why when it did not", () => {
    assert.equal(setupProblem("setup-saved"), null);
    // A success that says more than "saved" is not shown as a problem either.
    for (const done of [
      "setup-template-customized",
      "setup-template-saved",
      "invite-sent",
    ]) {
      assert.equal(setupProblem(done), null, done);
    }
    assert.equal(
      setupProblem("system-needs-facts"),
      "Confirm how the system is run first.",
    );
    assert.equal(setupProblem(""), "That could not be saved. Try again.");
  });
});

describe("a system the client runs", () => {
  it("adds all its open recommended controls, and nothing decided or else", () => {
    const base = {
      controlId: null,
      libraryKey: "access-review",
      controlRef: "ITGC-AC-03",
      controlTitle: "",
      cuec: "",
      reason: "",
      cuecRefs: [],
    };
    assert.deepEqual(
      addableOthers([
        { ...base, id: "a", kind: "INCLUDE", status: "PROPOSED" },
        { ...base, id: "b", kind: "INCLUDE", status: "PROPOSED" },
        { ...base, id: "c", kind: "EXCLUDE", status: "PROPOSED" },
        { ...base, id: "d", kind: "INCLUDE", status: "DISMISSED" },
      ]),
      ["a", "b"],
    );
  });
});

describe("adding a library control for one system", () => {
  it("sends a library control, or the system's own out-of-scope instance", () => {
    assert.deepEqual(
      setupWrite(
        fields({
          intent: "system-add-control",
          library_key: "operations-backup",
        }),
        {},
      ),
      {
        intent: "system-add-control",
        step: "controls",
        method: "POST",
        path: `${BASE}/controls/add`,
        body: { library_key: "operations-backup" },
      },
    );
    assert.deepEqual(
      setupWrite(fields({ intent: "system-add-control", control_id: REC }), {}),
      {
        intent: "system-add-control",
        step: "controls",
        method: "POST",
        path: `${BASE}/controls/add`,
        body: { control_id: REC },
      },
    );
    assert.deepEqual(
      setupWrite(
        fields({ intent: "system-add-control", library_key: "Bad Key" }),
        {},
      ),
      { error: "invalid" },
    );
  });

  it("reads the controls the library still offers for the system", () => {
    const onboarding = parseOnboarding({
      project_id: PROJECT,
      settings: {},
      controls: [],
      readiness: [],
      ready: false,
      applications: [
        {
          id: SYSTEM,
          name: "Oracle Database",
          other_controls: [
            {
              library_key: "operations-physical",
              control_ref: "ITGC-OP-05",
              title: "Data center access is restricted",
              domain: "OPERATIONS",
              control_id: null,
            },
          ],
        },
      ],
    });
    assert.deepEqual(onboarding?.applications[0]?.otherControls, [
      {
        libraryKey: "operations-physical",
        controlRef: "ITGC-OP-05",
        title: "Data center access is restricted",
        domain: "OPERATIONS",
        controlId: null,
      },
    ]);
  });
});

describe("a system's controls in scope", () => {
  it("lists the system's own in-scope controls, in reference order", () => {
    const control = (
      id: string,
      ref: string,
      applicationId: string,
      included: boolean,
    ) =>
      ({
        id,
        controlRef: ref,
        applicationId,
        included,
      }) as unknown as Parameters<typeof systemControls>[0][number];
    const listed = systemControls(
      [
        control("c1", "ITGC-OP-03", SYSTEM, true),
        control("c2", "ITGC-AC-01", SYSTEM, true),
        control("c3", "ITGC-AC-02", SYSTEM, false),
        control("c4", "ITGC-AC-03", "other-system", true),
      ],
      SYSTEM,
    );
    assert.deepEqual(
      listed.map((c) => c.id),
      ["c2", "c1"],
    );
  });

  it("takes one of them out for that system", () => {
    assert.deepEqual(
      setupWrite(
        fields({ intent: "system-remove-control", control_id: REC }),
        {},
      ),
      {
        intent: "system-remove-control",
        step: "controls",
        method: "POST",
        path: `${BASE}/controls/remove`,
        body: { control_id: REC },
      },
    );
    assert.deepEqual(
      setupWrite(
        fields({ intent: "system-remove-control", control_id: "x" }),
        {},
      ),
      { error: "invalid" },
    );
  });
});

describe("SOC 1 reports to address", () => {
  it("lists each system the agent found relevant or undetermined, or with a report", () => {
    const cuec = (ref: string, status: SocCuec["status"]): SocCuec => ({
      id: ref,
      ref,
      text: "",
      quote: "",
      page: 3,
      status,
      controls: [],
      limitations: "",
    });
    const report = (
      cuecs: SocCuec[],
      status: SocReport["status"],
    ): SocReport => ({
      id: "r",
      fileName: "soc.pdf",
      status,
      note: "",
      reportKind: "SOC1",
      serviceOrganization: "",
      reportType: "TYPE_2",
      periodStart: null,
      periodEnd: null,
      opinion: "UNQUALIFIED",
      opinionPage: null,
      scope: "",
      exceptions: [],
      cuecs,
    });
    const items = socOverview({
      applications: [
        system({
          id: "b",
          name: "Workday",
          assessment: assessment({
            socStatus: "RELEVANT",
            socProvider: "Workday, Inc.",
            socAvailability: "STATED_AVAILABLE",
          }),
          socReports: [
            report(
              [cuec("CUEC-1", "ADDRESSED"), cuec("CUEC-2", "UNADDRESSED")],
              "READ",
            ),
            report([cuec("CUEC-9", "UNADDRESSED")], "READING"),
          ],
        }),
        system({ id: "a", name: "Coupa", assessment: assessment() }),
        system({
          id: "c",
          name: "SAP",
          assessment: assessment({ socStatus: "NOT_IDENTIFIED" }),
        }),
        system({ id: "d", name: "Okta" }),
      ],
    } as unknown as Parameters<typeof socOverview>[0]);
    assert.deepEqual(
      items.map((item) => [
        item.name,
        item.status,
        item.reports,
        item.unaddressed,
      ]),
      [
        ["Coupa", "UNDETERMINED", 0, []],
        ["Workday", "RELEVANT", 1, ["CUEC-2"]],
      ],
    );
    assert.equal(items[1]?.cuecs, 2);
  });
});

describe("the system wizard", () => {
  const candidate = (
    ref: string,
    overrides: Partial<Candidate> = {},
  ): Candidate => ({
    controlRef: ref,
    libraryKey: null,
    title: ref,
    domain: "ACCESS",
    description: "",
    controlId: null,
    inScope: false,
    status: null,
    source: "NONE",
    rationale: "",
    support: "",
    missing: "",
    confidence: null,
    decision: null,
    decisionNote: "",
    decidedBy: null,
    origin: "SYSTEM",
    adaptedFrom: [],
    follows: "",
    ...overrides,
  });

  it("starts from the team's decisions, never from a recommendation", () => {
    const start = initialSelection([
      candidate("A", { inScope: true, status: "NOT_RECOMMENDED" }),
      candidate("B", { status: "RECOMMENDED" }),
      candidate("C", { inScope: true, decision: "NOT_SELECTED" }),
      candidate("D", { decision: "SELECTED" }),
    ]);
    assert.deepEqual(start, { A: true, B: false, C: false, D: true });
  });

  it("asks why a recommended control is left out", () => {
    const items = [
      candidate("A", { status: "RECOMMENDED" }),
      candidate("B", { status: "RECOMMENDED" }),
      candidate("C", { status: "POTENTIAL" }),
    ];
    assert.deepEqual(needsReason(items, { A: true }, {}), ["B"]);
    assert.deepEqual(
      needsReason(items, { A: true }, { B: "Vendor does it." }),
      [],
    );
  });

  it("builds each call and refuses what does not fit", () => {
    const ids = {
      organization_id: "01a13253-ec1a-7604-8944-a06dd7633ce0",
      project_id: "01a1327d-b92a-7bd1-b34b-845a8d89c879",
    };
    const base = `/organizations/${ids.organization_id}/projects/${ids.project_id}/onboarding`;
    assert.deepEqual(
      wizardWrite({
        ...ids,
        intent: "create",
        name: " Raul ERP ",
        layer: "APPLICATION",
      }),
      {
        method: "POST",
        path: `${base}/applications/known`,
        body: {
          names: [],
          custom: [{ name: "Raul ERP", layer: "APPLICATION" }],
        },
      },
    );
    const system = { ...ids, system_id: SYSTEM };
    assert.deepEqual(wizardWrite({ ...system, intent: "assess" }), {
      method: "POST",
      path: `${base}/systems/${SYSTEM}/review`,
      body: {},
    });
    assert.deepEqual(
      wizardWrite({
        ...system,
        intent: "save",
        selections: [
          { control_ref: "ITGC-AC-01", selected: false, note: " Vendor " },
        ],
      }),
      {
        method: "PUT",
        path: `${base}/systems/${SYSTEM}/applicability`,
        body: {
          selections: [
            { control_ref: "ITGC-AC-01", selected: false, note: "Vendor" },
          ],
        },
      },
    );
    for (const bad of [
      { ...ids, intent: "create", name: "", layer: "APPLICATION" },
      { ...ids, intent: "create", name: "X", layer: "PLANET" },
      { ...system, intent: "details", purpose: "x".repeat(1001) },
      { ...system, intent: "details", owner: "password=hunter22" },
      { ...system, intent: "save", selections: [] },
      { ...ids, intent: "assess" },
      { ...system, intent: "delete-everything" },
    ]) {
      assert.deepEqual(wizardWrite(bad), { error: "invalid" });
    }
    assert.equal(
      wizardProblem(409, "say why a recommended control is not selected"),
      "Say why each recommended control you leave out is not selected.",
    );
    assert.equal(wizardProblem(200), null);
  });
});

describe("a system scoped from the library and the client's controls", () => {
  const item = (ref: string, origin: Candidate["origin"]): Candidate => ({
    controlRef: ref,
    libraryKey: null,
    title: ref,
    domain: "ACCESS",
    description: "",
    controlId: null,
    inScope: false,
    status: null,
    source: "NONE",
    rationale: "",
    support: "",
    missing: "",
    confidence: null,
    decision: null,
    decisionNote: "",
    decidedBy: null,
    origin,
    adaptedFrom: origin === "RCM" ? ["ITGC-SAP-02", "ITGC-WD-02"] : [],
    follows: origin === "RCM" ? "ITGC-AC-02" : "",
  });

  it("reads the system's own controls, the client's, then the library's", () => {
    const sections = candidateSections(
      [
        item("ITGC-AC-03", "LIBRARY"),
        item("ITGC-AD-02", "RCM"),
        item("ITGC-AC-04", "LIBRARY"),
      ],
      "Active Directory",
    );
    assert.deepEqual(
      sections.map((part) => [part.origin, part.label, part.items.length]),
      [
        ["RCM", "From the client's RCM", 1],
        ["LIBRARY", "Standard library", 2],
      ],
    );
    assert.match(sections[0]?.note ?? "", /adapted to Active Directory/);
    assert.equal(
      candidateSections([item("X-1", "SYSTEM")], "AD")[0]?.label,
      "On AD",
    );
    assert.deepEqual(candidateSections([], "AD"), []);
  });

  it("suggests the system's code in references as the API does", () => {
    assert.equal(suggestedCode("Active Directory"), "AD");
    assert.equal(suggestedCode("SAP S/4HANA"), "SAP");
    assert.equal(suggestedCode("Oracle E-Business Suite"), "OEBS");
    assert.equal(suggestedCode("Salesforce (Sales Cloud / CPQ)"), "SAL");
    assert.equal(suggestedCode("Workday"), "WOR");
    assert.equal(suggestedCode(""), "SYS");
  });

  it("says a control is already in scope rather than doing nothing", () => {
    const notice = setupNoticeFor(
      "system-add-control",
      409,
      "this system already has it in scope as ITGC-AD-02",
    );
    assert.equal(notice, "setup-control-in-scope");
    assert.equal(
      setupProblem(notice),
      "That control is already in scope for this system under another ID.",
    );
  });

  it("sends the code with the details, checked", () => {
    const system = {
      organization_id: "11111111-1111-4111-8111-111111111111",
      project_id: "22222222-2222-4222-8222-222222222222",
      system_id: "33333333-3333-4333-8333-333333333333",
      intent: "details",
    };
    const sent = wizardWrite({ ...system, owner: "IT Ops", ref_code: " ad " });
    assert.ok(!("error" in sent));
    assert.equal((sent.body as Record<string, unknown>).ref_code, "AD");
    const cleared = wizardWrite({ ...system, ref_code: "" });
    assert.ok(!("error" in cleared));
    assert.equal((cleared.body as Record<string, unknown>).ref_code, "");
    const kept = wizardWrite({ ...system, owner: "IT Ops" });
    assert.ok(!("error" in kept));
    assert.equal("ref_code" in (kept.body as Record<string, unknown>), false);
    assert.deepEqual(wizardWrite({ ...system, ref_code: "1AD" }), {
      error: "invalid",
    });
  });
});

describe("suggested system details", () => {
  const ids = { organization_id: ORG, project_id: PROJECT };
  const base = `/organizations/${ORG}/projects/${PROJECT}/onboarding`;
  const empty = {
    name: "Active Directory",
    layer: "APPLICATION",
    description: "",
    purpose: "",
    processes: "",
    owner: "",
  };
  const answer = {
    layer: "INFRASTRUCTURE",
    description: "Directory service that authenticates users.",
    purpose: "Controls access to financially significant applications.",
    processes: "Logical access",
    owner: "IT Infrastructure Manager",
    basis: {
      layer: "CATALOGUE",
      description: "PRODUCT",
      purpose: "PRODUCT",
      processes: "RECORDS",
      owner: "PRODUCT",
      extra: "RECORDS",
    },
    source: "MODEL",
    note: "",
  };

  it("asks for a suggestion before the system is in scope", () => {
    assert.deepEqual(
      wizardWrite({ ...ids, intent: "suggest", name: " Active Directory " }),
      {
        method: "POST",
        path: `${base}/systems/suggest`,
        body: { name: "Active Directory" },
        timeout: 60000,
      },
    );
    assert.deepEqual(
      wizardWrite({
        ...ids,
        system_id: SYSTEM,
        intent: "suggest",
        name: "Okta",
        layer: "INFRASTRUCTURE",
      }),
      {
        method: "POST",
        path: `${base}/systems/suggest`,
        body: { name: "Okta", layer: "INFRASTRUCTURE", system_id: SYSTEM },
        timeout: 60000,
      },
    );
    for (const bad of [
      { ...ids, intent: "suggest", name: "" },
      { ...ids, intent: "suggest", name: "x".repeat(121) },
      { ...ids, intent: "suggest", name: "Okta", layer: "PLANET" },
      { ...ids, intent: "suggest", name: "Okta", system_id: "nope" },
      { ...ids, intent: "suggest", name: "password=hunter22" },
    ]) {
      assert.deepEqual(wizardWrite(bad), { error: "invalid" });
    }
  });

  it("reads the suggestion and drops what does not fit", () => {
    const parsed = parseSuggestion({
      ...answer,
      layer: "PLANET",
      owner: "x".repeat(300),
    });
    assert.ok(parsed !== null);
    assert.equal(parsed.layer, null);
    assert.equal(parsed.owner.length, 200);
    assert.deepEqual(Object.keys(parsed.basis).sort(), [
      "description",
      "layer",
      "owner",
      "processes",
      "purpose",
    ]);
    assert.equal(parseSuggestion("nope"), null);
    assert.equal(parseSuggestion({ source: "SOMETHING" })?.source, "RULES");
  });

  it("fills only the empty fields and leaves a chosen kind alone", () => {
    const suggestion = parseSuggestion(answer);
    assert.ok(suggestion !== null);
    const all = applySuggestion(empty, suggestion, false);
    assert.equal(all.details.layer, "INFRASTRUCTURE");
    assert.equal(all.details.owner, "IT Infrastructure Manager");
    assert.deepEqual(all.filled, [
      "layer",
      "description",
      "purpose",
      "processes",
      "owner",
    ]);
    const written = applySuggestion(
      { ...empty, layer: "TOOL", owner: "Dana Reyes" },
      suggestion,
      true,
    );
    assert.equal(written.details.layer, "TOOL");
    assert.equal(written.details.owner, "Dana Reyes");
    assert.deepEqual(written.filled, ["description", "purpose", "processes"]);
    assert.equal(written.details.name, "Active Directory");
  });

  it("says where each suggestion came from and what was filled", () => {
    assert.equal(
      basisLabel("RECORDS"),
      "Suggested from the engagement's records",
    );
    assert.equal(
      basisLabel(undefined),
      "Suggested from what is known of the product",
    );
    const suggestion = parseSuggestion({
      ...answer,
      note: "No model is configured.",
    });
    assert.ok(suggestion !== null);
    assert.equal(
      suggestionSummary(suggestion, 2),
      "2 fields were filled. Review each suggestion before saving. No model is configured.",
    );
    assert.equal(
      suggestionSummary({ ...suggestion, note: "" }, 0),
      "No empty fields could be filled.",
    );
  });
});

describe("finding a library control to add to a system", () => {
  const offer = (ref: string, title: string, domain: string, back = false) => ({
    libraryKey: ref.toLowerCase(),
    controlRef: ref,
    title,
    domain,
    controlId: back ? `id-${ref}` : null,
  });
  const areas = [
    {
      domain: "ACCESS",
      label: "Logical access",
      offers: [
        offer(
          "ITGC-AC-06",
          "Shared, Generic, and Service Account Management",
          "ACCESS",
          true,
        ),
        offer(
          "ITGC-AC-09",
          "Third-Party and Vendor Account Management",
          "ACCESS",
        ),
      ],
    },
    {
      domain: "CHANGE",
      label: "Change management",
      offers: [offer("ITGC-CM-04", "Configuration Change Approval", "CHANGE")],
    },
  ];
  const refs = (shown: ReturnType<typeof filterOffers>) =>
    shown.flatMap((area) => area.offers.map((item) => item.controlRef));

  it("matches every word of the search in the ID or title, in any case", () => {
    const all = { query: "", domain: null, removed: false };
    assert.deepEqual(refs(filterOffers(areas, all)), [
      "ITGC-AC-06",
      "ITGC-AC-09",
      "ITGC-CM-04",
    ]);
    assert.deepEqual(
      refs(filterOffers(areas, { ...all, query: "vendor ACCOUNT" })),
      ["ITGC-AC-09"],
    );
    assert.deepEqual(refs(filterOffers(areas, { ...all, query: "cm-04" })), [
      "ITGC-CM-04",
    ]);
    assert.deepEqual(filterOffers(areas, { ...all, query: "backup" }), []);
  });

  it("narrows to one area, or to the controls taken out of scope", () => {
    const all = { query: "", domain: null, removed: false };
    const change = filterOffers(areas, { ...all, domain: "CHANGE" });
    assert.deepEqual(
      change.map((area) => area.label),
      ["Change management"],
    );
    assert.deepEqual(refs(filterOffers(areas, { ...all, removed: true })), [
      "ITGC-AC-06",
    ]);
    assert.deepEqual(
      filterOffers(areas, { ...all, domain: "CHANGE", removed: true }),
      [],
    );
  });
});
