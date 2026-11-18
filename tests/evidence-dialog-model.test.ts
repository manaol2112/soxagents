import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  dialogWrite,
  instanceFor,
  interimPopulationOf,
  parseInstances,
  parsePopulationPage,
  readableReason,
  type SuggestionInput,
  sampleSize,
  sizeChoices,
  stepsOf,
  suggestionFor,
  tablePath,
  walkthroughItemOf,
} from "../apps/web/src/evidence-dialog-model.ts";
import type {
  NavItem,
  NavPhase,
} from "../apps/web/src/evidence-intelligence-model.ts";

// The evidence dialog (product owner, 31 October 2026): what it shows and what it may
// send. Every action is the person's; the server checks each.

const ORG = "01a18a07-7dbf-7cfd-bf4c-ecc319c6e6da";
const PROJECT = "01a18a18-4ed6-7118-b03e-e25d7f5993d3";
const FILE = "01a18a18-6144-72dd-8137-ec38094cba64";
const OTHER = "01a18a18-6144-72dd-8137-ec38094cba65";

function item(
  id: string,
  phase: "DESIGN" | "INTERIM" | "ROLLFORWARD",
  categories: string[],
): NavItem {
  return {
    requirement: { id, phase, categories, requestId: "r", title: id },
    files: [],
    waits: false,
    attention: false,
  } as unknown as NavItem;
}

function phases(): NavPhase[] {
  return [
    {
      phase: "DESIGN",
      label: "Design & Implementation",
      items: [
        item("policy", "DESIGN", ["PROCESS_DOCUMENTATION"]),
        item("one-grant", "DESIGN", ["CONTROL_EXECUTION"]),
      ],
      fileCount: 0,
      attention: 0,
    },
    {
      phase: "INTERIM",
      label: "Interim",
      items: [
        item("grants-list", "INTERIM", ["POPULATION"]),
        item("selected", "INTERIM", ["SAMPLE"]),
      ],
      fileCount: 0,
      attention: 0,
    },
  ] as unknown as NavPhase[];
}

const BASE: SuggestionInput = {
  read: "ready",
  kind: "population",
  confirmed: false,
  phase: "INTERIM",
  itemTitle: "SAP access grants",
  table: true,
  interimPopulation: true,
  populationAccepted: false,
  samples: null,
  instance: null,
  linkedToInterim: false,
};

const actions = (input: Partial<SuggestionInput>) =>
  suggestionFor({ ...BASE, ...input }).actions.map((entry) => entry.action);

describe("the dialog's steps", () => {
  it("moves from upload to classify to preview to route", () => {
    const states = (input: Parameters<typeof stepsOf>[0]) =>
      stepsOf(input).map((step) => `${step.step}:${step.state}`);
    assert.deepEqual(
      states({ phase: "DESIGN", fileOpen: false, read: "none", routed: false }),
      ["upload:current", "classify:todo", "preview:todo", "route:todo"],
    );
    assert.deepEqual(
      states({
        phase: "DESIGN",
        fileOpen: true,
        read: "reading",
        routed: false,
      }),
      ["upload:done", "classify:current", "preview:todo", "route:todo"],
    );
    assert.deepEqual(
      states({ phase: "DESIGN", fileOpen: true, read: "ready", routed: false }),
      ["upload:done", "classify:done", "preview:current", "route:todo"],
    );
    assert.deepEqual(
      states({ phase: "INTERIM", fileOpen: true, read: "ready", routed: true }),
      ["upload:done", "classify:done", "preview:done", "route:done"],
    );
    // The last step says what routing means in the phase.
    assert.equal(
      stepsOf({
        phase: "DESIGN",
        fileOpen: false,
        read: "none",
        routed: false,
      })[3]?.detail,
      "Use in testing or keep in D&I",
    );
  });
});

