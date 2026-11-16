import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BASIS_WORDS,
  type ChoiceFacts,
  CONCLUSION_KINDS,
  CONCLUSION_WORDS,
  choiceProblems,
  choiceRefusal,
  choiceWrite,
  conclusionHead,
  designConclusionNoticeFor,
  designConclusionWrite,
  holdsBelow,
  parseDesignConclusion,
  signBlockedReason,
} from "../apps/web/src/design-conclusion-model.ts";

const ORG = "01900000-0000-7000-8000-000000000001";
const PROJECT = "01900000-0000-7000-8000-000000000002";
const CONTROL = "01900000-0000-7000-8000-000000000003";

// The API's body for a control whose design workpaper is prepared and not yet signed off.
function body(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    control_id: CONTROL,
    status: "TO_SIGN",
    proposed: "EFFECTIVE",
    workpaper: {
      id: "01900000-0000-7000-8000-000000000004",
      status: "PREPARED",
      drafting: false,
      prepared_by: "Dana Preparer",
      prepared_version: 2,
    },
    deficiencies: [],
    signed: null,
    out_of_date: [],
    blocking: [],
    viewer_is_reviewer: true,
    viewer_prepared: false,
    independence_required: true,
    can_sign: true,
    history: [],
    ...overrides,
  };
}

const signoff = {
  id: "01900000-0000-7000-8000-000000000005",
  verdict: "NOT_EFFECTIVE",
  workpaper_version: 2,
  deficiencies: ["D-901"],
  signed_by: "Riley Reviewer",
  signed_at: "2026-11-08T15:00:00Z",
  signoff_note: "Walkthrough reviewed.",
  reopened_at: null,
  reopened_by: null,
  reopen_reason: "",
  reopened_from: null,
};

