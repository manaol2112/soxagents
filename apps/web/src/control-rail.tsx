"use client";

import { type ReactNode, useEffect, useState } from "react";

import { AgentBot } from "./agent-panel";
import {
  askAbout,
  PLAN_TAB_EVENT,
  PLAN_VIEW_EVENT,
  type RecordSection,
  SECTION_MENU,
} from "./control-rail-model";
import { type IconName, UiIcon } from "./ui-icon";

const SECTION_ICON: Record<RecordSection, IconName> = {
  OVERVIEW: "grid",
  PLAN: "file",
  REQUEST: "inbox",
  TEST: "check",
  CONCLUDE: "shield",
  REVIEW: "agents",
  HISTORY: "clock",
};

const CONTEXT_ICON: Record<string, IconName> = {
  system: "server",
  process: "layers",
  area: "shield",
  owner: "user",
  environment: "window",
  frequency: "clock",
  key: "star",
};

/** A slim bar that keeps the control in view once its header scrolls away (decided by
 * the product owner): its reference, title, status, step, and actions. */
export function ControlBar({
  heroId,
  controlRef,
  title,
  status,
  statusClass,
  step,
  actions,
}: {
  /** The header it stands in for; the bar shows once that has scrolled away. */
  heroId: string;
  controlRef: string;
  title: string;
  status: string;
  statusClass: string;
  step: string;
  actions: ReactNode;
}) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const hero = document.getElementById(heroId);
    if (hero === null) {
      return;
    }
    // The header has scrolled away once it passes under the top bar, where the top
    // bar stays in view; on small screens the top bar scrolls away too.
    const topbar = document.querySelector(".topbar");
    const header =
      topbar !== null && getComputedStyle(topbar).position === "sticky"
        ? Math.round(topbar.getBoundingClientRect().height)
        : 0;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry !== undefined) {
          setShown(
            !entry.isIntersecting &&
              entry.boundingClientRect.top < (entry.rootBounds?.top ?? header),
          );
        }
      },
      { rootMargin: `-${header}px 0px 0px 0px` },
    );
    observer.observe(hero);
    return () => observer.disconnect();
  }, [heroId]);

  return (
    <div className="cw-bar-anchor">
      <section
        className={`cw-bar${shown ? " is-shown" : ""}`}
        aria-label="Current control"
        aria-hidden={!shown}
        inert={!shown}
      >
        <span className="cw-bar-ref">{controlRef}</span>
        <span className="cw-bar-title">{title}</span>
        <span className={statusClass}>{status}</span>
        {step !== "" ? <span className="cw-bar-step">{step}</span> : null}
        <span className="cw-bar-actions">{actions}</span>
      </section>
    </div>
  );
}

/** The control's sections, each opening the step that holds it (decided by the product
 * owner): the overview where it stands, the five steps, and its history. */
