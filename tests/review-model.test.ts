import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  type ControlReview,
  openNotes,
  parseReviewNotice,
  parseReviews,
  reperformedWords,
  reperformHold,
  reviewBanner,
  reviewFor,
  reviewNoticeFor,
  reviewPill,
  reviewWrite,
  roundReviewsFor,
  runFailureLine,
  signOffAsk,
} from "../apps/web/src/review-model.ts";

const org = "11111111-1111-7111-8111-111111111111";
const project = "22222222-2222-7222-8222-222222222222";
const review = "33333333-3333-7333-8333-333333333333";
const note = "44444444-4444-7444-8444-444444444444";
const control = "55555555-5555-7555-8555-555555555555";

const ids = {
  organization_id: org,
  project_id: project,
  review_id: review,
  control_id: control,
  version: "3",
};

describe("independent review model", () => {
  it("parses a review with the agent's proposed notes and their citations", () => {
    const fixture = {
      id: review,
      control_id: control,
      control_ref: "ITGC-AC-01",
      label: "ITGC-AC-01 · SAP ERP",
      status: "OPEN",
      reperforming: false,
      reperformed_at: "2026-10-11T10:00:00Z",
      reperform_source: "MODEL",
      reperform_note: "",
      sheet_status: "SIGNED_OFF",
      sheet_signed_by: "Pat",
      sheet_version: 4,
      sheet_version_reviewed: 4,
      workpapers: [
        {
          id: note,
          stage: "EFFECTIVENESS",
          status: "PREPARED",
          prepared_by: "Pat",
        },
      ],
      notes: [
        {
          id: note,
          number: 1,
          target_kind: "RESULT",
          target: {
            item_id: control,
            indexes: [0],
            reviewer_result: "EXCEPTION",
            citations: [
              {
                file_id: control,
                file_name: "tickets.csv",
                quote: "Demo Manager",
                found: true,
                location: "row 2",
                page: null,
              },
            ],
          },
          text: "T-1: attribute A is pass, but the reviewer found an exception.",
          severity: "MUST_FIX",
          status: "PROPOSED",
          raised_by: "AGENT",
          raised_by_name: null,
          raised_at: "2026-10-11T10:00:00Z",
          decided_by_name: null,
          decision_reason: "",
          response: "",
          responded_by_name: null,
          responded_at: null,
          cleared_by_name: null,
          cleared_at: null,
          clear_reason: "",
          reopened: [],
          version: 1,
        },
        { id: "bad" },
        {
          id: "66666666-6666-7666-8666-666666666666",
          number: 2,
          target_kind: "GENERAL",
          target: {},
          text: "Cleared one.",
          severity: "OBSERVATION",
          status: "CLEARED",
          raised_by: "PERSON",
          raised_by_name: "Rae",
          raised_at: "2026-10-11T11:00:00Z",
          reopened: ["SHEET"],
          version: 2,
        },
      ],
      counts: { PROPOSED: 1, CLEARED: 1 },
      blocking: ["1 note(s) are not cleared"],
      viewer_is_reviewer: true,
      viewer_prepared: false,
      signed_by: null,
      signed_at: null,
      signoff_note: "",
      version: 3,
    };
    const parsed = parseReviews([fixture]);
    assert.ok(parsed !== null);
    const [first] = parsed;
    assert.ok(first);
    assert.equal(first.label, "ITGC-AC-01 · SAP ERP");
    // Independence is required unless the API says otherwise.
    assert.equal(first.independenceRequired, true);
    const relaxed = parseReviews([
      {
        ...(JSON.parse(JSON.stringify(fixture)) as Record<string, unknown>),
        independence_required: false,
      },
    ]);
    assert.equal(relaxed?.[0]?.independenceRequired, false);
    // Milestone 3a: FALLBACK says the rules' checks stand and the model did not
    // re-perform the items; it is never read as the model's work.
    const fallback = parseReviews([
      {
        ...(JSON.parse(JSON.stringify(fixture)) as Record<string, unknown>),
        reperform_source: "FALLBACK",
      },
    ]);
    assert.equal(fallback?.[0]?.reperformSource, "FALLBACK");
    assert.equal(first.reperformSource, "MODEL");
    assert.equal(first.notes.length, 2);
    assert.equal(first.notes[0]?.citations[0]?.quote, "Demo Manager");
    assert.equal(first.notes[0]?.reviewerResult, "EXCEPTION");
    assert.deepEqual(first.notes[0]?.indexes, [0]);
    assert.deepEqual(first.notes[1]?.reopened, ["SHEET"]);
    assert.deepEqual(
      openNotes(first).map((entry) => entry.number),
      [1],
    );
    assert.equal(reviewFor(parsed, control)?.id, review);
    assert.equal(reviewFor(parsed, note), null);
    assert.equal(parseReviews([{ id: "x" }]), null);
    assert.equal(parseReviews("no"), null);
    // A review of a testing round (W2) is listed beside the control's own, never in
    // its place; what it covered is kept as given.
    const base = JSON.parse(JSON.stringify(fixture)) as Record<string, unknown>;
    const withRound = parseReviews([
      base,
      {
        ...base,
        id: "01a12990-0000-7000-8000-000000000009",
        test_round_id: "01a12990-0000-7000-8000-000000000001",
        round_kind: "ROLLFORWARD",
        coverage: {
          sheet_version: 3,
          test_round_id: "01a12990-0000-7000-8000-000000000001",
        },
      },
    ]) as ControlReview[];
    assert.equal(withRound[0]?.testRoundId, null);
    assert.equal(withRound[1]?.roundKind, "ROLLFORWARD");
    assert.deepEqual(withRound[1]?.coverage, {
      sheet_version: 3,
      test_round_id: "01a12990-0000-7000-8000-000000000001",
    });
    assert.equal(reviewFor(withRound, control)?.id, review);
    assert.deepEqual(
      roundReviewsFor(withRound, control).map((entry) => entry.id),
      ["01a12990-0000-7000-8000-000000000009"],
    );
  });

  it("builds each review write and refuses bad input", () => {
    const accept = reviewWrite({ ...ids, intent: "accept", note_id: note });
    assert.ok(!("error" in accept));
    assert.equal(
      accept.path,
      `/organizations/${org}/projects/${project}/reviews/${review}/notes/${note}/decide`,
    );
    assert.deepEqual(accept.body, { version: 3, action: "ACCEPT", reason: "" });
    assert.equal(accept.controlId, control);
    assert.deepEqual(
      reviewWrite({ ...ids, intent: "dismiss", note_id: note }),
      { error: "invalid" },
    );
    const dismissed = reviewWrite({
      ...ids,
      intent: "dismiss",
      note_id: note,
      reason: "Whole population.",
    });
    assert.ok(!("error" in dismissed));
    assert.deepEqual(dismissed.body, {
      version: 3,
      action: "DISMISS",
      reason: "Whole population.",
    });
    const raised = reviewWrite({
      ...ids,
      intent: "note",
      target_kind: "RESULT",
      severity: "MUST_FIX",
      text: "Test T-1 again.",
      item_id: control,
      workpaper_id: "",
    });
    assert.ok(!("error" in raised));
    assert.deepEqual(raised.body, {
      version: 3,
      target_kind: "RESULT",
      severity: "MUST_FIX",
      text: "Test T-1 again.",
      item_id: control,
      workpaper_id: null,
    });
    assert.deepEqual(
      reviewWrite({
        ...ids,
        intent: "note",
        target_kind: "RESULT",
        severity: "HIGH",
        text: "x",
      }),
      { error: "invalid" },
    );
    const answered = reviewWrite({
      ...ids,
      intent: "respond",
      note_id: note,
      text: "Re-tested.",
    });
    assert.ok(!("error" in answered));
    assert.equal(answered.path.endsWith("/respond"), true);
    assert.deepEqual(answered.body, { version: 3, response: "Re-tested." });
    const returned = reviewWrite({
      ...ids,
      intent: "return",
      note_id: note,
      reason: "Cite it.",
    });
    assert.ok(!("error" in returned));
    assert.deepEqual(returned.body, {
      version: 3,
      action: "RETURN",
      reason: "Cite it.",
    });
    const signed = reviewWrite({
      ...ids,
      intent: "sign-off",
      text: "Reviewed.",
    });
    assert.ok(!("error" in signed));
    assert.deepEqual(signed.body, { version: 3, note: "Reviewed." });
    assert.deepEqual(reviewWrite({ ...ids, intent: "reopen" }), {
      error: "invalid",
    });
    assert.deepEqual(
      reviewWrite({
        ...ids,
        intent: "respond",
        note_id: note,
        text: "password: hunter2",
      }),
      { error: "invalid" },
    );
    assert.deepEqual(
      reviewWrite({ ...ids, version: "0", intent: "reperform" }),
      {
        error: "invalid",
      },
    );
    assert.deepEqual(reviewWrite({ ...ids, intent: "nonsense" }), {
      error: "invalid",
    });
  });

  it("maps results to notices", () => {
    assert.equal(reviewNoticeFor("sign-off", 200), "review-signed");
    assert.equal(reviewNoticeFor("accept", 409), "review-blocked");
    assert.equal(reviewNoticeFor("clear", 403), "review-denied");
    assert.equal(reviewNoticeFor("note", 422), "review-invalid");
    assert.equal(reviewNoticeFor("respond", 500), "review-unavailable");
    assert.equal(parseReviewNotice("review-cleared"), "review-cleared");
    assert.equal(parseReviewNotice("sheet-signed"), null);
  });
});

