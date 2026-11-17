import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { sectionWrite } from "../apps/web/src/section-edit-model.ts";
import {
  answered,
  citedIn,
  draftChanged,
  draftUsed,
  editorText,
  FOLDED_BLOCKS,
  folded,
  keepMineRequest,
  keepMineWrite,
  mayRead,
  namedDraft,
  POLL_MS,
  parseProposal,
  parseProposalAnswer,
  pollDelay,
  proposalAnnouncement,
  proposalIdOf,
  proposalMeta,
  proposalOf,
  proposalPath,
  proposalQuery,
  redraftable,
  redraftProblem,
  redraftRequest,
  redraftWrite,
  SEQUENCE,
  sent,
  usedAfter,
  withProposal,
} from "../apps/web/src/section-redraft-model.ts";
import { copyWrite } from "../apps/web/src/working-copy-model.ts";
import { parseWorkpapers } from "../apps/web/src/workpaper-model.ts";

// Redrafting a section a person has edited (docs/design-workpaper.md, section 3.11;
// product owner, 16 November 2026: "Okay build it after the reorder"). The model must
// never: show as the agent's anything that is not of the proposal's shape, offer the
// redraft on a section the agent does not draft, put back a proposal a later request
// ended, send a request the route has not checked, or let a save name the agent's draft
// once the editor no longer holds it. Synthetic data only.

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [ORG, PROJECT, PAPER, PROPOSAL] = [uuid(1), uuid(2), uuid(7), uuid(9)];
const KEY = "understanding-of-the-control";

const READY_TEXT = [
  "ITGC-AC-01 is a manual, event-driven control over access to Workday [^1].",
  "The manager approves each request in ServiceNow [^2].",
  "Access is provisioned by the **Workday Security** team.",
  "The design addresses the risk.",
].join("\n\n");

const wire = (over: Record<string, unknown> = {}) => ({
  id: PROPOSAL,
  section_key: KEY,
  based_on: 4,
  status: "READY",
  text: READY_TEXT,
  citations: [
    {
      number: 1,
      evidence_file_id: uuid(21),
      file_name: "access-policy.pdf",
      quote: "All access requests require approval",
      location: "p. 2",
    },
    {
      number: 2,
      evidence_file_id: uuid(22),
      file_name: "ticket-export.csv",
      quote: "Approved by manager",
      location: "",
    },
    { number: 3, evidence_file_id: "not-an-id", file_name: "x" },
  ],
  words: 412,
  requested_at: "2026-11-16T17:40:00Z",
  ready_at: "2026-11-16T17:41:30Z",
  failure: "",
  removed_note: "",
  ...over,
});

