import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  EMPTY_QUERY,
  filterRequests,
  isOverdue,
  itemsProgress,
  type PortalRequest,
  parsePortal,
  requestHref,
  requestTypes,
  selectedRequest,
  submitCheck,
  uploadItem,
  workspaceWrite,
} from "../apps/web/src/portal-model.ts";
import { detailsWrite } from "../apps/web/src/request-details-model.ts";

const A = "01a1429c-504a-7abe-9fe0-bb5b2c4f2f99";
const B = "01a1429c-504a-7abe-9fe0-bb5b2c4f2f98";
const ORG = "01a13253-ec1a-7604-8944-a06dd7633ce0";
const PROJECT = "01a1327d-b92a-7bd1-b34b-845a8d89c879";
const KEY = "0123456789abcdef";

function file(name: string) {
  return { file_name: name, size_bytes: 10, added_at: "2026-10-20T09:00:00Z" };
}

function item(number: number, title: string, files: unknown[] = []) {
  return {
    number,
    title,
    detail: "",
    period: "1 January 2027 to 30 September 2027",
    include: ["User ID", 4],
    format: "",
    show: "",
    completeness: "",
    state: files.length > 0 ? "UPLOADED" : "NOT_STARTED",
    state_label: files.length > 0 ? "Uploaded" : "Not started",
    files,
  };
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    id: A,
    reference: "PBC-2C4F2F99",
    control: "ITGC-AC-01",
    description: "1. Access grants\n\n2. The query",
    due_at: "2026-10-26T00:00:00Z",
    status: "SENT",
    open_until: "2026-11-25T00:00:00Z",
    files: [file("grants.csv")],
    title: "Access grants",
    type_label: "Access listing",
    summary: "To test how access is approved.",
    structured: true,
    period: "1 January 2027 to 30 September 2027",
    deliverables: [
      item(1, "Access grants", [file("grants.csv")]),
      item(2, "The query"),
    ],
    earlier_files: [],
    questions: [
      { key: KEY, text: "Which system?", answer: "", answered_at: null },
    ],
    messages: [
      {
        id: B,
        author: "AUDIT_TEAM",
        author_name: "Dana, audit team",
        body: "CSV is fine.",
        created_at: "2026-10-21T09:00:00Z",
      },
    ],
    submitted_at: null,
    owner_status: "IN_PROGRESS",
    owner_status_label: "In progress",
    open: true,
    ...overrides,
  };
}

function portal(requests: unknown[]) {
  return {
    engagement: "SOX 2027",
    firm: "Acme Audit",
    email: "iam@client.example",
    session_expires_at: "2027-01-01T12:00:00Z",
    requests,
    period_start: "2027-01-01T00:00:00",
    period_end: "2027-12-31T00:00:00",
  };
}

function parsed(requests: unknown[]): PortalRequest[] {
  const found = parsePortal(portal(requests));
  assert.ok(found !== null);
  return found.requests;
}

