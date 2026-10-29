import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  alternativesFor,
  asksForDocument,
  categoryOf,
  documentsFor,
  initialsOf,
  isQuestion,
  nextQuestion,
  pointAnswers,
  pointsSaid,
  progressSegments,
  suggestionFor,
  type WalkProposal,
  type WalkSlot,
  walkPoints,
  walkProgress,
  walkSettled,
  walkSlots,
  walkStatus,
} from "../apps/web/src/client-walkthrough-model.ts";
import { withoutCodes } from "../apps/web/src/control-context-model.ts";

// The client-specific walkthrough (decided by the product owner on 26 October 2026): the
// questions asked one at a time, each with an answer to start from that only the records
// suggest, saved as it is confirmed.

const slot = (key: string, extra: Partial<WalkSlot> = {}): WalkSlot => ({
  key,
  question: `Question ${key}?`,
  hint: "",
  example: "",
  options: [],
  blocks: false,
  value: "",
  filledBy: null,
  ...extra,
});

describe("the walkthrough's suggestions", () => {
  const proposals: WalkProposal[] = [
    {
      id: "p1",
      slotKey: "approver",
      value: "IT Security Manager",
      quote: "Access is approved by the IT Security Manager.",
      status: "PROPOSED",
    },
    {
      id: "p2",
      slotKey: "tool",
      value: "Jira",
      quote: "",
      status: "DISMISSED",
    },
  ];

  it("starts from the agent's prior-year proposal, with its passage", () => {
    const found = suggestionFor(
      slot("approver", { options: ["Line manager"] }),
      proposals,
    );
    assert.equal(found?.value, "IT Security Manager");
    assert.equal(found?.source, "PRIOR_YEAR");
    assert.equal(found?.proposalId, "p1");
    assert.equal(
      found?.quote,
      "Access is approved by the IT Security Manager.",
    );
  });

  it("falls back to the usual answer, never to a dismissed proposal", () => {
    const found = suggestionFor(
      slot("tool", { options: ["ServiceNow", "Jira"] }),
      proposals,
    );
    assert.deepEqual(
      [found?.value, found?.source, found?.proposalId, found?.label],
      ["ServiceNow", "USUAL", null, "The usual answer, one of 2"],
    );
  });

  it("suggests nothing where only the client's documents can answer", () => {
    assert.equal(suggestionFor(slot("threshold"), []), null);
  });

  it("offers the other usual answers to choose from", () => {
    const item = slot("tool", {
      options: ["ServiceNow", "Jira", "servicenow"],
    });
    assert.deepEqual(alternativesFor(item, suggestionFor(item, [])), ["Jira"]);
  });
});

describe("the walkthrough's order and progress", () => {
  const slots = [
    slot("a", { value: "Done", blocks: true }),
    slot("b", { blocks: true }),
    slot("c"),
    slot("d"),
  ];

  it("asks the first open question, then the next, skipped ones last", () => {
    assert.equal(nextQuestion(slots, new Set()), "b");
    assert.equal(nextQuestion(slots, new Set(), "b"), "c");
    assert.equal(nextQuestion(slots, new Set(["c"]), "b"), "d");
    // Every other open question skipped: the skipped one comes back.
    assert.equal(nextQuestion(slots, new Set(["c", "d"]), "b"), "c");
    // An answer saved this session counts before the page has refreshed.
    assert.equal(nextQuestion(slots, new Set(), "b", new Set(["c"])), "d");
    assert.equal(nextQuestion([slot("x", { value: "1" })], new Set()), null);
  });

  it("says where each question stands", () => {
    assert.equal(walkStatus(slots[0] as WalkSlot, "b", new Set()), "CONFIRMED");
    assert.equal(
      walkStatus(slots[1] as WalkSlot, "b", new Set()),
      "IN_PROGRESS",
    );
    assert.equal(
      walkStatus(slots[2] as WalkSlot, "b", new Set(["c"])),
      "SKIPPED",
    );
    assert.equal(walkStatus(slots[3] as WalkSlot, "b", new Set()), "PENDING");
  });

  it("filters to the required or the open questions, and counts progress", () => {
    assert.deepEqual(
      walkSlots(slots, "required").map((item) => item.key),
      ["a", "b"],
    );
    assert.deepEqual(
      walkSlots(slots, "open").map((item) => item.key),
      ["b", "c", "d"],
    );
    assert.deepEqual(walkProgress(slots), { done: 1, total: 4, percent: 25 });
    assert.deepEqual(walkProgress([]), { done: 0, total: 0, percent: 0 });
  });

  it("tells a question for the agent from an answer", () => {
    assert.equal(isQuestion("Why does this matter?"), true);
    assert.equal(isQuestion("What does the policy say"), true);
    assert.equal(isQuestion("IT Security Manager"), false);
    assert.equal(isQuestion("ServiceNow and Jira"), false);
  });
});