describe("the proposal is read strictly", () => {
  it("reads a READY proposal, its text and its citations as a text section's", () => {
    const proposal = parseProposal(wire());
    assert.ok(proposal !== null);
    assert.equal(proposal.id, PROPOSAL);
    assert.equal(proposal.sectionKey, KEY);
    assert.equal(proposal.basedOn, 4);
    assert.equal(proposal.status, "READY");
    assert.equal(proposal.text, READY_TEXT);
    assert.equal(proposal.words, 412);
    assert.equal(proposal.readyAt, "2026-11-16T17:41:30Z");
    // A citation that is not of a file is dropped, as a text section's is.
    assert.deepEqual(
      proposal.citations.map((c) => [c.number, c.fileName, c.location]),
      [
        [1, "access-policy.pdf", "p. 2"],
        [2, "ticket-export.csv", ""],
      ],
    );
  });

  it("reads the server's own times, with microseconds and an offset", () => {
    const proposal = parseProposal(
      wire({
        requested_at: "2026-11-16T17:40:00.123456+00:00",
        ready_at: "2026-11-16T17:41:30.5+00:00",
      }),
    );
    assert.equal(proposal?.requestedAt, "2026-11-16T17:40:00.123456+00:00");
  });

  it("refuses anything not of the shape", () => {
    for (const over of [
      { id: "1" },
      { id: 7 },
      { section_key: "Understanding" },
      { section_key: "a/../b" },
      { based_on: 0 },
      { based_on: 1.5 },
      { status: "USED" },
      { status: "ready" },
      { text: 3 },
      { citations: "none" },
      { words: -1 },
      { words: "412" },
      { requested_at: "" },
      { requested_at: "yesterday" },
      { ready_at: "later" },
      { failure: null },
      { removed_note: 1 },
      // READY with nothing to show is not a draft.
      { text: "  " },
    ]) {
      assert.equal(parseProposal(wire(over)), null, JSON.stringify(over));
    }
    for (const value of [null, undefined, "x", 3, [], [wire()]]) {
      assert.equal(parseProposal(value), null);
    }
  });

  it("shows a text only for a READY one, and a failure only for a FAILED one", () => {
    const pending = parseProposal(
      wire({ status: "PENDING", text: "half", ready_at: null, failure: "x" }),
    );
    assert.ok(pending !== null);
    assert.equal(pending.text, "");
    assert.deepEqual(pending.citations, []);
    assert.equal(pending.failure, "");
    assert.equal(pending.readyAt, null);
    const failed = parseProposal(
      wire({
        status: "FAILED",
        text: "",
        ready_at: null,
        failure: " The agent could not reach the model. ",
      }),
    );
    assert.ok(failed !== null);
    assert.equal(failed.failure, "The agent could not reach the model.");
    assert.equal(failed.text, "");
  });

  it("reads the route's answer: a proposal of another shape is not taken as one", () => {
    assert.deepEqual(parseProposalAnswer({ status: 200, proposal: null }), {
      status: 200,
      detail: "",
      proposal: null,
    });
    const ready = parseProposalAnswer({ status: 200, proposal: wire() });
    assert.equal(ready.proposal?.id, PROPOSAL);
    assert.deepEqual(
      parseProposalAnswer({ status: 200, proposal: wire({ status: "x" }) }),
      { status: 0, detail: "", proposal: null },
    );
    // A refusal carries the server's sentence, and never a proposal.
    assert.deepEqual(
      parseProposalAnswer({
        status: 409,
        detail: "The workpaper is being drafted.",
        proposal: wire(),
      }),
      {
        status: 409,
        detail: "The workpaper is being drafted.",
        proposal: null,
      },
    );
    assert.deepEqual(parseProposalAnswer("oops"), {
      status: 0,
      detail: "",
      proposal: null,
    });
    // A proposal of another section is none of this editor's.
    assert.equal(proposalOf(ready, KEY)?.id, PROPOSAL);
    assert.equal(proposalOf(ready, "design-conclusion"), null);
  });
});

describe("which sections offer the redraft", () => {
  const section = (key: string, kind: string, narrative: unknown) =>
    parseWorkpapers([
      {
        id: PAPER,
        control_id: uuid(3),
        stage: "DESIGN",
        status: "DRAFT",
        current_version: 1,
        shown_version: 1,
        content: {
          sections: [{ key, title: key, kind, narrative, source: "PERSON" }],
        },
        versions: [],
      },
    ])?.[0]?.sections[0];

  it("reads narrative from the workpaper's body, false where it is not said", () => {
    assert.equal(section(KEY, "text", true)?.narrative, true);
    assert.equal(section(KEY, "text", false)?.narrative, false);
    assert.equal(section(KEY, "text", undefined)?.narrative, false);
    assert.equal(section(KEY, "text", "yes")?.narrative, false);
  });

  it("is a text narrative the agent drafts, whoever saved it last", () => {
    // A person's save (source PERSON) is exactly what the redraft is for.
    assert.equal(redraftable(section(KEY, "text", true), "DESIGN"), true);
    assert.equal(
      redraftable(section("design-conclusion", "text", true), "DESIGN"),
      true,
    );
    assert.equal(
      redraftable(section("testing-approach", "text", true), "EFFECTIVENESS"),
      true,
    );
  });

  it("is never a table, a form, a text the agent does not draft, or an effectiveness conclusion", () => {
    assert.equal(redraftable(section(KEY, "table", true), "DESIGN"), false);
    assert.equal(redraftable(section(KEY, "fields", true), "DESIGN"), false);
    assert.equal(redraftable(section(KEY, "text", false), "DESIGN"), false);
    assert.equal(
      redraftable(
        section("effectiveness-conclusion", "text", true),
        "EFFECTIVENESS",
      ),
      false,
    );
    assert.equal(redraftable(undefined, "DESIGN"), false);
  });
});