describe("the D&I conclusion", () => {
  it("reads the API's body", () => {
    const parsed = parseDesignConclusion(
      body({
        status: "SIGNED_OFF",
        proposed: "NOT_EFFECTIVE",
        signed: signoff,
        history: [signoff, { ...signoff, id: "x", reopened_from: "BOGUS" }],
      }),
    );
    assert.ok(parsed !== null);
    assert.equal(parsed.status, "SIGNED_OFF");
    assert.equal(parsed.signed?.verdict, "NOT_EFFECTIVE");
    assert.deepEqual(parsed.signed?.deficiencies, ["D-901"]);
    assert.equal(parsed.workpaper?.preparedVersion, 2);
    // An unknown reopening source is never trusted as one of ours.
    assert.equal(parsed.history[1]?.reopenedFrom, null);
  });

  it("rejects a body that is not a D&I conclusion", () => {
    assert.equal(parseDesignConclusion(null), null);
    assert.equal(parseDesignConclusion(body({ status: "DONE" })), null);
    assert.equal(parseDesignConclusion({ status: "TO_SIGN" }), null);
    // A signed verdict outside the two is dropped, never read as effective.
    const odd = parseDesignConclusion(
      body({ signed: { ...signoff, verdict: "MAYBE" } }),
    );
    assert.equal(odd?.signed, null);
  });

  it("says why the viewer cannot sign", () => {
    const parse = (overrides: Record<string, unknown>) => {
      const parsed = parseDesignConclusion(body(overrides));
      assert.ok(parsed !== null);
      return parsed;
    };
    assert.equal(signBlockedReason(parse({})), null);
    assert.match(
      signBlockedReason(
        parse({ can_sign: false, viewer_is_reviewer: false }),
      ) ?? "",
      /reviewer role/,
    );
    assert.match(
      signBlockedReason(parse({ can_sign: false, viewer_prepared: true })) ??
        "",
      /preparer/,
    );
    assert.match(
      signBlockedReason(parse({ can_sign: false, status: "NOT_READY" })) ?? "",
      /D&I Assessment/,
    );
  });

  it("builds the sign-off and the reopening, and nothing else", () => {
    const ids = {
      organization_id: ORG,
      project_id: PROJECT,
      control_id: CONTROL,
    };
    // Rewritten 15 November 2026. Old: the sign-off sent the two-value verdict
    // (`verdict: "EFFECTIVE"` in, `{verdict, workpaper_version, note}` out). New: the
    // reviewer signs the preparer's conclusion by its kind, `{conclusion,
    // workpaper_version, note}`; the server takes `verdict` for one release only
    // (product owner, 15 November 2026, docs/design-workpaper.md section 3.5/3.6).
    const signed = designConclusionWrite({
      ...ids,
      intent: "sign",
      conclusion: "EXCEPTIONS_NOTED",
      workpaper_version: "2",
      note: " Reviewed. ",
    });
    assert.deepEqual(signed, {
      intent: "sign",
      path: `/organizations/${ORG}/projects/${PROJECT}/design-conclusions/${CONTROL}/sign-off`,
      body: {
        conclusion: "EXCEPTIONS_NOTED",
        workpaper_version: 2,
        note: "Reviewed.",
      },
      controlId: CONTROL,
    });
    const reopened = designConclusionWrite({
      ...ids,
      intent: "reopen",
      reason: "The walkthrough must be performed again.",
    });
    assert.ok(!("error" in reopened) && reopened.path.endsWith("/reopen"));
    // Rewritten 15 November 2026 with the above: the same refusals, of `conclusion`
    // in place of `verdict`; and the old field alone, or "Not concluded" (never signed),
    // is refused too (docs/design-workpaper.md section 3.5/3.6).
    for (const fields of [
      { ...ids, intent: "sign", conclusion: "PASS", workpaper_version: "2" },
      {
        ...ids,
        intent: "sign",
        conclusion: "EFFECTIVE",
        workpaper_version: "0",
      },
      {
        ...ids,
        intent: "sign",
        conclusion: "EFFECTIVE",
        workpaper_version: "2",
        note: "password: hunter2",
      },
      { ...ids, intent: "sign", verdict: "EFFECTIVE", workpaper_version: "2" },
      {
        ...ids,
        intent: "sign",
        conclusion: "NOT_CONCLUDED",
        workpaper_version: "2",
      },
      { ...ids, intent: "reopen", reason: "Too short" },
      { ...ids, intent: "approve" },
      {
        ...ids,
        control_id: "../../users",
        intent: "reopen",
        reason: "x".repeat(20),
      },
    ]) {
      assert.deepEqual(designConclusionWrite(fields), { error: "invalid" });
    }
  });

  it("shows success only once the API confirms it", () => {
    assert.equal(designConclusionNoticeFor("sign", 200, ""), "dc-signed");
    assert.equal(designConclusionNoticeFor("reopen", 200, ""), "dc-reopened");
    assert.equal(
      designConclusionNoticeFor(
        "sign",
        409,
        "you prepared the design workpaper; another reviewer must sign off",
      ),
      "dc-denied",
    );
    assert.equal(
      designConclusionNoticeFor("sign", 409, "the design workpaper changed"),
      "dc-blocked",
    );
    assert.equal(designConclusionNoticeFor("sign", 422, ""), "dc-invalid");
    assert.equal(
      designConclusionNoticeFor("sign", 402, "subscription inactive"),
      "dc-trial-ended",
    );
    assert.equal(designConclusionNoticeFor("sign", 0, ""), "dc-unavailable");
  });
});

// The preparer concludes; the agent proposes (product owner, 15 November 2026;
// docs/design-workpaper.md, section 3.6). The body gains the proposal, the preparer's
// choice and the design and implementation results; the web reads them cautiously, says
// before anything is sent what the server would refuse, and builds the one write.

const CHOICE = "01900000-0000-7000-8000-000000000006";
const choice = {
  id: CHOICE,
  kind: "EXCEPTIONS_NOTED",
  basis: null,
  reason: "The late removal was a holiday; access was not used.",
  proposed_kind: "EXCEPTIONS_NOTED",
  recorded_by: "Dana Preparer",
  recorded_at: "2026-11-15T10:00:00Z",
  workpaper_version: 3,
};
const designed = {
  result: "DESIGNED",
  sentence:
    "Every attribute is shown, as designed or in the instance, or closed by a tickmark.",
  open: [],
};
const inPlace = {
  result: "IN_PLACE",
  sentence:
    "Every attribute is shown in the records of the instance, or closed by a tickmark.",
  open: [],
};

