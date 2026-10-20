"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { formatDate } from "./format";
import { libraryHref } from "./library-model";
import {
  BASIS_LABELS,
  BASIS_MEANINGS,
  basisLine,
  basisProblem,
  type Candidate,
  MATCH_LABELS,
  MATCH_TONES,
  standardNote,
  TEST_BASES,
  type TestBasis,
  type TestBasisKind,
} from "./test-basis-model";
import { UiIcon } from "./ui-icon";

type Ids = { organizationId: string; projectId: string; controlId: string };

/** One call to the test-basis route; refreshes the page when it succeeds. */
function useBasisAction(ids: Ids) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  async function run(
    label: string,
    fields: Record<string, unknown>,
  ): Promise<boolean> {
    setBusy(label);
    setProblem(null);
    let status = 0;
    let detail = "";
    try {
      const response = await fetch("/workspace/test-basis", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organization_id: ids.organizationId,
          project_id: ids.projectId,
          control_id: ids.controlId,
          ...fields,
        }),
      });
      const answer = (await response.json()) as {
        status?: unknown;
        detail?: unknown;
      };
      status = typeof answer.status === "number" ? answer.status : 0;
      detail = typeof answer.detail === "string" ? answer.detail : "";
    } catch {
      status = 0;
    }
    setBusy("");
    const message = basisProblem(status, detail);
    setProblem(message);
    if (message === null) {
      startTransition(() => router.refresh());
    }
    return message === null;
  }
  return { run, busy, pending: pending || busy !== "", problem };
}

/**
 * What the control's test plan is built from, and the standard it could follow: the
 * basis a person chose (or the default by source), the candidates the rules or the model
 * proposed with their status and rationale, and the decision. Nothing is adopted until
 * a person chooses; the plan then goes through its approval as any other.
 */