describe("the requests and the routes' checks", () => {
  const scope = { organizationId: ORG, projectId: PROJECT };
  const place = { workpaperId: PAPER, sectionKey: KEY };
  const base = `/organizations/${ORG}/projects/${PROJECT}/workpapers/${PAPER}/sections/${KEY}`;

  it("asks for a redraft at the workpaper's current version, as the editor shows it", () => {
    const body = redraftRequest(scope, place, 6);
    assert.deepEqual(redraftWrite(body), {
      path: `${base}/redraft`,
      body: { workpaper_version: 6 },
    });
    for (const over of [
      { workpaper_version: 0 },
      { workpaper_version: "6" },
      { workpaper_version: 1.5 },
      { organization_id: "x" },
      { section: "../drafts" },
      { section: "Understanding" },
      { workpaper_id: undefined },
    ]) {
      assert.deepEqual(redraftWrite({ ...body, ...over }), {
        error: "invalid",
      });
    }
  });

  it("reads the caller's proposal by the workpaper and the section", () => {
    const query = new URLSearchParams(proposalQuery(scope, place));
    assert.equal(proposalPath(query), `${base}/proposal`);
    query.set("section", "a/b");
    assert.equal(proposalPath(query), null);
    assert.equal(proposalPath(new URLSearchParams("")), null);
  });

  it("ends one as Keep mine by its id, with an empty body", () => {
    const body = keepMineRequest(scope, place, PROPOSAL);
    assert.deepEqual(keepMineWrite(body), {
      path: `${base}/proposal/${PROPOSAL}/keep-mine`,
      body: {},
    });
    assert.deepEqual(keepMineWrite({ ...body, proposal_id: "../../x" }), {
      error: "invalid",
    });
    assert.deepEqual(keepMineWrite({ ...body, proposal_id: undefined }), {
      error: "invalid",
    });
  });

  it("names the agent's draft in a save only where the editor holds it", () => {
    const save = {
      organization_id: ORG,
      project_id: PROJECT,
      workpaper_id: PAPER,
      section: KEY,
      based_on: 4,
      text: "Mine.",
    };
    assert.deepEqual(withProposal(save, null), save);
    const named = withProposal(save, { id: PROPOSAL });
    assert.equal(named.proposal_id, PROPOSAL);
    // The section route sends it on, checked; never anything that is not an id.
    assert.deepEqual(sectionWrite(named), {
      path: base,
      body: { based_on: 4, text: "Mine.", proposal_id: PROPOSAL },
    });
    assert.deepEqual(sectionWrite(save), {
      path: base,
      body: { based_on: 4, text: "Mine." },
    });
    assert.deepEqual(sectionWrite({ ...save, proposal_id: null }), {
      path: base,
      body: { based_on: 4, text: "Mine." },
    });
    for (const bad of ["x", 9, {}, "../keep-mine"]) {
      assert.deepEqual(sectionWrite({ ...save, proposal_id: bad }), {
        error: "invalid",
      });
    }
    assert.equal(proposalIdOf(undefined), null);
    assert.equal(proposalIdOf(PROPOSAL), PROPOSAL);
    // A working copy is never the save that names it.
    const kept = copyWrite({ intent: "keep", ...named });
    assert.ok(!("error" in kept));
    assert.ok(kept.method === "PUT" && !("proposal_id" in kept.body));
  });
});

