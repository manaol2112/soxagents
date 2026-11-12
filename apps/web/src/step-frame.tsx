"use client";

import Link from "next/link";
import {
  createContext,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { askAbout } from "./control-rail-model";
import {
  basedOnSummary,
  nextLinks,
  quietLineOf,
  stepName,
  takesMinimalLayout,
} from "./step-frame-model";
import type { PanelFrame, PanelNeed } from "./step-panel-model";
import { UiIcon } from "./ui-icon";

/** What the drawer's Ask asks about: the agent console, the control, and the step. */
export type StepAskTarget = {
  askHref: string;
  about: { ref: string; title: string };
  step: string;
};

/**
 * The drawer the frame sits in (WorkflowPanel) shows the step's Ask in its header: the frame
 * tells it what to ask about. Absent outside a drawer.
 */
export const StepAskContext = createContext<
  ((target: StepAskTarget | null) => void) | null
>(null);

type Details = ReadonlyArray<{
  key: string;
  title: string;
  line: string;
  body: ReactNode;
  open?: boolean;
}>;

/**
 * Every step's panel, one layout (product owner, 11 November 2026: minimalist, approved from a
 * preview). What the step needs from the person, as one decision row with its one action, or
 * one quiet sentence where it needs nothing; what the agent did, in a line; the prepared work,
 * flat; the detail, folded; and a slim footer with what it rests on and what follows. Control
 * Understanding keeps the layout it had ("don't change that for now").
 */
export function StepFrame({
  frame,
  stepHrefs,
  askHref,
  about,
  agent,
  prepared,
  preparedTitle,
  verdict,
  details,
  children,
  bare = false,
  decision,
}: {
  frame: PanelFrame;
  /** The address of each step's panel, by its key. */
  stepHrefs: Readonly<Record<string, string>>;
  /** The agent console's address; the question is added to it. */
  askHref: string;
  /** The control, for the question asked about it. */
  about: { ref: string; title: string };
  /** What the agent did on this step and what it found. */
  agent: { did: string; found: string[] } | null;
  /** The step's own work: what the agent prepared, and what the person decides on it. */
  prepared: ReactNode;
  preparedTitle: string;
  /** The prepared work's verdict or summary, above it. */
  verdict?: ReactNode;
  /** The detail behind the work, folded: each with its title and one-line summary. */
  details?: Details;
  /** Anything the step shows below its folds. */
  children?: ReactNode;
  /** The work carries its own header, with what the step needs, the agent and its
   * progress (Control Understanding, 9 November 2026; the setup): the decision row, the
   * title and the agent's line are not repeated above it. */
  bare?: boolean;
  /** The step's own decision, in place of the decision row (D&I Evidence's release, 11
   * November 2026): one card with the decision's content and its one action. */
  decision?: ReactNode;
}) {
  const minimal = takesMinimalLayout(frame.key);
  const registerAsk = useContext(StepAskContext);
  // The drawer's header carries the step's Ask; set before paint, so it does not flash in.
  useLayoutEffect(() => {
    if (!minimal || registerAsk === null) {
      return;
    }
    registerAsk({
      askHref,
      about: { ref: about.ref, title: about.title },
      step: frame.title,
    });
    return () => registerAsk(null);
  }, [minimal, registerAsk, askHref, about.ref, about.title, frame.title]);

  if (!minimal) {
    return (
      <OwnLayoutFrame
        frame={frame}
        stepHrefs={stepHrefs}
        askHref={askHref}
        about={about}
        agent={agent}
        prepared={prepared}
        preparedTitle={preparedTitle}
        verdict={verdict}
        details={details}
        bare={bare}
        decision={decision}
      >
        {children}
      </OwnLayoutFrame>
    );
  }

  const hasDecision = decision !== undefined && decision !== null;
  return (
    <div className="stp is-minimal">
      {bare ? (
        <div className="stp-bare" id="stp-work">
          {prepared}
        </div>
      ) : (
        <>
          {hasDecision ? (
            <div className="stp-decision-slot">{decision}</div>
          ) : (
            <NeedLine need={frame.need} stepHrefs={stepHrefs} />
          )}
          {agent !== null ? <AgentLine agent={agent} /> : null}
          <section
            className="stp-area"
            id="stp-work"
            aria-labelledby="stp-work-title"
          >
            <h3 id="stp-work-title" className="sr-only">
              {preparedTitle}
            </h3>
            {verdict !== undefined ? (
              <div className="stp-work-verdict">{verdict}</div>
            ) : null}
            {prepared}
          </section>
        </>
      )}

      {details !== undefined && details.length > 0 ? (
        <div className="stp-details">
          {details.map((item) => (
            <details className="stp-fold" key={item.key} open={item.open}>
              <summary>
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.line}</small>
                </span>
                <UiIcon name="chevron" size={14} />
              </summary>
              <div className="stp-fold-body">{item.body}</div>
            </details>
          ))}
        </div>
      ) : null}

      {children}

      <StepFooter frame={frame} stepHrefs={stepHrefs} />
    </div>
  );
}

