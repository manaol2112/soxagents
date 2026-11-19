import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  FILE_ACTION_IMPACT,
  FILE_ACTION_LABELS,
  fileActions,
  fileHistory,
  historyApiPath,
  historyHref,
  historyLines,
  historyReadHref,
  IMPACT_ACTIONS,
  impactApiPath,
  impactHref,
  impactKey,
  impactReason,
  impactSummary,
  impactUnavailable,
  parseFileHistory,
  parseFileImpact,
  RELIANCE_KINDS,
  removedMessage,
  removeProblem,
  removeWrite,
  restoredMessage,
  withdrawnMessage,
  withdrawReason,
} from "../apps/web/src/evidence-impact-model.ts";
import {
  filingProblem,
  type WithdrawnFile,
} from "../apps/web/src/evidence-model.ts";
import { placementProblem } from "../apps/web/src/evidence-wizard-model.ts";
import { formatDate } from "../apps/web/src/format.ts";

// E1, evidence reliance (product owner, 18 November 2026): the web half. The API's impact
// read model says what a change to a file would do; the screens offer or hold an action
// from its fields, never from its sentences.

const org = "11111111-1111-7111-8111-111111111111";
const project = "22222222-2222-7222-8222-222222222222";
const file = "66666666-6666-7666-8666-666666666666";
const newer = "77777777-7777-7777-8777-777777777777";
const older = "88888888-8888-7888-8888-888888888888";
const control = "44444444-4444-7444-8444-444444444444";
const sibling = "45454545-4545-7454-8454-454545454545";
const item = "55555555-5555-7555-8555-555555555555";
const other = "56565656-5656-7565-8565-565656565656";
const request = "33333333-3333-7333-8333-333333333333";
const sheet = "99999999-9999-7999-8999-999999999999";

const ACCEPTED =
  'the evidence item "Access policy" was accepted with it; change that decision first';

/** The API's ImpactBody for a withdrawal, as evidence_reliance.impact writes it. */
const body = (over: Record<string, unknown> = {}) => ({
  file_id: file,
  action: "WITHDRAW",
  requirement_id: null,
  allowed: true,
  refusal: null,
  blocking: [],
  removal: null,
  controls: [
    {
      id: control,
      control_ref: "ITGC-AC-01",
      title: "User access review",
      application: "SAP",
    },
  ],
  requests: [
    {
      id: request,
      title: "User access listing",
      phase: "DESIGN",
      status: "RECEIVED",
      control_id: control,
      control_ref: "ITGC-AC-01",
    },
  ],
  items: [
    {
      id: item,
      title: "Access policy",
      phase: "DESIGN",
      control_id: control,
      control_ref: "ITGC-AC-01",
      request_id: request,
      via: "FILING",
      sufficiency: "ACCEPTED",
      resets: false,
    },
    // The same item served a second way (its filing and a person's link): one item.
    {
      id: item,
      title: "Access policy",
      phase: "DESIGN",
      control_id: control,
      control_ref: "ITGC-AC-01",
      request_id: request,
      via: "LINK",
      sufficiency: "ACCEPTED",
      resets: false,
    },
    {
      id: other,
      title: "User list",
      phase: "DESIGN",
      control_id: control,
      control_ref: "ITGC-AC-01",
      request_id: request,
      via: "LINK",
      sufficiency: "INSUFFICIENT",
      resets: true,
    },
  ],
  retested_sheets: [
    {
      id: sheet,
      control_id: sibling,
      control_ref: "ITGC-AC-01",
      application: "Oracle",
      items: 2,
    },
  ],
  ...over,
});

