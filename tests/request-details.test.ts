import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  addressProblem,
  attachmentHref,
  attachmentTarget,
  detailsWrite,
  formatBytes,
  hasClientActivity,
  type LifecycleInput,
  lifecycleOf,
  matchContacts,
  parseRequestDetails,
  parseSources,
} from "../apps/web/src/request-details-model.ts";
import {
  reviewProblem,
  reviewWrite,
} from "../apps/web/src/request-review-model.ts";

const ORG = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const REQUEST = "33333333-3333-4333-8333-333333333333";
const FILE = "44444444-4444-4444-8444-444444444444";
const ids = { organization_id: ORG, project_id: PROJECT, request_id: REQUEST };

const api = {
  request: {
    id: REQUEST,
    status: "DRAFT",
    recipient: "iam@client.example",
    due_at: "2026-11-01T23:59:00+00:00",
    evidence_description: "1. User access listing\n   Every active user.",
    control_ref: "PBC-ITGC-AC-01",
    version: 3,
    cc_recipients: ["pbc@client.example"],
    priority: "HIGH",
    testing_phase: "INTERIM",
    engagement_control_id: FILE,
  },
  reference: "PBC-33333333",
  title: "User access listing",
  title_set: false,
  control: {
    id: FILE,
    control_ref: "ITGC-AC-01",
    title: "User access review",
    owner_name: "Dana Lee",
  },
  type: {
    request_type: "ACCESS_LISTING",
    label: "Access listing",
    basis: "RULES",
    confirmed: false,
    uncertain: false,
    reason: "Classified from the evidence plan's requirements.",
  },
  types: [
    { request_type: "ACCESS_LISTING", label: "Access listing", purpose: "x" },
    { request_type: "bad key", label: "Ignored", purpose: "x" },
  ],
  content: {
    summary: "For our interim testing we need the items below.",
    items: [
      {
        number: 1,
        title: "User access listing",
        detail: "Every active user.",
        period: "1 January to 30 September 2028",
        include: ["User ID", "Role"],
        format: "",
        show: "",
        completeness: "",
        request_type: "ACCESS_LISTING",
      },
    ],
    questions: ["Who performs this control?"],
    structured: true,
  },
  planning: {
    requirements: [
      {
        title: "User access listing",
        categories: ["POPULATION"],
        objective: "Completeness of the population.",
        rationale: "Samples are selected from it.",
        necessity: "REQUIRED",
        status: "REQUESTED",
        sufficiency: "NOT_REVIEWED",
      },
    ],
    assumptions: ["The listing comes from the identity system."],
    drafted_by: "MODEL",
    drafting: false,
  },
  attachments: [
    {
      id: FILE,
      source: "PRIOR_YEAR_WORKPAPER",
      file_name: "FY2027 ITGC-AC-01-TOE effectiveness workpaper.xlsx",
      content_type: "application/vnd.ms-excel",
      size_bytes: 24_576,
      source_year: "FY2027",
      visibility: "INTERNAL",
      previewable: false,
      added_by: "Alex Auditor",
      added_at: "2026-10-01T10:00:00+00:00",
      shared_by: null,
      version: 1,
    },
    { id: "not-a-uuid" },
  ],
  contacts: [
    {
      name: "Dana Lee",
      email: "iam@client.example",
      role: "Control owner, ITGC-AC-01",
      source: "OWNER",
    },
    {
      name: "Pat",
      email: "pbc@client.example",
      role: "",
      source: "COORDINATOR",
    },
    { name: "Broken", email: "not-an-email", source: "CONTACT" },
  ],
  suggested: {
    name: "Dana Lee",
    email: "iam@client.example",
    role: "Control owner",
    source: "OWNER",
  },
  domains: ["client.example"],
  checks: [
    {
      key: "recipient",
      label: "Recipient",
      ok: true,
      detail: "iam@client.example",
    },
    { key: "type", label: "Request type", ok: true, detail: "Access listing" },
  ],
  ready: true,
  clarification: false,
  assignable: true,
  can_edit: true,
  can_share: false,
};

