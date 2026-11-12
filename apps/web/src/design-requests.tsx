"use client";

import { useRouter } from "next/navigation";
import {
  type ReactNode,
  useEffect,
  useId,
  useState,
  useTransition,
} from "react";
import {
  ADD_KINDS,
  EXCEPTION_REASON_MAX,
  firstToAccept,
  REQUEST_CHIPS,
  REQUEST_LIMITS,
  type RequestRow,
  type RequestsList,
  type RequestsView,
  readsAgain,
  reasonCheck,
  requestReady,
  requestsProblem,
  type UncoveredLine,
  withAttribute,
} from "./design-requests-model";
import { formatDate } from "./format";
import { RecordDialog } from "./record-dialog";
import { RowMenu } from "./row-menu";
import { UiIcon } from "./ui-icon";

type Ids = { organizationId: string; projectId: string; controlId: string };

/** Where each action goes: the list's own routes (accept, a coverage reason), the test
 * plan's (add, edit, delete, restore, the attributes a request addresses, the release),
 * and the evidence plan's (a pending change kept as it was). */
const ROUTES = {
  requests: "/workspace/design-requests",
  planning: "/workspace/planning",
  plan: "/workspace/evidence-plan",
} as const;

/**
 * One call for the list. Success is said only once the server has answered 200, and the
 * page's data is then read again in place (no reload; open rows and what was typed stay).
 * A stale answer (409), or one that never came, reads the list again too, so the person
 * decides on what is there now. A refusal leaves the page as it was, with the reason in
 * place.
 */
function useRequestAction(ids: Ids) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  async function run(
    label: string,
    route: keyof typeof ROUTES,
    fields: Record<string, unknown>,
  ): Promise<boolean> {
    setBusy(label);
    setProblem(null);
    let status = 0;
    let detail = "";
    try {
      const response = await fetch(ROUTES[route], {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organization_id: ids.organizationId,
          project_id: ids.projectId,
          control_id: ids.controlId,
          ...fields,
        }),
      });
      const body = (await response.json()) as {
        status?: unknown;
        detail?: unknown;
      };
      status = typeof body.status === "number" ? body.status : 0;
      detail = typeof body.detail === "string" ? body.detail : "";
    } catch {
      status = 0;
    }
    setBusy("");
    const message = requestsProblem(status, detail);
    setProblem(message);
    if (message === null || readsAgain(status)) {
      startTransition(() => router.refresh());
    }
    return message === null;
  }
  return { run, busy, pending: pending || busy !== "", problem };
}

function Problem({ text }: { text: string | null }) {
  return text === null ? null : (
    <p className="cc-problem" role="alert">
      {text}
    </p>
  );
}

type DialogState =
  | { mode: "add" }
  | { mode: "edit"; row: RequestRow }
  | { mode: "attributes"; row: RequestRow }
  | { mode: "reason"; attribute: UncoveredLine }
  | { mode: "assign"; attribute: UncoveredLine };

/**
 * The D&I Evidence step's work before its requests are drafted (product owner, 12 November
 * 2026): one list of what will be requested. The agent proposes each request and a person
 * accepts it, per row or all at once; a person can add, edit or delete one and change the
 * attributes it addresses; under the list, every approved attribute shows whether a
 * request addresses it. There is no Release button: the server drafts the requests once
 * the list is accepted and every attribute is addressed. The step's frame names the step,
 * its status and what it needs, so none of that is repeated here.
 */
export function DesignRequests({
  ids,
  view,
  canAct,
  canRelease,
  documents,
}: {
  ids: Ids;
  view: RequestsView;
  /** The person may change the control's plan. The server checks again. */
  canAct: boolean;
  /** The person may release a phase: asked only where a settled list is not yet drafted. */
  canRelease: boolean;
  /** The optional governing documents, folded: their one line and their setup. */
  documents?: { line: string; body: ReactNode };
}) {
  if (view.mode === "hidden") {
    return null;
  }
  if (view.mode === "waiting") {
    return (
      <section className="dq" aria-label="D&I requests">
        <p className="dr-empty">{view.line}</p>
        {documents !== undefined ? (
          <div className="dr-more">
            <DocumentsFold documents={documents} />
          </div>
        ) : null}
      </section>
    );
  }
  return (
    <RequestsPanel
      ids={ids}
      view={view}
      drafting={view.mode === "drafting"}
      canAct={canAct}
      canRelease={canRelease}
      documents={documents}
    />
  );
}

