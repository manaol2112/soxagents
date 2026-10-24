import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  apiQuery,
  bulkSummary,
  type CenterQuery,
  centerHref,
  centerWrite,
  DEFAULT_QUERY,
  exportHref,
  filtered,
  parseBulkResult,
  parseCenterList,
  parseCenterQuery,
  progressLine,
  viewQuery,
} from "../apps/web/src/evidence-center-model.ts";

const ORG = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const REQUEST = "33333333-3333-4333-8333-333333333333";
const OTHER = "44444444-4444-4444-8444-444444444444";
const ids = { organizationId: ORG, projectId: PROJECT };

const row = {
  id: REQUEST,
  reference: "PBC-33333333",
  title: "Every access grant or change in the window",
  control_id: OTHER,
  control_ref: "ITGC-AC-01",
  control_title: "New user access is approved",
  systems: ["SAP ERP"],
  phase: "INTERIM",
  request_type: "ACCESS_LISTING",
  type_label: "Access listing",
  type_uncertain: false,
  recipient: "",
  recipient_name: "",
  cc_count: 0,
  status: "DRAFT",
  stage: "READY_FOR_REVIEW",
  stage_label: "Ready for review",
  overdue: false,
  escalated: false,
  clarification: false,
  held: false,
  due_at: "2026-10-27T23:59:00+00:00",
  priority: "HIGH",
  agent: "READY_FOR_REVIEW",
  agent_label: "Drafted, ready for review",
  drafted_by: "AGENT",
  files: 0,
  version: 3,
  approval_id: null,
  approval_decision: null,
  viewer_can_decide: false,
  kickoff: false,
};

const api = {
  rows: [row, { ...row, id: "nope" }, { ...row, id: OTHER, stage: "INVENTED" }],
  matching: [{ id: REQUEST, version: 3 }],
  total: 1,
  page: 1,
  size: 50,
  kpis: {
    total: 160,
    needs_assignment: 160,
    awaiting_approval: 0,
    awaiting_client: 0,
    received: 0,
    needs_review: 0,
    overdue: 0,
    completed: 0,
  },
  facets: {
    stage: [{ key: "READY_FOR_REVIEW", label: "Ready for review", count: 160 }],
    phase: [],
    type: [],
    owner: [{ key: "UNASSIGNED", label: "Unassigned", count: 160 }],
    system: [],
  },
  views: [
    {
      id: "all",
      name: "All requests",
      built_in: true,
      filters: { view: "all" },
    },
    {
      id: OTHER,
      name: "Interim access",
      built_in: false,
      filters: { phase: ["INTERIM"], kpi: "overdue", q: "ac", view: "all" },
    },
  ],
  controls: [{ id: OTHER, control_ref: "ITGC-AC-01", title: "x", systems: [] }],
  types: [{ request_type: "POPULATION", label: "Population", purpose: "x" }],
  unplanned: 2,
  unrequested: 1,
  can_act: true,
  can_approve: false,
};

describe("the evidence command center list", () => {
  it("reads the API's list and drops rows that are not well formed", () => {
    const list = parseCenterList(api);
    assert.ok(list !== null);
    assert.equal(list.rows.length, 1);
    const first = list.rows[0];
    assert.equal(first?.stage, "READY_FOR_REVIEW");
    assert.equal(first?.priority, "HIGH");
    assert.equal(first?.draftedBy, "AGENT");
    assert.equal(first?.recipient, "");
    assert.equal(list.kpis.needs_assignment, 160);
    assert.equal(list.facets.owner[0]?.key, "UNASSIGNED");
    assert.equal(list.views[1]?.builtIn, false);
    assert.deepEqual([list.unplanned, list.unrequested], [2, 1]);
    assert.equal(list.canApprove, false);
    assert.equal(parseCenterList({ rows: "x" }), null);
  });

  it("keeps the list's state in the address, and reads it back", () => {
    const query: CenterQuery = {
      ...DEFAULT_QUERY,
      q: "access",
      phase: ["INTERIM", "DESIGN"],
      owner: ["UNASSIGNED"],
      kpi: "needs_assignment",
      sort: "due",
      dir: "desc",
      page: 3,
      size: 100,
      request: REQUEST,
    };
    const href = centerHref(ids, DEFAULT_QUERY, query);
    const params = new URL(href, "http://x").searchParams;
    assert.equal(params.get("section"), "evidence");
    const back = parseCenterQuery((name) => params.get(name));
    assert.deepEqual(back, query);
    // Changing a filter goes back to the first page; paging does not.
    const narrowed = new URL(
      centerHref(ids, query, { type: ["POPULATION"] }),
      "http://x",
    );
    assert.equal(narrowed.searchParams.get("rpage"), null);
    const paged = new URL(centerHref(ids, query, { page: 4 }), "http://x");
    assert.equal(paged.searchParams.get("rpage"), "4");
    // Odd values are left out.
    const odd = parseCenterQuery(
      (name) =>
        ({
          rsort: "drop table",
          rsize: "7",
          rpage: "-2",
          rkpi: "everything",
          request: "../x",
          rphase: "INTERIM,<script>",
          rview: "Robert'); --",
        })[name] ?? null,
    );
    assert.deepEqual(
      [odd.sort, odd.size, odd.page, odd.kpi, odd.request, odd.phase, odd.view],
      ["stage", 50, 1, null, null, ["INTERIM"], "all"],
    );
  });

  it("asks the API with the same filters, and exports them", () => {
    const query: CenterQuery = { ...DEFAULT_QUERY, stage: ["DRAFT"], q: "sap" };
    assert.equal(
      apiQuery(query),
      "q=sap&stage=DRAFT&view=all&sort=stage&dir=asc&page=1&size=50",
    );
    assert.match(
      exportHref(ids, query),
      /^\/workspace\/evidence-center\?q=sap&stage=DRAFT/,
    );
    assert.equal(filtered(DEFAULT_QUERY), false);
    assert.equal(filtered(query), true);
  });

  it("applies a saved view's filters", () => {
    const list = parseCenterList(api);
    const saved = list?.views[1];
    assert.ok(saved !== undefined);
    assert.deepEqual(viewQuery(saved), {
      view: OTHER,
      q: "ac",
      stage: [],
      phase: ["INTERIM"],
      type: [],
      owner: [],
      system: [],
      kpi: "overdue",
    });
  });
});