describe("the request details", () => {
  it("reads the API's details, dropping what is not well formed", () => {
    const details = parseRequestDetails(api);
    assert.ok(details !== null);
    assert.equal(details.request.priority, "HIGH");
    assert.deepEqual(details.request.ccRecipients, ["pbc@client.example"]);
    assert.equal(details.request.testingPhase, "INTERIM");
    assert.equal(details.type.key, "ACCESS_LISTING");
    assert.deepEqual(
      details.types.map((item) => item.key),
      ["ACCESS_LISTING"],
    );
    assert.equal(details.content.items[0]?.include.length, 2);
    assert.equal(details.planning.draftedBy, "MODEL");
    assert.equal(details.attachments.length, 1);
    assert.equal(details.attachments[0]?.source, "PRIOR_YEAR_WORKPAPER");
    assert.deepEqual(
      details.contacts.map((item) => item.email),
      ["iam@client.example", "pbc@client.example"],
    );
    assert.equal(details.suggested?.role, "Control owner");
    assert.equal(details.canShare, false);
    assert.equal(parseRequestDetails({ ...api, request: null }), null);
    assert.equal(parseRequestDetails("nope"), null);
  });

  it("reads what the owner gave through the portal, naming each side", () => {
    assert.equal(parseRequestDetails(api)?.client, null);
    assert.equal(hasClientActivity(null), false);
    const details = parseRequestDetails({
      ...api,
      client: {
        answers: [
          {
            question: "Which system?",
            answer: "SAP ERP",
            answered_at: "2026-10-21T09:00:00Z",
          },
          { question: "Blank?", answer: "", answered_at: "" },
        ],
        messages: [
          {
            id: "01a1429c-504a-7abe-9fe0-bb5b2c4f2f90",
            author: "YOU",
            author_name: "iam@client.example",
            body: "Is CSV fine?",
            created_at: "2026-10-21T09:00:00Z",
          },
          {
            id: "01a1429c-504a-7abe-9fe0-bb5b2c4f2f91",
            author: "AUDIT_TEAM",
            author_name: "Dana",
            body: "Yes.",
            created_at: "2026-10-21T10:00:00Z",
          },
          { id: "bad", author: "YOU", body: "x" },
        ],
        submitted_at: "2026-10-22T09:00:00Z",
        submission_note: "The query follows.",
        unseen: 1,
      },
    });
    const client = details?.client ?? null;
    assert.ok(client !== null);
    assert.deepEqual(
      client.answers.map((item) => item.answer),
      ["SAP ERP"],
    );
    assert.deepEqual(
      client.messages.map((item) => [item.author, item.authorName]),
      [
        ["OWNER", "iam@client.example"],
        ["TEAM", "Dana"],
      ],
    );
    assert.equal(client.submittedAt, "2026-10-22T09:00:00Z");
    assert.equal(client.unseen, 1);
    assert.equal(hasClientActivity(client), true);
  });

  it("finds contacts by name, email, or role, without those already on it", () => {
    const details = parseRequestDetails(api);
    assert.ok(details !== null);
    assert.deepEqual(
      matchContacts(details.contacts, "owner", []).map((item) => item.email),
      ["iam@client.example"],
    );
    assert.deepEqual(
      matchContacts(details.contacts, "client.example", [
        "IAM@client.example",
      ]).map((item) => item.email),
      ["pbc@client.example"],
    );
    assert.equal(matchContacts(details.contacts, "zzz", []).length, 0);
  });

  it("says why an address cannot be used, as the API does", () => {
    assert.equal(
      addressProblem("dana@client.example", ["client.example"]),
      null,
    );
    assert.equal(
      addressProblem("dana@elsewhere.example", ["client.example"]),
      "dana@elsewhere.example is outside the client's email domains (client.example).",
    );
    assert.equal(
      addressProblem("nope", ["client.example"]),
      "nope is not a valid email address.",
    );
    // An engagement that names no domains accepts any valid address here.
    assert.equal(addressProblem("dana@elsewhere.example", []), null);
  });

  it("formats sizes", () => {
    assert.equal(formatBytes(512), "512 B");
    assert.equal(formatBytes(24_576), "24 KB");
    assert.equal(formatBytes(3_500_000), "3.3 MB");
  });
});