describe("a reviewer's coverage assessment (W3 follow-up)", () => {
  it("posts COVERS or REQUIRES_REVIEW with a rationale, and nothing else", () => {
    const fields = {
      organization_id: "01a13253-ec1a-7604-8944-a06dd7633ce0",
      project_id: "01a155ff-992f-7342-bc45-127332b008f4",
      review_id: "01a12990-0000-7000-8000-000000000020",
      version: "3",
      intent: "coverage",
      decision: "COVERS",
      reason: "The design workpaper restates the walkthrough the review read.",
    };
    const good = reviewWrite(fields);
    assert.ok(!("error" in good));
    assert.equal(good.intent, "coverage");
    assert.match(
      good.path,
      /\/reviews\/01a12990-0000-7000-8000-000000000020\/coverage$/,
    );
    assert.deepEqual(good.body, {
      version: 3,
      decision: "COVERS",
      rationale: fields.reason,
    });
    assert.deepEqual(reviewWrite({ ...fields, decision: "MAYBE" }), {
      error: "invalid",
    });
    assert.deepEqual(reviewWrite({ ...fields, reason: "no" }), {
      error: "invalid",
    });
    assert.equal(reviewNoticeFor("coverage", 200), "review-covered");
    assert.equal(reviewNoticeFor("coverage", 409), "review-blocked");
  });
});