const facts = (over: Partial<ChoiceFacts> = {}): ChoiceFacts => ({
  deficiency: false,
  exceptions: [],
  design: "DESIGNED",
  implementation: "IN_PLACE",
  implementationOpen: [],
  ...over,
});

describe("the preparer's conclusion: reading it", () => {
  it("has exactly the contract's words", () => {
    assert.deepEqual(CONCLUSION_KINDS, [
      "EFFECTIVE",
      "EXCEPTIONS_NOTED",
      "NOT_EFFECTIVE",
      "NO_INSTANCE",
      "NOT_CONCLUDED",
    ]);
    assert.deepEqual(CONCLUSION_WORDS, {
      EFFECTIVE: "Effective",
      EXCEPTIONS_NOTED: "Exceptions noted",
      NOT_EFFECTIVE: "Not effective",
      NO_INSTANCE: "Design effective, no instance to walk through",
      NOT_CONCLUDED: "Not concluded",
    });
    assert.deepEqual(BASIS_WORDS, {
      DESIGN: "Design",
      IMPLEMENTATION: "Implementation",
      BOTH: "Design and implementation",
    });
  });

  it("reads the proposal, the choice, the results and the signed conclusion", () => {
    const parsed = parseDesignConclusion(
      body({
        proposed_conclusion: "EXCEPTIONS_NOTED",
        proposed_reasons: ["An exception stands on attribute B.", 7, ""],
        choice,
        can_choose: true,
        design: { ...designed, result: "EXCEPTIONS", open: ["B"] },
        implementation: inPlace,
        signed: {
          ...signoff,
          verdict: "EFFECTIVE",
          conclusion: "EXCEPTIONS_NOTED",
          reason: "Why.",
        },
      }),
    );
    assert.ok(parsed !== null);
    assert.equal(parsed.proposedConclusion, "EXCEPTIONS_NOTED");
    assert.deepEqual(parsed.proposedReasons, [
      "An exception stands on attribute B.",
    ]);
    assert.deepEqual(parsed.choice, {
      id: CHOICE,
      kind: "EXCEPTIONS_NOTED",
      basis: null,
      reason: "The late removal was a holiday; access was not used.",
      proposedKind: "EXCEPTIONS_NOTED",
      recordedBy: "Dana Preparer",
      recordedAt: "2026-11-15T10:00:00Z",
      workpaperVersion: 3,
    });
    assert.equal(parsed.canChoose, true);
    assert.equal(parsed.design?.result, "EXCEPTIONS");
    assert.deepEqual(parsed.design?.open, ["B"]);
    assert.equal(parsed.implementation?.result, "IN_PLACE");
    assert.equal(parsed.signed?.conclusion, "EXCEPTIONS_NOTED");
  });

  it("never reads an unknown kind as effective, and a missing field as null", () => {
    const old = parseDesignConclusion(body());
    assert.ok(old !== null);
    assert.equal(old.proposedConclusion, null);
    assert.deepEqual(old.proposedReasons, []);
    assert.equal(old.choice, null);
    assert.equal(old.canChoose, false);
    assert.equal(old.design, null);
    assert.equal(old.implementation, null);
    assert.equal(old.signed, null);
    const odd = parseDesignConclusion(
      body({
        proposed_conclusion: "MOSTLY_EFFECTIVE",
        choice: { ...choice, kind: "PASS" },
        can_choose: "yes",
        design: { result: "FINE", sentence: "x", open: [] },
        signed: { ...signoff, verdict: "EFFECTIVE", conclusion: "GREAT" },
      }),
    );
    assert.ok(odd !== null);
    assert.equal(odd.proposedConclusion, null);
    assert.equal(odd.choice, null);
    assert.equal(odd.canChoose, false);
    assert.equal(odd.design, null);
    assert.equal(odd.signed?.conclusion, null);
    // A choice without a real id is not one; a basis is read only of "Not effective".
    assert.equal(
      parseDesignConclusion(body({ choice: { ...choice, id: "1" } }))?.choice,
      null,
    );
    assert.equal(
      parseDesignConclusion(body({ choice: { ...choice, basis: "DESIGN" } }))
        ?.choice?.basis,
      null,
    );
    assert.equal(
      parseDesignConclusion(
        body({ choice: { ...choice, kind: "NOT_EFFECTIVE", basis: "BOTH" } }),
      )?.choice?.basis,
      "BOTH",
    );
    // A signed conclusion that disagrees with the verdict the OE gate reads is not
    // trusted: the sign-off is read by its verdict alone.
    assert.equal(
      parseDesignConclusion(
        body({
          signed: {
            ...signoff,
            verdict: "EFFECTIVE",
            conclusion: "NOT_EFFECTIVE",
          },
        }),
      )?.signed?.conclusion,
      null,
    );
  });

  it("words the step's card from the preparer's conclusion, said once", () => {
    const read = (over: Record<string, unknown>) => {
      const parsed = parseDesignConclusion(body(over));
      assert.ok(parsed !== null);
      return parsed;
    };
    const toSign = conclusionHead(
      read({ choice, proposed_conclusion: "EXCEPTIONS_NOTED" }),
    );
    assert.equal(toSign.word, "Exceptions noted");
    assert.equal(toSign.status, "Awaiting reviewer sign-off");
    // Exceptions noted is never the green of effective.
    assert.equal(toSign.tone, "none");
    const signed = conclusionHead(
      read({
        status: "SIGNED_OFF",
        choice: { ...choice, kind: "NO_INSTANCE" },
        signed: { ...signoff, verdict: "EFFECTIVE", conclusion: "NO_INSTANCE" },
      }),
    );
    assert.equal(signed.word, "Design effective, no instance to walk through");
    assert.equal(signed.tone, "effective");
    assert.match(signed.effect, /cleared to proceed/);
    const notConcluded = conclusionHead(
      read({ choice: { ...choice, kind: "NOT_CONCLUDED" } }),
    );
    assert.equal(notConcluded.word, "Not concluded");
    assert.match(notConcluded.effect, /never signed off/);
    // An exception that holds an effective choice: the choice is still what is said,
    // with the exception's status and reasons, never the green of effective.
    const held = conclusionHead(
      read({
        choice: { ...choice, kind: "EFFECTIVE" },
        blocking: [
          "An exception is recorded on attribute B. Log a design deficiency for it, or change the tickmark with your reason.",
        ],
      }),
    );
    assert.equal(held.word, "Effective");
    assert.equal(held.tone, "excepted");
    assert.equal(held.status, "Exception recorded: not ready to sign");
  });

  it("says the server's new fragments as the page's sentences, or not where said already", () => {
    const parsed = parseDesignConclusion(
      body({
        can_sign: false,
        blocking: [
          "the preparer has not recorded a conclusion",
          "log the design deficiency first",
        ],
      }),
    );
    assert.ok(parsed !== null);
    assert.deepEqual(holdsBelow(parsed), [
      "A conclusion of “Not effective” is signed off once the design deficiency is logged.",
    ]);
  });
});