describe("the impact read model, as the browser reads it", () => {
  it("parses every part of the API's body", () => {
    const impact = parseFileImpact(body());
    assert.ok(impact !== null);
    assert.equal(impact.action, "WITHDRAW");
    assert.equal(impact.allowed, true);
    assert.equal(impact.controls[0]?.application, "SAP");
    assert.equal(impact.requests[0]?.title, "User access listing");
    assert.equal(impact.items.length, 3);
    assert.equal(impact.items[2]?.resets, true);
    assert.equal(impact.retestedSheets[0]?.items, 2);
    assert.equal(impact.removal, null);
  });

  it("reads a removal's version to send back, and every reliance kind", () => {
    const impact = parseFileImpact(
      body({
        action: "REMOVE_FROM_REQUEST",
        requirement_id: item,
        removal: {
          via: "FILING",
          request_id: request,
          link_id: null,
          version: 4,
        },
      }),
    );
    assert.deepEqual(impact?.removal, {
      via: "FILING",
      requestId: request,
      linkId: null,
      version: 4,
    });
    assert.equal(impact?.requirementId, item);
    // The kinds the API names (evidence_reliance.KINDS): the six before E1, five new.
    assert.deepEqual(
      [...RELIANCE_KINDS],
      [
        "READING",
        "SCREENSHOT_SIGNED",
        "APPROVED_SAMPLE",
        "ACCEPTED_ITEM",
        "SIGNED_TESTING",
        "PREPARED_WORKPAPER",
        "TICKMARK",
        "RELIABILITY",
        "WALKTHROUGH_PICK",
        "SIGNED_DI_CONCLUSION",
        "SENT_FINDING",
      ],
    );
    const held = parseFileImpact(
      body({
        allowed: false,
        refusal: `the file cannot be withdrawn: ${ACCEPTED}`,
        blocking: RELIANCE_KINDS.map((kind) => ({
          kind,
          sentence: `${kind.toLowerCase()} relies on it`,
          control_id: control,
          requirement_id: null,
          request_id: null,
        })),
      }),
    );
    assert.equal(held?.blocking.length, RELIANCE_KINDS.length);
  });

  it("refuses what is not an impact, and drops a part it cannot read", () => {
    for (const bad of [
      null,
      [],
      "x",
      body({ file_id: "../x" }),
      body({ action: "DELETE" }),
      body({ allowed: "yes" }),
    ]) {
      assert.equal(parseFileImpact(bad), null);
    }
    const partial = parseFileImpact(
      body({
        blocking: [
          { kind: "SOMETHING_NEW", sentence: "x" },
          { kind: "READING" },
        ],
        items: [{ id: "nope" }],
        removal: { via: "ELSEWHERE", version: 1 },
      }),
    );
    assert.deepEqual(partial?.blocking, []);
    assert.deepEqual(partial?.items, []);
    assert.equal(partial?.removal, null);
  });
});