describe("what the agent suggests", () => {
  it("waits while the file is read, and says when it could not be", () => {
    assert.deepEqual(actions({ read: "reading" }), []);
    assert.equal(
      suggestionFor({ ...BASE, read: "failed" }).title,
      "The file could not be read",
    );
  });

  it("offers a sample of one, interim testing or D&I for a design population", () => {
    assert.deepEqual(actions({ phase: "DESIGN" }), [
      "confirm-population",
      "pick-one",
      "route-interim",
      "keep-design",
    ]);
    // Once confirmed, picking leads; once linked to interim, that offer goes.
    assert.deepEqual(
      actions({ phase: "DESIGN", confirmed: true, linkedToInterim: true }),
      ["pick-one", "keep-design"],
    );
    // No interim population item: nothing to link it to.
    assert.deepEqual(
      actions({ phase: "DESIGN", confirmed: true, interimPopulation: false }),
      ["pick-one", "keep-design"],
    );
    // Once an instance is picked, its evidence is uploaded next.
    const picked = suggestionFor({
      ...BASE,
      phase: "DESIGN",
      confirmed: true,
      instance: { key: "u0042", rowNumber: 42 },
    });
    assert.equal(picked.title, "Walkthrough instance selected: u0042");
    assert.deepEqual(
      picked.actions.map((entry) => entry.action),
      ["upload-instance", "pick-one"],
    );
  });

  it("takes an operating population from confirmation to accepted samples", () => {
    assert.deepEqual(actions({}), ["confirm-population", "change-kind"]);
    // Confirmed: a person accepts it as complete and accurate before any sample.
    assert.deepEqual(actions({ confirmed: true }), ["accept-population"]);
    assert.deepEqual(actions({ confirmed: true, populationAccepted: true }), [
      "choose-samples",
    ]);
    assert.deepEqual(
      actions({
        confirmed: true,
        populationAccepted: true,
        samples: { status: "PROPOSED", count: 5 },
      }),
      ["approve-samples", "choose-samples"],
    );
    assert.deepEqual(
      actions({
        confirmed: true,
        populationAccepted: true,
        samples: { status: "APPROVED", count: 5 },
      }),
      [],
    );
  });

  it("never asks to confirm a population a person already accepted or sampled", () => {
    // The demo's readings are not type-confirmed, yet their samples are approved.
    assert.deepEqual(
      actions({
        samples: { status: "APPROVED", count: 25 },
        populationAccepted: true,
      }),
      [],
    );
    assert.deepEqual(actions({ populationAccepted: true }), ["choose-samples"]);
    assert.deepEqual(
      actions({
        populationAccepted: true,
        samples: { status: "PROPOSED", count: 3 },
      }),
      ["approve-samples", "choose-samples"],
    );
  });

  it("asks a person to confirm or correct any other kind", () => {
    const ticket = suggestionFor({ ...BASE, kind: "sample", table: false });
    assert.equal(
      ticket.title,
      "This looks like evidence for one sample, such as a ticket or an approval.",
    );
    assert.deepEqual(
      ticket.actions.map((entry) => entry.action),
      ["confirm-kind", "change-kind"],
    );
    assert.deepEqual(
      actions({ kind: "policy", table: false, confirmed: true }),
      ["change-kind"],
    );
    // A population kind that is not a table is not sampled.
    assert.deepEqual(actions({ table: false }), [
      "confirm-kind",
      "change-kind",
    ]);
  });
});

describe("sample sizes", () => {
  it("offers one, five and ten, and the plan's own size beside them", () => {
    assert.deepEqual(
      sizeChoices(25).map((choice) => [choice.size, choice.plan]),
      [
        [1, false],
        [5, false],
        [10, false],
        [25, true],
      ],
    );
    // The plan's size among them is marked, not repeated.
    assert.deepEqual(
      sizeChoices(5).map((choice) => [choice.size, choice.plan]),
      [
        [1, false],
        [5, true],
        [10, false],
      ],
    );
    assert.equal(sizeChoices(null).length, 3);
  });

  it("takes a whole number the server takes", () => {
    assert.equal(sampleSize("25"), 25);
    assert.equal(sampleSize(" 3 "), 3);
    for (const bad of ["0", "201", "2.5", "x", ""]) {
      assert.equal(sampleSize(bad), null, bad);
    }
  });
});

describe("the items a pick or a link is for", () => {
  it("picks for the design item that asks for an executed instance", () => {
    const all = phases();
    assert.equal(walkthroughItemOf(all, null)?.requirement.id, "one-grant");
    const noExecution = all.map((entry) =>
      entry.phase === "DESIGN"
        ? { ...entry, items: [entry.items[0] as NavItem] }
        : entry,
    );
    // Without one, the design item the file is on; never an interim item.
    assert.equal(
      walkthroughItemOf(noExecution, noExecution[0]?.items[0] ?? null)
        ?.requirement.id,
      "policy",
    );
    assert.equal(
      walkthroughItemOf(noExecution, all[1]?.items[0] ?? null),
      null,
    );
  });

  it("links a design population to the interim population item", () => {
    assert.equal(interimPopulationOf(phases())?.requirement.id, "grants-list");
    assert.equal(interimPopulationOf([phases()[0] as NavPhase]), null);
  });
});

