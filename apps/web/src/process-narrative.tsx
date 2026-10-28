"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { WALK_ASK_EVENT, WALK_POINTS_EVENT } from "./client-walkthrough";
import {
  clock,
  type NarrativeRun,
  type NarrativeVersion,
  narrativeProgress,
  type ProcessStep,
  parseVersions,
  planOutcomeLine,
  REVIEW_ACTION_LABELS,
  reviewActions,
  reviewHeadline,
  type Understanding,
  VERSION_KIND_LABELS,
  withoutCodes,
} from "./control-context-model";
import { ProcessFlow } from "./process-flow";
import { type IconName, UiIcon } from "./ui-icon";

type Ids = { organizationId: string; projectId: string; controlId: string };

type Tab = "draft" | "flow" | "versions" | "testing";

const TABS: Array<[Tab, string]> = [
  ["draft", "Draft"],
  ["flow", "Process flow"],
  ["versions", "Versions"],
  ["testing", "Used in testing"],
];

const STAMP = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** A source the narrative is drafted from: a client's answer, or the control's document. */
export type NarrativeSource = {
  key: string;
  kind: "answer" | "document";
  title: string;
  detail: string;
  /** The answer's question, to open it in the walkthrough. */
  slotKey?: string;
  /** Where the document is read. */
  href?: string;
};

/** An attribute the plan tests, with the procedures that test it. */
export type NarrativeAttribute = {
  code: string;
  text: string;
  procedures: string[];
};

const paragraphs = (text: string) =>
  text
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);

/** A step as the save intent takes it. */
const saved = (step: ProcessStep) => ({
  description: step.description,
  actor: step.actor,
  system: step.system,
  controlPoint: step.controlPoint,
  basis: step.basis,
  source: step.source,
  quote: step.quote,
  attributes: step.attributes,
});

function builtWords(builtBy: Understanding["builtBy"]): {
  label: string;
  tone: string;
} {
  return builtBy === "AGENT"
    ? { label: "AI generated", tone: "is-ai" }
    : builtBy === "RULES" || builtBy === "FALLBACK"
      ? { label: "Drafted from the rules", tone: "is-rules" }
      : { label: "Written by the team", tone: "is-team" };
}

/**
 * The process narrative beside the client-specific walkthrough (decided by the product
 * owner on 26 October 2026, from the narrative reference): drafted by the process agent
 * from the confirmed answers once every question is answered, redrafted on request (beside
 * the team's, never over it), edited, saved as a draft, and approved by a person. Its
 * process flow shows each step, who performs it, the system, where the control operates and
 * the attributes evaluated there; every version is kept; Used in testing shows how each
 * attribute is tested. Nothing here approves on its own.
 */
