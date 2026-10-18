import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseTestNotice,
  parseTests,
  shownColumns,
  testFor,
  testNoticeFor,
  testWrite,
} from "../apps/web/src/testing-model.ts";

const ids = {
  organization_id: "11111111-1111-7111-8111-111111111111",
  project_id: "22222222-2222-7222-8222-222222222222",
};
const testId = "33333333-3333-7333-8333-333333333333";
const control = "44444444-4444-7444-8444-444444444444";
const file = "55555555-5555-7555-8555-555555555555";

const row = {
  id: testId,
  engagement_control_id: control,
  control_ref: "ITGC-AC-01",
  status: "PROPOSED",
  sample_size: 25,
  population_file_id: file,
  population_file_name: "pop.csv",
  population_sha256: "a".repeat(64),
  population_rows: 41,
  frame_rows: 40,
  key_column: "User ID",
  date_column: "Date granted",
  columns: ["User ID", "Name", "Role", "Date granted", "Ticket"],
  checks: [
    { check: "rows", result: "OK", detail: "41 data rows." },
    { check: "period", result: "WEIRD", detail: "x" },
  ],
  seed: "123",
  explanation: "Selected 25 of 40 items at random.",
  approved_by_name: null,
  approved_at: null,
  sample_request_id: null,
  sample_request_status: null,
  samples: [
    {
      position: 1,
      row_number: 7,
      key_value: "u0007",
      row_values: ["u0007", "Demo", "Clerk", "2027-01-10", "REQ-7"],
      selection: "RANDOM",
      reason: "",
      replaced_by_name: null,
    },
    { position: 2, row_number: 9, selection: "GUESS" },
  ],
  version: 2,
};

describe("test plan model", () => {
  it("parses test plans and keeps only known values", () => {
    const tests = parseTests([row]);
    assert.ok(tests !== null);
    assert.equal(tests[0]?.checks.length, 1);
    assert.equal(tests[0]?.samples.length, 1);
    assert.equal(testFor(tests, control)?.id, testId);
    assert.equal(testFor(tests, file), null);
    assert.deepEqual(shownColumns(tests[0] as never), [1, 2, 3]);
    assert.equal(parseTests([{ ...row, status: "DONE" }]), null);
    assert.equal(parseTests("x"), null);
  });

  it("builds each write and refuses bad input", () => {
    const base = `/organizations/${ids.organization_id}/projects/${ids.project_id}/control-tests`;
    assert.deepEqual(
      testWrite({
        ...ids,
        intent: "propose",
        evidence_file_id: file,
        control_id: control,
      }),
      {
        intent: "propose",
        path: `${base}/propose`,
        body: { evidence_file_id: file },
        controlId: control,
      },
    );
    assert.deepEqual(
      testWrite({ ...ids, intent: "approve", test_id: testId, version: "2" }),
      {
        intent: "approve",
        path: `${base}/${testId}/approve`,
        body: { version: 2 },
        controlId: null,
      },
    );
    assert.deepEqual(
      testWrite({
        ...ids,
        intent: "replace",
        test_id: testId,
        version: "2",
        position: "3",
        row_number: "17",
        selection: "TARGETED",
        reason: " Admin role ",
      }),
      {
        intent: "replace",
        path: `${base}/${testId}/samples/3/replace`,
        body: {
          version: 2,
          row_number: 17,
          selection: "TARGETED",
          reason: "Admin role",
        },
        controlId: null,
      },
    );
    for (const bad of [
      { ...ids, intent: "propose", evidence_file_id: "../x" },
      { ...ids, intent: "approve", test_id: testId, version: "0" },
      {
        ...ids,
        intent: "replace",
        test_id: testId,
        version: "2",
        position: "1",
        row_number: "4",
        selection: "TARGETED",
        reason: "",
      },
      {
        ...ids,
        intent: "replace",
        test_id: testId,
        version: "2",
        position: "1",
        row_number: "4",
        selection: "RANDOM",
        reason: "Because",
      },
      {
        ...ids,
        intent: "replace",
        test_id: testId,
        version: "2",
        position: "1",
        row_number: "0",
        selection: "HAPHAZARD",
        reason: "Because",
      },
      {
        ...ids,
        intent: "replace",
        test_id: testId,
        version: "2",
        position: "1",
        row_number: "4",
        selection: "HAPHAZARD",
        reason: "password = Hunter2024x",
      },
      {
        organization_id: "x",
        project_id: ids.project_id,
        intent: "approve",
        test_id: testId,
        version: "1",
      },
      { ...ids, intent: "delete", test_id: testId, version: "1" },
    ]) {
      assert.deepEqual(testWrite(bad), { error: "invalid" });
    }
  });

  it("maps results to notices", () => {
    assert.equal(testNoticeFor("propose", 200), "samples-proposed");
    // A 409 says why: the plan changed, or the control is not ready for testing.
    assert.equal(
      testNoticeFor("approve", 409, "control not ready"),
      "test-not-ready",
    );
    assert.equal(
      testNoticeFor("approve", 409, "test plan changed"),
      "test-changed",
    );
    assert.equal(testNoticeFor("replace", 200), "sample-replaced");
    assert.equal(testNoticeFor("approve", 200), "samples-approved");
    assert.equal(testNoticeFor("approve", 409), "test-changed");
    assert.equal(testNoticeFor("approve", 403), "test-denied");
    assert.equal(testNoticeFor("replace", 422), "test-invalid");
    assert.equal(testNoticeFor("propose", 0), "test-unavailable");
    assert.equal(parseTestNotice("samples-approved"), "samples-approved");
    assert.equal(parseTestNotice("saved"), null);
  });
});