export function RecordMenu({
  open,
  hrefs,
}: {
  open: RecordSection;
  hrefs: Record<RecordSection, string>;
}) {
  return (
    <nav className="cw-sidenav" aria-label="Control sections">
      <ul>
        {SECTION_MENU.map((item) => (
          <li key={item.key}>
            <a
              href={hrefs[item.key]}
              className={item.key === open ? "is-on" : undefined}
              aria-current={item.key === open ? "page" : undefined}
            >
              <UiIcon name={SECTION_ICON[item.key]} size={15} />
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

type Suggestion = "answers" | "documents" | "related" | "contradictions";

/** A next action the assistant suggests: a section of the plan to open, or a part of the
 * page to bring into view (the plan's section first, when it names one). */
export type AssistantAction = {
  key: string;
  label: string;
  icon: IconName;
  target: { tab?: string; anchor?: string; ask?: string };
};

function follow(
  target: AssistantAction["target"],
  askHref: string,
  about: string,
) {
  if (target.ask !== undefined) {
    // A question for the agent console about this control.
    const url = new URL(askHref, window.location.origin);
    url.searchParams.set("ask", `${about}: ${target.ask}`.slice(0, 1500));
    window.location.assign(url.toString());
    return;
  }
  if (target.tab !== undefined) {
    document.dispatchEvent(
      new CustomEvent(PLAN_TAB_EVENT, { detail: target.tab }),
    );
  }
  if (target.anchor !== undefined) {
    const anchor = target.anchor;
    // After the plan's section has been drawn.
    window.setTimeout(() => {
      document
        .getElementById(anchor)
        ?.scrollIntoView({ block: "start", behavior: "smooth" });
    }, 60);
  }
}

/**
 * The AI assistant beside the control (decided by the product owner on 26 October 2026,
 * from the control workspace reference): on the Overview, what the records show (the
 * questions with usual answers, the governing documents, the related controls, the open
 * contradictions) and the next actions; on the plan's other sections, the actions for
 * that section; and a question for the agent console. Nothing here is saved.
 */
export function ControlAssistant({
  controlRef,
  title,
  answers,
  counts = null,
  related,
  askHref,
  system = "",
  documents = [],
  contradictions = [],
  nextActions = [],
}: {
  controlRef: string;
  title: string;
  answers: Array<{ question: string; answers: string[] }>;
  /** The plan's procedures, attributes and evidence, for the section intros. */
  counts?: { procedures: number; attributes: number; evidence: number } | null;
  related: Array<{ ref: string; href: string | null }>;
  /** The agent console's address; the question is added to it. */
  askHref: string;
  /** The control's system, for its related controls. */
  system?: string;
  /** The governing documents the control cites. */
  documents?: Array<{ id: string; title: string; detail: string }>;
  /** The open contradictions between its sources, by topic. */
  contradictions?: string[];
  /** What to look at next, in the Plan step. */
  nextActions?: AssistantAction[];
}) {
  const [open, setOpen] = useState<Suggestion | null>(null);
  const [question, setQuestion] = useState("");
  // The plan's section open beside it; on Procedures the assistant works on them.
  const [planView, setPlanView] = useState<string | null>(null);
  useEffect(() => {
    const seen = (event: Event) =>
      setPlanView(String((event as CustomEvent<string>).detail));
    document.addEventListener(PLAN_VIEW_EVENT, seen);
    return () => document.removeEventListener(PLAN_VIEW_EVENT, seen);
  }, []);
  const procedureActions: AssistantAction[] = [
    {
      key: "review",
      label: "Review drafted procedures",
      icon: "file",
      target: { anchor: "pp-title" },
    },
    {
      key: "prior",
      label: "Compare with prior year procedures",
      icon: "clock",
      target: { anchor: "cw-prior-year" },
    },
    {
      key: "why",
      label: "Explain why this procedure is needed",
      icon: "help",
      target: {
        ask: "Explain why each procedure in the test plan is needed and what it shows.",
      },
    },
    {
      key: "sampling",
      label: "Suggest sampling approach",
      icon: "layers",
      target: {
        ask: "Suggest a sampling approach for testing this control, with the population and sample size.",
      },
    },
    {
      key: "evidence",
      label: "Check evidence requirements",
      icon: "inbox",
      target: { tab: "evidence" },
    },
  ];
  const attributeActions: AssistantAction[] = [
    {
      key: "suggest",
      label: "Suggest additional attributes",
      icon: "plus",
      target: {
        ask: "Suggest attributes this control should also be tested against, with the reason for each.",
      },
    },
    {
      key: "map",
      label: "Show how attributes map to procedures",
      icon: "layers",
      target: {
        ask: "Show how each attribute maps to the procedures and the evidence that test it, and any gap.",
      },
    },
    {
      key: "prior",
      label: "Compare with prior year",
      icon: "clock",
      target: { anchor: "cw-prior-year" },
    },
    {
      key: "explain",
      label: "Explain this attribute",
      icon: "help",
      target: {
        ask: "Explain each attribute of this control: what it requires and why it matters.",
      },
    },
  ];
  const evidenceActions: AssistantAction[] = [
    {
      key: "group",
      label: "Group into client requests",
      icon: "layers",
      target: {
        ask: "Suggest how to group this control's evidence into client requests, by owner and timing.",
      },
    },
    {
      key: "suggest",
      label: "Suggest additional evidence",
      icon: "plus",
      target: {
        ask: "Suggest evidence this control's test plan may still need, with the reason for each.",
      },
    },
    {
      key: "by-procedure",
      label: "Show evidence by procedure",
      icon: "file",
      target: {
        ask: "Show the evidence each procedure of this control's test plan needs.",
      },
    },
    {
      key: "prior",
      label: "Compare with prior year",
      icon: "clock",
      target: { anchor: "cw-prior-year" },
    },
  ];
  const historyActions: AssistantAction[] = [
    {
      key: "summary",
      label: "Summarize this control's history",
      icon: "clock",
      target: {
        ask: "Summarize this control's history: what changed, who changed it, and why.",
      },
    },
    {
      key: "prior",
      label: "Compare with prior year",
      icon: "file",
      target: { anchor: "cw-prior-year" },
    },
    {
      key: "revisions",
      label: "Show all plan revisions",
      icon: "layers",
      target: { anchor: "ph-decisions" },
    },
    {
      key: "pending",
      label: "What still needs approval?",
      icon: "help",
      target: {
        ask: "What on this control still needs a person's approval, and who can give it?",
      },
    },
  ];
  // The plan's section open beside it: on Procedures and Attributes the assistant works
  // on them; elsewhere it shows what it found and the next actions.
  const modes: Record<
    string,
    { intro: string; placeholder: string; actions: AssistantAction[] }
  > = {
    procedures: {
      intro:
        "Works with the procedures for this control: analyzes, compares, and suggests improvements.",
      placeholder: "Ask a question about these procedures…",
      actions: procedureActions,
    },
    history: {
      intro:
        "Summarizes changes, compares with prior year, or shows what is pending for this control.",
      placeholder: "Ask a question about this control…",
      actions: historyActions,
    },
    evidence: {
      intro: `Identified ${counts?.evidence ?? 0} evidence ${counts?.evidence === 1 ? "item" : "items"} based on the procedures and attributes for this control.`,
      placeholder: "Ask a question about the evidence…",
      actions: evidenceActions,
    },
    attributes: {
      intro: `Defined ${counts?.attributes ?? 0} control ${counts?.attributes === 1 ? "attribute" : "attributes"} based on the control objective and standard testing strategy.`,
      placeholder: "Ask a question about these attributes…",
      actions: attributeActions,
    },
  };
  const mode =
    nextActions.length > 0 && planView !== null
      ? (modes[planView] ?? null)
      : null;
  const onProcedures = mode !== null;
  const about = `About ${controlRef} ${title}`;

  const plural = (count: number, one: string, many: string) =>
    `${count} ${count === 1 ? one : many}`;
  const items: Array<{
    key: Suggestion;
    label: string;
    icon: IconName;
    tone: string;
    ai: boolean;
  }> = [
    {
      key: "answers",
      label: `${plural(answers.length, "question", "questions")} with usual answers`,
      icon: "file",
      tone: "is-green",
      ai: false,
    },
    {
      key: "documents",
      label: plural(
        documents.length,
        "governing document",
        "governing documents",
      ),
      icon: "file",
      tone: "is-blue",
      ai: false,
    },
    {
      key: "related",
      label: `${plural(related.length, "related control", "related controls")}${system !== "" ? ` in ${system}` : ""}`,
      icon: "layers",
      tone: "is-purple",
      ai: false,
    },
    {
      key: "contradictions",
      label: plural(
        contradictions.length,
        "unresolved contradiction",
        "unresolved contradictions",
      ),
      icon: "info",
      tone: "is-orange",
      ai: false,
    },
  ];
  const list = (entries: string[], none: string) =>
    entries.length === 0 ? (
      <p className="cw-assist-none">{none}</p>
    ) : (
      <ul>
        {entries.map((entry) => (
          <li key={entry}>{entry}</li>
        ))}
      </ul>
    );

  return (
    <section className="cw-assist" aria-labelledby="cw-assist-title">
      <div className="cw-assist-head">
        <span className="cw-assist-bot" aria-hidden="true">
          <AgentBot />
        </span>
        <div>
          <h2 id="cw-assist-title">
            AI assistant <span className="cw-beta">Beta</span>
          </h2>
          <p>
            {mode !== null
              ? mode.intro
              : "Analyzed this control using the system, process, and client documents. Here is what was found and suggested."}
          </p>
        </div>
      </div>
      {onProcedures ? (
        <ul className="cw-assist-list cw-assist-found cw-assist-actions">
          {(mode?.actions ?? []).map((action) => (
            <li key={action.key}>
              <button
                type="button"
                onClick={() => follow(action.target, askHref, about)}
              >
                <span className="cw-assist-icon is-purple" aria-hidden="true">
                  <UiIcon name={action.icon} size={14} />
                </span>
                <span className="cw-assist-label">{action.label}</span>
                <UiIcon name="chevron" size={13} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {onProcedures ? null : (
        <ul className="cw-assist-list cw-assist-found">
          {items.map((item) => {
            const isOpen = open === item.key;
            return (
              <li key={item.key} className={isOpen ? "is-open" : undefined}>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => {
                    setOpen(isOpen ? null : item.key);
                  }}
                >
                  <span
                    className={`cw-assist-icon ${item.tone}`}
                    aria-hidden="true"
                  >
                    <UiIcon name={item.icon} size={14} />
                  </span>
                  <span className="cw-assist-label">{item.label}</span>
                  {item.ai ? <span className="cw-assist-ai">AI</span> : null}
                  <UiIcon name="chevron" size={13} />
                </button>
                {isOpen ? (
                  <div className="cw-assist-body">
                    {item.key === "documents"
                      ? list(
                          documents.map((entry) => entry.title),
                          "No policy, procedure, narrative or diagram applies yet.",
                        )
                      : null}
                    {item.key === "contradictions"
                      ? list(contradictions, "Its sources agree.")
                      : null}
                    {item.key === "answers" ? (
                      answers.length === 0 ? (
                        <p className="cw-assist-none">
                          No usual answers are recorded for its questions.
                        </p>
                      ) : (
                        <dl>
                          {answers.map((entry) => (
                            <div key={entry.question}>
                              <dt>{entry.question}</dt>
                              <dd>{entry.answers.join(" · ")}</dd>
                            </div>
                          ))}
                        </dl>
                      )
                    ) : null}
                    {item.key === "related" ? (
                      related.length === 0 ? (
                        <p className="cw-assist-none">
                          It relies on no other control.
                        </p>
                      ) : (
                        <ul className="cw-assist-chips">
                          {related.map((entry) =>
                            entry.href === null ? (
                              <li key={entry.ref}>
                                <span title="Not in this engagement's scope">
                                  {entry.ref}
                                </span>
                              </li>
                            ) : (
                              <li key={entry.ref}>
                                <a href={entry.href}>{entry.ref}</a>
                              </li>
                            ),
                          )}
                        </ul>
                      )
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {nextActions.length > 0 && !onProcedures ? (
        <div className="cw-assist-next">
          <h3>Suggested next actions</h3>
          <ul>
            {nextActions.map((action, index) => (
              <li key={action.key}>
                <button
                  type="button"
                  className={index === 0 ? "is-first" : undefined}
                  onClick={() => follow(action.target, askHref, about)}
                >
                  <UiIcon name={action.icon} size={14} />
                  <span>{action.label}</span>
                  {index === 0 ? <UiIcon name="arrow" size={13} /> : null}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="cw-assist-ask">
        {onProcedures ? null : <h3>Ask the agent</h3>}
        <form
          autoComplete="off"
          className="cw-ask"
          onSubmit={(event) => {
            event.preventDefault();
            if (question.trim() === "") {
              return;
            }
            const url = new URL(askHref, window.location.origin);
            url.searchParams.set(
              "ask",
              askAbout(controlRef, title, question).slice(0, 1500),
            );
            window.location.assign(url.toString());
          }}
        >
          <input
            type="text"
            value={question}
            maxLength={1000}
            placeholder={
              mode?.placeholder ?? "Ask a question or give an instruction…"
            }
            aria-label="Ask the agent a question about this control"
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
    </section>
  );
}

const DATE = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
});

/** The plan's versions beside its History tab: the one open now, then each revision a
 * person decided, newest first. The current one opens the plan. */
export function PlanVersionsCard({
  versions,
}: {
  versions: Array<{
    revision: number;
    current: boolean;
    label: string;
    tone: string;
    at: string;
    by: string;
  }>;
}) {
  const [view, setView] = useState<string | null>(null);
  useEffect(() => {
    const seen = (event: Event) =>
      setView(String((event as CustomEvent<string>).detail));
    document.addEventListener(PLAN_VIEW_EVENT, seen);
    return () => document.removeEventListener(PLAN_VIEW_EVENT, seen);
  }, []);
  if (view !== "history" || versions.length === 0) {
    return null;
  }
  return (
    <section
      className="cw-context cw-versions"
      aria-labelledby="cw-versions-title"
    >
      <h2 id="cw-versions-title">Plan versions</h2>
      <ol>
        {versions.map((item) => (
          <li
            key={item.revision}
            className={item.current ? "is-current" : undefined}
          >
            <span className="cw-versions-dot" aria-hidden="true" />
            <span className="cw-versions-text">
              <span className="cw-versions-head">
                <span className="cw-versions-v">v{item.revision}</span>
                <span className={`cw-versions-tag is-${item.tone}`}>
                  {/* As the reference names them: a revision not yet decided is a draft. */}
                  {item.tone === "draft" ? "Draft" : item.label}
                  {item.current ? " (current)" : ""}
                </span>
              </span>
              <small>
                {item.at !== ""
                  ? `${DATE.format(new Date(item.at))} UTC${item.by !== "" ? ` · ${item.by}` : ""}`
                  : "Not decided yet"}
              </small>
            </span>
            {item.current ? (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() =>
                  follow(
                    { tab: "understanding", anchor: "pl-plan-tabs" },
                    "",
                    "",
                  )
                }
              >
                View
              </button>
            ) : null}
          </li>
        ))}
      </ol>
      <button
        type="button"
        className="cw-versions-all"
        onClick={() => follow({ anchor: "ph-decisions" }, "", "")}
      >
        Show all versions ({versions.length})
        <UiIcon name="chevron" size={12} />
      </button>
    </section>
  );
}

const SUMMARY_ROWS: Array<{ key: string; label: string; tone: string }> = [
  { key: "REQUESTED", label: "Requested", tone: "is-blue" },
  { key: "IN_PROGRESS", label: "In progress", tone: "is-blue" },
  { key: "NEEDS_REVIEW", label: "Needs review", tone: "is-orange" },
  { key: "ACCEPTED", label: "Accepted", tone: "is-green" },
  { key: "NOT_REQUESTED", label: "Not requested", tone: "is-grey" },
  { key: "NOT_APPLICABLE", label: "Not applicable", tone: "is-grey" },
];

/** Where the plan's evidence requests stand, beside its Evidence tab: the total and each
 * status as a share of it. Statuses with nothing in them are left out. */
export function EvidenceSummaryCard({
  counts,
}: {
  counts: Record<string, number> & { total: number };
}) {
  const [view, setView] = useState<string | null>(null);
  useEffect(() => {
    const seen = (event: Event) =>
      setView(String((event as CustomEvent<string>).detail));
    document.addEventListener(PLAN_VIEW_EVENT, seen);
    return () => document.removeEventListener(PLAN_VIEW_EVENT, seen);
  }, []);
  if (view !== "evidence" || counts.total === 0) {
    return null;
  }
  return (
    <section className="cw-context cw-evsum" aria-labelledby="cw-evsum-title">
      <h2 id="cw-evsum-title">Evidence summary</h2>
      <p className="cw-evsum-total">
        <strong>{counts.total}</strong> Total evidence items
      </p>
      <ul>
        {SUMMARY_ROWS.filter((row) => (counts[row.key] ?? 0) > 0).map((row) => {
          const count = counts[row.key] ?? 0;
          return (
            <li key={row.key}>
              <strong>{count}</strong>
              <span className={`cw-evsum-dot ${row.tone}`} aria-hidden="true" />
              <span>{row.label}</span>
              <span className="cw-evsum-bar" aria-hidden="true">
                <span
                  className={row.tone}
                  style={{
                    width: `${Math.round((count / counts.total) * 100)}%`,
                  }}
                />
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The policies, procedures, narratives and diagrams the control cites, with where they
 * are managed (Systems & Processes). */
export function GoverningDocumentsCard({
  documents,
  supporting = [],
  manageHref,
  actions = null,
}: {
  documents: Array<{
    id: string;
    title: string;
    detail: string;
    reviewed?: boolean;
  }>;
  /** The control's other documents: walkthrough notes, system documentation, and so on. */
  supporting?: Array<{
    id: string;
    title: string;
    detail: string;
    reviewed?: boolean;
  }>;
  manageHref: string;
  /** Adding a document and having the agent review the new ones. */
  actions?: ReactNode;
}) {
  const list = (
    items: Array<{
      id: string;
      title: string;
      detail: string;
      reviewed?: boolean;
    }>,
  ) => (
    <ul className="cw-docs-list">
      {items.map((item) => (
        <li key={item.id}>
          <span className="cw-context-icon" aria-hidden="true">
            <UiIcon name="file" size={15} />
          </span>
          <span>
            <strong>{item.title}</strong>
            {/* One line; the whole of it on hover. */}
            <small title={item.detail}>{item.detail}</small>
            {item.reviewed === false ? (
              <em className="cw-docs-new">Not reviewed yet</em>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
  return (
    <section className="cw-context cw-docs" aria-labelledby="cw-docs-title">
      <header className="cw-card-head">
        <h2 id="cw-docs-title">
          Governing documents <span>({documents.length})</span>
        </h2>
        <a href={manageHref}>Manage</a>
      </header>
      {documents.length === 0 ? (
        <p className="cw-assist-none">
          No policy, procedure, narrative or diagram applies to this control
          yet.
        </p>
      ) : (
        list(documents)
      )}
      {supporting.length > 0 ? (
        <>
          <h3 className="cw-docs-sub">Supporting ({supporting.length})</h3>
          {list(supporting)}
        </>
      ) : null}
      {actions}
    </section>
  );
}

/** The control's context, as its records state it. */
export function ControlContextCard({
  rows,
  editHref = null,
}: {
  rows: Array<{ key: string; label: string; value: string }>;
  /** Where the system it runs on is edited. */
  editHref?: string | null;
}) {
  return (
    <section className="cw-context" aria-labelledby="cw-context-title">
      <header className="cw-card-head">
        <h2 id="cw-context-title">Control context</h2>
        {editHref !== null ? (
          <a className="btn-secondary btn-sm" href={editHref}>
            <UiIcon name="compose" size={13} />
            Edit
          </a>
        ) : null}
      </header>
      <dl>
        {rows.map((row) => (
          <div key={row.key}>
            <dt>
              <span className="cw-context-icon" aria-hidden="true">
                <UiIcon name={CONTEXT_ICON[row.key] ?? "info"} size={14} />
              </span>
              {row.label}
            </dt>
            <dd className={row.value === "Not stated" ? "is-muted" : undefined}>
              {row.key === "key" && row.value === "Yes" ? (
                <span className="cw-yes">Yes</span>
              ) : (
                row.value
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