describe("the evidence command center writes", () => {
  const base = `/organizations/${ORG}/projects/${PROJECT}`;
  const fields = { organization_id: ORG, project_id: PROJECT };
  const items = [{ id: REQUEST, version: 3 }];

  it("approves and sends many at once, with the note, and says what went out", () => {
    assert.deepEqual(
      centerWrite({
        ...fields,
        intent: "bulk",
        action: "APPROVE_SEND",
        items,
        reason: "Checked the batch.",
      }),
      {
        intent: "bulk",
        path: `${base}/evidence-requests/bulk`,
        body: {
          action: "APPROVE_SEND",
          items,
          preview: false,
          reason: "Checked the batch.",
        },
      },
    );
    const outcome = (ok: boolean, detail: string) => ({
      id: detail,
      reference: "PBC-1",
      title: "",
      ok,
      detail,
    });
    assert.equal(
      bulkSummary("APPROVE_SEND", {
        done: 3,
        refused: 2,
        outcomes: [
          outcome(true, "Approved and sent."),
          outcome(false, "Approved, but not sent: Email sending is off."),
          outcome(false, "Assign a recipient."),
        ],
      }),
      "3 requests approved and sent; 1 approved but not sent; 1 could not change.",
    );
    assert.equal(
      bulkSummary("APPROVE_SEND", { done: 1, refused: 0, outcomes: [] }),
      "1 request approved and sent.",
    );
    assert.equal(
      bulkSummary("ASSIGN", { done: 2, refused: 1, outcomes: [] }),
      "2 requests updated; 1 could not change.",
    );
  });

  it("adds a new contact from a request's owner, checked as the request's panel does", () => {
    assert.deepEqual(
      centerWrite({
        ...fields,
        intent: "contact",
        name: " Dana Lee ",
        email: " Dana.Lee@Client.example ",
        role: "IT manager",
      }),
      {
        intent: "contact",
        path: `${base}/engagement-contacts`,
        body: {
          name: "Dana Lee",
          email: "dana.lee@client.example",
          role: "IT manager",
        },
      },
    );
    for (const bad of [
      { name: "", email: "dana@client.example" },
      { name: "Dana", email: "not-an-address" },
      { name: "Dana", email: "dana@client.example", role: "password: x" },
    ]) {
      assert.deepEqual(centerWrite({ ...fields, intent: "contact", ...bad }), {
        error: "invalid",
      });
    }
  });

  it("changes many requests at once, checked first", () => {
    assert.deepEqual(
      centerWrite({
        ...fields,
        intent: "bulk",
        action: "ASSIGN",
        recipient: " Ops@Client.example ",
        items,
        preview: true,
      }),
      {
        intent: "bulk",
        path: `${base}/evidence-requests/bulk`,
        body: {
          action: "ASSIGN",
          items,
          preview: true,
          recipient: "ops@client.example",
        },
      },
    );
    const bad = (extra: Record<string, unknown>) =>
      centerWrite({ ...fields, intent: "bulk", items, ...extra });
    assert.deepEqual(bad({ action: "ASSIGN", recipient: "nope" }), {
      error: "invalid",
    });
    assert.deepEqual(bad({ action: "DUE", due_on: "soon" }), {
      error: "invalid",
    });
    assert.deepEqual(bad({ action: "PRIORITY", priority: "CRITICAL" }), {
      error: "invalid",
    });
    assert.deepEqual(bad({ action: "RETURN", reason: "x" }), {
      error: "invalid",
    });
    assert.deepEqual(bad({ action: "DELETE" }), { error: "invalid" });
    assert.deepEqual(
      centerWrite({
        ...fields,
        intent: "bulk",
        action: "SUBMIT",
        items: [...items, ...items],
      }),
      { error: "invalid" },
    );
    assert.deepEqual(
      centerWrite({ ...fields, intent: "bulk", action: "SUBMIT", items: [] }),
      { error: "invalid" },
    );
    const many = Array.from({ length: 501 }, (_, n) => ({
      id: `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`,
      version: 1,
    }));
    assert.deepEqual(
      centerWrite({ ...fields, intent: "bulk", action: "SUBMIT", items: many }),
      { error: "invalid" },
    );
  });

  it("saves and removes views, creates a request, and requests planned evidence", () => {
    assert.deepEqual(
      centerWrite({
        ...fields,
        intent: "view-save",
        name: "Mine",
        filters: { q: "x" },
      }),
      {
        intent: "view-save",
        path: `${base}/evidence-views`,
        body: { name: "Mine", filters: { q: "x" } },
      },
    );
    assert.deepEqual(
      centerWrite({ ...fields, intent: "view-save", name: "", filters: {} }),
      {
        error: "invalid",
      },
    );
    assert.deepEqual(
      centerWrite({ ...fields, intent: "view-remove", view_id: OTHER }),
      {
        intent: "view-remove",
        path: `${base}/evidence-views/${OTHER}/remove`,
        body: {},
      },
    );
    assert.deepEqual(
      centerWrite({ ...fields, intent: "request-planned", control_id: OTHER }),
      {
        intent: "request-planned",
        path: `${base}/controls/${OTHER}/evidence-plan/request-planned`,
        body: {},
      },
    );
    const create = {
      ...fields,
      intent: "create",
      operation_key: "manual-abc",
      control_id: OTHER,
      control_ref: "ITGC-AC-01",
      phase: "INTERIM",
      request_type: "POPULATION",
      title: "Q3 listing",
      description: "Please provide the Q3 user listing.",
      recipient: "",
      cc: [],
      due_on: "2026-11-20",
      priority: "NORMAL",
      follow_up_after_days: 3,
      max_follow_ups: 2,
    };
    const made = centerWrite(create);
    assert.ok(!("error" in made));
    assert.equal(made.path, `${base}/pbc-requests`);
    assert.equal(made.body.engagement_control_id, OTHER);
    assert.equal(made.body.due_at, "2026-11-20T23:59:00+00:00");
    assert.deepEqual(centerWrite({ ...create, description: "short" }), {
      error: "invalid",
    });
    assert.deepEqual(centerWrite({ ...create, phase: "YEAREND" }), {
      error: "invalid",
    });
    assert.deepEqual(
      centerWrite({ ...create, description: "password: hunter2 please" }),
      {
        error: "invalid",
      },
    );
    assert.deepEqual(centerWrite({ ...create, operation_key: "../x" }), {
      error: "invalid",
    });
  });

  it("reads a bulk result", () => {
    assert.deepEqual(
      parseBulkResult({
        done: 1,
        refused: 1,
        outcomes: [
          {
            id: REQUEST,
            reference: "PBC-1",
            title: "A",
            ok: true,
            detail: "Approved. Not sent.",
          },
          {
            id: OTHER,
            reference: "PBC-2",
            title: "B",
            ok: false,
            detail: "Assign a recipient.",
          },
        ],
      })?.outcomes.map((item) => [item.ok, item.detail]),
      [
        [true, "Approved. Not sent."],
        [false, "Assign a recipient."],
      ],
    );
  });
});

describe("the test plan attributes a request supports", () => {
  it("reads each row's attribute codes, and none when the API gives none", () => {
    const row = (api.rows as Array<Record<string, unknown>>)[0] ?? {};
    const list = parseCenterList({
      ...api,
      rows: [{ ...row, supports: ["A1", "A3", 7] }],
    });
    assert.deepEqual(list?.rows[0]?.supports, ["A1", "A3"]);
    assert.deepEqual(parseCenterList(api)?.rows[0]?.supports, []);
  });
});

describe("a sent request's progress", () => {
  it("counts what the client provided and what a person accepted, once sent", () => {
    const row = {
      status: "SENT",
      itemsTotal: 8,
      itemsProvided: 3,
      itemsAccepted: 0,
    };
    assert.equal(progressLine(row), "3 of 8 provided");
    assert.equal(
      progressLine({ ...row, itemsAccepted: 2 }),
      "3 of 8 provided · 2 accepted",
    );
    assert.equal(progressLine({ ...row, status: "DRAFT" }), "");
    assert.equal(progressLine({ ...row, itemsTotal: 0 }), "");
  });
});