describe("the impact routes", () => {
  it("asks the browser's route with the item a removal is for", () => {
    assert.equal(
      impactHref(
        { organizationId: org, projectId: project },
        { fileId: file, action: "REMOVE_FROM_REQUEST", requirementId: item },
      ),
      `/workspace/evidence-files/${file}/impact?organization=${org}&project=${project}&action=REMOVE_FROM_REQUEST&requirement=${item}`,
    );
    assert.notEqual(
      impactKey({
        fileId: file,
        action: "REMOVE_FROM_REQUEST",
        requirementId: item,
      }),
      impactKey({
        fileId: file,
        action: "REMOVE_FROM_REQUEST",
        requirementId: other,
      }),
    );
  });

  it("forwards only a known action and well-formed ids to the API", () => {
    const params = (extra: Record<string, string> = {}) =>
      new URLSearchParams({
        organization: org,
        project,
        action: "WITHDRAW",
        ...extra,
      });
    assert.equal(
      impactApiPath(file, params()),
      `/organizations/${org}/projects/${project}/evidence-files/${file}/impact?action=WITHDRAW`,
    );
    assert.equal(
      impactApiPath(file, params({ action: "UNLINK", requirement: item })),
      `/organizations/${org}/projects/${project}/evidence-files/${file}/impact?action=UNLINK&requirement_id=${item}`,
    );
    for (const action of IMPACT_ACTIONS) {
      assert.ok(impactApiPath(file, params({ action })) !== null, action);
    }
    for (const bad of [
      params({ action: "DELETE" }),
      params({ organization: "x" }),
      params({ requirement: "../x" }),
    ]) {
      assert.equal(impactApiPath(file, bad), null);
    }
    assert.equal(impactApiPath("../x", params()), null);
  });

  it("is a read the API authorizes, and a removal that never withdraws", () => {
    const read = readFileSync(
      new URL(
        "../apps/web/app/workspace/evidence-files/[fileId]/impact/route.ts",
        import.meta.url,
      ),
      "utf8",
    );
    assert.match(read, /export async function GET\(/);
    assert.doesNotMatch(read, /method: "POST"|export async function POST/);
    assert.match(read, /"cache-control": "private, no-store"/);
    const remove = readFileSync(
      new URL(
        "../apps/web/app/workspace/evidence-files/[fileId]/remove-from-request/route.ts",
        import.meta.url,
      ),
      "utf8",
    );
    assert.match(remove, /removeWrite\(\{ \.\.\.fields, file_id: fileId \}\)/);
    // Its only call is the association's own route: never the withdrawal's.
    assert.doesNotMatch(remove, /\/withdraw\b|intent: "withdraw"/);
  });
});

describe("what a change is held by, and what it would do", () => {
  it("holds an action from `allowed` only, in the server's words", () => {
    const allowed = parseFileImpact(body());
    assert.ok(allowed !== null);
    assert.equal(impactReason(allowed), null);
    const held = parseFileImpact(
      body({
        allowed: false,
        refusal: `the file cannot be withdrawn: ${ACCEPTED}`,
        blocking: [
          {
            kind: "ACCEPTED_ITEM",
            sentence: ACCEPTED,
            control_id: control,
            requirement_id: item,
            request_id: request,
          },
        ],
      }),
    );
    assert.ok(held !== null);
    // The reliance itself beside the action it holds, as a sentence.
    assert.equal(
      impactReason(held),
      'The evidence item "Access policy" was accepted with it; change that decision first.',
    );
    // A refusal with no reliance (the file is not on that item, or is withdrawn): the
    // refusal itself.
    const state = parseFileImpact(
      body({
        allowed: false,
        refusal: "this file is withdrawn; restore it first",
      }),
    );
    assert.ok(state !== null);
    assert.equal(
      impactReason(state),
      "This file is withdrawn; restore it first.",
    );
    // Not known yet, or not read: not held (the form checks again; the server decides).
    assert.equal(impactUnavailable(undefined), null);
    assert.equal(impactUnavailable({ status: "loading" }), null);
    assert.equal(impactUnavailable({ status: "failed" }), null);
    assert.equal(
      impactUnavailable({ status: "ready", impact: state, at: 0 }),
      "This file is withdrawn; restore it first.",
    );
  });

  it("says where the file is used, whose decision resets, and which sheets retest", () => {
    const impact = parseFileImpact(body());
    assert.ok(impact !== null);
    const summary = impactSummary(impact);
    assert.equal(
      summary.used,
      "Used on ITGC-AC-01 (SAP): 2 evidence items on 1 request.",
    );
    assert.deepEqual(
      summary.items.map((line) => line.text),
      [
        "ITGC-AC-01 · Access policy · accepted",
        "ITGC-AC-01 · User list · insufficient",
      ],
    );
    assert.equal(
      summary.resets,
      "The decision on 1 evidence item goes back to not reviewed: User list.",
    );
    assert.equal(
      summary.retests,
      "1 open test sheet is tested again: ITGC-AC-01 (Oracle).",
    );
    assert.deepEqual(summary.blocking, []);
  });

  it("says nothing it has not got, and lists every reliance when held", () => {
    const quiet = parseFileImpact(
      body({ controls: [], requests: [], items: [], retested_sheets: [] }),
    );
    assert.ok(quiet !== null);
    assert.deepEqual(impactSummary(quiet), {
      used: null,
      items: [],
      resets: null,
      retests: null,
      blocking: [],
    });
    const filed = parseFileImpact(body({ items: [], requests: [] }));
    assert.equal(
      filed === null ? "" : impactSummary(filed).used,
      "Filed to ITGC-AC-01 (SAP); no evidence item uses it yet.",
    );
    const held = parseFileImpact(
      body({
        allowed: false,
        refusal: `the file cannot be withdrawn: ${ACCEPTED}`,
        blocking: [
          { kind: "ACCEPTED_ITEM", sentence: ACCEPTED },
          {
            kind: "SIGNED_DI_CONCLUSION",
            sentence:
              "the signed design conclusion for ITGC-AC-01 rests on it; reopen that conclusion first",
          },
        ],
      }),
    );
    assert.ok(held !== null);
    assert.deepEqual(impactSummary(held).blocking, [
      'The evidence item "Access policy" was accepted with it; change that decision first.',
      "The signed design conclusion for ITGC-AC-01 rests on it; reopen that conclusion first.",
    ]);
  });
});

describe("the labels each place offers a file's actions with", () => {
  it("never calls a withdrawal a removal from a request", () => {
    assert.equal(FILE_ACTION_LABELS.REMOVE, "Remove from this request");
    assert.equal(FILE_ACTION_LABELS.WITHDRAW, "Withdraw from the engagement…");
    assert.equal(FILE_ACTION_IMPACT.REMOVE, "REMOVE_FROM_REQUEST");
    assert.equal(FILE_ACTION_IMPACT.WITHDRAW, "WITHDRAW");
  });

  it("offers on a request only what keeps the file in the engagement", () => {
    const facts = { canAct: true, onRequest: true };
    // A request's file: its own change first, the removal last; never a withdrawal.
    assert.deepEqual(fileActions("REQUEST", facts), ["REPLACE", "REMOVE"]);
    assert.deepEqual(fileActions("REQUEST", { ...facts, onRequest: false }), [
      "REPLACE",
    ]);
    // The file's own viewer: off this request, then out of the engagement, last.
    assert.deepEqual(fileActions("PANEL", facts), ["REMOVE", "WITHDRAW"]);
    assert.deepEqual(fileActions("PANEL", { ...facts, onRequest: false }), [
      "WITHDRAW",
    ]);
    assert.deepEqual(fileActions("LIBRARY", facts), ["REPLACE", "WITHDRAW"]);
    // An upload that has just taken the file: a withdrawal, kept on record (discarding
    // an upload is not built yet).
    assert.deepEqual(fileActions("UPLOAD", facts), ["WITHDRAW"]);
    for (const place of ["REQUEST", "PANEL", "LIBRARY", "UPLOAD"] as const) {
      assert.deepEqual(fileActions(place, { ...facts, canAct: false }), []);
    }
  });

  it("is used by every place that offers a file's actions", () => {
    const read = (path: string) =>
      readFileSync(new URL(`../apps/web/src/${path}`, import.meta.url), "utf8");
    assert.match(read("evidence-workspace-view.tsx"), /fileActions\("REQUEST"/);
    assert.doesNotMatch(
      read("evidence-workspace-view.tsx"),
      /label: "Withdraw"/,
    );
    assert.match(read("evidence-about.tsx"), /fileActions\("PANEL"/);
    assert.match(read("evidence-change.tsx"), /FILE_ACTION_LABELS\.WITHDRAW/);
    assert.match(read("evidence-wizard.tsx"), /FILE_ACTION_LABELS\.WITHDRAW/);
    assert.match(read("evidence-dialog.tsx"), /FILE_ACTION_LABELS\.WITHDRAW/);
  });
});

describe("taking a file off one request", () => {
  const fields = {
    organization_id: org,
    project_id: project,
    file_id: file,
    requirement_id: item,
    reason: "  Belongs to\nanother request ",
    version: 3,
  };

  it("builds the association's own call, with a reason and the version seen", () => {
    assert.deepEqual(removeWrite(fields), {
      path: `/organizations/${org}/projects/${project}/evidence-files/${file}/remove-from-request`,
      body: {
        requirement_id: item,
        reason: "Belongs to another request",
        version: 3,
      },
    });
  });

  it("refuses a missing reason, a bad id, or a missing or bad version", () => {
    for (const bad of [
      // The version the impact named is required: a stale page is refused (the API's
      // own rule since its review, 18 November 2026).
      { ...fields, version: undefined },
      { ...fields, version: null },
      { ...fields, reason: "no" },
      { ...fields, reason: "" },
      { ...fields, requirement_id: "x" },
      { ...fields, file_id: "../x" },
      { ...fields, version: 0 },
      { ...fields, version: 1.5 },
      { ...fields, version: "3" },
    ]) {
      assert.deepEqual(removeWrite(bad), { error: "invalid" });
    }
  });

  it("says a refusal in the server's sentence, and recovers otherwise", () => {
    assert.equal(removeProblem(200, ""), null);
    assert.equal(
      removeProblem(
        409,
        `the file cannot be removed from this request: ${ACCEPTED}`,
      ),
      `The file cannot be removed from this request: ${ACCEPTED}.`,
    );
    for (const status of [0, 403, 404, 409, 422, 500]) {
      assert.match(removeProblem(status, "") ?? "", /^[A-Z].*\.$/);
    }
  });
});

describe("what a confirmed change says", () => {
  it("claims a reason only when the person gave one", () => {
    // 18 November 2026: the notice said "with your reason" after a withdrawal made
    // without one.
    assert.equal(
      withdrawnMessage("users.csv", false),
      "users.csv was withdrawn. It is kept on record under Withdrawn and can be restored.",
    );
    assert.match(withdrawnMessage("users.csv", true), /with your reason\./);
    assert.match(removedMessage("users.csv"), /stays on its control/);
    assert.doesNotMatch(removedMessage("users.csv"), /withdrawn/);
    assert.match(restoredMessage("users.csv"), /^users\.csv was restored\./);
  });

  it("takes an empty withdrawal reason, or one plain line of 3 to 500", () => {
    assert.equal(withdrawReason("   "), "");
    assert.equal(withdrawReason(" Wrong\tperiod "), "Wrong period");
    assert.equal(withdrawReason("no"), null);
    assert.equal(withdrawReason("x".repeat(501)), null);
  });
});

describe("a file's history, from what the register serves", () => {
  const withdrawn = (over: Partial<WithdrawnFile>): WithdrawnFile => ({
    id: older,
    fileName: "users v1.csv",
    folderPath: "",
    source: "UPLOAD",
    sizeBytes: 10,
    createdAt: "2026-10-01T09:00:00Z",
    addedBy: "Ann",
    reason: "Wrong period",
    withdrawnBy: "Bo",
    withdrawnAt: "2026-10-05T09:00:00Z",
    replacedBy: null,
    replacedByName: null,
    control: null,
    ...over,
  });

  it("names the upload, then the version it replaced, oldest first", () => {
    const lines = fileHistory(
      { id: file, createdAt: "2026-10-05T09:00:00Z", addedBy: "Bo" },
      [
        withdrawn({ replacedBy: file, replacedByName: "users.csv" }),
        // Another control's withdrawn file says nothing here.
        withdrawn({ id: newer, fileName: "other.csv" }),
      ],
    );
    assert.deepEqual(
      lines.map((line) => [line.event, line.label, line.by, line.file?.name]),
      [
        ["UPLOADED", "Uploaded", "Bo", undefined],
        ["REPLACES", "Replaces", "Bo", "users v1.csv"],
      ],
    );
    assert.equal(lines[1]?.why, "Wrong period");
    assert.equal(lines[1]?.file?.withdrawn, true);
  });

  it("says who withdrew it, when and why, and what replaced it", () => {
    const own = fileHistory(
      { id: older, createdAt: "2026-10-01T09:00:00Z", addedBy: "Ann" },
      [withdrawn({ reason: "No reason given." })],
    );
    assert.deepEqual(
      own.map((line) => [line.label, line.by, line.why]),
      [
        ["Uploaded", "Ann", null],
        ["Withdrawn", "Bo", "No reason given."],
      ],
    );
    const replaced = fileHistory(
      { id: older, createdAt: "2026-10-01T09:00:00Z", addedBy: "Ann" },
      [withdrawn({ replacedBy: newer, replacedByName: "users v2.csv" })],
    );
    assert.equal(replaced[1]?.label, "Replaced by");
    assert.deepEqual(replaced[1]?.file, {
      id: newer,
      name: "users v2.csv",
      withdrawn: false,
    });
    // A file received by email names no person.
    const mailed = fileHistory(
      {
        id: file,
        createdAt: "2026-10-01T09:00:00Z",
        addedBy: "owner@example.com",
        source: "MAILBOX",
      },
      [],
    );
    assert.deepEqual(
      mailed.map((line) => [line.label, line.by]),
      [["Received by email", ""]],
    );
  });

  it("links each other version where it is kept", () => {
    const ids = { organizationId: org, projectId: project };
    const kept = new URLSearchParams(
      historyHref(ids, {
        id: older,
        name: "users v1.csv",
        withdrawn: true,
      }).slice(2),
    );
    assert.equal(kept.get("section"), "evidence");
    // On the Evidence Library tab itself (18 November 2026: without it the link opened
    // Requests).
    assert.equal(kept.get("tab"), "files");
    assert.equal(kept.get("queue"), "withdrawn");
    assert.equal(kept.get("q"), "users v1.csv");
    const live = new URLSearchParams(
      historyHref(ids, {
        id: newer,
        name: "users v2.csv",
        withdrawn: false,
      }).slice(2),
    );
    assert.equal(live.get("file"), newer);
    assert.equal(live.get("tab"), "files");
    assert.equal(live.get("queue"), null);
  });
});

describe("a file's history, from the server (E1, 18 November 2026)", () => {
  // GET .../evidence-files/{id}/history (evidence_versions.HistoryBody), oldest first.
  const served = {
    file_id: file,
    file_name: "users v2.csv",
    events: [
      {
        kind: "ADDED",
        at: "2026-10-05T09:00:00Z",
        by: "Bo",
        reason: "",
        source: "UPLOAD",
        size_bytes: 2048,
        replaces: { id: older, name: "users v1.csv" },
        replaced_by: null,
        requirement_id: null,
        requirement_title: null,
      },
      {
        kind: "LINKED",
        at: "2026-10-06T09:00:00Z",
        by: "Ann",
        reason: "Covers the whole year",
        requirement_id: item,
        requirement_title: "Access policy",
      },
      {
        kind: "WITHDRAWN",
        at: "2026-10-07T09:00:00Z",
        by: "Bo",
        reason: "No reason given.",
        replaced_by: null,
      },
      {
        kind: "RESTORED",
        at: "2026-10-08T09:00:00Z",
        by: "Ann",
        reason: "Withdrawn by mistake",
      },
      {
        kind: "REMOVED_FROM_REQUEST",
        at: "2026-10-09T09:00:00Z",
        by: "owner@example.com (secure link)",
        reason: "Belongs to another request",
        requirement_id: item,
        requirement_title: "Access policy",
      },
      {
        kind: "UNLINKED",
        at: "2026-10-10T09:00:00Z",
        by: null,
        reason: "",
        requirement_id: other,
        requirement_title: "User list",
      },
      {
        kind: "WITHDRAWN",
        at: "2026-10-11T09:00:00Z",
        by: "Bo",
        reason: "Corrected export",
        replaced_by: { id: newer, name: "users v3.csv" },
      },
      // A kind this page does not know is left out.
      { kind: "SOMETHING_NEW", at: "2026-10-12T09:00:00Z", by: "Bo" },
    ],
  };

  it("parses every event the server serves, and nothing else", () => {
    const body = parseFileHistory(served);
    assert.ok(body !== null);
    assert.equal(body.fileName, "users v2.csv");
    assert.deepEqual(
      body.events.map((event) => event.kind),
      [
        "ADDED",
        "LINKED",
        "WITHDRAWN",
        "RESTORED",
        "REMOVED_FROM_REQUEST",
        "UNLINKED",
        "WITHDRAWN",
      ],
    );
    assert.equal(body.events[0]?.sizeBytes, 2048);
    assert.equal(body.events[5]?.by, null);
    for (const bad of [null, [], { file_id: "x", events: [] }]) {
      assert.equal(parseFileHistory(bad), null);
    }
  });

  it("lists withdrawals and restorations in order, with who, when, why and the versions", () => {
    const body = parseFileHistory(served);
    assert.ok(body !== null);
    // The page knows users v3.csv is withdrawn too: its link leads to Withdrawn.
    const lines = historyLines(body, new Set([newer]));
    assert.deepEqual(
      lines.map((line) => [line.label, line.item, line.by, line.why]),
      [
        ["Uploaded", null, "Bo", null],
        ["Linked to", "Access policy", "Ann", "Covers the whole year"],
        ["Withdrawn", null, "Bo", "No reason given."],
        ["Restored", null, "Ann", "Withdrawn by mistake"],
        [
          "Removed from the request for",
          "Access policy",
          "owner@example.com (secure link)",
          "Belongs to another request",
        ],
        ["Taken off", "User list", "", null],
        ["Withdrawn", null, "Bo", "Corrected export"],
      ],
    );
    assert.equal(lines[0]?.relation, "Replaces");
    assert.deepEqual(lines[0]?.file, {
      id: older,
      name: "users v1.csv",
      withdrawn: true,
    });
    assert.equal(lines[0]?.sizeBytes, 2048);
    assert.equal(lines[6]?.relation, "Replaced by");
    assert.equal(lines[6]?.file?.withdrawn, true);
    // A newer version the page does not know as withdrawn leads to the Library.
    assert.equal(historyLines(body)[6]?.file?.withdrawn, false);
    assert.equal(new Set(lines.map((line) => line.key)).size, lines.length);
  });

  it("names how a file came in", () => {
    const came = (source: "UPLOAD" | "MAILBOX" | "PORTAL") =>
      historyLines({
        fileId: file,
        fileName: "x",
        events: [
          {
            kind: "ADDED",
            at: "2026-10-05T09:00:00Z",
            by: null,
            reason: "",
            source,
            sizeBytes: null,
            replaces: null,
            replacedBy: null,
            requirementId: null,
            requirementTitle: null,
          },
        ],
      })[0]?.label;
    assert.equal(came("UPLOAD"), "Uploaded");
    assert.equal(came("MAILBOX"), "Received by email");
    assert.equal(came("PORTAL"), "Uploaded through the secure link");
  });

  it("is read through its own route, only when the section is shown", () => {
    const ids = { organizationId: org, projectId: project };
    assert.equal(
      historyReadHref(ids, file),
      `/workspace/evidence-files/${file}/history?organization=${org}&project=${project}`,
    );
    assert.equal(
      historyApiPath(file, new URLSearchParams({ organization: org, project })),
      `/organizations/${org}/projects/${project}/evidence-files/${file}/history`,
    );
    assert.equal(
      historyApiPath("x", new URLSearchParams({ organization: org, project })),
      null,
    );
    assert.equal(
      historyApiPath(file, new URLSearchParams({ organization: "x", project })),
      null,
    );
    const read = (path: string) =>
      readFileSync(new URL(`../apps/web/${path}`, import.meta.url), "utf8");
    const route = read(
      "app/workspace/evidence-files/[fileId]/history/route.ts",
    );
    assert.match(route, /export async function GET\(/);
    assert.doesNotMatch(route, /export async function POST/);
    // The viewer reads it once the section opens, and falls back to the register's.
    const about = read("src/evidence-about.tsx");
    assert.match(
      about,
      /onToggle=\{\(event\) => \{\s*if \(event\.currentTarget\.open\) \{\s*setHistoryShown\(true\);/,
    );
    const history = read("src/evidence-history.tsx");
    // 18 November 2026: the read's effect listed a value derived from the read itself,
    // so setting its loading state re-ran the effect, whose cleanup aborted its own
    // request (net::ERR_ABORTED), and the section stayed on "Loading…". The effect now
    // depends only on what asks for a read: never on state it sets, nor on anything
    // computed from that state.
    const hook = history.slice(
      history.indexOf("function useFileHistory("),
      history.indexOf("function Lines("),
    );
    const effect =
      /useEffect\(\(\) => \{([\s\S]*?)\n {2}\}, \[([^\]]*)\]\);/.exec(hook);
    assert.ok(effect !== null);
    const deps = (effect[2] ?? "").split(",").map((dep) => dep.trim());
    assert.deepEqual(deps, [
      "shown",
      "attempt",
      "fileId",
      "organizationId",
      "projectId",
    ]);
    const set = [...(effect[1] ?? "").matchAll(/\bset([A-Z]\w*)\(/g)].map(
      (match) => `${match[1]?.charAt(0).toLowerCase()}${match[1]?.slice(1)}`,
    );
    assert.ok(set.includes("read"), "the effect sets the read");
    for (const dep of deps) {
      assert.ok(!set.includes(dep), `${dep} is state the effect sets`);
      // Nor derived from it (the old `const known = read !== null && ...`).
      assert.doesNotMatch(hook, new RegExp(`const ${dep} = [^;]*\\bread\\b`));
    }
    // The last ask's answer only, and a retry is a new attempt.
    assert.match(hook, /if \(!abort\.signal\.aborted\) \{/);
    assert.match(hook, /retry: \(\) => setAttempt\(\(value\) => value \+ 1\)/);
    assert.match(history, /<ol className="ea-history"/);
    assert.match(history, /fileHistory\(/);
    assert.match(history, /role="status"/);
  });

  it("says a date as the file's facts beside it say it (one date rule, 18 November 2026)", () => {
    // Changed 18 November 2026 (design review). Old: the History lines said the browser's
    // local time ("Uploaded Nov 18, 4:56 PM") beside the facts' "Added Nov 19, 2026" for
    // the same upload (00:56 UTC on 19 November). New: both say formatDate's UTC date,
    // as the Evidence Library and the Withdrawn list do, in a <time> with the moment.
    const read = (path: string) =>
      readFileSync(new URL(`../apps/web/src/${path}`, import.meta.url), "utf8");
    const history = read("evidence-history.tsx");
    assert.match(
      history,
      /<time dateTime=\{line\.at\}>\{formatDate\(line\.at\)\}<\/time>/,
    );
    assert.doesNotMatch(history, /LocalTime/);
    // The facts beside it ("Added") use the same rule.
    assert.match(
      read("evidence-intelligence-view.tsx"),
      /formatDate\(file\.createdAt\)/,
    );
    // Whatever the browser's zone, the upload at 00:56 UTC on 19 November is that day.
    assert.equal(formatDate("2026-11-19T00:56:00Z"), "Nov 19, 2026");
    const upload = historyLines({
      fileId: file,
      fileName: "x",
      events: [
        {
          kind: "ADDED",
          at: "2026-11-19T00:56:00Z",
          by: "Bo",
          reason: "",
          source: "UPLOAD",
          sizeBytes: null,
          replaces: null,
          replacedBy: null,
          requirementId: null,
          requirementTitle: null,
        },
      ],
    })[0];
    assert.equal(formatDate(upload?.at ?? ""), "Nov 19, 2026");
  });
});

describe("the control's own file list at a phone's width (18 November 2026)", () => {
  it("lets every line of a file's card shrink and wrap inside the card", () => {
    // At 390 each line of a card was 561px, cut at its edge: the summary's grid column
    // grew to the unwrapped file name.
    const css = readFileSync(
      new URL("../apps/web/app/globals.css", import.meta.url),
      "utf8",
    ).replace(/\r\n/g, "\n");
    assert.match(
      css,
      /\.evidence-file > summary \{\n {2}grid-template-columns: minmax\(0, 1fr\);\n {2}min-width: 0;\n\}/,
    );
    assert.match(
      css,
      /\.evidence-file-summary,\n\.evidence-file-serves,\n\.evidence-file-meta \{\n {2}overflow-wrap: anywhere;\n\}/,
    );
    assert.match(
      css,
      /\.app-groups,\n\.evidence-files,\n\.evidence-file-body,\n\.evidence-file-tools \{\n {2}grid-template-columns: minmax\(0, 1fr\);\n\}/,
    );
    // The viewer is never wider than the window, whatever a file's name.
    assert.match(
      css,
      /\.preview-backdrop \{[^}]*grid-template-columns: minmax\(0, 1fr\);/,
    );
  });
});

describe("the backend's newer refusals, said in place (E1 review, 18 November 2026)", () => {
  it("holds a change with the impact's own refusal when nothing relies on the file", () => {
    for (const [refusal, said] of [
      [
        "you can read this engagement's evidence but not change it",
        "You can read this engagement's evidence but not change it.",
      ],
      [
        "the engagement is not active, so it takes no new evidence",
        "The engagement is not active, so it takes no new evidence.",
      ],
    ] as const) {
      const impact = parseFileImpact(body({ allowed: false, refusal }));
      assert.ok(impact !== null);
      assert.equal(impactReason(impact), said);
      assert.deepEqual(impactSummary(impact).blocking, [said]);
    }
  });

  it("says a refused move in the wizard, and an application change, in the server's words", () => {
    const move = `the file cannot be taken off this item: ${ACCEPTED}`;
    assert.equal(
      placementProblem(409, move),
      `The file cannot be taken off this item: ${ACCEPTED}.`,
    );
    const tags = `the file's applications cannot be changed: ${ACCEPTED}`;
    assert.equal(
      filingProblem(409, tags, "application"),
      `The file's applications cannot be changed: ${ACCEPTED}.`,
    );
    assert.equal(
      filingProblem(409, `the file cannot be moved: ${ACCEPTED}`, "filing"),
      `The file cannot be moved: ${ACCEPTED}.`,
    );
    // Without a sentence, the notice's own words; success says nothing.
    assert.equal(filingProblem(200, "", "filing"), null);
    assert.match(
      filingProblem(409, "", "filing") ?? "",
      /Refresh and try again/,
    );
    assert.match(filingProblem(422, "", "application") ?? "", /application/);
  });

  it("sends the filing and application forms in place, with the server's sentence", () => {
    const read = (path: string) =>
      readFileSync(new URL(`../apps/web/${path}`, import.meta.url), "utf8");
    for (const route of [
      "app/workspace/evidence-filing/route.ts",
      "app/workspace/evidence-application/route.ts",
    ]) {
      const source = read(route);
      assert.match(
        source,
        /answersInPlace\(request\.headers\.get\("accept"\)\)/,
      );
      assert.match(source, /NextResponse\.json\(\{\s*status/);
    }
    for (const view of [
      "src/evidence-view.tsx",
      "src/evidence-workspace-view.tsx",
      "src/controls-view.tsx",
    ]) {
      const source = read(view);
      assert.doesNotMatch(
        source,
        /<form\s+autoComplete="off"\s+method="post"\s+action="\/workspace\/evidence-(filing|application)"/,
        view,
      );
      assert.match(source, /<InPlaceForm/, view);
    }
  });
});