describe("the walkthrough's documents", () => {
  const documents = [
    {
      id: "n",
      title: "Order to cash narrative",
      detail: "",
      kind: "NARRATIVE",
    },
    {
      id: "p",
      title: "Access Management Procedure",
      detail: "",
      kind: "PROCEDURE",
    },
    {
      id: "s",
      title: "Access Management Standard",
      detail: "",
      kind: "POLICY",
    },
  ];

  it("offers the control's policies, then procedures, to a document question", () => {
    const question = slot("access-policy", {
      question: "Which policy sets who may approve access, and to what?",
    });
    assert.equal(asksForDocument(question), true);
    assert.deepEqual(
      documentsFor(question, documents).map((item) => item.id),
      ["s", "p"],
    );
  });

  it("offers no document to any other question", () => {
    const question = slot("approver", { question: "Who approves new access?" });
    assert.equal(asksForDocument(question), false);
    assert.deepEqual(documentsFor(question, documents), []);
  });

  it("makes initials from a name or an address", () => {
    assert.equal(initialsOf("Robert John Manager"), "RJ");
    assert.equal(initialsOf("robert.manager@example.com"), "RM");
    assert.equal(initialsOf(""), "?");
  });
});

// The rules that give the conversation its room (product owner, 26 October 2026: "the chat
// are getting hidden due to limited space"; "just dont want it to have issues with space
// when words are long"). The layout itself was checked in a browser with long answers and
// file names; this keeps the rules from being dropped.
describe("walkthrough layout", () => {
  const css = readFileSync("apps/web/app/client-walkthrough.css", "utf8");
  const rule = (selector: string): string => {
    const start = css.indexOf(`${selector} {`);
    assert.ok(start >= 0, `no rule for ${selector}`);
    return css.slice(start, css.indexOf("}", start));
  };

  it("leaves the assistant's column where it is", () => {
    // Moving it below the plan put it under the section menu, out of line with the page.
    assert.ok(!css.includes(".cw-layout:has(.cc-walk)"));
  });

  it("puts the narrative below the conversation, each the section's full width", () => {
    assert.match(rule(".cc-walk"), /display: grid/);
    // No rule ever sets the walkthrough in columns.
    assert.ok(!/\.cc-walk \{[^}]*grid-template-columns/.test(css));
  });

  it("scrolls with the page: the conversation is not pinned", () => {
    assert.ok(!css.includes("position: sticky"));
  });

  it("breaks long words and wraps long answers inside the conversation", () => {
    // break-word, not anywhere: "anywhere" let the next question shrink to a letter per
    // line beside its hint (product owner's screenshot, 26 October 2026).
    assert.match(css, /\n\.wt \{\n {2}overflow-wrap: break-word;/);
    assert.match(rule(".wt-say .wt-next"), /display: block/);
    // Scoped under .wt so it outranks the chips' own fixed height later in the file.
    const chips = rule(".wt .wt-chip,\n.wt .wt-choice");
    assert.match(chips, /white-space: normal/);
    assert.match(chips, /height: auto/);
    assert.match(chips, /max-width: 100%/);
  });
});

// The process narrative replaces the control design narrative in the Plan step (product
// owner, 26 October 2026: "dont need this section since i have the process narrative").
describe("one narrative in the Plan step", () => {
  it("shows the process narrative and not the control design narrative", () => {
    const views = [
      "control-context-view.tsx",
      "controls-view.tsx",
      "planning-view.tsx",
    ]
      .map((file) => readFileSync(`apps/web/src/${file}`, "utf8"))
      .join("\n");
    assert.ok(!views.includes("Control design narrative"));
    assert.ok(!views.includes("DesignNarrative"));
    assert.ok(views.includes("<ProcessNarrative"));
  });
});

// The narrative's points, confirmed as one decision (decided by the product owner on 26
// October 2026): a statement to confirm, or the question asked open.
describe("points to confirm", () => {
  const issue = {
    id: "i1",
    version: 1,
    status: "OPEN",
    topic: "Evidence of the check",
    question: "Where is the check recorded?",
    why: "A1 needs evidence.",
    proposal: "Role owners sign the listing in ServiceNow.",
    proposalBasis: "SOURCES" as const,
    suggestions: [] as string[],
    section: "RECORDING",
    attributes: ["A1"],
    pointKind: "MISSING",
  };
  const headings = { RECORDING: "Recording and evidence" };

  it("takes only the points still waiting, with their section heading", () => {
    const points = walkPoints(
      [
        issue,
        { ...issue, id: "i2", status: "RESOLVED" },
        { ...issue, id: "i3", question: "" },
        { ...issue, id: "i4", proposal: "", pointKind: "CONTRADICTION" },
      ],
      headings,
    );
    assert.deepEqual(
      points.map((point) => [point.id, point.section, point.contradiction]),
      [
        ["i1", "Recording and evidence", false],
        ["i4", "Recording and evidence", true],
      ],
    );
  });

  it("sends each statement as confirmed, or its correction, and waits for open ones", () => {
    const points = walkPoints(
      [issue, { ...issue, id: "i2", proposal: "" }],
      headings,
    );
    assert.equal(pointAnswers(points, {}), null);
    assert.deepEqual(pointAnswers(points, { i2: " Kept in SharePoint. " }), [
      {
        issue_id: "i1",
        version: 1,
        answer: "Role owners sign the listing in ServiceNow.",
      },
      { issue_id: "i2", version: 1, answer: "Kept in SharePoint." },
    ]);
    const [first] = points;
    assert.ok(first !== undefined);
    assert.equal(pointsSaid([first], {}), "Confirmed 1 point.");
    assert.equal(
      pointsSaid(points, { i2: "Kept in SharePoint." }),
      "Confirmed 1 point and corrected 1.",
    );
  });

  // Decided by the product owner on 27 October 2026 ("Agent should always be able to
  // provide a suggestion based on the nature of the controls"): a statement says where it
  // comes from, and other common answers are picked, not written.
  it("says where a statement comes from and offers the other answers to pick", () => {
    const [typical, sourced, earlier, open] = walkPoints(
      [
        {
          ...issue,
          proposalBasis: "TYPICAL",
          suggestions: [
            "A system-enforced workflow in ServiceNow",
            " ",
            "Role owners sign the listing in ServiceNow.",
          ],
        },
        { ...issue, id: "i2" },
        { ...issue, id: "i3", proposalBasis: "" },
        { ...issue, id: "i4", proposal: "", proposalBasis: "" },
      ],
      headings,
    );
    assert.deepEqual(
      [typical?.basis, sourced?.basis, earlier?.basis, open?.basis],
      ["TYPICAL", "SOURCES", "TYPICAL", ""],
    );
    // The statement itself and blanks are not offered again as alternatives.
    assert.deepEqual(typical?.options, [
      "A system-enforced workflow in ServiceNow",
    ]);
    // A picked alternative is sent as the correction.
    assert.ok(typical !== undefined);
    assert.deepEqual(
      pointAnswers([typical], {
        i1: "A system-enforced workflow in ServiceNow",
      }),
      [
        {
          issue_id: "i1",
          version: 1,
          answer: "A system-enforced workflow in ServiceNow",
        },
      ],
    );
    const source = readFileSync("apps/web/src/client-walkthrough.tsx", "utf8");
    assert.ok(source.includes("Typical for this control"));
    assert.ok(source.includes("Other answers"));
  });

  it("records each answer and opens the next question in the card", () => {
    // Rewritten for the product owner's reference of 28 October 2026, which replaced the
    // conversation with one question at a time beside the understanding so far. Was: the
    // next question appended to the conversation as its own card ({ who: "agent", kind:
    // "ask", key: next }) and "below this conversation". Now: the answer is recorded in
    // words under the card and the next question takes its place. The method is the same:
    // each answer saved as it is confirmed, then the next unanswered question.
    const source = readFileSync("apps/web/src/client-walkthrough.tsx", "utf8");
    assert.ok(!source.includes("Next: <strong>"));
    assert.match(source, /text: `Recorded: \$\{value\}\.`/);
    assert.ok(source.includes("setCurrent(next);"));
    assert.ok(!source.includes("beside this conversation"));
  });
});

// The narrative reads as a document (product owner, 27 October 2026, from a reference):
// a title with the system and control, numbered sections, the attribute codes on request.
describe("the narrative as a document", () => {
  it("titles it, numbers its sections, and shows the codes only when asked", () => {
    const source = readFileSync("apps/web/src/process-narrative.tsx", "utf8");
    assert.ok(source.includes("Control narrative"));
    assert.ok(source.includes('String(index + 1).padStart(2, "0")'));
    assert.ok(source.includes("Show attributes"));
    assert.ok(source.includes('role="switch"'));
    assert.ok(
      source.includes("const [showCodes, setShowCodes] = useState(false);"),
    );
    // On, each section's codes sit beside its heading as chips, the wording on hover, and
    // a picked code is highlighted in every section that explains it.
    assert.ok(source.includes('focus === code ? " is-on" : ""'));
    assert.ok(source.includes("pn-doc-chip"));
    assert.ok(source.includes("setFocus(focus === code ? null : code)"));
    assert.ok(!source.includes('pn-doc-code"'));
    // The codes the agents cite in the text are hidden with the switch off, and the text
    // around them is untouched.
    assert.equal(
      withoutCodes(
        "The manager approves (A2). The date is kept (A2, A3) and compared (A4 and A5). See (Appendix).",
      ),
      "The manager approves. The date is kept and compared. See (Appendix).",
    );
    // The text reads without the codes it cites, the switch on or off.
    assert.ok(source.includes("<p>{withoutCodes(item.text)}</p>"));
    const controls = readFileSync("apps/web/src/controls-view.tsx", "utf8");
    assert.ok(
      controls.includes("subtitle: [control.applicationName, control.title]"),
    );
  });
});

// Approving shows that it happened (product owner, 26 October 2026: "approving the narrative
// does not provide a great UX. just update the status without showing any other signs").
describe("approving the narrative", () => {
  const view = readFileSync("apps/web/src/process-narrative.tsx", "utf8");

  it("says it is approving, then shows the approval where the buttons were", () => {
    for (const words of [
      '"Approving…"',
      "Narrative approved",
      "Make changes",
      '"Approve the changes"',
      "approved && !editing",
    ]) {
      assert.ok(view.includes(words), words);
    }
    // The state is a badge, not a word in brackets.
    assert.ok(view.includes("pn-status"));
    assert.ok(!view.includes('"approved" : "draft"'));
  });
});

// Once the narrative is approved and nothing waits, the conversation folds to one line;
// an answer saved after the approval is named, so the narrative is redrafted to match
// (product owner, 27 October 2026).
describe("the answers once the narrative is approved", () => {
  const slots = [
    {
      question: "Who approves access?",
      value: "IT manager",
      filledAt: "2026-10-20T10:00:00Z",
    },
    {
      question: "Where are requests raised?",
      value: "Service desk",
      filledAt: "2026-10-27T09:00:00Z",
    },
  ];
  const approved = { status: "CONFIRMED", confirmedAt: "2026-10-26T12:00:00Z" };

  it("folds when approved, every question answered and no point waiting", () => {
    assert.equal(walkSettled(slots, approved, 0).settled, true);
    assert.equal(walkSettled(slots, approved, 0).answered, 2);
    // A draft narrative, a point waiting or a question unanswered keeps it open.
    assert.equal(
      walkSettled(slots, { ...approved, status: "DRAFT" }, 0).settled,
      false,
    );
    assert.equal(walkSettled(slots, approved, 1).settled, false);
    assert.equal(
      walkSettled(
        [...slots, { question: "How often?", value: "", filledAt: "" }],
        approved,
        0,
      ).settled,
      false,
    );
  });

  it("names each answer saved after the approval, and none for a draft", () => {
    assert.deepEqual(walkSettled(slots, approved, 0).changed, [
      "Where are requests raised?",
    ]);
    assert.deepEqual(
      walkSettled(slots, { status: "DRAFT", confirmedAt: "" }, 0).changed,
      [],
    );
    const view = readFileSync("apps/web/src/control-context-view.tsx", "utf8");
    assert.ok(view.includes("View or change answers"));
    const narrative = readFileSync(
      "apps/web/src/process-narrative.tsx",
      "utf8",
    );
    assert.ok(narrative.includes("Redraft to match"));
  });
});

// The product owner's reference (28 October 2026): one question at a time with its category,
// beside the understanding so far, each answer under what it covers.
describe("control understanding", () => {
  const slot = (kind: string, label: string, question = "") => ({
    key: "k",
    question,
    kind,
    label,
  });

  it("names what each question covers from the value's own name", () => {
    assert.deepEqual(categoryOf(slot("SYSTEM", "the access request tool")), {
      label: "Request channel",
      icon: "file",
    });
    assert.equal(
      categoryOf(slot("ROLE", "the role that approves privileged access"))
        .label,
      "Approval authority",
    );
    // The question may mention approval; the value is who grants.
    assert.equal(
      categoryOf(
        slot(
          "ROLE",
          "the role that administers user access",
          "Who grants access once it is approved?",
        ),
      ).label,
      "Access provisioner",
    );
    assert.equal(
      categoryOf(slot("ROLE", "the control owner for user access")).label,
      "Control owner",
    );
    assert.equal(
      categoryOf(slot("ROLE", "the role that reviews access")).label,
      "Reviewer",
    );
    assert.equal(
      categoryOf(slot("SYSTEM", "the HR system")).label,
      "HR source",
    );
    assert.equal(
      categoryOf(slot("TEXT", "the access management policy")).label,
      "Governing policy",
    );
    assert.equal(
      categoryOf(slot("TEXT", "how often IT receives terminations")).label,
      "Frequency",
    );
    assert.equal(
      categoryOf(slot("DAYS", "the removal period")).label,
      "Timeline",
    );
    assert.equal(
      categoryOf(slot("TEXT", "the escalation contact")).label,
      "Escalation contact",
    );
  });

  it("shows one segment a question, filled as answered, at most twelve", () => {
    assert.deepEqual(progressSegments(2, 4), [true, true, false, false]);
    assert.deepEqual(progressSegments(0, 0), []);
    assert.equal(progressSegments(10, 24).length, 12);
    assert.equal(progressSegments(10, 24).filter(Boolean).length, 5);
  });

  it("lays out the question beside the understanding so far, as the reference", () => {
    const source = readFileSync("apps/web/src/client-walkthrough.tsx", "utf8");
    for (const words of [
      "Control understanding",
      "Understand how this control operates",
      "Understanding so far",
      "answers captured",
      "Draft insights",
      "Additional context (optional)",
      "Save &amp; continue",
      "Other (specify)",
      "Skip for now",
    ]) {
      assert.ok(source.includes(words), words);
    }
    // Context is kept where the narrative's agents read it; a question goes to the console.
    const view = readFileSync("apps/web/src/control-context-view.tsx", "utf8");
    assert.ok(view.includes('kind: "WALKTHROUGH"'));
    assert.ok(
      source.includes(
        "Questions about the control are answered in the agent console.",
      ),
    );
  });
});

// Found by the product owner (28 October 2026): a long answer ran past its card on the
// right, and some lines were smaller than the conversation they replaced.
describe("control understanding: text fits and keeps its size", () => {
  const css = readFileSync("apps/web/app/client-walkthrough.css", "utf8");
  const own = css.slice(
    css.indexOf("/* Control understanding: the product owner"),
  );
  const rule = (selector: string) => {
    const at = own.indexOf(`${selector} {`);
    return at < 0 ? "" : own.slice(at, own.indexOf("}", at));
  };

  it("wraps a long answer inside its card", () => {
    assert.match(rule(".cu-answers button"), /white-space: normal/);
    assert.match(rule(".cu-answer-text strong"), /overflow-wrap: anywhere/);
  });

  it("sets no text smaller than the conversation's 12.5px, but the uppercase labels", () => {
    assert.doesNotMatch(own, /font-size: var\(--fs-xs\)/);
    // Every rule at 11px is an uppercase label (the eyebrows and the category pill).
    const tiny = own
      .split("}")
      .filter((rule) => rule.includes("font-size: var(--fs-2xs)"));
    assert.ok(tiny.length >= 2);
    for (const rule of tiny) {
      assert.match(
        rule,
        /text-transform: uppercase/,
        rule.trim().split("\n")[0],
      );
    }
  });
});