describe("the polling plan", () => {
  const pending = parseProposal(
    wire({ status: "PENDING", text: "", ready_at: null }),
  );
  const ready = parseProposal(wire());
  const failed = parseProposal(
    wire({ status: "FAILED", text: "", ready_at: null, failure: "No." }),
  );

  it("reads again every 3 seconds while drafting, and stops once it is not", () => {
    assert.equal(POLL_MS, 3000);
    assert.equal(pollDelay(pending), 3000);
    assert.equal(pollDelay(ready), null);
    assert.equal(pollDelay(failed), null);
    assert.equal(pollDelay(null), null);
  });

  it("uses an answer only where nothing sent later has answered first", () => {
    let sequence = SEQUENCE;
    const first = sent(sequence, "read");
    sequence = first.sequence;
    const second = sent(sequence, "read");
    sequence = second.sequence;
    // The later read answers first: the earlier one is too old.
    const late = answered(sequence, second.number, "read");
    assert.equal(late.use, true);
    sequence = late.sequence;
    const early = answered(sequence, first.number, "read");
    assert.equal(early.use, false);
  });

  it("never lets a read put back what a redraft or Keep mine ended", () => {
    let sequence = SEQUENCE;
    // A poll is out when the person presses Keep mine.
    const poll = sent(sequence, "read");
    sequence = poll.sequence;
    const keep = sent(sequence, "write");
    sequence = keep.sequence;
    assert.equal(mayRead(sequence), false);
    // The poll answers (READY) while Keep mine is out: not used.
    const pollBack = answered(sequence, poll.number, "read");
    assert.equal(pollBack.use, false);
    sequence = pollBack.sequence;
    // Keep mine answers: used, and reads may go again.
    const keepBack = answered(sequence, keep.number, "write");
    assert.equal(keepBack.use, true);
    sequence = keepBack.sequence;
    assert.equal(mayRead(sequence), true);
    assert.equal(sequence.writing, null);
    // A read sent before the write, answering after it, is not used either.
    const again = answered(sequence, poll.number, "read");
    assert.equal(again.use, false);
    // A read sent after it is.
    const next = sent(sequence, "read");
    assert.equal(answered(next.sequence, next.number, "read").use, true);
  });
});

describe("what the card shows", () => {
  it("folds the draft after its first two paragraphs, read by the formatting grammar", () => {
    assert.equal(FOLDED_BLOCKS, 2);
    const fold = folded(READY_TEXT);
    assert.equal(fold.more, true);
    assert.equal(
      fold.head,
      [
        "ITGC-AC-01 is a manual, event-driven control over access to Workday [^1].",
        "The manager approves each request in ServiceNow [^2].",
      ].join("\n\n"),
    );
    // Two paragraphs or fewer: all of it, nothing to show more of.
    const short = "One.\n\nTwo **bold**.";
    assert.deepEqual(folded(short), { head: short, more: false });
    // A list is one block, as a paragraph is; marks are kept.
    const listed = "Intro ''here''.\n\n- one\n- two\n\nLast.";
    assert.deepEqual(folded(listed), {
      head: "Intro ''here''.\n\n- one\n- two",
      more: true,
    });
  });

  it("lists the sources of what it shows", () => {
    const proposal = parseProposal(wire());
    assert.ok(proposal !== null);
    assert.deepEqual(
      citedIn(folded(proposal.text).head, proposal.citations).map(
        (c) => c.number,
      ),
      [1, 2],
    );
    assert.deepEqual(citedIn("Nothing cited.", proposal.citations), []);
    assert.deepEqual(
      citedIn("Only [^2].", proposal.citations).map((c) => c.number),
      [2],
    );
  });

  it("says the words, and what a screen reader hears", () => {
    assert.equal(
      proposalMeta({ words: 412 }),
      "from the confirmed understanding and the evidence · 412 words",
    );
    assert.equal(
      proposalMeta({ words: 1 }),
      "from the confirmed understanding and the evidence · 1 word",
    );
    assert.equal(proposalMeta({ words: 1200 }).endsWith("1,200 words"), true);
    assert.match(proposalAnnouncement(null, true), /^Drafting…/);
    assert.match(
      proposalAnnouncement({ status: "PENDING", failure: "" }),
      /^Drafting…/,
    );
    assert.equal(
      proposalAnnouncement({ status: "READY", failure: "" }),
      "The agent's draft is ready.",
    );
    assert.equal(
      proposalAnnouncement({ status: "FAILED", failure: "No model." }),
      "No model.",
    );
    assert.equal(
      proposalAnnouncement({ status: "FAILED", failure: "" }),
      "The agent could not draft this section.",
    );
    assert.equal(proposalAnnouncement(null), "");
  });

  it("never says 'the client'", () => {
    for (const words of [
      proposalMeta({ words: 3 }),
      proposalAnnouncement({ status: "PENDING", failure: "" }),
      redraftProblem(0, ""),
      redraftProblem(403, ""),
    ]) {
      assert.ok(!/the client/i.test(words), words);
    }
  });
});