describe("the request lifecycle", () => {
  const base: LifecycleInput = {
    status: "DRAFT",
    approvalDecision: null,
    agentDrafted: true,
    wordingReady: true,
    clarification: false,
    requirements: [],
  };
  const at = (input: Partial<LifecycleInput>) =>
    lifecycleOf({ ...base, ...input });

  it("follows the main path from draft to completed", () => {
    assert.equal(at({ agentDrafted: false }).key, "DRAFT");
    assert.equal(at({ wordingReady: false }).key, "DRAFT");
    assert.equal(at({}).key, "READY_FOR_REVIEW");
    assert.equal(at({ status: "APPROVAL_PENDING" }).key, "READY_FOR_REVIEW");
    assert.equal(
      at({ status: "APPROVAL_PENDING", approvalDecision: "APPROVED" }).key,
      "APPROVED",
    );
    // Sent is awaiting evidence: one stage, not two.
    assert.equal(at({ status: "SENT" }).key, "AWAITING_EVIDENCE");
    assert.equal(
      at({ status: "WAITING_FOR_RESPONSE" }).key,
      "AWAITING_EVIDENCE",
    );
    assert.equal(at({ status: "OVERDUE" }).key, "AWAITING_EVIDENCE");
    const received = { status: "RECEIVED" };
    assert.equal(
      at({
        ...received,
        requirements: [{ status: "RECEIVED", sufficiency: "NOT_REVIEWED" }],
      }).key,
      "EVIDENCE_RECEIVED",
    );
    assert.equal(
      at({
        ...received,
        requirements: [
          { status: "RECEIVED", sufficiency: "SUFFICIENT" },
          { status: "RECEIVED", sufficiency: "NOT_REVIEWED" },
        ],
      }).key,
      "UNDER_REVIEW",
    );
    const done = at({
      ...received,
      requirements: [
        { status: "RECEIVED", sufficiency: "SUFFICIENT" },
        { status: "WAIVED", sufficiency: "NOT_REVIEWED" },
      ],
    });
    assert.deepEqual(
      [done.key, done.tone, done.step],
      ["COMPLETED", "done", 6],
    );
    assert.equal(at({ status: "CLOSED" }).key, "COMPLETED");
  });

  it("places the other stages on the path", () => {
    const returned = at({ approvalDecision: "REJECTED" });
    assert.deepEqual(
      [returned.key, returned.label, returned.tone, returned.step],
      ["CHANGES_REQUESTED", "Changes requested", "warn", 0],
    );
    const partial = at({ status: "PARTIALLY_RECEIVED" });
    assert.deepEqual([partial.key, partial.step], ["PARTIALLY_RECEIVED", 4]);
    const asked = at({ status: "WAITING_FOR_RESPONSE", clarification: true });
    assert.deepEqual([asked.key, asked.step], ["CLARIFICATION_NEEDED", 3]);
    const rejected = at({ status: "CANCELLED", approvalDecision: "REJECTED" });
    assert.deepEqual([rejected.key, rejected.tone], ["REJECTED", "danger"]);
    const cancelled = at({ status: "CANCELLED" });
    assert.deepEqual([cancelled.key, cancelled.step], ["CANCELLED", null]);
  });
});

