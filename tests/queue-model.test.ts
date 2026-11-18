import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  collapseRows,
  filterWords,
  groupQueue,
  ownerWords,
  parseQueue,
  parseQueueFilter,
  queueFor,
  queueHref,
  whereWords,
} from "../apps/web/src/queue-model.ts";

const raw = (over: Record<string, unknown> = {}) => ({
  id: "samples:t1",
  kind: "samples",
  source: { type: "control_test", id: "t1" },
  stage: "TESTING",
  control_id: "c1",
  control_ref: "ITGC-AC-01",
  phase: "INTERIM",
  round_id: null,
  round_kind: null,
  title: "Approve the samples",
  reason: "3 samples proposed by the tester.",
  owner: { role: "PREPARER", names: ["Dana Whitfield"] },
  authorized: true,
  ready: true,
  blockers: [],
  blocks: false,
  bucket: "MINE",
  link: { section: "controls", query: { control: "c1", step: "test" } },
  at: "2026-10-20T10:00:00Z",
  ...over,
});

describe("the engagement's one queue", () => {
  it("reads the API's items and drops what it cannot place", () => {
    const queue = parseQueue({
      items: [
        raw(),
        raw({ id: "x", stage: "ELSEWHERE" }),
        raw({ id: "y", link: { section: "nowhere", query: {} } }),
        raw({
          id: "z",
          link: { section: "controls", query: { control: "c1", evil: "<x>" } },
        }),
      ],
      counts: { MINE: 1, WAITING: 0, BLOCKED: 0 },
      generated_at: "2026-10-20T10:00:00Z",
    });
    assert.ok(queue !== null);
    assert.deepEqual(
      queue.items.map((item) => item.id),
      ["samples:t1", "z"],
    );
    assert.deepEqual(queue.items[1]?.link.query, { control: "c1" });
    assert.equal(parseQueue({ counts: {} }), null);
  });

  it("groups by responsibility, mine first, and filters without widening", () => {
    const queue = parseQueue({
      items: [
        raw({
          id: "a",
          bucket: "WAITING",
          authorized: false,
          owner: { role: "REVIEWER", names: [] },
        }),
        raw({ id: "b", bucket: "MINE" }),
        raw({
          id: "c",
          bucket: "BLOCKED",
          ready: false,
          blockers: ["The retest population is not received"],
          phase: "RETEST",
          round_kind: "RETEST",
          stage: "TESTING",
        }),
        raw({ id: "d", bucket: "MINE", stage: "REVIEW", phase: null }),
      ],
      counts: {},
      generated_at: "",
    });
    assert.ok(queue !== null);
    assert.deepEqual(queue.counts, {
      MINE: 2,
      WAITING: 1,
      BLOCKED: 1,
      UPCOMING: 0,
    });
    const all = groupQueue(queue, { bucket: null, stage: null, phase: null });
    assert.deepEqual(
      all.map((group) => [group.bucket, group.items.map((item) => item.id)]),
      [
        ["MINE", ["b", "d"]],
        ["BLOCKED", ["c"]],
        ["WAITING", ["a"]],
      ],
    );
    const retest = groupQueue(queue, {
      bucket: null,
      stage: null,
      phase: "RETEST",
    });
    assert.deepEqual(
      retest.map((group) => group.items.map((item) => item.id)),
      [["c"]],
    );
    const mineReview = groupQueue(queue, {
      bucket: "MINE",
      stage: "REVIEW",
      phase: null,
    });
    assert.deepEqual(
      mineReview.map((group) => group.items.map((item) => item.id)),
      [["d"]],
    );
    assert.deepEqual(queueFor(queue, "c1").length, 4);
  });

  it("says whose each item is and where it belongs", () => {
    const queue = parseQueue({
      items: [
        raw(),
        raw({
          id: "w",
          bucket: "WAITING",
          authorized: false,
          owner: { role: "REVIEWER", names: [] },
        }),
        raw({
          id: "r",
          round_kind: "RETEST",
          phase: "RETEST",
          round_id: "round-1",
        }),
        raw({ id: "none", control_ref: null, control_id: null, phase: null }),
      ],
      counts: {},
      generated_at: "",
    });
    assert.ok(queue !== null);
    const [mine, waiting, round, bare] = queue.items;
    assert.ok(mine && waiting && round && bare);
    assert.equal(ownerWords(mine), "Yours");
    assert.equal(ownerWords(waiting), "Waits on the independent reviewer");
    assert.equal(whereWords(mine), "ITGC-AC-01 · Interim");
    assert.equal(whereWords(round), "ITGC-AC-01 · Retest round");
    assert.equal(whereWords(bare), "");
    assert.equal(
      queueHref(mine, "org", "proj"),
      "/?organization=org&project=proj&section=controls&control=c1&step=test",
    );
  });

  it("reads and writes the filter in the address", () => {
    assert.deepEqual(
      parseQueueFilter("bucket:MINE,stage:REVIEW,phase:RETEST"),
      {
        bucket: "MINE",
        stage: "REVIEW",
        phase: "RETEST",
      },
    );
    assert.deepEqual(parseQueueFilter("bucket:nope,stage:x,phase:lower"), {
      bucket: null,
      stage: null,
      phase: null,
    });
    assert.equal(
      filterWords({ bucket: "WAITING", stage: null, phase: "INTERIM" }),
      "bucket:WAITING,phase:INTERIM",
    );
    assert.equal(filterWords(parseQueueFilter(null)), "");
  });

  it("shows a step repeated across many controls once, keeping each item", () => {
    const steps = ["a", "b", "c", "d"].map((id) =>
      raw({
        id: `control-step:${id}`,
        kind: "control-step",
        title: "Approve the test plan",
        control_ref: `ITGC-${id}`,
      }),
    );
    const queue = parseQueue({
      items: [
        raw(),
        ...steps,
        raw({
          id: "control-step:z",
          kind: "control-step",
          title: "Accept the population",
        }),
      ],
      counts: {},
      generated_at: "",
    });
    assert.ok(queue !== null);
    const rows = collapseRows(queue.items);
    assert.deepEqual(
      rows.map((row) =>
        row.kind === "item" ? row.item.id : `${row.title} ×${row.items.length}`,
      ),
      ["samples:t1", "Approve the test plan ×4", "control-step:z"],
    );
  });

  it("lists what is not due yet last, as no one's, with its obligation", () => {
    const queue = parseQueue({
      items: [
        raw({
          id: "round:r1",
          kind: "round",
          obligation: "ROUND_WINDOW",
          bucket: "UPCOMING",
          authorized: false,
          ready: false,
          owner: { role: "NONE", names: [] },
          blockers: ["The fixed control must operate until 2027-01-31"],
          title: "Retest testing not due yet",
          phase: "RETEST",
          round_kind: "RETEST",
          round_id: "r1",
        }),
        raw({ id: "b", bucket: "BLOCKED", ready: false, blockers: ["x"] }),
        raw(),
      ],
      counts: { MINE: 1, WAITING: 0, BLOCKED: 1, UPCOMING: 1 },
      total: 3,
      generated_at: "",
    });
    assert.ok(queue !== null);
    assert.equal(queue.total, 3);
    assert.equal(queue.counts.UPCOMING, 1);
    assert.deepEqual(
      groupQueue(queue, { bucket: null, stage: null, phase: null }).map(
        (group) => group.bucket,
      ),
      ["MINE", "BLOCKED", "UPCOMING"],
    );
    const [upcoming] = groupQueue(queue, {
      bucket: "UPCOMING",
      stage: null,
      phase: null,
    });
    assert.ok(upcoming);
    assert.equal(upcoming.items[0]?.obligation, "ROUND_WINDOW");
    assert.ok(upcoming.items[0]);
    assert.equal(ownerWords(upcoming.items[0]), "Not due yet");
    assert.equal(queue.items[2]?.obligation, "CONTROL_STEP");
    assert.deepEqual(parseQueueFilter("bucket:UPCOMING"), {
      bucket: "UPCOMING",
      stage: null,
      phase: null,
    });
  });
});