export function ProcessNarrative({
  ids,
  subtitle = "",
  understanding,
  attributes,
  canAct,
  busy,
  problem,
  run,
  points = false,
  changed = [],
  controlRef = "",
}: {
  ids: Ids;
  /** The system and the control, under the narrative's title. */
  subtitle?: string;
  understanding: Understanding | null;
  attributes: NarrativeAttribute[];
  canAct: boolean;
  busy: boolean;
  problem: string | null;
  run: (label: string, fields: Record<string, unknown>) => Promise<boolean>;
  /** Points are waiting for the client to confirm in the walkthrough. */
  points?: boolean;
  /** The questions whose answer changed after the narrative was approved. */
  changed?: string[];
  /** The control's reference, shown on the flow where it operates. */
  controlRef?: string;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("draft");
  const [editing, setEditing] = useState(false);
  // The attribute codes each section explains, shown on request (product owner, 27
  // October 2026: the narrative reads as a document first).
  const [showCodes, setShowCodes] = useState(false);
  // One attribute picked out across the sections that explain it.
  const [focus, setFocus] = useState<string | null>(null);
  const sections = understanding?.sections ?? [];
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState(false);
  const [versions, setVersions] = useState<
    NarrativeVersion[] | null | "failed"
  >(null);
  const [opened, setOpened] = useState<number | null>(null);
  const status = understanding?.status ?? "NONE";
  const summary = understanding?.summary ?? "";
  const steps = understanding?.steps ?? [];
  const proposal = understanding?.proposedSections ?? null;
  const has = sections.length > 0 || summary.trim() !== "" || steps.length > 0;
  const words = builtWords(understanding?.builtBy ?? "PERSON");
  const version = understanding?.version ?? 0;
  const live = understanding?.run ?? null;
  const working = live?.status === "PENDING" || live?.status === "WORKING";
  const review = understanding?.review ?? null;
  // The review stands for the narrative only while it is the version reviewed.
  const current = review !== null && review.version === version;

  // While the agents work, the page reads the narrative again every few seconds.
  useEffect(() => {
    if (!working) {
      return;
    }
    const timer = window.setInterval(() => router.refresh(), 3000);
    return () => window.clearInterval(timer);
  }, [working, router]);

  // The versions are read when the tab opens, and again after each change.
  useEffect(() => {
    if (tab !== "versions") {
      return;
    }
    let alive = true;
    const params = new URLSearchParams({
      intent: "process-versions",
      organization_id: ids.organizationId,
      project_id: ids.projectId,
      control_id: ids.controlId,
      v: String(version),
    });
    void fetch(`/workspace/control-context?${params.toString()}`, {
      cache: "no-store",
    })
      .then((response) => response.json())
      .then((body: { status?: unknown; versions?: unknown }) => {
        if (alive) {
          setVersions(
            body.status === 200 ? parseVersions(body.versions) : "failed",
          );
        }
      })
      .catch(() => {
        if (alive) {
          setVersions("failed");
        }
      });
    return () => {
      alive = false;
    };
  }, [tab, ids, version]);

  const edited = sections.map((item) => ({
    key: item.key,
    text: texts[item.key] ?? item.text,
    attributes: item.attributes,
  }));
  const [saving, setSaving] = useState<"" | "draft" | "approve">("");
  const approved = status === "CONFIRMED";
  const save = async (confirm: boolean) => {
    setSaving(confirm ? "approve" : "draft");
    const done = await run("process", {
      intent: "process-save",
      summary,
      sections: editing ? edited : sections,
      steps: steps.map(saved),
      version,
      confirm,
    });
    setSaving("");
    if (done) {
      setEditing(false);
      setTexts({});
    }
  };
  return (
    <section className="pn" aria-labelledby="pn-title">
      <header className="pn-head">
        <div>
          <h4 id="pn-title">
            Process narrative
            {has ? (
              <span
                className={`pn-status ${approved ? "is-approved" : "is-draft"}`}
              >
                {approved ? (
                  <>
                    <UiIcon name="check" size={11} /> Approved
                  </>
                ) : (
                  "Draft"
                )}
              </span>
            ) : null}
            {has ? (
              <span className={`pn-badge ${words.tone}`}>{words.label}</span>
            ) : null}
          </h4>
          <p>
            {approved
              ? "How the control operates at this client, as approved. The test plan follows it."
              : "Drafted from the confirmed answers and checked by a reviewer agent. Review and update as needed."}
          </p>
        </div>
        {canAct ? (
          <span className="pn-head-actions">
            {has ? (
              <button
                type="button"
                className="btn-secondary btn-sm"
                disabled={busy || working}
                onClick={() =>
                  void run("narrate", { intent: "process-review" })
                }
              >
                <UiIcon name="check" size={13} />
                Review again
              </button>
            ) : null}
            <button
              type="button"
              className="btn-secondary btn-sm"
              disabled={busy || working}
              onClick={() => void run("narrate", { intent: "process-narrate" })}
            >
              <UiIcon name="retry" size={13} />
              {has ? "Regenerate" : "Draft it"}
            </button>
          </span>
        ) : null}
      </header>

      {working && live !== null ? (
        <NarrativeProgress run={live} />
      ) : live?.status === "FAILED" ? (
        <p className="form-error" role="alert">
          {live.note || "The narrative could not be drafted. Try again."}
        </p>
      ) : null}

      {review !== null && !working ? (
        <div
          className={`pn-review ${
            current ? (review.passed ? "is-passed" : "is-held") : "is-stale"
          }`}
        >
          <p>
            <UiIcon
              name={
                current && review.passed
                  ? "check"
                  : review.version < 0
                    ? "info"
                    : "risk"
              }
              size={14}
            />
            <strong>{reviewHeadline(review, version)}</strong>
          </p>
          {current && review.findings.length > 0 ? (
            <ul>
              {review.findings.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
          {current && review.fixes.length > 0 ? (
            <details className="pn-fixes">
              <summary>
                Corrected by the reviewer ({review.fixes.length})
              </summary>
              <ul>
                {review.fixes.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </details>
          ) : null}
          {canAct ? (
            <span className="pn-review-actions">
              {reviewActions(review, version)
                .filter((item) => item !== "answer" || points)
                .map((item) => (
                  <button
                    key={item}
                    type="button"
                    className="btn-secondary btn-sm"
                    disabled={busy}
                    onClick={() => {
                      if (item === "answer") {
                        document.dispatchEvent(new Event(WALK_POINTS_EVENT));
                        return;
                      }
                      void run("narrate", {
                        intent:
                          item === "review"
                            ? "process-review"
                            : "process-narrate",
                      });
                    }}
                  >
                    <UiIcon
                      name={
                        item === "answer"
                          ? "compose"
                          : item === "review"
                            ? "check"
                            : "retry"
                      }
                      size={13}
                    />
                    {REVIEW_ACTION_LABELS[item]}
                  </button>
                ))}
            </span>
          ) : null}
        </div>
      ) : null}

      {/* An answer changed after approval: the approved narrative stands until a redraft
          from the new answers, placed beside it, is reviewed and approved (product owner,
          27 October 2026). */}
      {approved && changed.length > 0 && proposal === null && !working ? (
        <div className="pn-changed" role="status">
          <p>
            <UiIcon name="risk" size={14} />
            <span>
              <strong>
                {changed.length === 1
                  ? "An answer changed since this narrative was approved"
                  : `${changed.length} answers changed since this narrative was approved`}
              </strong>
              : {changed.map((question) => `“${question}”`).join(", ")}. The
              approved narrative stays as it is until a redraft from the new
              answers is approved.
            </span>
          </p>
          {canAct ? (
            <button
              type="button"
              className="btn-secondary btn-sm"
              disabled={busy}
              onClick={() => void run("narrate", { intent: "process-narrate" })}
            >
              <UiIcon name="retry" size={13} />
              Redraft to match
            </button>
          ) : null}
        </div>
      ) : null}

      {/* What the approved narrative changed in the test plan (0120). */}
      {!working && live?.planOutcome != null && status === "CONFIRMED" ? (
        <p className="pn-plan" role="status">
          <UiIcon name="layers" size={14} />
          <span>{planOutcomeLine(live.planOutcome)}</span>
          {canAct && live.planOutcome.evidenceFallback ? (
            <button
              type="button"
              className="btn-secondary btn-sm"
              disabled={busy}
              onClick={() =>
                void run("narrate", { intent: "process-update-plan" })
              }
            >
              <UiIcon name="retry" size={13} />
              Update the plan again
            </button>
          ) : null}
        </p>
      ) : null}

      {proposal !== null && canAct ? (
        <div className="pn-proposal">
          <p>
            <UiIcon name="sparkles" size={13} />A newer draft is ready beside
            this one
            {understanding?.proposedNote
              ? `: ${understanding.proposedNote}`
              : "."}
          </p>
          <span>
            <button
              type="button"
              className="btn-secondary btn-sm"
              aria-expanded={preview}
              onClick={() => setPreview(!preview)}
            >
              {preview ? "Hide it" : "Show it"}
            </button>
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy}
              onClick={() =>
                void run("process", { intent: "process-adopt", version })
              }
            >
              Use the newer draft
            </button>
          </span>
          {preview ? (
            <div className="pn-sections is-preview">
              {proposal.map((item) => (
                <section key={item.key}>
                  <h5>{item.heading}</h5>
                  <p>{item.text}</p>
                </section>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="pn-tabs" role="tablist" aria-label="The narrative">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? "is-on" : undefined}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "draft" ? (
        <div className="pn-panel" role="tabpanel">
          {sections.length > 0 ? (
            <article className="pn-doc" aria-labelledby="pn-doc-title">
              <header className="pn-doc-head">
                <span>
                  <h4 id="pn-doc-title">Control narrative</h4>
                  {subtitle !== "" ? <p>{subtitle}</p> : null}
                </span>
                {sections.some((item) => item.attributes.length > 0) ? (
                  <span className="pn-doc-toggle">
                    <span id="pn-doc-codes">Show attributes</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={showCodes}
                      aria-labelledby="pn-doc-codes"
                      className={`wt-switch${showCodes ? " is-on" : ""}`}
                      onClick={() => {
                        setShowCodes(!showCodes);
                        setFocus(null);
                      }}
                    >
                      <span />
                    </button>
                  </span>
                ) : null}
              </header>
              <ol className="pn-doc-sections">
                {sections.map((item, index) => (
                  <li key={item.key}>
                    <span className="pn-doc-num" aria-hidden="true">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div>
                      <h5>
                        {item.heading}
                        {showCodes
                          ? item.attributes.map((code) => (
                              <button
                                key={code}
                                type="button"
                                className={`pn-doc-chip${focus === code ? " is-on" : ""}`}
                                aria-pressed={focus === code}
                                title={
                                  attributes.find(
                                    (entry) => entry.code === code,
                                  )?.text ?? code
                                }
                                onClick={() =>
                                  setFocus(focus === code ? null : code)
                                }
                              >
                                {code}
                              </button>
                            ))
                          : null}
                      </h5>
                      {editing ? (
                        <textarea
                          className="pn-edit"
                          rows={4}
                          maxLength={3000}
                          value={texts[item.key] ?? item.text}
                          aria-label={item.heading}
                          onChange={(event) =>
                            setTexts({
                              ...texts,
                              [item.key]: event.target.value,
                            })
                          }
                        />
                      ) : (
                        <p>{withoutCodes(item.text)}</p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </article>
          ) : has && summary.trim() !== "" ? (
            <div className="pn-text">
              {paragraphs(summary).map((part) => (
                <p key={part}>{part}</p>
              ))}
            </div>
          ) : (
            <p className="pn-empty">
              The narrative is drafted from the confirmed answers once every
              question is answered.
            </p>
          )}
          {approved && !editing && sections.length > 0 ? (
            <div className="pn-approved" role="status">
              <span className="pn-approved-mark" aria-hidden="true">
                <UiIcon name="check" size={16} />
              </span>
              <span className="pn-approved-text">
                <strong>Narrative approved</strong>
                <small>
                  {[
                    understanding?.confirmedBy
                      ? `By ${understanding.confirmedBy}`
                      : "",
                    understanding?.confirmedAt
                      ? STAMP.format(new Date(understanding.confirmedAt))
                      : "",
                  ]
                    .filter((part) => part !== "")
                    .join(" · ")}
                  {working && live?.mode === "PLAN"
                    ? ". The attributes and evidence are being updated from it."
                    : "."}
                </small>
              </span>
              {canAct ? (
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={busy || working}
                  onClick={() => setEditing(true)}
                >
                  <UiIcon name="compose" size={13} />
                  Make changes
                </button>
              ) : null}
            </div>
          ) : canAct && sections.length > 0 ? (
            <div className="pn-actions">
              {editing ? (
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={() => {
                    setEditing(false);
                    setTexts({});
                  }}
                >
                  Cancel
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={working}
                  onClick={() => setEditing(true)}
                >
                  <UiIcon name="compose" size={13} />
                  Edit
                </button>
              )}
              <button
                type="button"
                className="btn-secondary btn-sm"
                disabled={busy || working}
                onClick={() => void save(false)}
              >
                {saving === "draft" ? "Saving…" : "Save as draft"}
              </button>
              {/* No reason is asked for (product owner, 26 October 2026): the approval
                  records whether the review stood for the narrative as approved. */}
              <button
                type="button"
                className="btn btn-sm"
                disabled={busy || working}
                onClick={() => void save(true)}
              >
                <UiIcon name="check" size={13} />
                {saving === "approve"
                  ? "Approving…"
                  : approved
                    ? "Approve the changes"
                    : "Approve narrative"}
              </button>
            </div>
          ) : null}
          {problem !== null ? (
            <p className="form-error" role="alert">
              {problem}
            </p>
          ) : null}
        </div>
      ) : tab === "flow" ? (
        <div className="pn-panel" role="tabpanel">
          {steps.length === 0 ? (
            <p className="pn-empty">
              The flow is drawn from the narrative's steps once it is drafted.
            </p>
          ) : (
            <ProcessFlow
              steps={steps}
              attributes={attributes}
              controlRef={controlRef}
            />
          )}
        </div>
      ) : tab === "versions" ? (
        <div className="pn-panel" role="tabpanel">
          {versions === null ? (
            <p className="pn-empty">Loading the versions…</p>
          ) : versions === "failed" ? (
            <p className="pn-empty">
              The versions could not be loaded. Try again.
            </p>
          ) : versions.length === 0 ? (
            <p className="pn-empty">No version is recorded yet.</p>
          ) : (
            <ol className="pn-versions">
              {versions.map((item, index) => (
                <li key={`${item.version}-${item.kind}-${item.at}`}>
                  <button
                    type="button"
                    aria-expanded={opened === index}
                    onClick={() => setOpened(opened === index ? null : index)}
                  >
                    <span className="cw-versions-v">v{item.version}</span>
                    <span className="pn-version-text">
                      <strong>{VERSION_KIND_LABELS[item.kind]}</strong>
                      <small>
                        {item.at !== "" ? STAMP.format(new Date(item.at)) : ""}
                        {item.actor !== null ? ` · ${item.actor}` : ""}
                        {item.builtBy === "AGENT"
                          ? " · AI generated"
                          : item.builtBy === "RULES" ||
                              item.builtBy === "FALLBACK"
                            ? " · From the rules"
                            : ""}
                      </small>
                    </span>
                    <UiIcon name="chevron" size={13} />
                  </button>
                  {opened === index ? (
                    <div className="pn-text is-preview">
                      {item.sections.length > 0
                        ? item.sections.map((section) => (
                            <p key={section.key}>
                              <strong>{section.heading}. </strong>
                              {section.text}
                            </p>
                          ))
                        : paragraphs(item.summary).map((part) => (
                            <p key={part}>{part}</p>
                          ))}
                      <small>
                        {item.steps.length}{" "}
                        {item.steps.length === 1 ? "step" : "steps"}
                      </small>
                    </div>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </div>
      ) : (
        <div className="pn-panel" role="tabpanel">
          {attributes.length === 0 ? (
            <p className="pn-empty">
              The control has no approved attributes yet.
            </p>
          ) : (
            <ul className="pn-testing">
              {attributes.map((item) => {
                const at = steps
                  .map((step, index) => ({ step, index }))
                  .filter(({ step }) => step.attributes.includes(item.code));
                return (
                  <li key={item.code}>
                    <span className="pa-code">{item.code}</span>
                    <span>
                      <strong>{item.text}</strong>
                      <small>
                        {(() => {
                          const explained = sections
                            .filter((section) =>
                              section.attributes.includes(item.code),
                            )
                            .map((section) => section.heading);
                          return explained.length === 0
                            ? "Not explained in any section yet · "
                            : `Explained in ${explained.join(", ")} · `;
                        })()}
                        {at.length === 0
                          ? "Not evaluated at a step yet"
                          : `Evaluated at step ${at.map(({ index }) => index + 1).join(", ")}`}
                        {item.procedures.length > 0
                          ? ` · Tested by ${item.procedures.join(", ")}`
                          : ""}
                      </small>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

/** What the narrative was drafted from, each opening where it is read or answered. */
export function NarrativeSources({ sources }: { sources: NarrativeSource[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? sources : sources.slice(0, 4);
  return (
    <section className="pn-card" aria-labelledby="pn-sources-title">
      <header>
        <h5 id="pn-sources-title">
          Sources used <span className="pn-count">{sources.length}</span>
        </h5>
        {sources.length > 4 ? (
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => setAll(!all)}
          >
            {all ? "Show fewer" : "View all sources"}
          </button>
        ) : null}
      </header>
      {sources.length === 0 ? (
        <p className="pn-empty">No answer or document is recorded yet.</p>
      ) : (
        <ol className="pn-sources">
          {shown.map((item, index) => (
            <li key={item.key}>
              <span className="pn-source-num">{index + 1}</span>
              <span
                className={`pn-source-icon is-${item.kind}`}
                aria-hidden="true"
              >
                <UiIcon
                  name={item.kind === "document" ? "file" : "help"}
                  size={14}
                />
              </span>
              <span className="pn-source-text">
                <strong>{item.title}</strong>
                <small>{item.detail}</small>
              </span>
              {item.kind === "answer" && item.slotKey !== undefined ? (
                <button
                  type="button"
                  className="pn-view"
                  onClick={() =>
                    document.dispatchEvent(
                      new CustomEvent(WALK_ASK_EVENT, {
                        detail: item.slotKey ?? "",
                      }),
                    )
                  }
                >
                  View
                </button>
              ) : item.href !== undefined ? (
                <a className="pn-view" href={item.href}>
                  View
                </a>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

const USES: Array<{ icon: IconName; title: string; detail: string }> = [
  {
    icon: "compose",
    title: "Plans",
    detail: "Shapes the test procedures and the evidence required",
  },
  {
    icon: "check",
    title: "Testing",
    detail: "The evidence is evaluated against how the control operates",
  },
  {
    icon: "file",
    title: "Evidence",
    detail: "Informs the evidence expected and its attributes",
  },
  {
    icon: "shield",
    title: "Review",
    detail: "Helps reviewers assess exceptions and conclusions",
  },
];

/** How the approved narrative is used across the engagement. */
export function NarrativeUses() {
  return (
    <section className="pn-card" aria-labelledby="pn-uses-title">
      <header>
        <h5 id="pn-uses-title">
          How this narrative will be used
          <span
            className="pn-info"
            title="Once approved, the narrative is the process understanding the plan, the evidence, the testing and the review rely on."
          >
            <UiIcon name="info" size={13} />
          </span>
        </h5>
      </header>
      <ul className="pn-uses">
        {USES.map((item) => (
          <li key={item.title}>
            <span className="pn-use-icon" aria-hidden="true">
              <UiIcon name={item.icon} size={15} />
            </span>
            <span>
              <strong>{item.title}</strong>
              <small>{item.detail}</small>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * What the agents are doing while they work (decided by the product owner on 26 October
 * 2026: "a real status so that the user knows what's happening"): each step with what it
 * does, which are done, the one under way and for how long. The page reads the run again
 * every few seconds; the clock ticks in between.
 */
function NarrativeProgress({ run }: { run: NarrativeRun }) {
  // Set after the first render, so the server and the browser draw the same thing.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const { steps, seconds } = narrativeProgress(run, now ?? 0);
  const done = steps.filter((step) => step.state === "done").length;
  const active = steps.find((step) => step.state === "active");
  const timed = now !== null && run.status === "WORKING";
  return (
    <div className="pn-progress" role="status" aria-live="polite">
      <header>
        <span className="ng-orb is-small" aria-hidden="true" />
        <strong>
          {run.mode === "PLAN"
            ? `Updating the test plan from the approved narrative${run.status === "PENDING" ? "…" : `: ${(active?.label ?? "working").toLowerCase()}…`}`
            : run.status === "PENDING"
              ? "Starting the agents…"
              : `${active?.label ?? "Working"}…`}
        </strong>
        {timed ? (
          <span className="pn-progress-time">{clock(seconds)}</span>
        ) : null}
      </header>
      <span className="pn-progress-bar" aria-hidden="true">
        <span
          style={{ width: `${Math.round((done / steps.length) * 100)}%` }}
        />
      </span>
      <ol>
        {steps.map((step) => (
          <li key={step.key} className={`is-${step.state}`}>
            <span className="pn-step-mark" aria-hidden="true">
              {step.state === "done" ? <UiIcon name="check" size={12} /> : null}
            </span>
            <span className="pn-step-text">
              <strong>{step.label}</strong>
              <small>{step.detail}</small>
            </span>
            {step.state === "active" && timed ? (
              <span className="pn-step-time">{clock(step.seconds)}</span>
            ) : null}
            <span className="sr-only">
              {step.state === "done"
                ? "Done"
                : step.state === "active"
                  ? "In progress"
                  : "Waiting"}
            </span>
          </li>
        ))}
      </ol>
      <p className="pn-progress-note">
        {run.mode === "PLAN"
          ? "Usually one to two minutes. Nothing approved changes on its own: the changes wait on the Attributes and Evidence tabs for a decision."
          : "Usually one to two minutes. The narrative appears here when the review is done."}
      </p>
    </div>
  );
}