describe("the request details writes", () => {
  it("assigns recipients, copies, the due date, and the priority", () => {
    const write = detailsWrite({
      ...ids,
      intent: "assign",
      version: 3,
      recipient: " Ops@Client.example ",
      cc: ["pbc@client.example", ""],
      due_on: "2026-11-20",
      priority: "URGENT",
    });
    assert.deepEqual(write, {
      intent: "assign",
      path: `/organizations/${ORG}/projects/${PROJECT}/pbc-requests/${REQUEST}/assignment`,
      body: {
        version: 3,
        recipient: "ops@client.example",
        cc: ["pbc@client.example"],
        due_on: "2026-11-20",
        priority: "URGENT",
      },
    });
    const bad = (fields: Record<string, unknown>) =>
      detailsWrite({
        ...ids,
        intent: "assign",
        version: 3,
        recipient: "",
        cc: [],
        due_on: "2026-11-20",
        priority: "NORMAL",
        ...fields,
      });
    assert.equal("error" in bad({}), false, "an unassigned draft can be saved");
    assert.deepEqual(bad({ recipient: "nope" }), { error: "invalid" });
    assert.deepEqual(bad({ cc: ["nope"] }), { error: "invalid" });
    assert.deepEqual(
      bad({ cc: Array.from({ length: 11 }, (_, n) => `p${n}@client.example`) }),
      { error: "invalid" },
    );
    assert.deepEqual(bad({ due_on: "20 Nov" }), { error: "invalid" });
    assert.deepEqual(bad({ priority: "CRITICAL" }), { error: "invalid" });
    assert.deepEqual(bad({ version: 0 }), { error: "invalid" });
    assert.deepEqual(bad({ request_id: "nope" }), { error: "invalid" });
  });

  it("confirms a type, adds a contact, and links, removes, or shares references", () => {
    const request = `/organizations/${ORG}/projects/${PROJECT}/pbc-requests/${REQUEST}`;
    assert.deepEqual(
      detailsWrite({
        ...ids,
        intent: "classify",
        version: 2,
        request_type: "RECONCILIATION",
        title: " Q3 reconciliation ",
      }),
      {
        intent: "classify",
        path: `${request}/classification`,
        body: {
          version: 2,
          request_type: "RECONCILIATION",
          title: "Q3 reconciliation",
        },
      },
    );
    assert.deepEqual(
      detailsWrite({
        ...ids,
        intent: "classify",
        version: 2,
        request_type: "bad",
      }),
      { error: "invalid" },
    );
    assert.deepEqual(
      detailsWrite({
        ...ids,
        intent: "contact",
        name: "Alex",
        email: "Alex@Client.example",
      }),
      {
        intent: "contact",
        path: `/organizations/${ORG}/projects/${PROJECT}/engagement-contacts`,
        body: { name: "Alex", email: "alex@client.example", role: "" },
      },
    );
    assert.deepEqual(
      detailsWrite({
        ...ids,
        intent: "contact",
        name: "",
        email: "a@b.example",
      }),
      { error: "invalid" },
    );
    assert.deepEqual(
      detailsWrite({
        ...ids,
        intent: "link",
        source: "PRIOR_YEAR_WORKPAPER",
        id: FILE,
      }),
      {
        intent: "link",
        path: `${request}/attachments/link`,
        body: { source: "PRIOR_YEAR_WORKPAPER", id: FILE },
      },
    );
    assert.deepEqual(
      detailsWrite({ ...ids, intent: "link", source: "ANYWHERE", id: FILE }),
      { error: "invalid" },
    );
    assert.deepEqual(
      detailsWrite({
        ...ids,
        intent: "remove",
        attachment_id: FILE,
        version: 2,
      }),
      {
        intent: "remove",
        path: `${request}/attachments/${FILE}/remove`,
        body: { version: 2 },
      },
    );
    assert.deepEqual(
      detailsWrite({
        ...ids,
        intent: "share",
        attachment_id: FILE,
        version: 2,
        visibility: "SHARED",
      }),
      {
        intent: "share",
        path: `${request}/attachments/${FILE}/visibility`,
        body: { version: 2, visibility: "SHARED" },
      },
    );
    assert.deepEqual(
      detailsWrite({
        ...ids,
        intent: "share",
        attachment_id: FILE,
        version: 2,
        visibility: "PUBLIC",
      }),
      { error: "invalid" },
    );
    assert.deepEqual(detailsWrite({ ...ids, intent: "delete" }), {
      error: "invalid",
    });
  });

  it("reaches attachments only by well-formed addresses", () => {
    const params = (values: Record<string, string>) =>
      new URLSearchParams({
        organization: ORG,
        project: PROJECT,
        request: REQUEST,
        ...values,
      });
    const request = `/organizations/${ORG}/projects/${PROJECT}/pbc-requests/${REQUEST}`;
    assert.deepEqual(
      attachmentTarget(params({ attachment: FILE, mode: "preview" }), "GET"),
      { path: `${request}/attachments/${FILE}/preview`, mode: "preview" },
    );
    assert.deepEqual(attachmentTarget(params({ mode: "sources" }), "GET"), {
      path: `${request}/attachment-sources`,
      mode: "sources",
    });
    assert.deepEqual(
      attachmentTarget(params({ name: "walk through.pdf" }), "POST"),
      {
        path: `${request}/attachments?name=walk%20through.pdf`,
        mode: "upload",
      },
    );
    assert.deepEqual(
      attachmentTarget(params({ name: "../secret.pdf" }), "POST"),
      { error: "invalid" },
    );
    assert.deepEqual(
      attachmentTarget(params({ attachment: FILE, mode: "delete" }), "GET"),
      { error: "invalid" },
    );
    assert.deepEqual(
      attachmentTarget(params({ request: "nope", mode: "sources" }), "GET"),
      { error: "invalid" },
    );
    assert.match(
      attachmentHref(
        { organizationId: ORG, projectId: PROJECT },
        REQUEST,
        FILE,
        "content",
      ),
      /^\/workspace\/request-attachment\?.*mode=content/,
    );
    assert.deepEqual(parseSources({ files: [{ id: "x" }], workpapers: [] }), {
      files: [],
      workpapers: [],
    });
  });

  it("rewords a draft before anyone is assigned, and shows the API's sentences", () => {
    // A person's own request goes straight to its recipient, at the version shown.
    const direct = reviewWrite({ ...ids, intent: "send-direct", version: 2 });
    assert.ok(!("error" in direct));
    assert.match(direct.path, /\/send-direct$/);
    assert.deepEqual(direct.body, { version: 2 });
    assert.deepEqual(reviewWrite({ ...ids, intent: "send-direct" }), {
      error: "invalid",
    });
    // Send again: on the approval the request has, with no other field.
    const resend = reviewWrite({ ...ids, intent: "resend" });
    assert.ok(!("error" in resend));
    assert.match(resend.path, /\/pbc-requests\/[0-9a-f-]{36}\/resend$/);
    assert.deepEqual(resend.body, {});
    const save = reviewWrite({
      ...ids,
      intent: "save",
      version: 3,
      description: "Please provide the access listing.",
      recipient: "",
      due_date: "2026-11-20",
      control_ref: "PBC-ITGC-AC-01",
      follow_up_after_days: 3,
      max_follow_ups: 2,
    });
    assert.equal("error" in save, false);
    assert.equal(
      reviewProblem(409, "Confirm the type (Other)."),
      "Confirm the type (Other).",
    );
    assert.equal(
      reviewProblem(409, "pbc request changed"),
      "The request was updated since the page loaded. The latest version is now shown.",
    );
    assert.equal(
      reviewProblem(409, "something internal"),
      "The action could not be completed in the request's current state.",
    );
  });
});

describe("what a request supports in the test plan", () => {
  it("reads the attributes its items evidence, for the reviewer only", () => {
    const details = parseRequestDetails({
      ...api,
      supports: [
        { code: "A2", text: "Approved before granted", items: ["E5"] },
        "x",
      ],
    });
    assert.deepEqual(details?.supports, [
      { code: "A2", text: "Approved before granted", items: ["E5"] },
    ]);
    assert.deepEqual(parseRequestDetails(api)?.supports, []);
  });
});