/** What the step needs from the person: one decision row with its one action, or one
 * quiet sentence where it needs nothing. */
function NeedLine({
  need,
  stepHrefs,
}: {
  need: PanelNeed;
  stepHrefs: Readonly<Record<string, string>>;
}) {
  const quiet = quietLineOf(need);
  if (quiet !== null) {
    return (
      <p
        className={`stp-quiet is-${need.kind}`}
        role={quiet.working ? "status" : undefined}
      >
        {quiet.working ? (
          <span className="wf-pulse" aria-hidden="true" />
        ) : null}
        <span className="stp-quiet-text">{quiet.text}</span>
        {quiet.link !== undefined ? (
          <Link
            className="stp-quiet-link"
            href={stepHrefs[quiet.link.step] ?? "#"}
            scroll={false}
          >
            {quiet.link.label}
            <UiIcon name="arrow" size={13} />
          </Link>
        ) : null}
      </p>
    );
  }
  return (
    <section
      className={`stp-decide is-${need.kind}`}
      aria-labelledby="stp-need-title"
    >
      <div className="stp-decide-text">
        <h3 id="stp-need-title">
          {need.kind === "flag" ? <UiIcon name="risk" size={15} /> : null}
          {need.title}
        </h3>
        {need.detail !== "" ? <p>{need.detail}</p> : null}
      </div>
      {need.action !== undefined ? (
        need.action.step !== undefined ? (
          <Link
            className="btn btn-primary stp-decide-act"
            href={stepHrefs[need.action.step] ?? "#"}
            scroll={false}
          >
            {need.action.label}
            <UiIcon name="arrow" size={14} />
          </Link>
        ) : (
          <a
            className="btn btn-primary stp-decide-act"
            href={`#${need.action.anchor ?? "stp-work"}`}
          >
            {need.action.label}
            <UiIcon name="arrow" size={14} />
          </a>
        )
      ) : null}
    </section>
  );
}

