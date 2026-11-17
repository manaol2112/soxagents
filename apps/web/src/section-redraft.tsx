"use client";

import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import { RichText } from "./rich-text";
import {
  answered,
  citedIn,
  DRAFTING,
  failureLine,
  folded,
  IN_EDITOR,
  KEEP_MINE,
  keepMineRequest,
  mayRead,
  PROPOSAL_TITLE,
  type Proposal,
  type ProposalAnswer,
  type ProposalPlace,
  parseProposalAnswer,
  pollDelay,
  proposalAnnouncement,
  proposalMeta,
  proposalOf,
  proposalQuery,
  REDRAFT,
  redraftProblem,
  redraftRequest,
  SAVE_FIRST,
  SEQUENCE,
  SHOW_ALL,
  SHOW_LESS,
  sent,
  TRY_AGAIN,
  USE_DRAFT,
} from "./section-redraft-model";
import { UiIcon } from "./ui-icon";

/**
 * "Redraft with the agent" in a text section's editor (docs/design-workpaper.md, section
 * 3.11): the button at the right of the formatting bar, and the agent's draft under the
 * editor with its two choices. The proposal is the agent's: nothing here changes the
 * workpaper. "Use the draft" hands the text to the editor's owner, which puts it in the
 * editor's own box (an unsaved change, kept as a working copy); "Keep mine" ends the
 * proposal once the server confirmed it. What may be redrafted, the requests and the
 * polling plan are the model's (section-redraft-model.ts).
 */

/** What an editor that offers the redraft is given by its owner. */
export type RedraftOffer = {
  scope: { organizationId: string; projectId: string };
  place: ProposalPlace;
  /** The workpaper's current version the editor was opened on (a save's `based_on`): a
   * redraft asked on an older one is refused by the server. */
  workpaperVersion: number;
  /** The proposal whose text the editor holds, not saved yet; null where it holds none. */
  used: string | null;
  /** Changes when the owner wants the proposal read again (a save refused as the draft
   * changed). */
  reread: number;
  /** "Use the draft": the owner puts its text in the editor. */
  onUse: (proposal: Proposal) => void;
};

/** Where the redraft of the open editor stands, and what may be done. */
export type Redraft = {
  proposal: Proposal | null;
  /** A redraft is asked for and not answered yet. */
  asking: boolean;
  /** "Keep mine" is out. */
  keeping: boolean;
  /** Why the last request was not taken, in one sentence; "". */
  problem: string;
  /** What a screen reader hears. */
  announce: string;
  ask: () => void;
  keepMine: () => void;
};

async function call(
  url: string,
  body?: Record<string, unknown>,
): Promise<ProposalAnswer> {
  try {
    const response = await fetch(
      url,
      body === undefined
        ? { cache: "no-store" }
        : {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          },
    );
    return parseProposalAnswer((await response.json()) as unknown);
  } catch {
    return { status: 0, detail: "", proposal: null };
  }
}

/** The redraft of the open editor: its proposal read when the editor opens (a READY one
 * shown, a PENDING one read again every few seconds until it is not), a request, and
 * "Keep mine". An answer that comes back after a later one is not used; nothing is read
 * once the editor has gone. */