describe("what the dialog sends", () => {
  const ids = { organization_id: ORG, project_id: PROJECT };

  it("checks each action before it goes to the API", () => {
    assert.deepEqual(
      dialogWrite({
        ...ids,
        intent: "confirm-kind",
        analysis_id: FILE,
        version: 2,
        kind: "population",
      }),
      {
        ok: true,
        path: `/organizations/${ORG}/projects/${PROJECT}/evidence-analyses/${FILE}/confirm`,
        body: { version: 2, kind: "population" },
      },
    );
    assert.deepEqual(
      dialogWrite({
        ...ids,
        intent: "propose-samples",
        file_id: FILE,
        sample_size: 5,
      }),
      {
        ok: true,
        path: `/organizations/${ORG}/projects/${PROJECT}/control-tests/propose`,
        body: { evidence_file_id: FILE, sample_size: 5 },
      },
    );
    const pick = dialogWrite({
      ...ids,
      intent: "pick-instance",
      control_id: FILE,
      requirement_id: OTHER,
      file_id: FILE,
      row_number: 4,
    });
    assert.ok(pick.ok);
    assert.equal(
      pick.ok ? pick.path : "",
      `/organizations/${ORG}/projects/${PROJECT}/controls/${FILE}/evidence-requirements/${OTHER}/walkthrough-instance`,
    );
  });

  it("refuses what the API would not take", () => {
    const refused = [
      {
        ...ids,
        intent: "confirm-kind",
        analysis_id: FILE,
        version: 1,
        kind: "ticket",
      },
      { ...ids, intent: "propose-samples", file_id: FILE, sample_size: 0 },
      { ...ids, intent: "propose-samples", file_id: FILE, sample_size: 201 },
      { ...ids, intent: "approve-samples", test_id: "x", version: 1 },
      {
        ...ids,
        intent: "pick-instance",
        control_id: FILE,
        requirement_id: OTHER,
        file_id: FILE,
        row_number: 0,
      },
      { ...ids, intent: "accept-population" },
      {
        organization_id: "x",
        project_id: PROJECT,
        intent: "propose-samples",
        file_id: FILE,
        sample_size: 3,
      },
    ];
    for (const fields of refused) {
      assert.equal(dialogWrite(fields).ok, false, JSON.stringify(fields));
    }
  });

  it("reads a page of rows only with a checked file and bounds", () => {
    const params = (extra: Record<string, string>) =>
      new URLSearchParams({
        organization: ORG,
        project: PROJECT,
        file: FILE,
        ...extra,
      });
    assert.equal(
      tablePath(params({ offset: "25", limit: "25", search: "u00" })),
      `/organizations/${ORG}/projects/${PROJECT}/evidence-files/${FILE}/table?offset=25&limit=25&search=u00`,
    );
    assert.equal(tablePath(params({ limit: "500" })), null);
    assert.equal(tablePath(params({ file: "../x" })), null);
  });
});

describe("reading the API's answers", () => {
  it("reads a page of a population", () => {
    const page = parsePopulationPage({
      columns: ["User ID", "Name"],
      rows: [{ row_number: 1, values: ["u0001", "Ana"] }],
      total: 40,
      matched: 1,
      offset: 0,
      key_column: "User ID",
      date_column: null,
    });
    assert.deepEqual(page?.rows, [{ rowNumber: 1, values: ["u0001", "Ana"] }]);
    assert.equal(page?.keyColumn, "User ID");
    assert.equal(parsePopulationPage({ columns: "x" }), null);
  });

  it("reads the picks and finds the current one for a file", () => {
    const picks = parseInstances({
      instances: [
        {
          id: FILE,
          requirement_id: OTHER,
          population_file_id: FILE,
          file_name: "grants.csv",
          row_number: 5,
          key_column: "User ID",
          key_value: "u0005",
          columns: ["User ID"],
          values: ["u0005"],
          note: "",
          selected_by_name: "Ava Lin",
          created_at: "2026-10-31T10:00:00Z",
          superseded_at: null,
        },
        {
          id: OTHER,
          requirement_id: OTHER,
          population_file_id: FILE,
          file_name: "grants.csv",
          row_number: 2,
          key_column: "User ID",
          key_value: "u0002",
          columns: ["User ID"],
          values: ["u0002"],
          note: "",
          selected_by_name: "Ava Lin",
          created_at: "2026-10-31T09:00:00Z",
          superseded_at: "2026-10-31T10:00:00Z",
        },
      ],
    });
    assert.equal(picks?.length, 2);
    assert.equal(instanceFor(picks, FILE)?.keyValue, "u0005");
    assert.equal(instanceFor(picks, OTHER), null);
    assert.equal(parseInstances({ instances: [{ id: "x" }] }), null);
  });
});

describe("the reader's reason as a person reads it", () => {
  it("drops field names in brackets and ends at a full sentence", () => {
    assert.equal(
      readableReason(
        "It is a listing. The extract is not cut (excerpt_is_cut is false), but the rows end in September. The file does not say how it was generated or whe",
      ),
      "It is a listing. The extract is not cut, but the rows end in September.",
    );
    assert.equal(readableReason("Complete and clear."), "Complete and clear.");
    assert.equal(
      readableReason("No full stop here"),
      "No full stop here\u2026",
    );
    // Ordinary brackets stay.
    assert.equal(
      readableReason("Rows run to September (Q3)."),
      "Rows run to September (Q3).",
    );
  });
});