export function TestBasisCard({
  ids,
  basis,
}: {
  ids: Ids;
  basis: TestBasis | null;
}) {
  const action = useBasisAction(ids);
  const noteId = useId();
  const [choosing, setChoosing] = useState<{
    basis: TestBasisKind;
    libraryKey: string | null;
  } | null>(null);
  const [note, setNote] = useState("");
  const [showClient, setShowClient] = useState(false);
  if (basis === null) {
    return null;
  }
  const library = (key: string) =>
    libraryHref(ids.organizationId, ids.projectId, { control: key });
  const choose = (next: TestBasisKind, libraryKey: string | null) => {
    setChoosing({ basis: next, libraryKey });
    setNote("");
  };
  const standardKey = basis.standard?.libraryKey ?? null;
  const candidates = basis.candidates.filter(
    (item) => item.status !== "NONE" || item.rank === 1,
  );
  return (
    <section className="cw-plain tb" aria-labelledby="tb-title">
      <header className="cw-def-head">
        <h2 id="tb-title">Test basis</h2>
        <span className={`cx-status ${basis.decided ? "tone-success" : ""}`}>
          {BASIS_LABELS[basis.basis]}
        </span>
      </header>
      <p className="tb-line">{basisLine(basis)}</p>
      <p className="tb-meaning">{BASIS_MEANINGS[basis.basis]}</p>
      {basis.decided && basis.decidedBy !== null && basis.decidedAt !== null ? (
        <p className="tb-sub">
          Decided by {basis.decidedBy}, {formatDate(basis.decidedAt)}
          {basis.note !== "" ? `: ${basis.note}` : "."}
        </p>
      ) : (
        <p className="tb-sub">
          No decision recorded: the default for a{" "}
          {basis.source === "LIBRARY" ? "library" : "client's"} control.
        </p>
      )}
      {basis.standard !== null &&
      standardNote(basis.standard.libraryStatus) !== "" ? (
        <p className="tb-flag">
          <UiIcon name="info" size={13} />
          <span>
            {basis.standard.controlRef} is{" "}
            {standardNote(basis.standard.libraryStatus).toLowerCase()} on the
            Library. Following it is allowed; the plan review says so.{" "}
            <a href={library(basis.standard.libraryKey)}>Open the standard</a>
          </span>
        </p>
      ) : null}

      {basis.clientProcedures.length > 0 ? (
        <details
          className="tb-fold"
          open={showClient}
          onToggle={(event) => setShowClient(event.currentTarget.open)}
        >
          <summary>
            The client's documented test{" "}
            {basis.clientProcedures.length === 1 ? "procedure" : "procedures"} (
            {basis.clientProcedures.length})
          </summary>
          <ul className="tb-client">
            {basis.clientProcedures.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </details>
      ) : null}

      {basis.canDecide ? (
        <div className="tb-actions">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={action.pending}
            onClick={() => action.run("match", { intent: "match" })}
          >
            <UiIcon name="sparkles" size={13} />
            {action.busy === "match"
              ? "Looking for a standard…"
              : basis.run === null
                ? "Find a standard"
                : "Look again"}
          </button>
          {basis.basis !== "CLIENT" ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={action.pending}
              onClick={() => choose("CLIENT", null)}
            >
              Use the client's procedures
            </button>
          ) : null}
          {standardKey !== null && basis.basis !== "STANDARD" ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={action.pending}
              onClick={() => choose("STANDARD", standardKey)}
            >
              Follow the standard as is
            </button>
          ) : null}
          {standardKey !== null && basis.basis !== "CUSTOM" ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={action.pending}
              onClick={() => choose("CUSTOM", standardKey)}
            >
              Tailor the standard
            </button>
          ) : null}
        </div>
      ) : null}

      {basis.run !== null ? (
        <section className="tb-candidates" aria-label="Candidate standards">
          <h3>
            Candidate standards
            <small>
              {basis.run.decidedBy === "MODEL"
                ? "Adjudicated by the agent, checked by the rules"
                : "Ranked by the rules"}
              {" · "}
              {formatDate(basis.run.computedAt)}
            </small>
          </h3>
          {basis.run.note !== "" ? (
            <p className="tb-sub">{basis.run.note}</p>
          ) : null}
          {basis.run.noMatch ? (
            <p className="tb-none">
              No reliable match: none of the standards is this control as
              described. Keep the client's procedures, or propose a new standard
              on the Library.
            </p>
          ) : null}
          <ul className="tb-list">
            {candidates.map((item) => (
              <CandidateRow
                key={item.libraryKey}
                item={item}
                current={item.libraryKey === standardKey}
                canDecide={basis.canDecide}
                pending={action.pending}
                href={library(item.libraryKey)}
                onChoose={(next) => choose(next, item.libraryKey)}
              />
            ))}
          </ul>
        </section>
      ) : basis.source !== "LIBRARY" ? (
        <p className="tb-sub">
          No standard has been looked for yet. Finding one proposes candidates;
          a person decides.
        </p>
      ) : null}

      {choosing !== null ? (
        <div className="tb-decide">
          <p className="tb-decide-title">
            {choosing.basis === "CLIENT"
              ? "Use the client's documented procedures as the test basis"
              : choosing.basis === "STANDARD"
                ? `Follow ${choosing.libraryKey ?? "the standard"} as the test basis`
                : `Start from ${choosing.libraryKey ?? "the standard"} and tailor it`}
          </p>
          <p className="tb-sub">
            {BASIS_MEANINGS[choosing.basis]}
            {choosing.basis !== "CLIENT" && choosing.libraryKey !== standardKey
              ? " The standard's attributes are proposed for you to decide; the client's own stay for you to keep or retire; the control is planned again and the plan goes for approval."
              : ""}
          </p>
          <label htmlFor={noteId}>Why (optional), kept with the decision</label>
          <textarea
            id={noteId}
            rows={2}
            maxLength={1000}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <div className="tb-actions">
            <button
              type="button"
              className="btn btn-sm"
              disabled={action.pending}
              onClick={async () => {
                const done = await action.run("basis", {
                  intent: "basis",
                  basis: choosing.basis,
                  library_key: choosing.libraryKey ?? "",
                  note,
                });
                if (done) {
                  setChoosing(null);
                }
              }}
            >
              {action.busy === "basis" ? "Saving…" : "Confirm"}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setChoosing(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {action.problem !== null ? (
        <p className="cw-problem" role="alert">
          {action.problem}
        </p>
      ) : null}
    </section>
  );
}

function CandidateRow({
  item,
  current,
  canDecide,
  pending,
  href,
  onChoose,
}: {
  item: Candidate;
  current: boolean;
  canDecide: boolean;
  pending: boolean;
  href: string;
  onChoose: (basis: TestBasisKind) => void;
}) {
  return (
    <li className={`tb-candidate is-${item.status.toLowerCase()}`}>
      <details open={item.rank === 1 ? true : undefined}>
        <summary>
          <span className="lb-ref">{item.controlRef}</span>
          <span className="tb-candidate-title">
            <strong>{item.title}</strong>
            {item.objective !== "" ? <small>{item.objective}</small> : null}
          </span>
          <span className={`pill pill-dot ${MATCH_TONES[item.status]}`}>
            {MATCH_LABELS[item.status]}
          </span>
          {current ? <span className="pill">Following</span> : null}
          <UiIcon name="chevron" size={14} />
        </summary>
        <div className="tb-candidate-body">
          <p className="tb-text">{item.rationale}</p>
          {standardNote(item.libraryStatus) !== "" ? (
            <p className="tb-sub">
              {standardNote(item.libraryStatus)} on the Library.
            </p>
          ) : null}
          <dl className="lb-facts">
            {item.applicable.length > 0 ? (
              <div>
                <dt>Attributes that apply</dt>
                <dd>
                  <ul className="lb-bullets">
                    {item.applicable.map((entry) => (
                      <li key={entry}>{entry}</li>
                    ))}
                  </ul>
                </dd>
              </div>
            ) : null}
            {item.excluded.length > 0 ? (
              <div>
                <dt>Excluded</dt>
                <dd>
                  <ul className="lb-bullets">
                    {item.excluded.map((entry) => (
                      <li key={entry.key}>
                        {entry.key}
                        {entry.reason !== "" ? (
                          <small>{entry.reason}</small>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
            ) : null}
            {item.missing.length > 0 ? (
              <div>
                <dt>Not stated by the control</dt>
                <dd>
                  <ul className="lb-bullets">
                    {item.missing.map((entry) => (
                      <li key={entry}>{entry}</li>
                    ))}
                  </ul>
                </dd>
              </div>
            ) : null}
          </dl>
          <div className="tb-actions">
            <a className="cw-open" href={href}>
              Open the standard
              <UiIcon name="arrow" size={13} />
            </a>
            {canDecide && !current && item.status !== "NONE" ? (
              <>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={pending}
                  onClick={() => onChoose("STANDARD")}
                >
                  Follow this standard
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={pending}
                  onClick={() => onChoose("CUSTOM")}
                >
                  Start from it and tailor
                </button>
              </>
            ) : null}
          </div>
        </div>
      </details>
    </li>
  );
}

export { TEST_BASES };