describe("refusals", () => {
  it("passes the server's one sentence on for the refusals it words", () => {
    for (const status of [403, 404, 409]) {
      assert.equal(
        redraftProblem(status, " The agent does not draft this section. "),
        "The agent does not draft this section.",
      );
    }
    assert.equal(redraftProblem(200, "x"), "");
    assert.equal(redraftProblem(403, ""), "You may not edit this workpaper.");
    assert.match(redraftProblem(401, ""), /Sign in again/);
    assert.match(redraftProblem(422, "detail"), /did not take/);
    assert.match(redraftProblem(0, ""), /could not be reached/);
    assert.match(redraftProblem(502, ""), /could not be reached/);
  });

  it("knows a save refused because the agent's draft changed", () => {
    const sentence = "The agent's draft changed; read it again.";
    assert.equal(draftChanged(409, sentence), true);
    assert.equal(draftChanged(409, "The workpaper changed."), false);
    assert.equal(draftChanged(422, sentence), false);
  });
});

describe("using the draft", () => {
  const proposal = parseProposal(wire());
  assert.ok(proposal !== null);

  it("puts the draft in as the editor writes it, and remembers when it was drafted", () => {
    const used = draftUsed(proposal, "Mine, **bold**.");
    assert.equal(used.id, PROPOSAL);
    assert.equal(used.text, editorText(READY_TEXT));
    assert.equal(used.before, "Mine, **bold**.");
    assert.equal(used.at, "2026-11-16T17:41:30Z");
    assert.equal(used.off, false);
    // The formatting round-trips through the editor's own grammar.
    assert.equal(editorText(used.text), used.text);
    assert.equal(editorText("A **b** c [^1]."), "A **b** c [^1].");
  });

  it("names the draft in a save until the editor is back to the person's own text", () => {
    const used = draftUsed(proposal, "Mine.");
    assert.deepEqual(namedDraft(used), { id: PROPOSAL });
    // An edit after "Use the draft" is still from the draft.
    const edited = usedAfter(used, `${used.text}\n\nOne more line.`);
    assert.deepEqual(namedDraft(edited), { id: PROPOSAL });
    // Undo, back to what was there: the save no longer names it.
    const undone = usedAfter(edited, "Mine.");
    assert.equal(namedDraft(undone), null);
    // Typing after the undo is the person's own.
    const typed = usedAfter(undone, "Mine, and more.");
    assert.equal(namedDraft(typed), null);
    // Redo, back to the draft: named again.
    const redone = usedAfter(typed, used.text);
    assert.deepEqual(namedDraft(redone), { id: PROPOSAL });
    assert.equal(usedAfter(null, "x"), null);
    assert.equal(namedDraft(null), null);
  });
});
