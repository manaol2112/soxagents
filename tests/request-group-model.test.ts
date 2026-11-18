import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  centerHref,
  centerWrite,
  DEFAULT_QUERY,
  parseCenterList,
  parseCenterQuery,
} from "../apps/web/src/evidence-center-model.ts";
import {
  approveBlocker,
  groupStatusLine,
  memberProgress,
  parseGroupView,
  seenMembers,
} from "../apps/web/src/request-group-model.ts";

const ORG = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const GROUP = "55555555-5555-5555-8555-555555555555";
const FIRST = "33333333-3333-4333-8333-333333333333";
const SECOND = "44444444-4444-4444-8444-444444444444";
const CHANGED = "66666666-6666-4666-8666-666666666666";
const ids = { organizationId: ORG, projectId: PROJECT };

const member = (
  id: string,
  ref: string,
  extra: Record<string, unknown> = {},
) => ({
  id,
  reference: `PBC-${id.slice(-8).toUpperCase()}`,
  control_id: null,
  control_ref: ref,
  control_title: `${ref} title`,
  systems: ["SAP ERP"],
  title: `Design evidence for ${ref}`,
  items: ["1. Policy", "2. Walkthrough"],
  due_at: "2026-11-30T23:59:00+00:00",
  due_differs: false,
  status: "DRAFT",
  stage: "READY_FOR_REVIEW",
  stage_label: "Ready for review",
  version: 2,
  problem: null,
  ...extra,
});

const api = {
  id: GROUP,
  reference: "PBC-55555555",
  status: "PROPOSED",
  title: "Evidence for 2 controls",
  phase: "DESIGN",
  recipient: "iam@client.example",
  recipient_name: "Access administrator",
  cc: [],
  due_at: "2026-11-30T23:59:00+00:00",
  item_count: 4,
  personal_data: false,
  members: [member(FIRST, "ITGC-AC-01"), member(SECOND, "ITGC-AC-03")],
  optional: [member(CHANGED, "ITGC-AC-04", { version: 5 })],
  subject: "[PBC-55555555] Evidence request: 2 controls",
  body: "Hello,",
  ready: true,
  approved_by: "",
  approved_at: null,
  sent_at: null,
  delivery: "",
  reason: "",
  lead_request_id: FIRST,
  can_approve: true,
  notice: "",
};