function DocumentsFold({
  documents,
}: {
  documents: { line: string; body: ReactNode };
}) {
  return (
    <details className="dr-fold">
      <summary>
        <span>
          <strong>Governing documents</strong>
          <small>{documents.line}</small>
        </span>
        <UiIcon name="chevron" size={13} />
      </summary>
      <div className="dr-fold-body">{documents.body}</div>
    </details>
  );
}

function RequestsPanel({
  ids,
  view,
  drafting,
  canAct,
  canRelease,
  documents,
}: {
  ids: Ids;
  view: RequestsList;
  drafting: boolean;
  canAct: boolean;
  canRelease: boolean;
  documents: { line: string; body: ReactNode } | undefined;
}) {
  const id = useId();
  const router = useRouter();
  const action = useRequestAction(ids);
  // The rows the person opened or closed; until then the first that waits on them is open.
  const [chosen, setChosen] = useState<ReadonlySet<string> | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [done, setDone] = useState("");
  // The request just deleted, offered back at once; the history keeps it after that.
  const [removed, setRemoved] = useState<{
    id: string;
    title: string;
    version: number;
  } | null>(null);
  // While the planner works or the requests are drafted, the list is read again every few
  // seconds, in place; it stops by itself when the work ends.
  useEffect(() => {
    if (!view.working) {
      return;
    }
    const timer = window.setInterval(() => router.refresh(), 3000);
    return () => window.clearInterval(timer);
  }, [view.working, router]);

  const locked = action.pending || view.working;
  const editable = canAct && !view.working;
  const first = view.working ? null : firstToAccept(view.rows);
  const opened = chosen ?? new Set(first !== null ? [first] : []);
  const wording = new Map(view.attributes.map((item) => [item.id, item]));
  const flip = (each: string) => {
    const next = new Set(opened);
    if (next.has(each)) {
      next.delete(each);
    } else {
      next.add(each);
    }
    setChosen(next);
  };

  async function accept(rows: readonly RequestRow[], label: string) {
    setDone("");
    setRemoved(null);
    const ok = await action.run(label, "requests", {
      intent: "requests-accept",
      items: rows.map((row) => ({
        requirement_id: row.id,
        version: row.version,
      })),
    });
    if (ok) {
      setDone(
        rows.length === 1
          ? rows[0]?.change?.remove === true
            ? "Removal accepted."
            : "Accepted."
          : `${rows.length} requests accepted.`,
      );
    }
  }

  async function keep(row: RequestRow) {
    setDone("");
    const ok = await action.run(`keep-${row.id}`, "plan", {
      intent: "change",
      requirement_id: row.id,
      decision: "DISMISS",
      version: row.version,
    });
    if (ok) {
      setDone("Kept as accepted.");
    }
  }

  async function remove(row: RequestRow) {
    setDone("");
    const ok = await action.run(`remove-${row.id}`, "planning", {
      intent: "evidence-remove",
      requirement_id: row.id,
      version: row.version,
    });
    if (ok) {
      setRemoved({ id: row.id, title: row.title, version: row.version + 1 });
    }
  }

  async function restore(item: { id: string; version: number }) {
    setDone("");
    const ok = await action.run(`restore-${item.id}`, "planning", {
      intent: "evidence-restore",
      requirement_id: item.id,
      version: item.version,
    });
    if (ok) {
      setRemoved(null);
      setDone("Request restored.");
    }
  }

  async function clearReason(attributeId: string, letter: string) {
    setDone("");
    const ok = await action.run(`clear-${attributeId}`, "requests", {
      intent: "exception-clear",
      attribute_id: attributeId,
    });
    if (ok) {
      setDone(`Reason removed for attribute ${letter}.`);
    }
  }

  async function draft() {
    setDone("");
    const ok = await action.run("draft", "planning", {
      intent: "phase-release",
      phase: "DESIGN",
      reason: "",
    });
    if (ok) {
      setDone("The requests are being drafted.");
    }
  }

  function row(each: RequestRow) {
    const chip = REQUEST_CHIPS[each.state];
    const isOpen = opened.has(each.id);
    const bodyId = `${id}-${each.id}`;
    const waits = each.state !== "ACCEPTED";
    const menu = editable && !drafting;
    return (
      <li
        key={each.id}
        className={`tar is-${each.state.toLowerCase()}${isOpen ? " is-open" : ""}${menu ? " has-menu" : ""}`}
      >
        <button
          type="button"
          className="tar-head dq-head"
          aria-expanded={isOpen}
          aria-controls={bodyId}
          onClick={() => flip(each.id)}
        >
          <span className="dr-tile" aria-hidden="true">
            <UiIcon name={each.icon} size={16} />
          </span>
          <span className="tar-name">
            <span className="tar-text">{each.title}</span>
            <span className="tar-source">
              {each.line}
              {" · "}
              {each.change !== null ? (
                <span className="tar-origin">{each.change.line}</span>
              ) : each.origin === "AGENT" && waits ? (
                <span className="tar-origin">{each.originLine}</span>
              ) : (
                each.originLine
              )}
            </span>
          </span>
          <span className="dq-meta">
            <span className="dq-letters">
              <span className="sr-only">{`, ${each.addresses}, `}</span>
              {each.letters.length > 0 ? (
                each.attributeIds.map((attributeId) => {
                  const attribute = wording.get(attributeId);
                  return (
                    <span
                      key={attributeId}
                      className="dr-code"
                      aria-hidden="true"
                      title={
                        attribute !== undefined
                          ? `Addresses attribute ${attribute.letter}: ${attribute.text}`
                          : undefined
                      }
                    >
                      {attribute?.letter ?? ""}
                    </span>
                  );
                })
              ) : (
                <span className="dq-none" aria-hidden="true">
                  No attribute
                </span>
              )}
            </span>
            <span className={`tar-chip tone-${chip.tone}`}>{chip.label}</span>
          </span>
          <span className="tar-caret" aria-hidden="true">
            <UiIcon name="chevron" size={14} />
          </span>
        </button>
        {menu ? (
          <span className="dq-menu">
            <RowMenu
              label={each.title}
              items={[
                {
                  label: "Edit",
                  icon: "compose",
                  onSelect: () => setDialog({ mode: "edit", row: each }),
                },
                {
                  label: "Change attributes",
                  icon: "tag",
                  unavailable:
                    each.procedureIds === null
                      ? "The test plan could not be read. Refresh the page."
                      : view.attributes.length === 0
                        ? "The control has no approved attributes."
                        : null,
                  onSelect: () => setDialog({ mode: "attributes", row: each }),
                },
                {
                  label: "Delete",
                  icon: "trash",
                  danger: true,
                  onSelect: () => void remove(each),
                },
              ]}
            />
          </span>
        ) : null}
        {isOpen ? (
          <div className="tar-body" id={bodyId}>
            {each.change !== null ? (
              <div className="dq-change">
                <p className="ta-why">
                  <span className="tar-origin">{each.change.summary}</span>{" "}
                  {each.change.remove
                    ? "It stays as it is until you accept the removal."
                    : "Your accepted request stays as it is until you accept the change."}
                </p>
                {each.change.title !== "" ? (
                  <p className="ta-replaces">
                    <span>Proposed title</span> {each.change.title}
                  </p>
                ) : null}
                {each.change.description !== "" ? (
                  <p className="ta-replaces">
                    <span>Proposed request</span> {each.change.description}
                  </p>
                ) : null}
              </div>
            ) : null}
            <div className="tc is-flat">
              <dl className="tc-rules">
                <div>
                  <dt>Request</dt>
                  <dd>{each.description || "Not stated"}</dd>
                </div>
                {each.shows !== "" ? (
                  <div>
                    <dt>Shows</dt>
                    <dd>{each.shows}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>Addresses</dt>
                  <dd>
                    {each.attributeIds.length === 0 ? (
                      "No attribute yet"
                    ) : (
                      <ul className="dq-addressed">
                        {each.attributeIds.map((attributeId) => {
                          const attribute = wording.get(attributeId);
                          return attribute === undefined ? null : (
                            <li key={attributeId}>
                              <span className="dr-code">
                                {attribute.letter}
                              </span>
                              <span>{attribute.text}</span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </dd>
                </div>
              </dl>
              {each.state === "ACCEPTED" && each.acceptedBy !== null ? (
                <p className="tc-by">
                  Accepted by {each.acceptedBy}
                  {each.acceptedAt !== null
                    ? ` · ${formatDate(each.acceptedAt)}`
                    : ""}
                </p>
              ) : null}
              {canAct && !drafting ? (
                <div className="tc-row-acts">
                  {waits ? (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={locked}
                      onClick={() => void accept([each], `accept-${each.id}`)}
                    >
                      {action.busy === `accept-${each.id}`
                        ? "Accepting…"
                        : each.change?.remove === true
                          ? "Accept the removal"
                          : each.change !== null
                            ? "Accept the change"
                            : "Accept"}
                    </button>
                  ) : null}
                  {each.change !== null ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={locked}
                      onClick={() => void keep(each)}
                    >
                      {action.busy === `keep-${each.id}`
                        ? "Keeping…"
                        : "Keep the accepted request"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={locked}
                      onClick={() => setDialog({ mode: "edit", row: each })}
                    >
                      Edit
                    </button>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </li>
    );
  }

  const undo =
    removed !== null
      ? (view.history.find((item) => item.id === removed.id) ?? removed)
      : null;
  return (
    <section className="dq" aria-label="D&I requests" aria-busy={locked}>
      <div className="ta-bar">
        <h4 className="ta-section-title">{view.title}</h4>
        {canAct && !drafting ? (
          <span className="ta-bar-acts">
            {view.accept.length > 0 ? (
              <button
                type="button"
                className="btn btn-sm"
                disabled={locked}
                title="Accepts each request as it reads, each recorded on its own."
                onClick={() =>
                  void accept(
                    view.rows.filter((each) => each.state === "TO_ACCEPT"),
                    "accept-all",
                  )
                }
              >
                {action.busy === "accept-all"
                  ? "Accepting…"
                  : `Accept all ${view.accept.length}`}
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn-ghost btn-sm ta-quiet"
              disabled={locked}
              onClick={() => setDialog({ mode: "add" })}
            >
              <UiIcon name="plus" size={13} />
              Add request
            </button>
          </span>
        ) : null}
      </div>
      <p className="ta-done" role="status">
        {done !== "" && action.problem === null ? (
          <>
            <UiIcon name="check" size={14} />
            {done}
          </>
        ) : null}
      </p>
      {removed !== null && undo !== null ? (
        <p className="pe-removed" role="status">
          <span>“{removed.title}” was deleted. It stays in the history.</span>
          <button
            type="button"
            className="btn-ghost btn-sm"
            disabled={locked}
            onClick={() => void restore(undo)}
          >
            {action.busy === `restore-${removed.id}` ? "Restoring…" : "Undo"}
          </button>
        </p>
      ) : null}
      <Problem text={action.problem} />
      <ul className="tar-list" aria-label="D&I requests">
        {view.rows.map((each) => row(each))}
        {view.rows.length === 0 ? (
          <li className="tar-empty">{view.empty}</li>
        ) : null}
      </ul>

      {view.settled ? (
        <div className="dq-settled">
          <p>Every request is accepted and every attribute is addressed.</p>
          {canRelease ? (
            <button
              type="button"
              className="btn btn-sm"
              disabled={locked}
              onClick={() => void draft()}
            >
              {action.busy === "draft" ? "Drafting…" : "Draft the requests"}
            </button>
          ) : (
            <small>
              An Owner, Admin or Project Manager drafts the requests.
            </small>
          )}
        </div>
      ) : null}
      {view.holds !== "" ? (
        <p className="ta-run-note" role="status">
          <UiIcon name="info" size={13} />
          {view.holds}
        </p>
      ) : null}

      {view.coverage.length > 0 ? (
        <section className="dq-coverage" aria-labelledby={`${id}-coverage`}>
          <div className="dq-cov-head">
            <h4 className="ta-section-title" id={`${id}-coverage`}>
              Coverage
            </h4>
            <span className="dq-cov-line">{view.coverageLine}</span>
          </div>
          <ul className="dq-cov-chips">
            {view.coverage.map((chip) => (
              <li
                key={chip.attributeId}
                className={`dq-cov is-${chip.state.toLowerCase()}`}
                title={`${chip.label}. ${chip.text}`}
              >
                <span className="sr-only">{chip.label}</span>
                <span className="dq-cov-letter" aria-hidden="true">
                  {chip.letter}
                </span>
                <span className="dq-cov-state" aria-hidden="true">
                  {chip.state === "COVERED" ? (
                    <UiIcon name="check" size={12} />
                  ) : chip.state === "EXCEPTION" ? (
                    "Reason recorded"
                  ) : (
                    "Not addressed"
                  )}
                </span>
              </li>
            ))}
          </ul>
          {view.uncovered.length > 0 ? (
            <ul
              className="dq-gaps"
              aria-label="Attributes no request addresses"
            >
              {view.uncovered.map((item) => (
                <li className="dq-gap" key={item.attributeId}>
                  <span className="dq-gap-mark" aria-hidden="true">
                    <UiIcon name="risk" size={15} />
                  </span>
                  <p className="dq-gap-text">
                    <strong>{item.line}</strong>
                    <small>{item.text}</small>
                  </p>
                  {editable && !drafting ? (
                    <span className="dq-gap-acts">
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={locked || view.rows.length === 0}
                        title={
                          view.rows.length === 0
                            ? "Add a request first."
                            : undefined
                        }
                        aria-label={`Add attribute ${item.letter} to a request`}
                        onClick={() =>
                          setDialog({ mode: "assign", attribute: item })
                        }
                      >
                        Add to a request
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={locked}
                        aria-label={`Record why attribute ${item.letter} is not evidenced at D&I`}
                        onClick={() =>
                          setDialog({ mode: "reason", attribute: item })
                        }
                      >
                        Record why
                      </button>
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      <div className="dr-more">
        {view.exceptions.length > 0 ? (
          <details className="dr-fold">
            <summary>
              <span>
                <strong>Not evidenced at D&amp;I</strong>
                <small>
                  {view.exceptions.length} attribute
                  {view.exceptions.length === 1 ? "" : "s"}, with the reason
                  recorded
                </small>
              </span>
              <UiIcon name="chevron" size={13} />
            </summary>
            <ul className="dq-reasons">
              {view.exceptions.map((item) => (
                <li key={item.attributeId}>
                  <span className="dr-code">{item.letter}</span>
                  <span className="dq-reason-text">
                    <span>{item.text}</span>
                    <q>{item.reason}</q>
                    <small>
                      {[
                        item.recordedBy,
                        item.recordedAt !== null
                          ? formatDate(item.recordedAt)
                          : "",
                      ]
                        .filter((part) => part !== "")
                        .join(" · ")}
                    </small>
                  </span>
                  {editable && !drafting ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={locked}
                      aria-label={`Remove the reason for attribute ${item.letter}`}
                      onClick={() =>
                        void clearReason(item.attributeId, item.letter)
                      }
                    >
                      {action.busy === `clear-${item.attributeId}`
                        ? "Removing…"
                        : "Remove"}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        {view.attributes.length > 0 ? (
          <details className="dr-fold">
            <summary>
              <span>
                <strong>
                  Tested against {view.attributes.length} attribute
                  {view.attributes.length === 1 ? "" : "s"}
                </strong>
                {view.sources !== "" ? (
                  <small>From {view.sources}</small>
                ) : null}
              </span>
              <UiIcon name="chevron" size={13} />
            </summary>
            <ol className="dr-attrs">
              {view.attributes.map((item) => (
                <li key={item.id}>
                  <span className="dr-code">{item.letter}</span>
                  <span className="dr-attr-text">{item.text}</span>
                  <small>{item.source}</small>
                </li>
              ))}
            </ol>
          </details>
        ) : null}
        {documents !== undefined ? (
          <DocumentsFold documents={documents} />
        ) : null}
        {view.history.length > 0 ? (
          <details className="dr-fold">
            <summary>
              <span>
                <strong>History</strong>
                <small>
                  {view.history.length} deleted request
                  {view.history.length === 1 ? "" : "s"}
                </small>
              </span>
              <UiIcon name="chevron" size={13} />
            </summary>
            <ul className="dq-history">
              {view.history.map((item) => (
                <li key={item.id}>
                  <span className="dq-history-text">
                    <span>{item.title}</span>
                    <small>{item.kind} · Deleted</small>
                  </span>
                  {editable && !drafting ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={locked}
                      aria-label={`Restore ${item.title}`}
                      onClick={() => void restore(item)}
                    >
                      {action.busy === `restore-${item.id}`
                        ? "Restoring…"
                        : "Restore"}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>

      {dialog === null ? null : dialog.mode === "add" ||
        dialog.mode === "edit" ? (
        <RequestDialog
          key={dialog.mode === "add" ? "add" : dialog.row.id}
          ids={ids}
          row={dialog.mode === "edit" ? dialog.row : null}
          onClose={() => setDialog(null)}
          onDone={(note) => {
            setDialog(null);
            setRemoved(null);
            setDone(note);
          }}
        />
      ) : dialog.mode === "attributes" ? (
        <AttributesDialog
          key={dialog.row.id}
          ids={ids}
          row={dialog.row}
          attributes={view.attributes}
          onClose={() => setDialog(null)}
          onDone={(note) => {
            setDialog(null);
            setDone(note);
          }}
        />
      ) : dialog.mode === "reason" ? (
        <ReasonDialog
          key={dialog.attribute.attributeId}
          ids={ids}
          attribute={dialog.attribute}
          onClose={() => setDialog(null)}
          onDone={(note) => {
            setDialog(null);
            setDone(note);
          }}
        />
      ) : (
        <AssignDialog
          key={dialog.attribute.attributeId}
          ids={ids}
          attribute={dialog.attribute}
          rows={view.rows}
          onClose={() => setDialog(null)}
          onDone={(note) => {
            setDialog(null);
            setDone(note);
          }}
        />
      )}
    </section>
  );
}

type DialogProps = {
  ids: Ids;
  onClose: () => void;
  /** Called once the server has confirmed, with what to say on the list. */
  onDone: (note: string) => void;
};

function DialogFoot({
  busy,
  disabled,
  save,
  onClose,
}: {
  busy: boolean;
  disabled: boolean;
  save: string;
  onClose: () => void;
}) {
  return (
    <footer className="tae-foot">
      <button
        type="button"
        className="btn-secondary"
        disabled={busy}
        onClick={onClose}
      >
        Cancel
      </button>
      <span className="tae-foot-main">
        <button type="submit" className="btn" disabled={disabled || busy}>
          {busy ? (
            <span className="spinner small" aria-hidden="true" />
          ) : (
            <UiIcon name="check" size={16} />
          )}
          {busy ? "Saving…" : save}
        </button>
      </span>
    </footer>
  );
}

/** A request added, or its title and description edited. Either is accepted by that act:
 * the person wrote it. What was typed stays if the server refuses. */
function RequestDialog({
  ids,
  row,
  onClose,
  onDone,
}: DialogProps & { row: RequestRow | null }) {
  const action = useRequestAction(ids);
  const id = useId();
  const [title, setTitle] = useState(row?.title ?? "");
  const [description, setDescription] = useState(row?.description ?? "");
  const [shows, setShows] = useState("");
  const [category, setCategory] = useState(ADD_KINDS[0]?.category ?? "OTHER");
  const adding = row === null;
  const changed =
    adding ||
    title.trim() !== row.title ||
    description.trim() !== row.description;
  const ready =
    changed &&
    requestReady(
      adding ? { title, description, shows } : { title, description },
      adding ? "add" : "edit",
    );

  async function submit() {
    if (row === null) {
      if (
        await action.run("save", "planning", {
          intent: "evidence-add",
          phase: "DESIGN",
          category,
          title,
          description,
          objective: shows,
          necessity: "REQUIRED",
        })
      ) {
        onDone("Request added. Choose the attributes it addresses.");
      }
      return;
    }
    if (
      await action.run("save", "planning", {
        intent: "evidence-edit",
        requirement_id: row.id,
        version: row.version,
        title,
        description,
      })
    ) {
      onDone("Request updated.");
    }
  }

  return (
    <RecordDialog
      icon={<UiIcon name={adding ? "plus" : "compose"} size={24} />}
      eyebrow={adding ? "New D&I request" : "D&I request"}
      title={adding ? "Add request" : "Edit request"}
      description={
        adding
          ? "Add one piece of evidence to request for the design and walkthrough."
          : "Change what is requested. The request is accepted as you write it."
      }
      closeHref=""
      className="tae-dialog"
      onClose={onClose}
    >
      <form
        autoComplete="off"
        className="tae-form dq-form"
        aria-busy={action.pending}
        onSubmit={(event) => {
          event.preventDefault();
          if (ready && !action.pending) {
            void submit();
          }
        }}
      >
        {adding ? (
          <div className="tae-field">
            <label htmlFor={`${id}-kind`}>Kind of evidence</label>
            <select
              id={`${id}-kind`}
              value={category}
              disabled={action.pending}
              onChange={(event) => setCategory(event.target.value)}
            >
              {ADD_KINDS.map((kind) => (
                <option key={kind.category} value={kind.category}>
                  {kind.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="tae-field">
          <label htmlFor={`${id}-title`}>What to request</label>
          <input
            id={`${id}-title`}
            type="text"
            value={title}
            required
            minLength={REQUEST_LIMITS.title.min}
            maxLength={REQUEST_LIMITS.title.max}
            disabled={action.pending}
            placeholder="For example: One access request traced from request to approval"
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>
        <div className="tae-field">
          <label htmlFor={`${id}-description`}>What the client provides</label>
          <textarea
            id={`${id}-description`}
            value={description}
            rows={3}
            required
            maxLength={
              adding
                ? REQUEST_LIMITS.description.max
                : REQUEST_LIMITS.description.editMax
            }
            disabled={action.pending}
            aria-describedby={`${id}-note`}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>
        {adding ? (
          <div className="tae-field">
            <label htmlFor={`${id}-shows`}>What it shows</label>
            <textarea
              id={`${id}-shows`}
              value={shows}
              rows={2}
              required
              maxLength={REQUEST_LIMITS.shows.max}
              disabled={action.pending}
              placeholder="For example: The access was approved before it was granted."
              onChange={(event) => setShows(event.target.value)}
            />
          </div>
        ) : null}
        <p className="tae-note" id={`${id}-note`}>
          {adding
            ? "Added as required and accepted as you write it. Nothing goes to the client until the drafted request is approved."
            : "Recorded as edited by the team. Nothing goes to the client until the drafted request is approved."}
        </p>
        <Problem text={action.problem} />
        <DialogFoot
          busy={action.pending}
          disabled={!ready}
          save={adding ? "Add request" : "Save changes"}
          onClose={onClose}
        />
      </form>
    </RecordDialog>
  );
}

/** The approved attributes a request addresses, as a checklist by letter and wording. */
function AttributesDialog({
  ids,
  row,
  attributes,
  onClose,
  onDone,
}: DialogProps & {
  row: RequestRow;
  attributes: RequestsList["attributes"];
}) {
  const action = useRequestAction(ids);
  const [checked, setChecked] = useState<ReadonlySet<string>>(
    new Set(row.attributeIds),
  );
  const changed =
    checked.size !== row.attributeIds.length ||
    row.attributeIds.some((each) => !checked.has(each));
  const toggle = (each: string, on: boolean) => {
    const next = new Set(checked);
    if (on) {
      next.add(each);
    } else {
      next.delete(each);
    }
    setChecked(next);
  };

  async function submit() {
    if (row.procedureIds === null) {
      return;
    }
    if (
      await action.run("save", "planning", {
        intent: "evidence-links",
        requirement_id: row.id,
        // In the attributes' order, and the procedures it serves as they were.
        attribute_ids: attributes
          .filter((item) => checked.has(item.id))
          .map((item) => item.id),
        procedure_ids: row.procedureIds,
      })
    ) {
      onDone("Attributes updated.");
    }
  }

  return (
    <RecordDialog
      icon={<UiIcon name="tag" size={24} />}
      eyebrow="D&I request"
      title="Change attributes"
      description={row.title}
      closeHref=""
      className="tae-dialog"
      onClose={onClose}
    >
      <form
        autoComplete="off"
        className="tae-form dq-form"
        aria-busy={action.pending}
        onSubmit={(event) => {
          event.preventDefault();
          if (changed && !action.pending) {
            void submit();
          }
        }}
      >
        <fieldset className="dq-choices" disabled={action.pending}>
          <legend>Attributes this request addresses</legend>
          {attributes.map((item) => (
            <label key={item.id} className="dq-choice">
              <input
                type="checkbox"
                checked={checked.has(item.id)}
                onChange={(event) => toggle(item.id, event.target.checked)}
              />
              <span className="dr-code" aria-hidden="true">
                {item.letter}
              </span>
              <span>
                <span className="sr-only">{`Attribute ${item.letter}: `}</span>
                {item.text}
              </span>
            </label>
          ))}
        </fieldset>
        <p className="tae-note">
          Each approved attribute needs a request that addresses it, or a
          recorded reason.
        </p>
        <Problem text={action.problem} />
        <DialogFoot
          busy={action.pending}
          disabled={!changed}
          save="Save attributes"
          onClose={onClose}
        />
      </form>
    </RecordDialog>
  );
}

/** Why an approved attribute is not evidenced at D&I: a person's reason, on the record. */
function ReasonDialog({
  ids,
  attribute,
  onClose,
  onDone,
}: DialogProps & { attribute: UncoveredLine }) {
  const action = useRequestAction(ids);
  const id = useId();
  const [reason, setReason] = useState("");
  const check = reasonCheck(reason);

  async function submit() {
    if (
      await action.run("save", "requests", {
        intent: "exception-record",
        attribute_id: attribute.attributeId,
        reason,
      })
    ) {
      onDone(`Reason recorded for attribute ${attribute.letter}.`);
    }
  }

  return (
    <RecordDialog
      icon={<UiIcon name="compose" size={24} />}
      eyebrow={`Attribute ${attribute.letter}`}
      title="Record why it is not evidenced at D&I"
      description={attribute.text}
      closeHref=""
      className="tae-dialog"
      onClose={onClose}
    >
      <form
        autoComplete="off"
        className="tae-form dq-form"
        aria-busy={action.pending}
        onSubmit={(event) => {
          event.preventDefault();
          if (check.enabled && !action.pending) {
            void submit();
          }
        }}
      >
        <div className="tae-field">
          <label htmlFor={`${id}-reason`}>
            Why does no D&amp;I request address this attribute?
          </label>
          <textarea
            id={`${id}-reason`}
            value={reason}
            rows={3}
            required
            maxLength={EXCEPTION_REASON_MAX}
            disabled={action.pending}
            aria-describedby={`${id}-hint`}
            placeholder="For example: It is tested on each operating-effectiveness sample, not at the walkthrough."
            onChange={(event) => setReason(event.target.value)}
          />
          <p className="tae-count" id={`${id}-hint`}>
            {check.hint}
          </p>
        </div>
        <Problem text={action.problem} />
        <DialogFoot
          busy={action.pending}
          disabled={!check.enabled}
          save="Record reason"
          onClose={onClose}
        />
      </form>
    </RecordDialog>
  );
}

/** An attribute no request addresses, added to one of the requests. */
function AssignDialog({
  ids,
  attribute,
  rows,
  onClose,
  onDone,
}: DialogProps & { attribute: UncoveredLine; rows: readonly RequestRow[] }) {
  const action = useRequestAction(ids);
  const [chosen, setChosen] = useState("");
  const target = rows.find((row) => row.id === chosen) ?? null;

  async function submit() {
    if (target === null || target.procedureIds === null) {
      return;
    }
    if (
      await action.run("save", "planning", {
        intent: "evidence-links",
        requirement_id: target.id,
        attribute_ids: withAttribute(target, attribute.attributeId),
        procedure_ids: target.procedureIds,
      })
    ) {
      onDone(`Attribute ${attribute.letter} added to “${target.title}”.`);
    }
  }

  return (
    <RecordDialog
      icon={<UiIcon name="plus" size={24} />}
      eyebrow={`Attribute ${attribute.letter}`}
      title="Add to a request"
      description={attribute.text}
      closeHref=""
      className="tae-dialog"
      onClose={onClose}
    >
      <form
        autoComplete="off"
        className="tae-form dq-form"
        aria-busy={action.pending}
        onSubmit={(event) => {
          event.preventDefault();
          if (target !== null && !action.pending) {
            void submit();
          }
        }}
      >
        <fieldset className="dq-choices" disabled={action.pending}>
          <legend>
            The request that addresses attribute {attribute.letter}
          </legend>
          {rows.map((row) => (
            <label key={row.id} className="dq-choice">
              <input
                type="radio"
                name="request"
                value={row.id}
                checked={chosen === row.id}
                disabled={row.procedureIds === null}
                onChange={() => setChosen(row.id)}
              />
              <span>
                {row.title}
                <small>
                  {row.line}
                  {row.letters.length > 0
                    ? ` · ${row.addresses}`
                    : " · addresses no attribute yet"}
                </small>
              </span>
            </label>
          ))}
        </fieldset>
        <Problem text={action.problem} />
        <DialogFoot
          busy={action.pending}
          disabled={target === null || target.procedureIds === null}
          save="Add to this request"
          onClose={onClose}
        />
      </form>
    </RecordDialog>
  );
}
