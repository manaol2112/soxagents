"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { categoryOf } from "./client-walkthrough-model";
import { UiIcon } from "./ui-icon";
import {
  type CopyOffer,
  controlLabel,
  copyLabel,
  initialSelection,
  rowsFor,
  selectable,
} from "./understanding-copy-model";

type Ids = { organizationId: string; projectId: string; controlId: string };

const STATE_WORDS = {
  prior: "Prior answer",
  check: "Check applicability",
  replaces: "Replaces this answer",
  same: "Already the same",
} as const;

/**
 * Bring forward prior answers (the product owner's reference, 28 October 2026): another
 * control's answers, from a system whose process is the same, reviewed and copied here.
 * The prior answers are ticked to start; one that may not hold for this system, or would
 * replace an answer this control gives, waits for a person to tick it. The API copies them
 * from the source itself and records where they came from; nothing is copied until Copy.
 */
export function BringForward({
  ids,
  offer,
  initial,
  onClose,
  onCopied,
}: {
  ids: Ids;
  offer: CopyOffer;
  /** The source to start from. */
  initial: string;
  onClose: () => void;
  /** The answers copied, by question, once the server confirms them. */
  onCopied: (values: Record<string, string>, from: string) => void;
}) {
  const id = useId();
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [sourceId, setSourceId] = useState(initial);
  const source =
    offer.sources.find((item) => item.controlId === sourceId) ??
    offer.sources[0] ??
    null;
  const rows = useMemo(
    () => (source === null ? [] : rowsFor(source, offer.target)),
    [source, offer.target],
  );
  const [chosen, setChosen] = useState<Set<string>>(() =>
    initialSelection(rows),
  );
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const open = selectable(rows);
  const picked = open.filter((key) => chosen.has(key));

  useEffect(() => {
    const node = dialog.current;
    if (node !== null && !node.open) {
      node.showModal();
    }
  }, []);

  function pick(next: string) {
    setSourceId(next);
    const nextSource = offer.sources.find((item) => item.controlId === next);
    setChosen(
      nextSource === undefined
        ? new Set()
        : initialSelection(rowsFor(nextSource, offer.target)),
    );
    setProblem(null);
  }

  async function copy() {
    if (source === null || picked.length === 0) {
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const response = await fetch("/workspace/understanding-copy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organization_id: ids.organizationId,
          project_id: ids.projectId,
          control_id: ids.controlId,
          source_control_id: source.controlId,
          keys: picked,
        }),
      });
      const answer = (await response.json()) as {
        status?: number;
        detail?: string;
      };
      if (answer.status !== 200) {
        setProblem(
          answer.status === 409 && answer.detail
            ? `${answer.detail.charAt(0).toUpperCase()}${answer.detail.slice(1)}.`
            : answer.status === 403 || answer.status === 404
              ? "Only the engagement team can copy answers."
              : "The answers could not be copied. Try again.",
        );
        setBusy(false);
        return;
      }
      const values = Object.fromEntries(
        rows
          .filter((row) => picked.includes(row.key))
          .map((row) => [row.key, row.value]),
      );
      onCopied(values, controlLabel(source));
      router.refresh();
    } catch {
      setProblem("The answers could not be copied. Try again.");
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="confirm-dialog bf-dialog"
      aria-labelledby={`${id}-title`}
      onClose={onClose}
    >
      <div className="bf">
        <header className="bf-head">
          <span className="bf-head-icon" aria-hidden="true">
            <UiIcon name="copy" size={22} />
          </span>
          <span className="bf-head-text">
            <small>Reuse control understanding</small>
            <h2 id={`${id}-title`}>Bring forward prior answers</h2>
            <span>
              Review answers from a similar control before applying them to this
              system.
            </span>
          </span>
          <button
            type="button"
            className="btn-ghost btn-sm bf-close"
            aria-label="Close"
            onClick={onClose}
          >
            <UiIcon name="x" size={16} />
          </button>
        </header>

        <div className="bf-route">
          <label className="bf-pick">
            <span>Copy from</span>
            <span className="bf-select">
              <UiIcon name="server" size={16} />
              <select
                value={source?.controlId ?? ""}
                onChange={(event) => pick(event.target.value)}
              >
                {offer.sources.map((item) => (
                  <option key={item.controlId} value={item.controlId}>
                    {controlLabel(item)}
                    {item.sameControl ? "" : ` (${item.title})`}
                  </option>
                ))}
              </select>
            </span>
          </label>
          <span className="bf-arrow" aria-hidden="true">
            <UiIcon name="arrow" size={18} />
          </span>
          <span className="bf-pick">
            <span>Apply to</span>
            <span className="bf-select is-fixed">
              <UiIcon name="server" size={16} />
              <strong>{controlLabel(offer.target)}</strong>
            </span>
          </span>
        </div>

        {source !== null ? (
          <p className="bf-found">
            <UiIcon name="info" size={15} />
            <span>
              {source.sameControl
                ? "Similar control identified"
                : "Another control asks the same questions"}
              {" · "}
              {source.answers.length} prior answer
              {source.answers.length === 1 ? "" : "s"} available
            </span>
            <span className="bf-review">
              <UiIcon name="info" size={12} />
              Review required
            </span>
          </p>
        ) : null}

        <div className="bf-body">
          <section className="bf-list" aria-labelledby={`${id}-list`}>
            <header>
              <h3 id={`${id}-list`}>Select answers to bring forward</h3>
              <label className="bf-all">
                <input
                  type="checkbox"
                  checked={open.length > 0 && picked.length === open.length}
                  disabled={open.length === 0}
                  onChange={(event) =>
                    setChosen(event.target.checked ? new Set(open) : new Set())
                  }
                />
                Select all
              </label>
            </header>
            <ul>
              {rows.map((row) => {
                const category = categoryOf({
                  key: row.key,
                  question: row.question,
                  kind: row.kind,
                  label: row.label,
                });
                const off = row.state === "same";
                return (
                  <li key={row.key}>
                    <label className={off ? "is-off" : undefined}>
                      <input
                        type="checkbox"
                        checked={!off && chosen.has(row.key)}
                        disabled={off}
                        onChange={(event) => {
                          const next = new Set(chosen);
                          if (event.target.checked) {
                            next.add(row.key);
                          } else {
                            next.delete(row.key);
                          }
                          setChosen(next);
                        }}
                      />
                      <span className="bf-what">
                        <strong>{category.label}</strong>
                        <small>
                          Source: {source?.system || source?.title}
                          {row.filledBy !== null ? ` · ${row.filledBy}` : ""}
                        </small>
                      </span>
                      <span className="bf-value">
                        {row.value}
                        {row.state === "replaces" ? (
                          <small>Now: {row.current}</small>
                        ) : null}
                      </span>
                      <span className={`bf-state is-${row.state}`}>
                        {row.state === "check" || row.state === "replaces" ? (
                          <UiIcon name="info" size={12} />
                        ) : null}
                        {STATE_WORDS[row.state]}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>
          <aside className="bf-summary" aria-label="Copy summary">
            <strong>Copy summary</strong>
            <span className="bf-count">
              {picked.length} of {open.length} selected
            </span>
            <span className="bf-bar" aria-hidden="true">
              <span
                style={{
                  width: `${open.length === 0 ? 0 : Math.round((picked.length / open.length) * 100)}%`,
                }}
              />
            </span>
            <p>
              <UiIcon name="file" size={15} />
              Copied answers feed this system's narrative, which is still
              reviewed.
            </p>
            <p>
              <UiIcon name="info" size={15} />
              Existing answers are kept unless you tick them.
            </p>
          </aside>
        </div>

        {problem !== null ? (
          <p className="form-error" role="alert">
            {problem}
          </p>
        ) : null}

        <footer className="bf-foot">
          <p>
            <UiIcon name="shield" size={16} />
            Prior answers are context, not verified evidence.
          </p>
          <span className="bf-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              disabled={busy || picked.length === 0}
              onClick={() => void copy()}
            >
              {busy ? (
                <span className="spinner small" aria-hidden="true" />
              ) : null}
              {copyLabel(picked.length)}
              <UiIcon name="arrow" size={15} />
            </button>
          </span>
        </footer>
      </div>
    </dialog>
  );
}