describe("a sign-off over a re-performance by hand (FO-1, 19 November 2026)", () => {
  const ids = {
    organization_id: org,
    project_id: project,
    review_id: review,
    version: "3",
    intent: "sign-off",
  };

  it("posts the reviewer's record with a note that says what, and reads the typed record", () => {
    const attested = reviewWrite({
      ...ids,
      text: "Re-performed T-0 to T-2 by hand.",
      reperformed_by_hand: "on",
    });
    assert.ok(!("error" in attested));
    assert.deepEqual(attested.body, {
      version: 3,
      note: "Re-performed T-0 to T-2 by hand.",
      reperformed_by_hand: true,
    });
    // A note shorter than the server's minimum is refused before it posts.
    assert.deepEqual(
      reviewWrite({ ...ids, text: "Done.", reperformed_by_hand: "on" }),
      { error: "invalid" },
    );
    const parsed = parseReviews([
      {
        id: review,
        control_id: control,
        control_ref: "ITGC-AC-01",
        status: "OPEN",
        reperformance: { known: true, source: "MODEL", due: 3, done: 1 },
        attestation_needed: true,
      },
    ])?.[0];
    assert.deepEqual(parsed?.reperformance, {
      known: true,
      source: "MODEL",
      due: 3,
      done: 1,
      capped: false,
      dropped: 0,
      failed: false,
    });
    assert.equal(parsed?.attestationNeeded, true);
    // Rewritten (design review, 20 November 2026). Old: attestationWords put the run's
    // fact ("The reviewer agent re-performed 1 of 3 items.") inside the person's
    // checkbox label. New: the fact is the header's and the banner's (reperformedWords,
    // one source with the reviewer lane), and the checkbox holds only the attestation;
    // the run-fact assertion moves to reperformedWords below.
    assert.equal(
      reperformedWords(parsed?.reperformance, "MODEL", 0),
      "Re-performed 1 of 3 items: no differences from the preparer's results",
    );
  });

  it("never reads a partial or failed re-performance as ready to sign off or as each result", () => {
    // Design review, 20 November 2026: the header said "the reviewer agent
    // re-performed each result" and the pill "Ready to sign off" whenever the source
    // was MODEL and no note was open, beside a banner that said 2 of 3 items were not
    // re-performed.
    const base = {
      status: "OPEN" as const,
      reperforming: false,
      attestationNeeded: true,
    };
    const partial = {
      known: true,
      source: "MODEL",
      due: 3,
      done: 1,
      capped: false,
      dropped: 0,
      failed: false,
    };
    const failed = { ...partial, failed: true };
    const idle = { waiting: 0, outstanding: false, unavailable: false };
    for (const [record, words] of [
      [partial, "Re-perform needed"],
      [failed, "Re-performance did not finish"],
      [{ ...partial, done: 0 }, "Re-perform needed"],
      [null, "Re-perform needed"],
    ] as const) {
      const pill = reviewPill({ ...base, reperformance: record }, idle);
      assert.deepEqual(pill, { words, tone: "tone-warning" });
      assert.equal(reperformHold({ ...base, reperformance: record }), words);
      const said = reperformedWords(record, "MODEL", 0);
      assert.doesNotMatch(said, /each result/);
      assert.doesNotMatch(said, /^Re-performed the testing/);
    }
    // Only a re-performance that holds nothing reads as ready.
    assert.deepEqual(
      reviewPill(
        {
          ...base,
          attestationNeeded: false,
          reperformance: { ...partial, done: 3 },
        },
        idle,
      ),
      { words: "Ready to sign off", tone: "" },
    );
    // Code review, 20 November 2026: a last attempt that gave up after a full run held
    // nothing ("Ready to sign off", reperformHold null while attestationNeeded was false)
    // while the server's run_lets_sign withheld "Sign off the review" from the queue.
    // New: a failed attempt holds the sign-off whatever the earlier run did.
    const fullThenFailed = { ...partial, done: 3, failed: true };
    assert.equal(
      reperformHold({
        attestationNeeded: false,
        reperformance: fullThenFailed,
      }),
      "Re-performance did not finish",
    );
    assert.deepEqual(
      reviewPill(
        { ...base, attestationNeeded: false, reperformance: fullThenFailed },
        idle,
      ),
      { words: "Re-performance did not finish", tone: "tone-warning" },
    );
    // Open notes and a signed review keep their own words.
    assert.equal(
      reviewPill({ ...base, reperformance: partial }, { ...idle, waiting: 2 })
        .words,
      "Notes open",
    );
    assert.deepEqual(
      reviewPill(
        { ...base, status: "SIGNED_OFF", reperformance: partial },
        { ...idle, outstanding: true },
      ),
      { words: "Review outstanding", tone: "tone-warning" },
    );
    // Code review, 20 November 2026: the header said the earlier run's count ("Re-performed
    // 1 of 3 items: no differences ...") above the banner's "did not finish". New: the
    // header names the last attempt after a partial or a full run, never the earlier
    // count. Design review, 20 November 2026: "did not finish" stood three times on the
    // card (header, pill, banner). Code review, 20 November 2026: the header read "Last
    // re-performance attempt · <reperformedAt>", the date of the earlier run that finished
    // (reperformedAt is written only when a run finishes), so the failed attempt was given
    // that run's date. New: the words name the last run that finished, the date's own, and
    // the pill and the banner say a later attempt did not finish.
    for (const record of [failed, fullThenFailed]) {
      const said = reperformedWords(record, "MODEL", 0);
      assert.equal(said, "Last finished re-performance");
      assert.doesNotMatch(said, /attempt|did not finish|Re-performed \d/);
    }
    assert.equal(
      reperformedWords({ ...partial, done: 0 }, "MODEL", 0),
      "The reviewer agent did not re-perform the items",
    );
  });
});