describe("the owner's evidence workspace", () => {
  it("reads deliverables, questions, and messages, and keeps only well-formed ones", () => {
    const [one] = parsed([request()]);
    assert.ok(one !== undefined);
    assert.equal(one.ownerStatus, "IN_PROGRESS");
    assert.deepEqual(
      one.deliverables.map((entry) => [entry.number, entry.files.length]),
      [
        [1, 1],
        [2, 0],
      ],
    );
    // Only text is kept from an item's include list.
    assert.deepEqual(one.deliverables[0]?.include, ["User ID"]);
    assert.equal(one.questions[0]?.key, KEY);
    assert.equal(one.messages[0]?.author, "AUDIT_TEAM");
    // A malformed deliverable, question, or message makes the answer untrusted.
    for (const broken of [
      { deliverables: [{ ...item(1, "x"), number: 99 }] },
      { questions: [{ key: "nothex", text: "?" }] },
      {
        messages: [{ id: "1", author: "AUDIT_TEAM", body: "", created_at: "" }],
      },
      { deliverables: [{ ...item(1, "x"), state: "DONE" }] },
    ]) {
      assert.equal(parsePortal(portal([request(broken)])), null);
    }
  });

  it("counts by status from the requests read, so the summary matches the list", () => {
    const found = parsePortal(
      portal([
        request(),
        request({ id: B, owner_status: "AWAITING", files: [] }),
      ]),
    );
    assert.equal(found?.counts.total, 2);
    assert.equal(found?.counts.IN_PROGRESS, 1);
    assert.equal(found?.counts.AWAITING, 1);
    assert.equal(found?.counts.COMPLETED, 0);
    assert.equal(found?.periodEnd, "2027-12-31T00:00:00");
  });

  it("shows a request from before deliverables as one deliverable, as written", () => {
    const old = {
      id: A,
      reference: "PBC-2C4F2F99",
      control: "ITGC-AC-01",
      description: "Every access grant in the window.",
      due_at: "2026-10-26T00:00:00Z",
      status: "SENT",
      open_until: "2026-11-25T00:00:00Z",
      files: [],
    };
    const [one] = parsed([old]);
    assert.equal(one?.structured, false);
    assert.equal(one?.title, "Every access grant in the window.");
    assert.equal(one?.deliverables.length, 1);
    assert.equal(one?.ownerStatus, "AWAITING");
    assert.equal(one?.open, true);
  });

  it("searches, filters, and sorts the list", () => {
    const requests = parsed([
      request(),
      request({
        id: B,
        reference: "PBC-00000001",
        title: "Change tickets",
        type_label: "Change listing",
        control: "ITGC-CM-01",
        due_at: "2026-10-01T00:00:00Z",
        owner_status: "AWAITING",
        deliverables: [item(1, "Change tickets")],
      }),
    ]);
    const ids = (query: Partial<typeof EMPTY_QUERY>) =>
      filterRequests(requests, { ...EMPTY_QUERY, ...query }).map(
        (entry) => entry.reference,
      );
    assert.deepEqual(ids({}), ["PBC-00000001", "PBC-2C4F2F99"]);
    assert.deepEqual(ids({ sort: "due-latest" }), [
      "PBC-2C4F2F99",
      "PBC-00000001",
    ]);
    assert.deepEqual(ids({ sort: "title" }), ["PBC-2C4F2F99", "PBC-00000001"]);
    assert.deepEqual(ids({ search: "cm-01" }), ["PBC-00000001"]);
    // Search reaches the items too.
    assert.deepEqual(ids({ search: "the query" }), ["PBC-2C4F2F99"]);
    assert.deepEqual(ids({ status: "AWAITING" }), ["PBC-00000001"]);
    assert.deepEqual(ids({ type: "Access listing" }), ["PBC-2C4F2F99"]);
    assert.deepEqual(ids({ search: "nothing like this" }), []);
    assert.deepEqual(requestTypes(requests), [
      "Access listing",
      "Change listing",
    ]);
  });

  it("measures items with files and when a request is past due", () => {
    const [one] = parsed([request()]);
    assert.ok(one !== undefined);
    assert.deepEqual(itemsProgress(one), { done: 1, total: 2 });
    const later = Date.parse("2026-11-01T00:00:00Z");
    assert.equal(isOverdue(one, later), true);
    assert.equal(
      isOverdue({ ...one, submittedAt: "2026-10-25" }, later),
      false,
    );
    assert.equal(isOverdue({ ...one, open: false }, later), false);
    assert.equal(isOverdue(one, Date.parse("2026-10-01T00:00:00Z")), false);
  });

  it("submits only with a file, naming the items still empty", () => {
    const [one] = parsed([request()]);
    assert.ok(one !== undefined);
    assert.deepEqual(submitCheck(one), {
      ready: true,
      missing: ["The query"],
      problem: null,
    });
    const empty = {
      ...one,
      deliverables: one.deliverables.map((entry) => ({ ...entry, files: [] })),
    };
    assert.equal(submitCheck(empty).ready, false);
    assert.match(submitCheck(empty).problem ?? "", /at least one file/);
    assert.equal(submitCheck({ ...one, open: false }).ready, false);
  });

  it("keeps the open request in the address, and only a request id", () => {
    assert.equal(requestHref("/upload/tok", A), `/upload/tok?request=${A}`);
    assert.equal(requestHref("/upload/tok", null), "/upload/tok");
    assert.equal(selectedRequest(`?request=${A}`), A);
    assert.equal(selectedRequest("?request=../../x"), null);
    assert.equal(selectedRequest(""), null);
  });

  it("checks the owner's writes before they are sent", () => {
    assert.deepEqual(workspaceWrite("messages", A, { body: "  Hello  " }), {
      path: `/session/requests/${A}/messages`,
      body: { body: "Hello" },
    });
    assert.ok("error" in workspaceWrite("messages", A, { body: "  " }));
    assert.ok(
      "error" in workspaceWrite("messages", A, { body: "x".repeat(4001) }),
    );
    assert.ok("error" in workspaceWrite("messages", "../x", { body: "Hi" }));
    assert.deepEqual(
      workspaceWrite("answers", A, { answers: [{ key: KEY, answer: "SAP" }] }),
      {
        path: `/session/requests/${A}/answers`,
        body: { answers: [{ key: KEY, answer: "SAP" }] },
      },
    );
    assert.ok(
      "error" in
        workspaceWrite("answers", A, {
          answers: [{ key: "x", answer: "SAP" }],
        }),
    );
    assert.ok("error" in workspaceWrite("answers", A, { answers: [] }));
    assert.deepEqual(
      workspaceWrite("submit", A, { note: " Done ", confirm_incomplete: true }),
      {
        path: `/session/requests/${A}/submit`,
        body: { note: "Done", confirm_incomplete: true },
      },
    );
    // Only a literal true confirms submitting with items still empty.
    assert.deepEqual(
      workspaceWrite("submit", A, { confirm_incomplete: "true" }),
      {
        path: `/session/requests/${A}/submit`,
        body: { note: "", confirm_incomplete: false },
      },
    );
    assert.ok(
      "error" in workspaceWrite("submit", A, { note: "x".repeat(2001) }),
    );
    assert.equal(uploadItem(null), null);
    assert.equal(uploadItem("2"), 2);
    for (const bad of ["0", "51", "1.5", "two", 3]) {
      assert.equal(uploadItem(bad), "invalid");
    }
  });
});

describe("the owner's responses on the team's side", () => {
  it("builds the team's reply and seen writes", () => {
    const ids = { organization_id: ORG, project_id: PROJECT, request_id: A };
    const root = `/organizations/${ORG}/projects/${PROJECT}/pbc-requests/${A}`;
    assert.deepEqual(
      detailsWrite({ ...ids, intent: "message", body: " Yes " }),
      {
        intent: "message",
        path: `${root}/messages`,
        body: { body: "Yes" },
      },
    );
    assert.ok("error" in detailsWrite({ ...ids, intent: "message", body: "" }));
    assert.ok(
      "error" in
        detailsWrite({ ...ids, intent: "message", body: "password: hunter2" }),
    );
    assert.deepEqual(detailsWrite({ ...ids, intent: "seen" }), {
      intent: "seen",
      path: `${root}/messages/seen`,
      body: {},
    });
  });
});
