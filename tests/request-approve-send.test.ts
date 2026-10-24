import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  approveAndSend,
  type ReviewCall,
} from "../apps/web/src/request-review-model.ts";

const ORG = "11111111-1111-7111-8111-111111111111";
const PROJECT = "22222222-2222-7222-8222-222222222222";
const REQUEST = "33333333-3333-7333-8333-333333333333";
const APPROVAL = "44444444-4444-7444-8444-444444444444";
const base = `/organizations/${ORG}/projects/${PROJECT}/pbc-requests/${REQUEST}`;
const fields = {
  organization_id: ORG,
  project_id: PROJECT,
  request_id: REQUEST,
  version: 3,
  reason: "Reviewed and approved.",
};

/** A fake API: answers each path in turn, and records what was asked. */
function api(
  answers: Record<
    string,
    { status: number; detail?: string; payload?: unknown }
  >,
) {
  const asked: Array<{ path: string; body: unknown }> = [];
  const call: ReviewCall = async (path, body) => {
    asked.push({ path, body });
    const answer = answers[path] ?? { status: 404 };
    return {
      status: answer.status,
      detail: answer.detail ?? "",
      payload: answer.payload ?? null,
    };
  };
  return { call, asked };
}

describe("approve and send in one press", () => {
  it("approves the draft, then sends it with that approval", async () => {
    const { call, asked } = api({
      [`${base}/approve`]: {
        status: 200,
        payload: { approval: { id: APPROVAL } },
      },
      [`${base}/send`]: { status: 200 },
    });
    assert.deepEqual(await approveAndSend(fields, call), {
      status: 200,
      detail: "",
      approved: true,
    });
    assert.deepEqual(asked, [
      {
        path: `${base}/approve`,
        body: { version: 3, reason: "Reviewed and approved." },
      },
      { path: `${base}/send`, body: { approval_id: APPROVAL } },
    ]);
  });

  it("sends nothing when the approval is refused", async () => {
    const { call, asked } = api({
      [`${base}/approve`]: { status: 409, detail: "recipient is not allowed" },
    });
    assert.deepEqual(await approveAndSend(fields, call), {
      status: 409,
      detail: "recipient is not allowed",
      approved: false,
    });
    assert.equal(asked.length, 1);
  });

  it("says the request stays approved when the send is refused", async () => {
    const { call } = api({
      [`${base}/approve`]: {
        status: 200,
        payload: { approval: { id: APPROVAL } },
      },
      [`${base}/send`]: { status: 409, detail: "live email is off" },
    });
    assert.deepEqual(await approveAndSend(fields, call), {
      status: 409,
      detail: "live email is off",
      approved: true,
    });
  });

  it("never sends without the approval it just recorded", async () => {
    const { call, asked } = api({
      [`${base}/approve`]: { status: 200, payload: { approval: {} } },
    });
    const outcome = await approveAndSend(fields, call);
    assert.equal(outcome.approved, true);
    assert.notEqual(outcome.status, 200);
    assert.equal(asked.length, 1);
    // A malformed request is refused before anything is asked.
    const none = api({});
    assert.equal(
      (await approveAndSend({ ...fields, request_id: "nope" }, none.call))
        .status,
      422,
    );
    assert.equal(none.asked.length, 0);
  });
});