describe("a failed re-performance on a design not effective (product owner, 20 November 2026)", () => {
  // Code review of dda278f: on a design signed off as not effective nothing was tested,
  // yet a failed attempt asked for the reviewer's record of re-performing the testing by
  // hand, a record that could only be false. Now the sign-off waits for a run that
  // finishes (the server's signoffHold RUN), with no record by hand offered.
  const failed = {
    known: false,
    source: null,
    due: 0,
    done: 0,
    capped: false,
    dropped: 0,
    failed: true,
  };
  const untested = {
    status: "OPEN" as const,
    reperforming: false,
    attestationNeeded: false,
    signoffHold: "RUN" as const,
    reperformance: failed,
  };
  const idle = { waiting: 0, outstanding: false, unavailable: false };

  it("waits for a run: no record by hand, the pill says the run did not finish", () => {
    assert.equal(signOffAsk(untested), "WAIT");
    assert.equal(reperformHold(untested), "Re-performance did not finish");
    assert.deepEqual(reviewPill(untested, idle), {
      words: "Re-performance did not finish",
      tone: "tone-warning",
    });
    // A run that finishes clears it: an optional note, ready to sign off.
    const finished = {
      ...untested,
      signoffHold: "NONE" as const,
      reperformance: { ...failed, failed: false },
    };
    assert.equal(signOffAsk(finished), "NOTE");
    assert.equal(reperformHold(finished), null);
    assert.deepEqual(reviewPill(finished, idle), {
      words: "Ready to sign off",
      tone: "",
    });
    // The tested branch keeps the record by hand after a failed attempt (dda278f).
    assert.equal(
      signOffAsk({
        attestationNeeded: true,
        signoffHold: "ATTESTATION",
        reperformance: { ...failed, known: true, due: 3, done: 3 },
      }),
      "ATTEST",
    );
    // Fail closed: a failed record waits even if the hold was not sent.
    assert.equal(
      signOffAsk({ attestationNeeded: false, reperformance: failed }),
      "WAIT",
    );
  });

  it("parses the server's typed hold", () => {
    const parsed = parseReviews([
      {
        id: review,
        control_id: control,
        control_ref: "ITGC-AC-01",
        label: "ITGC-AC-01",
        status: "OPEN",
        reperforming: false,
        reperform_state: "IDLE",
        reperformed_at: null,
        reperform_source: null,
        reperform_note: "",
        reperformance: failed,
        attestation_needed: false,
        signoff_hold: "RUN",
        workpapers: [],
        notes: [],
        counts: {},
        blocking: [
          "the last re-performance did not finish: re-perform to try again",
        ],
      },
    ])?.[0];
    assert.equal(parsed?.signoffHold, "RUN");
    assert.equal(signOffAsk(parsed ?? untested), "WAIT");
    const unknown = parseReviews([
      {
        id: review,
        control_id: control,
        control_ref: "ITGC-AC-01",
        status: "OPEN",
        signoff_hold: "SOMETHING",
        workpapers: [],
        notes: [],
        counts: {},
        blocking: [],
      },
    ])?.[0];
    assert.equal(unknown?.signoffHold, "NONE");
  });
});