export function useSectionRedraft(offer: RedraftOffer | null): Redraft {
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [asking, setAsking] = useState(false);
  const [keeping, setKeeping] = useState(false);
  const [problem, setProblem] = useState("");
  // A failed read of a drafting proposal is tried again on the next tick.
  const [tick, setTick] = useState(0);
  const sequence = useRef(SEQUENCE);
  const live = useRef(true);
  const scope = offer?.scope ?? null;
  const organizationId = scope?.organizationId ?? "";
  const projectId = scope?.projectId ?? "";
  const workpaperId = offer?.place.workpaperId ?? "";
  const sectionKey = offer?.place.sectionKey ?? "";
  const version = offer?.workpaperVersion ?? 0;
  const on = offer !== null;
  const reread = offer?.reread ?? 0;

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const read = useCallback(async () => {
    if (!on || !mayRead(sequence.current)) {
      return;
    }
    const going = sent(sequence.current, "read");
    sequence.current = going.sequence;
    const answer = await call(
      `/workspace/workpapers/proposal?${proposalQuery(
        { organizationId, projectId },
        { workpaperId, sectionKey },
      )}`,
    );
    const back = answered(sequence.current, going.number, "read");
    sequence.current = back.sequence;
    if (!live.current || !back.use) {
      return;
    }
    if (answer.status === 200) {
      setProposal(proposalOf(answer, sectionKey));
    } else {
      // Not read: what is shown stays, and a drafting one is read again.
      setTick((count) => count + 1);
    }
  }, [on, organizationId, projectId, workpaperId, sectionKey]);

  // Read when the editor opens on a section, and again when the owner asks.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `reread` is what asks for another read.
  useEffect(() => {
    void read();
  }, [read, reread]);

  // A drafting proposal is read again every few seconds; never once it is ready or has
  // failed, nor after the editor has gone.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `tick` is what asks again after a failed read.
  useEffect(() => {
    const delay = pollDelay(proposal);
    if (delay === null) {
      return;
    }
    const timer = window.setTimeout(() => void read(), delay);
    return () => window.clearTimeout(timer);
  }, [proposal, read, tick]);

  const write = async (
    url: string,
    body: Record<string, unknown>,
  ): Promise<ProposalAnswer | null> => {
    const going = sent(sequence.current, "write");
    sequence.current = going.sequence;
    const answer = await call(url, body);
    const back = answered(sequence.current, going.number, "write");
    sequence.current = back.sequence;
    return live.current && back.use ? answer : null;
  };

  const ask = () => {
    if (!on || asking || keeping || version < 1) {
      return;
    }
    setAsking(true);
    setProblem("");
    void write(
      "/workspace/workpapers/redraft",
      redraftRequest(
        { organizationId, projectId },
        { workpaperId, sectionKey },
        version,
      ),
    ).then((answer) => {
      if (answer === null) {
        return;
      }
      setAsking(false);
      const problem = redraftProblem(answer.status, answer.detail);
      if (problem !== "") {
        setProblem(problem);
        return;
      }
      const made = proposalOf(answer, sectionKey);
      if (made === null) {
        // Asked, and the answer could not be read: what stands is read again.
        void read();
        return;
      }
      setProposal(made);
    });
  };

  const keepMine = () => {
    if (!on || proposal === null || keeping || asking) {
      return;
    }
    setKeeping(true);
    setProblem("");
    void write(
      "/workspace/workpapers/keep-mine",
      keepMineRequest(
        { organizationId, projectId },
        { workpaperId, sectionKey },
        proposal.id,
      ),
    ).then((answer) => {
      if (answer === null) {
        return;
      }
      setKeeping(false);
      const problem = redraftProblem(answer.status, answer.detail);
      if (problem !== "") {
        setProblem(problem);
        if (answer.status === 409 || answer.status === 404) {
          void read();
        }
        return;
      }
      // Ended, as the server confirmed: only now does the draft go.
      setProposal(null);
    });
  };

  return {
    proposal,
    asking,
    keeping,
    problem,
    announce: proposalAnnouncement(proposal, asking),
    ask,
    keepMine,
  };
}

/** The editor's box, inside its frame: where the focus goes after a choice. */
function focusBox(from: RefObject<HTMLElement | null>) {
  window.requestAnimationFrame(() => {
    const box = from.current
      ?.closest("[data-section-editor]")
      ?.querySelector<HTMLElement>('[role="textbox"]');
    box?.focus();
  });
}

/** "Redraft with the agent", at the right of the formatting bar: "Drafting…" while the
 * agent drafts (the editor stays usable), off while a save is out or the editor holds a
 * draft not saved yet. It is never disabled outright where it has the focus: it says it
 * is off, and does nothing. */
export function RedraftButton({
  redraft,
  busy,
  used,
}: {
  redraft: Redraft;
  /** A save is out, or the views are reading the workpaper again. */
  busy: boolean;
  /** The editor holds the agent's draft, not saved yet. */
  used: boolean;
}) {
  const drafting = redraft.asking || redraft.proposal?.status === "PENDING";
  const off = drafting || busy || used || redraft.keeping;
  return (
    <button
      type="button"
      className="btn-secondary btn-sm se-redraft"
      aria-disabled={off}
      title={used && !drafting ? SAVE_FIRST : undefined}
      onClick={() => {
        if (!off) {
          redraft.ask();
        }
      }}
    >
      <UiIcon name="sparkles" size={13} /> {drafting ? DRAFTING : REDRAFT}
    </button>
  );
}