describe("one request to one person for several controls", () => {
  it("reads the review, and refuses one that is not well formed", () => {
    const view = parseGroupView(api);
    assert.ok(view !== null);
    assert.equal(view.members.length, 2);
    assert.equal(view.optional[0]?.controlRef, "ITGC-AC-04");
    assert.equal(groupStatusLine(view), "Ready for review");
    assert.equal(parseGroupView({ ...api, status: "WHATEVER" }), null);
    assert.equal(parseGroupView({ ...api, members: [api.members[0]] }), null);
    assert.equal(parseGroupView({ ...api, lead_request_id: "x" }), null);
  });

  it("approves what the person saw, with any changed draft they included", () => {
    const view = parseGroupView(api);
    assert.ok(view !== null);
    assert.deepEqual(seenMembers(view, new Set()), [
      { id: FIRST, version: 2 },
      { id: SECOND, version: 2 },
    ]);
    assert.deepEqual(seenMembers(view, new Set([CHANGED])).at(-1), {
      id: CHANGED,
      version: 5,
    });
  });

  it("says why it cannot be approved yet", () => {
    const ready = parseGroupView(api);
    assert.ok(ready !== null);
    assert.equal(approveBlocker(ready, new Set()), null);
    const blocked = parseGroupView({
      ...api,
      ready: false,
      members: [
        member(FIRST, "ITGC-AC-01", { problem: "Assign a recipient." }),
        member(SECOND, "ITGC-AC-03"),
      ],
    });
    assert.ok(blocked !== null);
    assert.equal(
      approveBlocker(blocked, new Set()),
      "ITGC-AC-01: Assign a recipient.",
    );
    const viewer = parseGroupView({ ...api, can_approve: false });
    assert.ok(viewer !== null);
    assert.equal(
      approveBlocker(viewer, new Set()),
      "Your role does not permit approving requests.",
    );
    const included = parseGroupView({
      ...api,
      optional: [member(CHANGED, "ITGC-AC-04", { problem: "Set a due date." })],
    });
    assert.ok(included !== null);
    assert.equal(approveBlocker(included, new Set()), null);
    assert.equal(
      approveBlocker(included, new Set([CHANGED])),
      "ITGC-AC-04: Set a due date.",
    );
  });

  it("reads the list's group rows and opens a group in the address", () => {
    const list = parseCenterList({
      rows: [
        {
          id: GROUP,
          reference: "PBC-55555555",
          title: "Evidence for 2 controls",
          control_id: null,
          control_ref: "2 controls",
          control_title: "ITGC-AC-01, ITGC-AC-03",
          systems: ["SAP ERP"],
          phase: "DESIGN",
          stage: "READY_FOR_REVIEW",
          due_at: "2026-11-30T23:59:00+00:00",
          group: true,
          group_status: "PROPOSED",
          member_ids: [FIRST, SECOND, "not-an-id"],
        },
      ],
      matching: [],
      kpis: { total: 1 },
    });
    assert.ok(list !== null);
    const [row] = list.rows;
    assert.equal(row?.group, true);
    assert.deepEqual(row?.memberIds, [FIRST, SECOND]);
    const href = centerHref(ids, DEFAULT_QUERY, { group: GROUP });
    const params = new URL(href, "http://x").searchParams;
    assert.equal(params.get("group"), GROUP);
    assert.equal(parseCenterQuery((name) => params.get(name)).group, GROUP);
    // Opening one of its requests leaves the group's panel.
    const member = centerHref(
      ids,
      { ...DEFAULT_QUERY, group: GROUP },
      { request: FIRST, group: null },
    );
    const opened = new URL(member, "http://x").searchParams;
    assert.equal(opened.get("request"), FIRST);
    assert.equal(opened.get("group"), null);
    assert.equal(
      parseCenterQuery((name) => ({ group: "nonsense" })[name] ?? null).group,
      null,
    );
  });

  it("approves and sends, or sends, checked before the call", () => {
    const base = { organization_id: ORG, project_id: PROJECT };
    const members = [
      { id: FIRST, version: 2 },
      { id: SECOND, version: 2 },
    ];
    const approve = centerWrite({
      ...base,
      intent: "group-approve-send",
      group_id: GROUP,
      members,
    });
    assert.deepEqual(approve, {
      intent: "group-approve-send",
      path: `/organizations/${ORG}/projects/${PROJECT}/evidence-groups/${GROUP}/approve-send`,
      body: { members, reason: "Reviewed and approved." },
    });
    for (const bad of [
      { group_id: "x", members },
      { group_id: GROUP, members: members.slice(0, 1) },
      { group_id: GROUP, members: [members[0], members[0]] },
      { group_id: GROUP, members, reason: "password=hunter2" },
    ]) {
      assert.deepEqual(
        centerWrite({ ...base, intent: "group-approve-send", ...bad }),
        { error: "invalid" },
      );
    }
    assert.deepEqual(
      centerWrite({ ...base, intent: "group-send", group_id: GROUP }),
      {
        intent: "group-send",
        path: `/organizations/${ORG}/projects/${PROJECT}/evidence-groups/${GROUP}/send`,
        body: {},
      },
    );
  });
});

describe("statuses once sent", () => {
  it("reads each item's status, and says when the request is ready for testing", () => {
    const sent = parseGroupView({
      ...api,
      status: "SENT",
      items_total: 2,
      items_provided: 2,
      items_accepted: 2,
      ready_for_testing: true,
      members: [
        member(FIRST, "ITGC-AC-01", {
          statuses: [
            {
              title: "Policy",
              status: "ACCEPTED",
              label: "Accepted",
              note: "",
            },
            { title: "Walkthrough", status: "NONSENSE", label: "?", note: "" },
          ],
        }),
        member(SECOND, "ITGC-AC-03", {
          statuses: [
            {
              title: "Listing",
              status: "MISSING",
              label: "Missing",
              note: "Include the approval dates.",
            },
          ],
        }),
      ],
    });
    assert.ok(sent !== null);
    assert.deepEqual(
      sent.members.map((m) => m.statuses.map((s) => s.status)),
      [["ACCEPTED"], ["MISSING"]],
    );
    assert.equal(
      sent.members[1]?.statuses[0]?.note,
      "Include the approval dates.",
    );
    assert.equal(groupStatusLine(sent), "Ready for testing");
    assert.equal(groupStatusLine({ ...sent, readyForTesting: false }), "Sent");
  });
});

describe("a sent control's progress", () => {
  it("counts its provided items, and says ready for testing when all are accepted", () => {
    const base = parseGroupView(api);
    assert.ok(base !== null);
    const one = base.members[0];
    assert.ok(one !== undefined);
    const item = (status: string) => ({
      title: status,
      status,
      label: status,
      note: "",
    });
    assert.equal(
      memberProgress({
        ...one,
        statuses: [item("ACCEPTED"), item("MISSING")] as never,
      }),
      "1 of 2 provided",
    );
    assert.equal(
      memberProgress({
        ...one,
        statuses: [item("ACCEPTED"), item("ACCEPTED")] as never,
      }),
      "Ready for testing",
    );
    assert.equal(memberProgress({ ...one, statuses: [] }), one.stageLabel);
  });
});