/** What the agent did, in one line; what it found, on request. */
function AgentLine({ agent }: { agent: { did: string; found: string[] } }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  return (
    <div className="stp-agent-line">
      <p>
        <UiIcon name="sparkles" size={14} />
        <span className="stp-agent-line-did">{agent.did}</span>
        {agent.found.length > 0 ? (
          <button
            type="button"
            className="stp-why"
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen((value) => !value)}
          >
            Why
            <UiIcon name="chevron" size={12} />
          </button>
        ) : null}
      </p>
      {agent.found.length > 0 ? (
        <ul className="stp-why-list" id={listId} hidden={!open}>
          {agent.found.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** The slim footer: what the step rests on, and the step that follows. */
function StepFooter({
  frame,
  stepHrefs,
}: {
  frame: PanelFrame;
  stepHrefs: Readonly<Record<string, string>>;
}) {
  const based = basedOnSummary(frame.basedOn);
  const next = nextLinks(frame.next);
  if (based === null && next.length === 0) {
    return null;
  }
  return (
    <footer className="stp-foot">
      {based !== null ? (
        <nav className="stp-foot-based" aria-label="What this step is based on">
          <span className="stp-foot-label">Based on</span>
          <Link href={stepHrefs[based.first.key] ?? "#"} scroll={false}>
            <span
              className={`wf-dot tone-${based.first.tone}`}
              aria-hidden="true"
            />
            {based.label}
          </Link>
          {based.more.length > 0 ? (
            <span
              className="stp-foot-more"
              title={based.more.map((item) => stepName(item)).join(", ")}
            >
              <span aria-hidden="true">+{based.more.length}</span>
              <span className="sr-only">
                and {based.more.map((item) => stepName(item)).join(", ")}
              </span>
            </span>
          ) : null}
        </nav>
      ) : null}
      {next.length > 0 ? (
        <nav className="stp-foot-next" aria-label="The step that follows">
          {next.map((item) => (
            <Link
              key={item.key}
              href={stepHrefs[item.key] ?? "#"}
              scroll={false}
            >
              {item.label} · {item.title}
              <UiIcon name="arrow" size={13} />
            </Link>
          ))}
        </nav>
      ) : null}
    </footer>
  );
}

/**
 * The drawer header's Ask: a small popover with one question about the step, asked in the
 * agent console. Escape or a click outside closes it, and the focus returns to Ask.
 */
export function StepAsk({ target }: { target: StepAskTarget }) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const popId = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    input.current?.focus();
    const away = (event: PointerEvent) => {
      if (
        wrap.current !== null &&
        event.target instanceof Node &&
        !wrap.current.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  function onKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && open) {
      // The popover takes its own Escape: the drawer stays open.
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  }

  function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (question.trim() === "") {
      return;
    }
    const url = new URL(target.askHref, window.location.origin);
    url.searchParams.set(
      "ask",
      askAbout(
        target.about.ref,
        target.about.title,
        `${target.step}: ${question}`,
      ).slice(0, 1500),
    );
    window.location.assign(url.toString());
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Escape inside the popover closes it.
    <div className="stp-ask-wrap" ref={wrap} onKeyDown={onKey}>
      <button
        ref={trigger}
        type="button"
        className="btn btn-secondary stp-ask-btn"
        aria-expanded={open}
        aria-controls={popId}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <UiIcon name="sparkles" size={14} />
        <span className="stp-ask-label">Ask</span>
      </button>
      <div className="stp-ask-pop" id={popId} hidden={!open}>
        <form autoComplete="off" onSubmit={ask}>
          <label htmlFor={`${popId}-q`}>
            Ask the agent about {target.step}
          </label>
          <div className="stp-ask-field">
            <input
              ref={input}
              id={`${popId}-q`}
              type="text"
              value={question}
              maxLength={1000}
              placeholder="What would you like to know?"
              onChange={(event) => setQuestion(event.target.value)}
            />
            <button
              type="submit"
              aria-label="Ask"
              disabled={question.trim() === ""}
            >
              <UiIcon name="arrow" size={14} />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const NEED_ICON: Record<
  PanelNeed["kind"],
  "user" | "sparkles" | "clock" | "check" | "minus" | "risk"
> = {
  act: "user",
  agent: "sparkles",
  wait: "clock",
  done: "check",
  skipped: "minus",
  flag: "risk",
};

const NEED_LABEL: Record<PanelNeed["kind"], string> = {
  act: "Needed from you",
  agent: "The agent is working",
  wait: "Nothing to do yet",
  done: "Nothing needed",
  skipped: "Not performed",
  flag: "Needs attention",
};

/**
 * Control Understanding's panel, as it was before the minimalist layout (product owner, 11
 * November 2026: "don't change that for now"): the need card, the work with the agent's
 * strip, the "Based on" row, the folds, and the step that follows. Unchanged markup.
 */
function OwnLayoutFrame({
  frame,
  stepHrefs,
  askHref,
  about,
  agent,
  prepared,
  preparedTitle,
  verdict,
  details,
  children,
  bare,
  decision,
}: {
  frame: PanelFrame;
  stepHrefs: Readonly<Record<string, string>>;
  askHref: string;
  about: { ref: string; title: string };
  agent: { did: string; found: string[] } | null;
  prepared: ReactNode;
  preparedTitle: string;
  verdict?: ReactNode;
  details?: Details | undefined;
  children?: ReactNode;
  bare: boolean;
  decision?: ReactNode;
}) {
  const need = frame.need;
  return (
    <div className="stp">
      {bare ? (
        <div className="stp-bare" id="stp-work">
          {prepared}
        </div>
      ) : (
        <>
          {decision !== undefined && decision !== null ? (
            decision
          ) : (
            <section
              className={`stp-need is-${need.kind}`}
              aria-labelledby="stp-need-title"
            >
              <span className="stp-need-icon" aria-hidden="true">
                <UiIcon name={NEED_ICON[need.kind]} size={16} />
              </span>
              <div className="stp-need-text">
                <p className="stp-need-kicker">{NEED_LABEL[need.kind]}</p>
                <h3 id="stp-need-title">{need.title}</h3>
                {need.detail !== "" ? <p>{need.detail}</p> : null}
              </div>
              {need.action !== undefined ? (
                need.action.step !== undefined ? (
                  <Link
                    className="btn btn-primary stp-need-act"
                    href={stepHrefs[need.action.step] ?? "#"}
                    scroll={false}
                  >
                    {need.action.label}
                    <UiIcon name="arrow" size={14} />
                  </Link>
                ) : (
                  <a
                    className="btn btn-primary stp-need-act"
                    href={`#${need.action.anchor ?? "stp-work"}`}
                  >
                    {need.action.label}
                    <UiIcon name="arrow" size={14} />
                  </a>
                )
              ) : null}
            </section>
          )}

          <section
            className="stp-work"
            id="stp-work"
            aria-labelledby="stp-work-title"
          >
            <header className="stp-work-head">
              <h3 id="stp-work-title">{preparedTitle}</h3>
              {verdict !== undefined ? (
                <div className="stp-work-verdict">{verdict}</div>
              ) : null}
            </header>
            {agent !== null ? (
              <AgentStrip
                agent={agent}
                askHref={askHref}
                about={about}
                step={frame.title}
              />
            ) : null}
            <div className="stp-work-body">{prepared}</div>
          </section>
        </>
      )}

      {frame.basedOn.length > 0 ? (
        <nav className="stp-based" aria-label="What this step is based on">
          <span className="stp-based-label">Based on</span>
          <ul>
            {frame.basedOn.map((item) => (
              <li key={item.key}>
                <Link href={stepHrefs[item.key] ?? "#"} scroll={false}>
                  <span
                    className={`wf-dot tone-${item.tone}`}
                    aria-hidden="true"
                  />
                  <span className="stp-based-num">
                    {String(item.number).padStart(2, "0")}
                  </span>
                  {item.title}
                  <span className="stp-based-status">{item.status}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}

      {details !== undefined && details.length > 0 ? (
        <div className="stp-details">
          {details.map((item) => (
            <details className="stp-fold" key={item.key} open={item.open}>
              <summary>
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.line}</small>
                </span>
                <UiIcon name="chevron" size={14} />
              </summary>
              <div className="stp-fold-body">{item.body}</div>
            </details>
          ))}
        </div>
      ) : null}

      {children}

      {frame.next.length > 0 ? (
        <nav className="stp-next" aria-label="The step that follows">
          {frame.next.map((item) => (
            <Link
              key={item.key}
              className="stp-next-link"
              href={stepHrefs[item.key] ?? "#"}
              scroll={false}
            >
              <span className="stp-next-label">
                {item.when !== "" ? item.when : "Next"}
              </span>
              <span className="stp-next-title">
                {String(item.number).padStart(2, "0")} · {item.title}
              </span>
              <UiIcon name="arrow" size={14} />
            </Link>
          ))}
        </nav>
      ) : null}
    </div>
  );
}

/** The agent's strip on a step: what it did, what it found, and a question about the step. */
function AgentStrip({
  agent,
  askHref,
  about,
  step,
}: {
  agent: { did: string; found: string[] };
  askHref: string;
  about: { ref: string; title: string };
  step: string;
}) {
  const [question, setQuestion] = useState("");
  function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (question.trim() === "") {
      return;
    }
    const url = new URL(askHref, window.location.origin);
    url.searchParams.set(
      "ask",
      askAbout(about.ref, about.title, `${step}: ${question}`).slice(0, 1500),
    );
    window.location.assign(url.toString());
  }
  return (
    <div className="stp-agent">
      <div className="stp-agent-text">
        <span className="stp-agent-mark" aria-hidden="true">
          <UiIcon name="sparkles" size={13} />
        </span>
        <div>
          <p className="stp-agent-did">{agent.did}</p>
          {agent.found.length > 0 ? (
            <ul className="stp-agent-found">
              {agent.found.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
      <form autoComplete="off" className="stp-ask" onSubmit={ask}>
        <input
          type="text"
          value={question}
          maxLength={1000}
          placeholder="Ask about this step…"
          aria-label={`Ask the agent about ${step}`}
          onChange={(event) => setQuestion(event.target.value)}
        />
        <button
          type="submit"
          aria-label="Ask"
          disabled={question.trim() === ""}
        >
          <UiIcon name="arrow" size={14} />
        </button>
      </form>
    </div>
  );
}
