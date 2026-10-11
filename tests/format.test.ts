import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  agentMonogram,
  formatBytes,
  formatDate,
  formatDuration,
  formatPeriod,
  initials,
  monogram,
} from "../apps/web/src/format.ts";

describe("formatDate", () => {
  it("formats a stored date without shifting the day", () => {
    assert.equal(formatDate("2027-02-28"), "Feb 28, 2027");
  });

  it("formats a UTC timestamp on its UTC day", () => {
    assert.equal(formatDate("2027-02-28T00:00:00Z"), "Feb 28, 2027");
    assert.equal(formatDate("2026-10-11T23:59:59Z"), "Oct 11, 2026");
  });

  it("returns values that are not dates unchanged", () => {
    assert.equal(formatDate("not a date"), "not a date");
    assert.equal(formatDate(""), "");
  });
});

describe("initials", () => {
  it("uses up to two name parts before the domain", () => {
    assert.equal(initials("preview.owner@example.com"), "PO");
    assert.equal(initials("ana@example.com"), "A");
    assert.equal(initials("jo-anne_mary.smith@example.com"), "JA");
  });

  it("falls back when there is no name", () => {
    assert.equal(initials("@example.com"), "?");
  });
});

describe("monogram", () => {
  it("uses the first two letters in a titled engagement", () => {
    assert.equal(monogram("SOX 2026"), "SO");
    assert.equal(monogram("Lucid"), "LU");
  });

  it("falls back when the title has no letters", () => {
    assert.equal(monogram("2026"), "?");
    assert.equal(monogram(""), "?");
  });
});

describe("formatPeriod", () => {
  it("names an unscheduled engagement", () => {
    assert.equal(formatPeriod(null, null), "Not scheduled");
  });

  it("formats an open or closed window without shifting the day", () => {
    assert.equal(formatPeriod("2026-01-15", null), "From Jan 15, 2026");
    assert.equal(formatPeriod(null, "2026-12-31"), "Through Dec 31, 2026");
    assert.equal(
      formatPeriod("2026-01-15", "2026-12-31"),
      "Jan 15, 2026 – Dec 31, 2026",
    );
  });
});

describe("formatBytes", () => {
  it("uses the largest sensible unit", () => {
    assert.equal(formatBytes(0), "0 B");
    assert.equal(formatBytes(1023), "1023 B");
    assert.equal(formatBytes(2048), "2.0 KB");
    assert.equal(formatBytes(25_000_000), "24 MB");
  });

  it("returns nothing for impossible sizes", () => {
    assert.equal(formatBytes(-1), "");
    assert.equal(formatBytes(Number.NaN), "");
  });
});

describe("formatDuration", () => {
  it("reads like a person would say it", () => {
    assert.equal(formatDuration(45), "45 sec");
    assert.equal(formatDuration(600), "10 min");
    assert.equal(formatDuration(3600), "1 h");
    assert.equal(formatDuration(5400), "1.5 h");
    assert.equal(formatDuration(-5), "");
  });
});

describe("agentMonogram", () => {
  it("tells similar agents apart", () => {
    assert.equal(agentMonogram("ITGC tester: access"), "IA");
    assert.equal(agentMonogram("ITGC tester: change management"), "IC");
    assert.equal(agentMonogram("ITGC tester: IT operations"), "IO");
    assert.equal(agentMonogram("Engagement planner"), "EP");
    assert.equal(agentMonogram("Reviewer"), "RE");
    assert.equal(agentMonogram("42"), "?");
  });
});