describe("a signed review over a re-performance that gave up (code review, 20 November 2026)", () => {
  it("says no failure and no hold once the review is signed off", () => {
    // Before: runFailureLine fell through to the re-performance note ("Re-perform to try
    // again") over a signed review whose record still said failed, beside "Reviewed".
    const failed = {
      known: true,
      source: "MODEL",
      due: 3,
      done: 1,
      capped: false,
      dropped: 0,
      failed: true,
    };
    const open = {
      status: "OPEN" as const,
      reperforming: false,
      reperformState: "IDLE" as const,
      reperformNote:
        "The re-performance did not finish. Re-perform to try again.",
      failureNote: "",
      reperformance: failed,
    };
    assert.match(runFailureLine(open) ?? "", /did not finish/);
    const signed = { ...open, status: "SIGNED_OFF" as const };
    assert.equal(runFailureLine(signed), null);
    assert.equal(runFailureLine(signed, "Anything the server said."), null);
    assert.deepEqual(
      reviewPill(
        { ...signed, attestationNeeded: true },
        { waiting: 0, outstanding: false, unavailable: false },
      ),
      { words: "Reviewed", tone: "tone-success" },
    );
  });
});

describe("the review card's one re-performance banner (code review, 20 November 2026)", () => {
  const failed = {
    known: true,
    source: "MODEL",
    due: 3,
    done: 3,
    capped: false,
    dropped: 0,
    failed: true,
  };
  const open = {
    status: "OPEN" as const,
    reperforming: false,
    reperformState: "IDLE" as const,
    reperformNote:
      "The re-performance did not finish. Re-perform to try again.",
    failureNote: "",
    reperformance: failed,
  };

  it("shows no banner over a signed review whose last re-performance gave up", () => {
    // Before: the view fell through to the raw note as an info banner, so a signed
    // review said "Re-perform to try again" beside "Reviewed".
    const signed = { ...open, status: "SIGNED_OFF" as const };
    assert.equal(reviewBanner(signed), null);
    assert.equal(
      reviewBanner({ ...signed, failureNote: "The model did not answer." }),
      null,
    );
  });

  it("never shows a failed run's note as information while it re-performs again", () => {
    for (const review of [
      { ...open, reperforming: true },
      { ...open, reperformState: "RUNNING" as const },
    ]) {
      const banner = reviewBanner(review);
      assert.doesNotMatch(banner?.text ?? "", /Re-perform/);
    }
  });

  it("says an open review's failure as a warning, and a finished run's note as information", () => {
    assert.deepEqual(reviewBanner(open), {
      tone: "warning",
      text: "The re-performance did not finish. Re-perform to try again.",
    });
    const finished = {
      ...open,
      reperformance: { ...failed, done: 0, failed: false },
      reperformNote: "The reviewer agent did not re-perform the items.",
    };
    assert.deepEqual(reviewBanner(finished), {
      tone: "info",
      text: "The reviewer agent did not re-perform the items.",
    });
    assert.deepEqual(
      reviewBanner({ ...finished, status: "SIGNED_OFF" as const }),
      {
        tone: "info",
        text: "The reviewer agent did not re-perform the items.",
      },
    );
    assert.equal(reviewBanner({ ...finished, reperformNote: "" }), null);
  });
});
