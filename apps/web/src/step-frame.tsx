"use client";

import Link from "next/link";
import { type FormEvent, type ReactNode, useState } from "react";
import { askAbout } from "./control-rail-model";
import type { PanelFrame, PanelNeed } from "./step-panel-model";
import { UiIcon } from "./ui-icon";

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
 * Every step's panel, one layout (product owner, 8 November 2026: decision-first). What the
 * step needs from the person, with its one action; the agent's prepared work, with the agent's
 * strip; what it is based on; the detail, folded; and the step that follows.
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
  /** The prepared work's verdict or summary, beside its title. */
  verdict?: ReactNode;
  /** The detail behind the work, folded: each with its title and one-line summary. */
  details?: ReadonlyArray<{
    key: string;
    title: string;
    line: string;
    body: ReactNode;
    open?: boolean;
  }>;
  /** Anything the step shows below its folds. */
  children?: ReactNode;
  /** The work carries its own header, with what the step needs, the agent and its
   * progress (Control Understanding, 9 November 2026): the need card, the title and the
   * agent's strip are not repeated above it. */
  bare?: boolean;
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