/** Under the editor: the agent's draft (READY) with its two choices, a line once the
 * editor holds it, or a failed run's one line with "Try again". Nothing for a drafting
 * one: the button says so. Its owner keys it by the proposal, so another one is shown
 * folded again. */
export function RedraftCard({
  redraft,
  offer,
  busy,
}: {
  redraft: Redraft;
  offer: RedraftOffer;
  busy: boolean;
}) {
  const uid = useId();
  const [all, setAll] = useState(false);
  const here = useRef<HTMLDivElement>(null);
  const { proposal, problem } = redraft;
  const line = (words: string, action: ReactNode = null) => (
    <div className="se-proposal-line" ref={here}>
      <p>{words}</p>
      {action}
    </div>
  );
  if (proposal === null || proposal.status === "PENDING") {
    return problem === ""
      ? null
      : line(
          problem,
          <button
            type="button"
            className="btn-secondary btn-sm"
            disabled={busy || redraft.asking}
            onClick={redraft.ask}
          >
            {TRY_AGAIN}
          </button>,
        );
  }
  if (proposal.status === "FAILED") {
    return line(
      problem !== "" ? problem : failureLine(proposal),
      <button
        type="button"
        className="btn-secondary btn-sm"
        disabled={busy || redraft.asking || offer.used !== null}
        onClick={redraft.ask}
      >
        {TRY_AGAIN}
      </button>,
    );
  }
  if (offer.used === proposal.id) {
    return line(IN_EDITOR);
  }
  const fold = folded(proposal.text);
  const text = all || !fold.more ? proposal.text : fold.head;
  const sources =
    all || !fold.more ? proposal.citations : citedIn(text, proposal.citations);
  const off = busy || redraft.keeping;
  return (
    <section
      className="se-proposal"
      aria-labelledby={`${uid}-title`}
      aria-busy={redraft.keeping}
    >
      <header className="se-proposal-head">
        <h6 id={`${uid}-title`}>{PROPOSAL_TITLE}</h6>
        <span>{proposalMeta(proposal)}</span>
      </header>
      <div className="se-proposal-text" id={`${uid}-text`}>
        <RichText text={text} cite />
      </div>
      {fold.more ? (
        <button
          type="button"
          className="dw-link se-proposal-more"
          aria-expanded={all}
          aria-controls={`${uid}-text`}
          onClick={() => setAll((open) => !open)}
        >
          {all ? SHOW_LESS : SHOW_ALL}
        </button>
      ) : null}
      {sources.length > 0 ? (
        <ol className="wp-sources se-proposal-sources" aria-label="Sources">
          {sources.map((citation) => (
            <li key={citation.number}>
              <span className="cite-num">{citation.number}</span>
              <span>{citation.fileName}</span>
              {citation.location !== "" ? (
                <small> · {citation.location}</small>
              ) : null}
              <q>{citation.quote}</q>
            </li>
          ))}
        </ol>
      ) : null}
      {proposal.removedNote !== "" ? (
        <p className="se-proposal-note">{proposal.removedNote}</p>
      ) : null}
      {problem !== "" ? (
        <p className="se-refusal" role="alert">
          {problem}
        </p>
      ) : null}
      <div className="se-proposal-actions" ref={here}>
        <button
          type="button"
          className="btn-secondary btn-sm"
          disabled={off}
          onClick={() => {
            redraft.keepMine();
            focusBox(here);
          }}
        >
          {KEEP_MINE}
        </button>
        <button
          type="button"
          className="btn-sm"
          disabled={off}
          onClick={() => {
            offer.onUse(proposal);
            focusBox(here);
          }}
        >
          {USE_DRAFT}
        </button>
      </div>
    </section>
  );
}

/** What a screen reader hears of the redraft: "Drafting…", then "The agent's draft is
 * ready." (or the failure), in its own polite region. */
export function RedraftAnnouncer({ redraft }: { redraft: Redraft }) {
  return (
    <p className="sr-only" role="status" aria-live="polite">
      {redraft.announce}
    </p>
  );
}