describe("the preparer's conclusion: what stands in the way", () => {
  const draft = (over: Record<string, unknown> = {}) => ({
    kind: null,
    basis: null,
    reason: "",
    ...over,
  });

  it("offers every conclusion where the records allow it", () => {
    const problems = choiceProblems(draft(), "EFFECTIVE", facts());
    for (const kind of CONCLUSION_KINDS) {
      assert.equal(problems.unavailable[kind], "", kind);
    }
    assert.equal(problems.kind, "Choose a conclusion.");
    assert.equal(problems.ready, false);
    const chosen = choiceProblems(
      draft({ kind: "EFFECTIVE" }),
      "EFFECTIVE",
      facts(),
    );
    // Effective as proposed needs no reason.
    assert.equal(chosen.reasonNeeded, false);
    assert.equal(chosen.ready, true);
  });

  it("mirrors the server's refusals, each with its sentence", () => {
    const deficiency = choiceProblems(
      draft(),
      "NOT_EFFECTIVE",
      facts({ deficiency: true }),
    ).unavailable;
    assert.equal(
      deficiency.EFFECTIVE,
      "A design deficiency is logged, so the conclusion cannot be “Effective”.",
    );
    assert.equal(
      deficiency.EXCEPTIONS_NOTED,
      "A design deficiency is logged, so the conclusion cannot be “Exceptions noted”.",
    );
    assert.equal(
      deficiency.NO_INSTANCE,
      "A design deficiency is logged, so the conclusion cannot be “Design effective, no instance to walk through”.",
    );
    assert.equal(deficiency.NOT_EFFECTIVE, "");
    assert.equal(deficiency.NOT_CONCLUDED, "");

    const excepted = choiceProblems(
      draft(),
      "EXCEPTIONS_NOTED",
      facts({
        exceptions: ["A", "C"],
        design: "EXCEPTIONS",
        implementation: "EXCEPTIONS",
      }),
    ).unavailable;
    assert.equal(
      excepted.EFFECTIVE,
      "An exception stands on attributes A and C, so the conclusion cannot be “Effective”.",
    );
    assert.equal(excepted.EXCEPTIONS_NOTED, "");
    // No instance says the design is effective: not while the design is not DESIGNED.
    assert.equal(
      excepted.NO_INSTANCE,
      "The design is not shown yet: Design effective needs every attribute shown as designed or settled by a tickmark.",
    );

    const open = choiceProblems(
      draft(),
      "NOT_CONCLUDED",
      facts({
        design: "DESIGNED",
        implementation: "OPEN",
        implementationOpen: ["B"],
      }),
    ).unavailable;
    assert.equal(
      open.EFFECTIVE,
      "Attribute B is not yet shown in the records of an instance, so the conclusion cannot be “Effective”.",
    );
    // Designed, with no instance: no instance is offered.
    assert.equal(open.NO_INSTANCE, "");
    const none = choiceProblems(
      draft(),
      "NOT_CONCLUDED",
      facts({ design: "OPEN", implementation: "OPEN" }),
    ).unavailable;
    assert.match(
      none.EFFECTIVE,
      /^No attribute of the control is approved yet/,
    );
    // Results not known: effective and no instance are never offered on a guess.
    const unknown = choiceProblems(
      draft(),
      null,
      facts({ design: null, implementation: null }),
    ).unavailable;
    assert.notEqual(unknown.EFFECTIVE, "");
    assert.notEqual(unknown.NO_INSTANCE, "");
  });

  it("needs a basis for not effective, and a reason of 10 to 1000 characters where 3.6 does", () => {
    const notEffective = choiceProblems(
      draft({ kind: "NOT_EFFECTIVE" }),
      "NOT_EFFECTIVE",
      facts({ deficiency: true }),
    );
    assert.equal(
      notEffective.basis,
      "Say whether the design, the implementation or both are not effective.",
    );
    assert.equal(notEffective.reasonNeeded, true);
    assert.equal(
      notEffective.reason,
      "Give the reason in a sentence of at least 10 characters.",
    );
    assert.equal(notEffective.ready, false);
    assert.equal(
      choiceProblems(
        draft({
          kind: "NOT_EFFECTIVE",
          basis: "DESIGN",
          reason: "The design lacks a second approval.",
        }),
        "NOT_EFFECTIVE",
        facts({ deficiency: true }),
      ).ready,
      true,
    );
    for (const kind of ["EXCEPTIONS_NOTED", "NO_INSTANCE"] as const) {
      const always = choiceProblems(draft({ kind }), kind, facts());
      assert.equal(always.reasonNeeded, true, kind);
      assert.equal(always.ready, false, kind);
    }
    // Effective or not concluded where they differ from the proposal: a reason, and the
    // label says why.
    const differs = choiceProblems(
      draft({ kind: "NOT_CONCLUDED", reason: "short" }),
      "EFFECTIVE",
      facts(),
    );
    assert.equal(differs.reasonNeeded, true);
    assert.match(
      differs.reasonWhy,
      /differs from the agent's proposal \(Effective\)/,
    );
    assert.equal(differs.ready, false);
    assert.equal(
      choiceProblems(draft({ kind: "NOT_CONCLUDED" }), "NOT_CONCLUDED", facts())
        .reasonNeeded,
      false,
    );
    // Where no reason is needed, what was typed for another conclusion is not asked
    // about (its box is not shown, and it is not sent).
    const leftover = choiceProblems(
      draft({ kind: "NOT_CONCLUDED", reason: "short" }),
      "NOT_CONCLUDED",
      facts(),
    );
    assert.equal(leftover.reason, "");
    assert.equal(leftover.ready, true);
    // Too long, or a credential: refused before it is sent.
    assert.match(
      choiceProblems(
        draft({ kind: "EXCEPTIONS_NOTED", reason: "x".repeat(1001) }),
        "EXCEPTIONS_NOTED",
        facts(),
      ).reason,
      /at most 1,000 characters/,
    );
    assert.match(
      choiceProblems(
        draft({ kind: "EXCEPTIONS_NOTED", reason: "password: hunter2hunter2" }),
        "EXCEPTIONS_NOTED",
        facts(),
      ).reason,
      /credential/,
    );
  });
});

