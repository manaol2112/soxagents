"use client";

import { useState } from "react";

import {
  matchesSummary,
  parseStandardMatches,
  type StandardMatches,
} from "./standard-matches-model";
import { UiIcon } from "./ui-icon";

type Ids = { organizationId: string; projectId: string };

async function write(ids: Ids, body: Record<string, unknown>) {
  try {
    const response = await fetch("/workspace/references", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        organization_id: ids.organizationId,
        project_id: ids.projectId,
        ...body,
      }),
    });
    const answer = (await response.json()) as {
      status?: unknown;
      answer?: unknown;
      detail?: unknown;
    };
    return {
      status: typeof answer.status === "number" ? answer.status : 0,
      answer: answer.answer ?? null,
      detail: typeof answer.detail === "string" ? answer.detail : "",
    };
  } catch {
    return { status: 0, answer: null, detail: "" };
  }
}

/**
 * The client's controls that match a firm standard (decided by the product owner on 25
 * October 2026): matched by the rules when the RCM is imported, confirmed by a person as
 * one decision. Each confirmed control is then planned from its standard's procedures.
 */
export function StandardMatchesCard({
  ids,
  initial,
  editable,
}: {
  ids: Ids;
  initial: StandardMatches | null;
  editable: boolean;
}) {
  const [matches, setMatches] = useState(initial);
  const [chosen, setChosen] = useState<string[]>(
    () => initial?.strong.map((item) => item.controlId) ?? [],
  );
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [done, setDone] = useState("");
  const summary = matchesSummary(matches);
  if (summary === null && done === "") {
    return null;
  }
  const refresh = (next: unknown) => {
    const parsed = parseStandardMatches(next);
    setMatches(parsed);
    setChosen(parsed?.strong.map((item) => item.controlId) ?? []);
  };
  const match = async () => {
    setBusy(true);
    setProblem("");
    const answer = await write(ids, { intent: "standard-match" });
    setBusy(false);
    if (answer.status === 200) {
      refresh(answer.answer);
      return;
    }
    setProblem("The controls could not be matched. Try again.");
  };
  const adopt = async () => {
    setBusy(true);
    setProblem("");
    const answer = await write(ids, {
      intent: "standard-adopt",
      control_ids: chosen,
    });
    if (answer.status !== 200) {
      setBusy(false);
      setProblem(
        answer.status === 409
          ? "A control changed since the list was shown. Match again to see it as it stands."
          : "The decision could not be saved. Try again.",
      );
      return;
    }
    const result = answer.answer as {
      adopted?: unknown;
      replanned?: unknown;
    } | null;
    const count =
      typeof result?.adopted === "number" ? result.adopted : chosen.length;
    setDone(
      `${count} control${count === 1 ? " now follows its" : "s now follow their"} standard. ${
        result?.replanned === true
          ? "Their test plans were drawn up again from the standard's procedures, for approval in Planning."
          : "They are planned from the standard's procedures when the scope is finalized."
      }`,
    );
    const fresh = await write(ids, { intent: "standard-matches" });
    setBusy(false);
    if (fresh.status === 200) {
      refresh(fresh.answer);
    }
  };
  return (
    <section className="card sm-card" aria-labelledby="sm-title">
      {done !== "" ? (
        <p className="ry-saved" role="status">
          <UiIcon name="check" size={14} />
          {done}
        </p>
      ) : null}
      {summary !== null ? (
        <>
          <header className="ry-review-head">
            <span className="ry-card-icon is-ai" aria-hidden="true">
              <UiIcon name="sparkles" size={16} />
            </span>
            <div>
              <h3 id="sm-title">{summary.title}</h3>
              <p className="ry-muted">{summary.detail}</p>
            </div>
            {editable && matches !== null && matches.strong.length === 0 ? (
              <button
                type="button"
                className="btn btn-sm"
                disabled={busy}
                onClick={match}
              >
                {busy ? "Matching…" : "Match to the standards"}
              </button>
            ) : null}
          </header>
          {matches !== null && matches.strong.length > 0 ? (
            <>
              <ul className="ry-matches">
                {matches.strong.map((item) => (
                  <li key={item.controlId}>
                    <label className="ry-match">
                      <input
                        type="checkbox"
                        hidden={!editable}
                        disabled={!editable || busy}
                        checked={chosen.includes(item.controlId)}
                        onChange={() =>
                          setChosen((list) =>
                            list.includes(item.controlId)
                              ? list.filter((id) => id !== item.controlId)
                              : [...list, item.controlId],
                          )
                        }
                      />
                      <span className="ry-now">
                        <strong>{item.controlRef}</strong> {item.title}
                        {item.system !== "" ? (
                          <span className="ry-muted"> · {item.system}</span>
                        ) : null}
                      </span>
                      <UiIcon name="arrow" size={12} />
                      <span className="ry-now">
                        <strong>{item.standardRef}</strong> {item.standardTitle}
                      </span>
                      <span className="sc-scope">Strong match</span>
                    </label>
                    <button
                      type="button"
                      className="ry-link"
                      aria-expanded={open === item.controlId}
                      onClick={() =>
                        setOpen(open === item.controlId ? null : item.controlId)
                      }
                    >
                      {open === item.controlId ? "Hide why" : "Why it matches"}
                    </button>
                    {open === item.controlId ? (
                      <p className="ry-excerpt">{item.rationale}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
              {problem !== "" ? (
                <p className="as-problem" role="alert">
                  {problem}
                </p>
              ) : null}
              {editable ? (
                <div className="ry-actions">
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={busy || chosen.length === 0}
                    onClick={adopt}
                  >
                    <UiIcon name="check" size={14} />
                    {busy
                      ? "Saving…"
                      : `Follow ${chosen.length} standard${chosen.length === 1 ? "" : "s"}`}
                  </button>
                </div>
              ) : null}
            </>
          ) : problem !== "" ? (
            <p className="as-problem" role="alert">
              {problem}
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
