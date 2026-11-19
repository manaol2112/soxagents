import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkTarget } from "./browser/lib.ts";
import {
  copyFindings,
  layoutFindings,
  spanFindings,
  storyFindings,
} from "./browser/rules.ts";

// What the browser checks (tests/browser/) assert about a rendered screen, without a
// browser: these run in every node test run.

describe("copy rules on a rendered screen", () => {
  it("pass professional copy, an ellipsis and e.g.", () => {
    assert.deepEqual(
      copyFindings(
        "Reading 3 files… Loading... Request the listing, e.g., the SAP ERP users.",
      ),
      [],
    );
  });

  it("find a double full stop, a spaced one and doubled punctuation", () => {
    assert.equal(
      copyFindings("The file was withdrawn...").length,
      0,
      "an ellipsis is not one",
    );
    assert.match(
      copyFindings("The file was withdrawn.. Restore it")[0] ?? "",
      /double/,
    );
    assert.match(
      copyFindings("No reason given .")[0] ?? "",
      /spaced full stop/,
    );
    assert.match(copyFindings("Ready?.")[0] ?? "", /doubled punctuation/);
  });

  it("find internal wording and casual phrasing", () => {
    assert.match(
      copyFindings("Set MODEL_API_KEY to read it")[0] ?? "",
      /banned wording/,
    );
    assert.match(
      copyFindings("The OCR engine is off")[0] ?? "",
      /banned wording/,
    );
    assert.match(copyFindings("Draft it for me")[0] ?? "", /banned wording/);
  });

  it("find the agent's first person, but not a person's own button", () => {
    assert.match(
      copyFindings("I read the policy and drafted the request.")[0] ?? "",
      /first person/,
    );
    assert.deepEqual(copyFindings("Guide me", ["Guide me"]), []);
    // "i.e." is not the agent; "We" at a sentence's start is.
    assert.deepEqual(
      copyFindings("The listing, i.e. every user, is complete."),
      [],
    );
    assert.match(
      copyFindings("We drafted the request.")[0] ?? "",
      /first person/,
    );
    // A card that is a link is prose: only a short label is the person's command.
    const card = "I read the policy and found two approvers for each request.";
    assert.match(copyFindings(card, [card])[0] ?? "", /first person/);
    assert.deepEqual(
      copyFindings("D&I evidence for a SOC 1 Type II report"),
      [],
    );
  });
});

describe("the server the browser checks drive", () => {
  const session = {
    db: "ai_workforce_states_ui1",
    organization: "o",
    project: "p",
    owner: "t",
    cookie: "aw_session",
    states: {},
  };

  it("is a scratch server on 127.0.0.1, never the development stack", () => {
    for (const web of [
      "http://localhost:3030",
      "http://192.168.1.20:3030",
      "http://127.0.0.1:3000",
      "http://127.0.0.1:8000",
      "http://127.0.0.1",
    ]) {
      assert.throws(() => checkTarget(session, web), Error, web);
    }
  });

  it("has a scratch_stack.py record serving the session's database", () => {
    assert.throws(
      () => checkTarget(session, "http://127.0.0.1:3999"),
      /no scratch web server is recorded/,
    );
  });
});

describe("one screen, one story", () => {
  it("names what is missing and what contradicts", () => {
    const text = "Plan: Approved Testing: Not started Evidence 0 of 2 received";
    assert.deepEqual(
      storyFindings(
        text,
        ["Plan: Approved", /0 of 2/],
        ["Testing: In progress"],
      ),
      [],
    );
    assert.deepEqual(storyFindings(text, ["2 withdrawn"], [/Not started/]), [
      "missing: 2 withdrawn",
      "contradicts: /Not started/",
    ]);
  });
});

describe("layout findings", () => {
  const clean = {
    width: 390,
    docScrollWidth: 390,
    docClientWidth: 390,
    gutterBreaks: [],
    undeclaredScrollers: [],
    clipped: [],
    focus: null,
  };

  it("pass a clean measurement", () => {
    assert.deepEqual(layoutFindings(clean), []);
  });

  it("report every kind of defect", () => {
    const found = layoutFindings({
      ...clean,
      docScrollWidth: 420,
      gutterBreaks: ["p [8-380]"],
      undeclaredScrollers: ["div.tabs 500/325"],
      clipped: ["td is 0 px wide"],
      focus: "body",
    });
    assert.equal(found.length, 5, found.join("; "));
  });

  it("asserts the gutter only at phone width", () => {
    assert.deepEqual(
      layoutFindings({ ...clean, width: 1440, gutterBreaks: ["p [8-380]"] }),
      [],
    );
  });

  it("checks a declared full-width row against its container", () => {
    const box = (left: number, right: number) => ({
      left,
      right,
      width: right - left,
    });
    assert.deepEqual(spanFindings("header", box(24, 366), box(24, 367)), []);
    assert.equal(spanFindings("header", box(24, 300), box(24, 366)).length, 1);
    assert.equal(spanFindings("header", null, box(24, 366)).length, 1);
  });
});
