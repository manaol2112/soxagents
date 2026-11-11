"use client";

import { useCallback, useEffect, useState } from "react";
import {
  COLUMNS,
  cell,
  changes,
  checkDraft,
  type Draft,
  draftFrom,
  type EngagementMethodology,
  engagementLine,
  FREQUENCIES,
  FREQUENCY_LABELS,
  type Methodology,
  type MethodologyVersion,
  methodologyProblem,
  parseEngagement,
  parseMethodology,
  provenance,
  type Rules,
  rulesBody,
  standing,
} from "./methodology-model";
import { UiIcon } from "./ui-icon";

type Reply = { status: number; detail: string; result: unknown };

async function call(
  method: "GET" | "POST",
  query: string,
  body?: Record<string, unknown>,
): Promise<Reply> {
  try {
    const response = await fetch(`/workspace/testing-methodology${query}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? null : JSON.stringify(body),
      cache: "no-store",
    });
    return (await response.json()) as Reply;
  } catch {
    return { status: 0, detail: "", result: null };
  }
}

/**
 * Settings › Testing methodology (product owner, 8 November 2026): the rules that size and
 * conclude testing on every engagement, in versions the firm approves. The version in force
 * and its standing lead; a change is proposed with its reason and decided by another Owner or
 * Admin; this engagement says which version it follows. Every figure is the API's.
 */
export function MethodologyMain({
  organizationId,
  projectId,
  organizationName,
}: {
  organizationId: string;
  projectId: string | null;
  organizationName: string;
}) {
  const [firm, setFirm] = useState<Methodology | null>(null);
  const [engagement, setEngagement] = useState<EngagementMethodology | null>(
    null,
  );
  const [loaded, setLoaded] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const [read, here] = await Promise.all([
      call("GET", `?organization=${organizationId}`),
      projectId === null
        ? Promise.resolve(null)
        : call("GET", `?organization=${organizationId}&project=${projectId}`),
    ]);
    setFirm(read.status === 200 ? parseMethodology(read.result) : null);
    setEngagement(
      here !== null && here.status === 200
        ? parseEngagement(here.result)
        : null,
    );
    setLoaded(true);
  }, [organizationId, projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** A change, shown as done only once the server confirms it. */
  async function write(
    fields: Record<string, unknown>,
    done: string,
  ): Promise<boolean> {
    setProblem(null);
    setNotice("");
    const reply = await call("POST", "", {
      organization_id: organizationId,
      ...fields,
    });
    if (reply.status !== 200) {
      setProblem(methodologyProblem(reply.status, reply.detail));
      return false;
    }
    await load();
    setNotice(done);
    return true;
  }

  if (!loaded) {
    return (
      <div className="page">
        <section className="card tm-card" aria-busy="true">
          <div className="card-body">
            <p className="form-hint">Reading the firm's testing methodology…</p>
          </div>
        </section>
      </div>
    );
  }
  if (firm === null) {
    return (
      <div className="page">
        <section className="card tm-card">
          <div className="card-body">
            <h2>Testing methodology</h2>
            <p className="form-hint" role="alert">
              The firm's testing methodology could not be read. Reload the page
              to try again.
            </p>
          </div>
        </section>
      </div>
    );
  }
  const current = firm.current;
  const state = standing(current);
  return (
    <div className="page tm-page">
      <section className="card tm-card" aria-labelledby="tm-title">
        <header className="card-header tm-head">
          <div>
            <p className="page-context">{organizationName}</p>
            <h2 id="tm-title">Testing methodology</h2>
            <p className="tm-lead">
              The rules that size and conclude testing on the firm's
              engagements. No auditing standard prescribes them: the firm
              approves its own.
            </p>
          </div>
          <span className={`pill pill-dot tone-${state.tone}`}>
            Version {current.number} · {state.label}
          </span>
        </header>
        <div className="card-body">
          {current.status === "PLATFORM_DEFAULT" ? (
            <div className="tm-notice tone-warning" role="note">
              <UiIcon name="info" size={16} />
              <p>
                These are the platform's default rules. Engagements use them
                until the firm approves a version of its own; review them with
                the firm's methodology owner.
              </p>
            </div>
          ) : null}
          {!firm.independence ? (
            <div className="tm-notice tone-info" role="note">
              <UiIcon name="info" size={16} />
              <p>
                Independent review is off in this environment: the person who
                proposes a change may also approve it. Real engagements always
                need a second Owner or Admin.
              </p>
            </div>
          ) : null}
          {engagement !== null ? (
            <EngagementStrip
              engagement={engagement}
              onMove={(versionId, reason) =>
                write(
                  {
                    intent: "move",
                    project_id: projectId,
                    version_id: versionId,
                    reason,
                  },
                  "This engagement follows the version chosen from now on.",
                )
              }
            />
          ) : null}
          {firm.pending !== null ? (
            <PendingCard
              firm={firm}
              pending={firm.pending}
              onDecide={(decision, note) =>
                write(
                  {
                    intent: "decide",
                    version_id: firm.pending?.id,
                    version: firm.pending?.version,
                    decision,
                    note,
                  },
                  decision === "APPROVE"
                    ? "Approved. New engagements follow this version."
                    : "Rejected. The version in force is unchanged.",
                )
              }
              onWithdraw={() =>
                write(
                  {
                    intent: "withdraw",
                    version_id: firm.pending?.id,
                    version: firm.pending?.version,
                  },
                  "The proposal is withdrawn.",
                )
              }
            />
          ) : null}
          <RulesSection
            firm={firm}
            onPropose={(rules, rationale) =>
              write(
                {
                  intent: "propose",
                  based_on: current.id,
                  rules: rulesBody(rules),
                  rationale,
                },
                "Proposed. It takes effect once another Owner or Admin approves it.",
              )
            }
          />
          {problem !== null ? (
            <p className="cc-problem" role="alert">
              {problem}
            </p>
          ) : null}
          {notice !== "" ? (
            <p className="tm-done" role="status">
              <UiIcon name="check" size={14} />
              {notice}
            </p>
          ) : null}
          <History versions={firm.history} />
        </div>
      </section>
    </div>
  );
}

function RulesTable({
  rules,
  draft,
  changed,
  limits,
  onEdit,
  caption,
}: {
  rules: Rules;
  draft: Draft | null;
  changed: Set<string>;
  limits: { maxSample: number; maxWaitDays: number };
  onEdit?: (column: keyof Draft, key: string, value: string) => void;
  caption: string;
}) {
  return (
    <div className="tm-table-wrap">
      <table className="table tm-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Control frequency</th>
            {COLUMNS.map((column) => (
              <th key={column.key} scope="col" className="tm-num">
                {column.label}
                <small>{column.unit}</small>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {FREQUENCIES.map((key) => (
            <tr key={key}>
              <th scope="row">{FREQUENCY_LABELS[key]}</th>
              {COLUMNS.map((column) => {
                const mark = changed.has(`${column.key}:${key}`);
                return (
                  <td
                    key={column.key}
                    className={`tm-num${mark ? " is-changed" : ""}`}
                  >
                    {draft !== null && onEdit !== undefined ? (
                      <input
                        type="number"
                        inputMode="numeric"
                        min={column.key === "retestDays" ? 0 : 1}
                        max={
                          column.key === "retestDays"
                            ? limits.maxWaitDays
                            : limits.maxSample
                        }
                        value={draft[column.key][key]}
                        aria-label={`${column.label} (${column.unit}), ${FREQUENCY_LABELS[key]}`}
                        onChange={(event) =>
                          onEdit(column.key, key, event.target.value)
                        }
                      />
                    ) : (
                      cell(rules, column.key, key)
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FixedRules() {
  return (
    <dl className="tm-fixed">
      <div>
        <dt>Deviations</dt>
        <dd>
          None allowed: any confirmed exception concludes the control not
          effective.
          <small>
            Allowing a deviation with an expanded sample comes in a later
            release.
          </small>
        </dd>
      </div>
      <div>
        <dt>Automated controls</dt>
        <dd>
          Tested once, by their configuration, in every phase.
          <small>
            Benchmarking in later years comes with the control risk rating.
          </small>
        </dd>
      </div>
    </dl>
  );
}

function RulesSection({
  firm,
  onPropose,
}: {
  firm: Methodology;
  onPropose: (rules: Rules, rationale: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const current = firm.current;
  const limits = { maxSample: firm.maxSample, maxWaitDays: firm.maxWaitDays };
  const checked =
    draft === null ? null : checkDraft(draft, current.rules, limits);
  const changed =
    checked?.ok === true
      ? changes(current.rules, checked.rules)
      : new Set<string>();

  async function send() {
    if (draft === null) {
      return;
    }
    const result = checkDraft(draft, current.rules, limits);
    if (!result.ok) {
      setProblems(result.problems);
      return;
    }
    setProblems([]);
    setSaving(true);
    const ok = await onPropose(result.rules, draft.rationale.trim());
    setSaving(false);
    if (ok) {
      setDraft(null);
    }
  }

  return (
    <section className="tm-section" aria-labelledby="tm-rules">
      <div className="tm-section-head">
        <h3 id="tm-rules">
          {draft === null
            ? `Version ${current.number} in force`
            : `Proposed change to version ${current.number}`}
        </h3>
        {draft === null && firm.canPropose ? (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              setProblems([]);
              setDraft(draftFrom(current.rules));
            }}
          >
            Propose a change
          </button>
        ) : null}
      </div>
      <p className="tm-provenance">{provenance(current)}</p>
      {/* The default's own note says what the provenance line already says. */}
      {current.rationale !== "" &&
      draft === null &&
      current.status !== "PLATFORM_DEFAULT" ? (
        <p className="tm-rationale">{current.rationale}</p>
      ) : null}
      <RulesTable
        rules={current.rules}
        draft={draft}
        changed={changed}
        limits={limits}
        caption={`Sample sizes by control frequency, version ${current.number}`}
        onEdit={(column, key, value) =>
          setDraft((now) =>
            now === null || column === "rationale"
              ? now
              : { ...now, [column]: { ...now[column], [key]: value } },
          )
        }
      />
      <FixedRules />
      {draft !== null ? (
        <div className="tm-propose">
          <label htmlFor="tm-rationale">
            Why it changes, and what it rests on
            <small>
              For example the section of the firm's methodology manual.
            </small>
          </label>
          <textarea
            id="tm-rationale"
            rows={3}
            maxLength={2000}
            value={draft.rationale}
            onChange={(event) =>
              setDraft((now) =>
                now === null ? now : { ...now, rationale: event.target.value },
              )
            }
          />
          {problems.length > 0 ? (
            <ul className="cc-problem tm-problems" role="alert">
              {problems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : checked?.ok ? (
            <p className="form-hint">
              {checked.changed}{" "}
              {checked.changed === 1 ? "value changes" : "values change"}.
              Another Owner or Admin approves it before it takes effect.
            </p>
          ) : null}
          <div className="tm-actions">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={saving}
              onClick={() => {
                setDraft(null);
                setProblems([]);
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn"
              disabled={saving}
              onClick={() => void send()}
            >
              {saving ? (
                <span className="spinner small" aria-hidden="true" />
              ) : null}
              {saving ? "Submitting…" : "Submit for approval"}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function PendingCard({
  firm,
  pending,
  onDecide,
  onWithdraw,
}: {
  firm: Methodology;
  pending: MethodologyVersion;
  onDecide: (decision: "APPROVE" | "REJECT", note: string) => Promise<boolean>;
  onWithdraw: () => Promise<boolean>;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const changed = changes(firm.current.rules, pending.rules);
  async function run(label: string, action: () => Promise<boolean>) {
    setBusy(label);
    await action();
    setBusy("");
  }
  return (
    <section className="tm-section tm-pending" aria-labelledby="tm-pending">
      <div className="tm-section-head">
        <h3 id="tm-pending">Version {pending.number} waits for approval</h3>
        <span className="pill pill-dot tone-info">
          {changed.size}{" "}
          {changed.size === 1 ? "value changes" : "values change"}
        </span>
      </div>
      <p className="tm-provenance">{provenance(pending)}</p>
      <p className="tm-rationale">{pending.rationale}</p>
      <RulesTable
        rules={pending.rules}
        draft={null}
        changed={changed}
        limits={{ maxSample: firm.maxSample, maxWaitDays: firm.maxWaitDays }}
        caption={`Proposed sample sizes, version ${pending.number}; changed values are marked`}
      />
      {firm.canDecide ? (
        <div className="tm-propose">
          <label htmlFor="tm-note">
            Note on the decision
            <small>Required to reject; kept with the decision.</small>
          </label>
          <textarea
            id="tm-note"
            rows={2}
            maxLength={1000}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <div className="tm-actions">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy !== ""}
              onClick={() =>
                void run("reject", () => onDecide("REJECT", note.trim()))
              }
            >
              {busy === "reject" ? "Rejecting…" : "Reject"}
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy !== ""}
              onClick={() =>
                void run("approve", () => onDecide("APPROVE", note.trim()))
              }
            >
              {busy === "approve" ? (
                <span className="spinner small" aria-hidden="true" />
              ) : null}
              {busy === "approve" ? "Approving…" : "Approve version"}
            </button>
          </div>
        </div>
      ) : (
        <p className="form-hint">
          {firm.canWithdraw
            ? "Another Owner or Admin decides it. Until then the version in force applies."
            : "An Owner or Admin other than the person who proposed it decides it."}
        </p>
      )}
      {firm.canWithdraw ? (
        <div className="tm-actions">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={busy !== ""}
            onClick={() => void run("withdraw", onWithdraw)}
          >
            {busy === "withdraw" ? "Withdrawing…" : "Withdraw proposal"}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function EngagementStrip({
  engagement,
  onMove,
}: {
  engagement: EngagementMethodology;
  onMove: (versionId: string, reason: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState(engagement.choices[0]?.id ?? "");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <section className="tm-engagement" aria-labelledby="tm-engagement">
      <div className="tm-engagement-head">
        <div>
          <h3 id="tm-engagement">This engagement</h3>
          <p>{engagementLine(engagement)}</p>
        </div>
        {engagement.canMove && engagement.choices.length > 0 && !open ? (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              // The choices are the ones read now, not when the page first opened.
              setTarget(engagement.choices[0]?.id ?? "");
              setOpen(true);
            }}
          >
            Change version
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="tm-propose">
          <label htmlFor="tm-move-version">Version to follow</label>
          <select
            id="tm-move-version"
            value={target}
            onChange={(event) => setTarget(event.target.value)}
          >
            {engagement.choices.map((item) => (
              <option key={item.id} value={item.id}>
                Version {item.number} · {standing(item).label}
              </option>
            ))}
          </select>
          <label htmlFor="tm-move-reason">
            Why this engagement changes version
            <small>
              Kept with the change. What is already sized keeps its size.
            </small>
          </label>
          <textarea
            id="tm-move-reason"
            rows={2}
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <div className="tm-actions">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={saving}
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn"
              disabled={saving || target === "" || reason.trim().length < 10}
              onClick={async () => {
                setSaving(true);
                const ok = await onMove(target, reason.trim());
                setSaving(false);
                if (ok) {
                  setOpen(false);
                  setReason("");
                }
              }}
            >
              {saving ? "Saving…" : "Change version"}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function History({ versions }: { versions: MethodologyVersion[] }) {
  if (versions.length <= 1) {
    return null;
  }
  return (
    <details className="tm-history">
      <summary>Version history ({versions.length})</summary>
      <ul>
        {versions.map((item) => {
          const state = standing(item);
          return (
            <li key={item.id}>
              <strong>Version {item.number}</strong>
              <span className={`pill tone-${state.tone}`}>{state.label}</span>
              <span className="tm-provenance">{provenance(item)}</span>
              {item.decisionNote !== "" ? (
                <span className="tm-rationale">Note: {item.decisionNote}</span>
              ) : null}
              <span className="tm-count">
                {item.engagements}{" "}
                {item.engagements === 1 ? "engagement" : "engagements"}
              </span>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
