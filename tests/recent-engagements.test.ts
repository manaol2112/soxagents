import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  byRecent,
  MAX_VISITS,
  openedLabel,
  parseFavorites,
  parseVisits,
  recentOf,
  recordVisit,
  startingView,
  toggleFavorite,
} from "../apps/web/src/recent-engagements.ts";

const A = "01a14b66-2833-7711-b1ef-539054bc3ea1";
const B = "01a14b66-2833-7711-b1ef-539054bc3ea2";
const C = "01a14b66-2833-7711-b1ef-539054bc3ea3";

describe("recently opened engagements", () => {
  it("reads only what it stored", () => {
    assert.deepEqual(parseVisits(null), {});
    assert.deepEqual(parseVisits("not json"), {});
    assert.deepEqual(parseVisits("[1,2]"), {});
    assert.deepEqual(
      parseVisits(JSON.stringify({ [A]: 5, nope: 6, [B]: "x", [C]: -1 })),
      { [A]: 5 },
    );
  });

  it("records a visit and forgets the oldest past the limit", () => {
    let visits = recordVisit({}, A, 100);
    visits = recordVisit(visits, A, 200);
    assert.deepEqual(visits, { [A]: 200 });
    assert.deepEqual(recordVisit(visits, "not-an-id", 300), visits);
    let many = {};
    for (let index = 0; index < MAX_VISITS + 5; index += 1) {
      const id = `01a14b66-2833-7711-b1ef-${String(index).padStart(12, "0")}`;
      many = recordVisit(many, id, index + 1);
    }
    assert.equal(Object.keys(many).length, MAX_VISITS);
    // The first ones opened are the ones forgotten.
    assert.equal(
      Object.hasOwn(many, "01a14b66-2833-7711-b1ef-000000000000"),
      false,
    );
  });

  it("puts the most recently opened first and keeps the rest in order", () => {
    const projects = [{ id: A }, { id: B }, { id: C }];
    assert.deepEqual(
      byRecent(projects, { [C]: 10, [B]: 20 }).map((project) => project.id),
      [B, C, A],
    );
    assert.deepEqual(
      byRecent(projects, {}).map((project) => project.id),
      [A, B, C],
    );
  });

  it("says when it was opened", () => {
    const now = Date.parse("2026-10-17T12:00:00Z");
    assert.equal(openedLabel(now - 20_000, now), "Opened just now");
    assert.equal(openedLabel(now - 5 * 60_000, now), "Opened 5m ago");
    assert.equal(openedLabel(now - 3 * 3_600_000, now), "Opened 3h ago");
    assert.equal(openedLabel(now - 2 * 86_400_000, now), "Opened 2d ago");
    assert.equal(
      openedLabel(Date.parse("2026-08-01T12:00:00Z"), now),
      "Opened Aug 1, 2026",
    );
  });
});

describe("the Recent list", () => {
  it("leaves out archived engagements and ones never opened", () => {
    const projects = [
      { id: A, status: "ACTIVE" },
      { id: B, status: "ARCHIVED" },
      { id: C, status: "ACTIVE" },
    ];
    assert.deepEqual(
      recentOf(projects, { [A]: 1, [B]: 2 }).map((project) => project.id),
      [A],
    );
  });
});

describe("the view the page opens on", () => {
  it("opens on Recent once an engagement on the page was opened", () => {
    assert.equal(startingView([A, B], { [B]: 5 }, null), "recent");
    assert.equal(startingView([A, B], {}, null), "all");
    // A visit to an engagement no longer listed does not count.
    assert.equal(startingView([A], { [C]: 5 }, null), "all");
    // A link to one engagement opens where it is listed.
    assert.equal(startingView([A, B], { [B]: 5 }, A), "all");
  });
});

describe("favorite engagements", () => {
  it("stars and unstars", () => {
    const starred = toggleFavorite([], A);
    assert.deepEqual(starred, [A]);
    assert.deepEqual(toggleFavorite(starred, B), [A, B]);
    assert.deepEqual(toggleFavorite(starred, A), []);
    assert.deepEqual(toggleFavorite(starred, "nope"), [A]);
  });

  it("reads only ids, once each", () => {
    assert.deepEqual(parseFavorites(JSON.stringify([A, A, "x", 3, B])), [A, B]);
    assert.deepEqual(parseFavorites("{}"), []);
    assert.deepEqual(parseFavorites(null), []);
  });
});
