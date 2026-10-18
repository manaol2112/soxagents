import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { engagementWrite } from "../apps/web/src/engagement-model.ts";
import {
  ofRound,
  parseRounds,
  roundNext,
  roundsFor,
  roundTitle,
} from "../apps/web/src/round-model.ts";
import { sheetFor } from "../apps/web/src/sheet-model.ts";
import { testFor } from "../apps/web/src/testing-model.ts";

const control = "44444444-4444-7444-8444-444444444444";
const roundId = "55555555-5555-7555-8555-555555555555";
const later = "66666666-6666-7666-8666-666666666666";
const request = "77777777-7777-7777-8777-777777777777";
const org = "11111111-1111-7111-8111-111111111111";
const project = "22222222-2222-7222-8222-222222222222";
const deficiency = "88888888-8888-7888-8888-888888888888";

function raw(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: roundId,
    control_id: control,
    control_ref: "ITGC-AC-01",
    kind: "ROLLFORWARD",
    number: 1,
    status: "REQUESTED",
    method: "SAMPLE",
    window_start: "2027-03-11",
    window_end: "2027-12-31",
    test_from: "2027-03-11",
    sample_size: 10,
    deficiency_id: null,
    deficiency_reference: null,
    request_id: request,
    request_status: "DRAFT",
    task_id: null,
    test_id: null,
    sheet_id: null,
    conclusion: null,
    cancel_reason: "",
    ...extra,
  };
}

describe("testing rounds", () => {
  it("parses rounds and drops anything malformed", () => {
    const parsed = parseRounds([
      raw(),
      raw({ id: "x" }),
      raw({ kind: "OTHER" }),
      raw({ status: "WHATEVER" }),
    ]);
    assert.equal(parsed?.length, 1);
    assert.equal(parsed?.[0]?.windowStart, "2027-03-11");
    assert.equal(parseRounds({}), null);
  });

  it("names each round and says what happens next", () => {
    const [rolled] = parseRounds([raw()]) ?? [];
    assert.ok(rolled !== undefined);
    assert.equal(roundTitle(rolled), "Roll-forward to period end");
    assert.match(roundNext(rolled, "2027-04-01"), /Submit it for approval/);
    const [retest] =
      parseRounds([
        raw({
          kind: "RETEST",
          number: 2,
          deficiency_id: deficiency,
          deficiency_reference: "D-001",
          request_status: "SENT",
          window_start: "2027-05-01",
          test_from: "2027-06-30",
        }),
      ]) ?? [];
    assert.ok(retest !== undefined);
    assert.equal(roundTitle(retest), "Retest 2 after remediation of D-001");
    assert.match(roundNext(retest, "2027-06-01"), /operate until 2027-06-30/);
    assert.match(roundNext(retest, "2027-07-01"), /population/);
    const [passed] =
      parseRounds([
        raw({
          kind: "RETEST",
          deficiency_reference: "D-001",
          status: "SIGNED_OFF",
          conclusion: "EFFECTIVE",
        }),
      ]) ?? [];
    assert.ok(passed !== undefined);
    assert.match(roundNext(passed, "2027-07-01"), /D-001 is remediated/);
  });

  it("lists a control's open rounds first, latest first", () => {
    const rounds =
      parseRounds([
        raw({ status: "SIGNED_OFF", conclusion: "EFFECTIVE" }),
        raw({ id: later, kind: "RETEST", deficiency_reference: "D-002" }),
        raw({ id: request, control_id: org }),
      ]) ?? [];
    assert.deepEqual(
      roundsFor(rounds, control).map((item) => item.id),
      [later, roundId],
    );
  });

  it("keeps interim testing's plan and sheet apart from a round's", () => {
    const interim = { controlId: control, testRoundId: null, id: "interim" };
    const rolled = { controlId: control, testRoundId: roundId, id: "round" };
    // The interim lookups never return a round's plan or sheet.
    assert.equal(
      testFor([rolled, interim] as never, control)?.id as unknown,
      "interim",
    );
    assert.equal(
      sheetFor([rolled, interim] as never, control)?.id as unknown,
      "interim",
    );
    assert.equal(ofRound([interim, rolled], roundId)?.id, "round");
  });

  it("asks for the date the fix took effect to mark a deficiency ready for retest", () => {
    const fields = {
      organization_id: org,
      project_id: project,
      intent: "deficiency-progress",
      deficiency_id: deficiency,
      version: "3",
      status: "READY_FOR_RETEST",
    };
    assert.deepEqual(engagementWrite(fields), { error: "invalid" });
    const dated = engagementWrite({ ...fields, remediated_on: "2027-05-01" });
    assert.ok(!("error" in dated));
    assert.deepEqual(dated.body, {
      version: 3,
      status: "READY_FOR_RETEST",
      remediated_on: "2027-05-01",
    });
    assert.deepEqual(
      engagementWrite({
        ...fields,
        status: "REMEDIATION_IN_PROGRESS",
        remediated_on: "2027-05-01",
      }),
      { error: "invalid" },
    );
  });
});