describe("the preparer's conclusion: the write", () => {
  const ids = {
    organization_id: ORG,
    project_id: PROJECT,
    control_id: CONTROL,
  };
  const path = `/organizations/${ORG}/projects/${PROJECT}/design-conclusions/${CONTROL}/choice`;

  it("sends exactly {kind, basis?, reason?, replaces}", () => {
    assert.deepEqual(
      choiceWrite({ ...ids, kind: "EFFECTIVE", replaces: null }),
      { path, body: { kind: "EFFECTIVE", replaces: null }, controlId: CONTROL },
    );
    assert.deepEqual(
      choiceWrite({
        ...ids,
        kind: "NOT_EFFECTIVE",
        basis: "BOTH",
        reason: "  Neither the design nor the instance holds.  ",
        replaces: CHOICE,
      }),
      {
        path,
        body: {
          kind: "NOT_EFFECTIVE",
          basis: "BOTH",
          reason: "Neither the design nor the instance holds.",
          replaces: CHOICE,
        },
        controlId: CONTROL,
      },
    );
    // Nothing else is passed on, whatever the page was sent.
    const write = choiceWrite({
      ...ids,
      kind: "EFFECTIVE",
      replaces: null,
      verdict: "EFFECTIVE",
      recorded_by: "someone",
    });
    assert.ok(!("error" in write));
    assert.deepEqual(Object.keys(write.body), ["kind", "replaces"]);
  });

  it("refuses what is not one of the five, an odd basis, a long reason or a bad id", () => {
    for (const fields of [
      { ...ids, kind: "MAYBE", replaces: null },
      { ...ids, kind: "EFFECTIVE" },
      { ...ids, kind: "EFFECTIVE", replaces: "not-an-id" },
      { ...ids, kind: "EFFECTIVE", basis: "DESIGN", replaces: null },
      { ...ids, kind: "NOT_EFFECTIVE", basis: "PARTLY", replaces: null },
      {
        ...ids,
        kind: "EXCEPTIONS_NOTED",
        reason: "x".repeat(1001),
        replaces: null,
      },
      { ...ids, kind: "EXCEPTIONS_NOTED", reason: 12, replaces: null },
      {
        ...ids,
        kind: "EXCEPTIONS_NOTED",
        reason: "api_key=abcdef123456",
        replaces: null,
      },
      { ...ids, control_id: "../../users", kind: "EFFECTIVE", replaces: null },
    ]) {
      assert.deepEqual(choiceWrite(fields), { error: "invalid" });
    }
  });

  it("says the server's refusal, and only success on 200", () => {
    assert.equal(choiceRefusal(200, ""), "");
    assert.equal(
      choiceRefusal(
        409,
        "a design deficiency is logged, so the conclusion cannot be “Effective”",
      ),
      "Not recorded: a design deficiency is logged, so the conclusion cannot be “Effective”.",
    );
    assert.equal(
      choiceRefusal(
        422,
        "give the reason in a sentence of at least 10 characters",
      ),
      "Not recorded: give the reason in a sentence of at least 10 characters.",
    );
    assert.match(choiceRefusal(401, ""), /session has ended/);
    assert.match(choiceRefusal(0, ""), /could not be reached/);
  });
});
