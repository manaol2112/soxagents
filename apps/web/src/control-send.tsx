"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";

import {
  checkOwner,
  initialsOf,
  type ListedRequest,
  matchOwners,
  type OwnerChoice,
  outsideDomains,
  ownerOf,
  parseSendResult,
  personOf,
  type Routing,
  recipientChoices,
  requests,
  reviewPlan,
  routingOf,
  type SendResult,
  type SentReport,
  sendBody,
  sentReport,
  withTitles,
} from "./control-send-model";
import { UiIcon } from "./ui-icon";

type Ids = { organizationId: string; projectId: string; controlId: string };

type Step =
  | { kind: "closed" }
  | { kind: "checking" }
  | { kind: "owner"; info: SendResult }
  | { kind: "confirm"; result: SendResult }
  | { kind: "sending" }
  | { kind: "done"; title: string; summary: string }
  | { kind: "sent"; report: SentReport };

/**
 * Approve and send the control's drafted requests to its owner, here (decided by the
 * product owner on 28 October 2026). A check comes first: a control with no owner asks for
 * one; then the requests, who each goes to and what travels with it, are confirmed before
 * anything is sent. The requests are the Evidence center's, so they show there as sent.
 */
export function ControlSend({
  ids,
  titles = {},
}: {
  ids: Ids;
  /** The requests as the list shows them (title and period), by request id. */
  titles?: Readonly<Record<string, ListedRequest>>;
}) {
  const id = useId();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const dialog = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState<Step>({ kind: "closed" });
  const [owner, setOwner] = useState<{ name: string; email: string } | null>(
    null,
  );

  useEffect(() => {
    const node = dialog.current;
    if (node === null) {
      return;
    }
    if (step.kind === "closed") {
      if (node.open) node.close();
    } else if (!node.open) {
      node.showModal();
    }
  }, [step.kind]);

  async function call(
    preview: boolean,
    named: { name: string; email: string } | null,
    routing: readonly Routing[] = [],
  ): Promise<{ result: SendResult | null; detail: string }> {
    try {
      const response = await fetch("/workspace/control-send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organization_id: ids.organizationId,
          project_id: ids.projectId,
          control_id: ids.controlId,
          ...sendBody(preview, named, routing),
        }),
      });
      const answer = (await response.json()) as {
        status?: number;
        detail?: string;
        result?: unknown;
      };
      const parsed = parseSendResult(answer.result);
      return {
        result: parsed === null ? null : withTitles(parsed, titles),
        detail:
          answer.status === 403
            ? "Only the engagement's managers can approve and send requests."
            : answer.status === 422
              ? (answer.detail ?? "Check the owner and try again.")
              : "The requests could not be checked. Try again.",
      };
    } catch {
      return {
        result: null,
        detail: "The requests could not be checked. Try again.",
      };
    }
  }

  async function check(named: { name: string; email: string } | null) {
    setStep({ kind: "checking" });
    const { result, detail } = await call(true, named);
    if (result === null) {
      setStep({ kind: "done", title: "Not checked", summary: detail });
    } else if (result.needsOwner) {
      setStep({ kind: "owner", info: result });
    } else if (result.targets.length === 0) {
      setStep({
        kind: "done",
        title: "Nothing to send",
        summary:
          "No request of this control is drafted and waiting to be sent.",
      });
    } else {
      setStep({ kind: "confirm", result });
    }
  }

  async function send(
    named: { name: string; email: string } | null,
    routing: readonly Routing[] = [],
  ) {
    setStep({ kind: "sending" });
    const { result, detail } = await call(false, named, routing);
    setStep(
      result === null
        ? { kind: "done", title: "Not sent", summary: detail }
        : { kind: "sent", report: sentReport(result) },
    );
    startTransition(() => router.refresh());
  }

  return (
    <>
      <button type="button" className="btn" onClick={() => void check(owner)}>
        <UiIcon name="mail" size={14} />
        Approve and send
      </button>
      <dialog
        ref={dialog}
        className="confirm-dialog cs-dialog"
        aria-labelledby={`${id}-title`}
        onClose={() => setStep({ kind: "closed" })}
      >
        <div className="confirm-dialog-body">
          {step.kind === "checking" || step.kind === "sending" ? (
            <>
              <h2 id={`${id}-title`}>
                {step.kind === "checking"
                  ? "Checking the requests…"
                  : "Sending…"}
              </h2>
              <p aria-live="polite">
                {step.kind === "checking"
                  ? "Who each request goes to and whether it is ready."
                  : "Approving each request and sending it to its owner."}
              </p>
            </>
          ) : step.kind === "owner" ? (
            <OwnerStep
              titleId={`${id}-title`}
              info={step.info}
              onCancel={() => setStep({ kind: "closed" })}
              onSend={(chosen) => {
                setOwner(chosen);
                void send(chosen);
              }}
            />
          ) : step.kind === "confirm" ? (
            <ReviewStep
              titleId={`${id}-title`}
              result={step.result}
              onCancel={() => setStep({ kind: "closed" })}
              onSend={(routing, newOwner) =>
                void send(newOwner ?? owner, routing)
              }
            />
          ) : step.kind === "sent" ? (
            <SentStep
              titleId={`${id}-title`}
              report={step.report}
              onClose={() => setStep({ kind: "closed" })}
            />
          ) : step.kind === "done" ? (
            <>
              <h2 id={`${id}-title`}>{step.title}</h2>
              <p role="status">{step.summary}</p>
              <div className="confirm-dialog-actions">
                <button
                  type="button"
                  onClick={() => setStep({ kind: "closed" })}
                >
                  Done
                </button>
              </div>
            </>
          ) : null}
        </div>
      </dialog>
    </>
  );
}

/**
 * Review and send requests (the product owner's reference, 28 October 2026): what is
 * sent now and to whom, what stays scheduled for its phase, and what a check holds back;
 * sent only once the reviewer confirms they checked the recipients and details.
 */
function ReviewStep({
  titleId,
  result,
  onCancel,
  onSend,
}: {
  titleId: string;
  result: SendResult;
  onCancel: () => void;
  /** The review's changes to who each request goes to, and a new owner when asked. */
  onSend: (
    routing: Routing[],
    owner: { name: string; email: string } | null,
  ) => void;
}) {
  const id = useId();
  const [reviewed, setReviewed] = useState(false);
  const [edits, setEdits] = useState<
    Record<string, { recipient: string; cc: string[] }>
  >({});
  const [editing, setEditing] = useState<{
    id: string;
    mode: "to" | "cc";
  } | null>(null);
  const [ownerFrom, setOwnerFrom] = useState<string | null>(null);
  const plan = reviewPlan(result);
  // A change to who a request goes to asks for the review again before it is sent.
  const change = (
    item: { id: string; recipient: string },
    next: { recipient: string; cc: string[] },
  ) => {
    setEdits((all) => ({ ...all, [item.id]: next }));
    if (next.recipient === item.recipient && ownerFrom === item.id) {
      setOwnerFrom(null);
    }
    setReviewed(false);
  };
  const newOwner =
    ownerFrom === null || edits[ownerFrom] === undefined
      ? null
      : personOf(edits[ownerFrom].recipient, result.contacts);
  const sending = plan.sending.length;
  const held = plan.later.length + plan.attention.length;
  return (
    <div className="rs">
      <header className="co-head">
        <span className="co-head-icon" aria-hidden="true">
          <UiIcon name="check" size={20} />
        </span>
        <span className="co-head-text">
          <small className="rs-eyebrow">Request approval</small>
          <h2 id={titleId}>Review and send requests</h2>
          <span>
            Confirm what will be sent now and what will remain scheduled.
          </span>
        </span>
        <button
          type="button"
          className="btn-ghost btn-sm co-close"
          aria-label="Close"
          onClick={onCancel}
        >
          <UiIcon name="x" size={16} />
        </button>
      </header>
      {sending > 0 ? (
        <section className="rs-group is-now" aria-labelledby={`${id}-now`}>
          <header>
            <span className="rs-dot" aria-hidden="true" />
            <span>
              <strong id={`${id}-now`}>Sending now</strong>
              <small>
                These requests will be approved and emailed immediately.
              </small>
            </span>
            <span className="rs-count">{requests(sending)}</span>
          </header>
          <ul>
            {plan.sending.map((item) => {
              const edit = edits[item.id] ?? {
                recipient: item.recipient,
                cc: [],
              };
              const changed = edit.recipient !== item.recipient;
              const picking = editing?.id === item.id ? editing.mode : null;
              return (
                <li key={item.id} className="rs-item is-routed">
                  <span className="rs-file" aria-hidden="true">
                    <UiIcon name="file" size={18} />
                  </span>
                  <span className="rs-text">
                    <strong>{item.title}</strong>
                    <span className="rs-to">
                      To: {edit.recipient}
                      <button
                        type="button"
                        className="text-link is-plain"
                        aria-label={`Change who “${item.title}” goes to`}
                        onClick={() =>
                          setEditing(
                            picking === "to"
                              ? null
                              : { id: item.id, mode: "to" },
                          )
                        }
                      >
                        Change
                      </button>
                    </span>
                    {changed ? <small>Was {item.recipient}</small> : null}
                    {outsideDomains(edit.recipient, result.domains) ? (
                      <small className="rs-warn">
                        Outside the client&apos;s email domains
                      </small>
                    ) : null}
                    <span className="rs-cc">
                      {edit.cc.length > 0 ? <span>Cc:</span> : null}
                      {edit.cc.map((address) => (
                        <span
                          key={address}
                          className={`rs-chip${outsideDomains(address, result.domains) ? " is-outside" : ""}`}
                          title={
                            outsideDomains(address, result.domains)
                              ? "Outside the client's email domains"
                              : undefined
                          }
                        >
                          {address}
                          <button
                            type="button"
                            aria-label={`Stop copying ${address}`}
                            onClick={() =>
                              change(item, {
                                ...edit,
                                cc: edit.cc.filter((a) => a !== address),
                              })
                            }
                          >
                            <UiIcon name="x" size={12} />
                          </button>
                        </span>
                      ))}
                      {edit.cc.length < 10 ? (
                        <button
                          type="button"
                          className="text-link is-plain"
                          onClick={() =>
                            setEditing(
                              picking === "cc"
                                ? null
                                : { id: item.id, mode: "cc" },
                            )
                          }
                        >
                          <UiIcon name="plus" size={13} />
                          Add recipient
                        </button>
                      ) : null}
                    </span>
                    {picking !== null ? (
                      <RecipientPicker
                        label={
                          picking === "to"
                            ? `Send “${item.title}” to`
                            : `Copy someone on “${item.title}”`
                        }
                        contacts={result.contacts}
                        taken={[edit.recipient, ...edit.cc]}
                        onPick={(address) => {
                          change(
                            item,
                            picking === "to"
                              ? {
                                  recipient: address,
                                  cc: edit.cc.filter((a) => a !== address),
                                }
                              : { ...edit, cc: [...edit.cc, address] },
                          );
                          setEditing(null);
                        }}
                        onCancel={() => setEditing(null)}
                      />
                    ) : null}
                    {changed ? (
                      <label className="rs-owner">
                        <input
                          type="checkbox"
                          checked={ownerFrom === item.id}
                          onChange={(event) =>
                            setOwnerFrom(event.target.checked ? item.id : null)
                          }
                        />
                        Also make them the control owner
                      </label>
                    ) : null}
                    {item.others.length > 0 ? (
                      <small>
                        Also carries {item.others.join(", ")} in the same email
                      </small>
                    ) : null}
                  </span>
                  <span className="pill pill-dot tone-success">
                    Ready to send
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      {plan.later.length > 0 ? (
        <section className="rs-group is-later" aria-labelledby={`${id}-later`}>
          <header>
            <span className="rs-clock" aria-hidden="true">
              <UiIcon name="clock" size={18} />
            </span>
            <span>
              <strong id={`${id}-later`}>Scheduled for later</strong>
              <small>{plan.laterLead}</small>
            </span>
            <span className="rs-count">{requests(plan.later.length)}</span>
          </header>
          <ul>
            {plan.later.map((item) => (
              <li key={item.id} className="rs-item">
                <span className="rs-file" aria-hidden="true">
                  <UiIcon name="file" size={18} />
                </span>
                <span className="rs-text">
                  <strong>{item.title}</strong>
                  {item.period !== "" ? <span>{item.period}</span> : null}
                  <small>{item.note}</small>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {plan.attention.length > 0 ? (
        <section
          className="rs-group is-attention"
          aria-labelledby={`${id}-attention`}
        >
          <header>
            <span className="rs-clock" aria-hidden="true">
              <UiIcon name="info" size={18} />
            </span>
            <span>
              <strong id={`${id}-attention`}>Needs attention</strong>
              <small>
                These requests cannot be sent until this is resolved.
              </small>
            </span>
            <span className="rs-count">{requests(plan.attention.length)}</span>
          </header>
          <ul>
            {plan.attention.map((item) => (
              <li key={item.id} className="rs-item">
                <span className="rs-file" aria-hidden="true">
                  <UiIcon name="file" size={18} />
                </span>
                <span className="rs-text">
                  <strong>{item.title}</strong>
                  <small>{item.reason}</small>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {sending > 0 ? (
        <>
          <p className="rs-info">
            <UiIcon name="info" size={16} />
            Approval sends {plan.emails} email{plan.emails === 1 ? "" : "s"}{" "}
            now. Replies and evidence will appear in the Evidence center.
          </p>
          <label className="rs-check" htmlFor={`${id}-reviewed`}>
            <input
              id={`${id}-reviewed`}
              type="checkbox"
              checked={reviewed}
              onChange={(event) => setReviewed(event.target.checked)}
            />
            I have reviewed the recipient and request details
          </label>
        </>
      ) : null}
      <footer className="rs-foot">
        <p>
          {sending} sending now
          {held > 0 ? (
            <>
              <span aria-hidden="true"> · </span>
              {held} held for later
            </>
          ) : null}
        </p>
        <span className="co-actions">
          <button type="button" className="btn-secondary" onClick={onCancel}>
            {sending > 0 ? "Cancel" : "Close"}
          </button>
          {sending > 0 ? (
            <button
              type="button"
              disabled={!reviewed}
              onClick={() => onSend(routingOf(plan.sending, edits), newOwner)}
            >
              Approve &amp; send {requests(sending)}
              <UiIcon name="arrow" size={15} />
            </button>
          ) : null}
        </span>
      </footer>
    </div>
  );
}

/** Who a request goes to, or who it copies: one of the engagement's people, searched by
 * name, email or role, or any address typed in full. Nothing changes until it is picked. */
function RecipientPicker({
  label,
  contacts,
  taken,
  onPick,
  onCancel,
}: {
  label: string;
  contacts: readonly OwnerChoice[];
  /** Already on the request, so not offered again. */
  taken: readonly string[];
  onPick: (email: string) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const choices = recipientChoices(contacts, query, taken);
  const listId = `${id}-people`;
  return (
    <span className="rs-picker">
      <label htmlFor={`${id}-search`} className="sr-only">
        {label}
      </label>
      <span className="co-search is-open">
        <UiIcon name="search" size={16} />
        <input
          id={`${id}-search`}
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            choices[active] === undefined ? undefined : `${listId}-${active}`
          }
          placeholder="Search people, or type an email address"
          value={query}
          autoComplete="off"
          // biome-ignore lint/a11y/noAutofocus: the picker opens on Change and is typed into.
          autoFocus
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActive((at) => Math.min(at + 1, choices.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((at) => Math.max(at - 1, 0));
            } else if (event.key === "Enter") {
              event.preventDefault();
              const person = choices[active];
              if (person !== undefined) onPick(person.email.toLowerCase());
            } else if (event.key === "Escape") {
              // The picker closes first; the dialog stays.
              event.preventDefault();
              event.stopPropagation();
              onCancel();
            }
          }}
        />
      </span>
      <span className="co-pop rs-pop" id={listId} role="listbox">
        {choices.map((person, index) => (
          <span
            key={person.email}
            id={`${listId}-${index}`}
            role="option"
            tabIndex={-1}
            aria-selected={index === active}
            className={`co-option${index === active ? " is-active" : ""}`}
            onMouseDown={(event) => {
              event.preventDefault();
              onPick(person.email.toLowerCase());
            }}
            onMouseEnter={() => setActive(index)}
          >
            <span className="co-avatar" aria-hidden="true">
              {person.name === "" ? (
                <UiIcon name="mail" size={14} />
              ) : (
                initialsOf(person)
              )}
            </span>
            <span className="co-option-text">
              <strong>{person.name || person.email}</strong>
              <span>
                {person.name === ""
                  ? "Not one of the engagement's contacts"
                  : person.email}
              </span>
            </span>
          </span>
        ))}
        {choices.length === 0 ? (
          <span className="co-empty">
            No one matches. Type their full email address.
          </span>
        ) : null}
      </span>
    </span>
  );
}

/** After the send: what went and to whom, then any request a check refused (with why) and
 * the requests still scheduled for their phase, as the review showed them. */
function SentStep({
  titleId,
  report,
  onClose,
}: {
  titleId: string;
  report: SentReport;
  onClose: () => void;
}) {
  const id = useId();
  return (
    <div className="rs">
      <header className="co-head">
        <span className={`co-head-icon is-${report.tone}`} aria-hidden="true">
          <UiIcon
            name={
              report.tone === "success"
                ? "check"
                : report.tone === "waiting"
                  ? "clock"
                  : "info"
            }
            size={20}
          />
        </span>
        <span className="co-head-text">
          <h2 id={titleId}>{report.title}</h2>
          <span role="status">{report.lead}</span>
        </span>
        <button
          type="button"
          className="btn-ghost btn-sm co-close"
          aria-label="Close"
          onClick={onClose}
        >
          <UiIcon name="x" size={16} />
        </button>
      </header>
      {report.problems.length > 0 ? (
        <section
          className="rs-group is-attention"
          aria-labelledby={`${id}-problems`}
        >
          <header>
            <span className="rs-clock" aria-hidden="true">
              <UiIcon name="info" size={18} />
            </span>
            <span>
              <strong id={`${id}-problems`}>Not sent</strong>
              <small>Resolve these, then approve and send them again.</small>
            </span>
            <span className="rs-count">{requests(report.problems.length)}</span>
          </header>
          <ul>
            {report.problems.map((item) => (
              <li key={`${item.title}-${item.reason}`} className="rs-item">
                <span className="rs-file" aria-hidden="true">
                  <UiIcon name="file" size={18} />
                </span>
                <span className="rs-text">
                  <strong>{item.title}</strong>
                  <small>{item.reason}</small>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {report.scheduled.length > 0 ? (
        <section
          className="rs-group is-later"
          aria-labelledby={`${id}-scheduled`}
        >
          <header>
            <span className="rs-clock" aria-hidden="true">
              <UiIcon name="clock" size={18} />
            </span>
            <span>
              <strong id={`${id}-scheduled`}>Still scheduled</strong>
              <small>{report.scheduledLead}</small>
            </span>
            <span className="rs-count">
              {requests(report.scheduled.length)}
            </span>
          </header>
          <ul>
            {report.scheduled.map((item) => (
              <li key={item.title} className="rs-item">
                <span className="rs-file" aria-hidden="true">
                  <UiIcon name="file" size={18} />
                </span>
                <span className="rs-text">
                  <strong>{item.title}</strong>
                  {item.period !== "" ? <span>{item.period}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <footer className="rs-foot is-end">
        <span className="co-actions">
          <button type="button" onClick={onClose}>
            Done
          </button>
        </span>
      </footer>
    </div>
  );
}

/**
 * Assign a control owner (the product owner's reference, 28 October 2026): the control,
 * then someone from the engagement's people at the client, searched by name or email, or
 * a person entered by hand, as the reference shows it and nothing more. It is the one
 * confirmation (the product owner, the same day: "you don't need two sets of
 * confirmation"): Assign owner sets the owner and sends the control's requests to them.
 */
function OwnerStep({
  titleId,
  info,
  onCancel,
  onSend,
}: {
  titleId: string;
  info: SendResult;
  onCancel: () => void;
  onSend: (owner: { name: string; email: string }) => void;
}) {
  const id = useId();
  const [manual, setManual] = useState(info.contacts.length === 0);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [chosen, setChosen] = useState<OwnerChoice | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const matches = matchOwners(info.contacts, query);
  const listId = `${id}-people`;

  const pick = (person: OwnerChoice) => {
    setChosen(person);
    setQuery(person.name || person.email);
    setOpen(false);
    setProblem(null);
  };

  return (
    <form
      autoComplete="off"
      className="co"
      onSubmit={(event) => {
        event.preventDefault();
        if (manual) {
          const checked = checkOwner(name, email);
          if ("problem" in checked) {
            setProblem(checked.problem);
            return;
          }
          onSend(checked);
          return;
        }
        if (chosen === null) {
          setProblem("Choose the control owner, or enter one by hand.");
          return;
        }
        onSend(ownerOf(chosen));
      }}
    >
      <header className="co-head">
        <span className="co-head-icon" aria-hidden="true">
          <UiIcon name="userPlus" size={20} />
        </span>
        <span className="co-head-text">
          <small>Control ownership</small>
          <h2 id={titleId}>Assign a control owner</h2>
          <span>
            Choose who will be accountable for this control and receive related
            requests.
          </span>
        </span>
        <button
          type="button"
          className="btn-ghost btn-sm co-close"
          aria-label="Close"
          onClick={onCancel}
        >
          <UiIcon name="x" size={16} />
        </button>
      </header>
      <div className="co-control">
        <span className="co-control-icon" aria-hidden="true">
          <UiIcon name="shield" size={18} />
        </span>
        <span className="co-control-text">
          <strong className="mono">{info.controlRef}</strong>
          <span>{info.controlTitle}</span>
        </span>
        <span className="pill tone-info">Owner required</span>
      </div>
      <div className="co-field">
        <span className="co-label-row">
          <label htmlFor={manual ? `${id}-name` : `${id}-search`}>
            Control owner{" "}
            <span className="field-mark" aria-hidden="true">
              *
            </span>
          </label>
          {info.contacts.length > 0 ? (
            <button
              type="button"
              className="text-link"
              onClick={() => {
                setManual(!manual);
                setProblem(null);
              }}
            >
              {manual ? "Choose from people" : "Enter owner manually"}
            </button>
          ) : null}
        </span>
        {manual ? (
          <span className="co-manual">
            <input
              id={`${id}-name`}
              placeholder="Full name"
              value={name}
              autoComplete="off"
              onChange={(event) => setName(event.target.value)}
            />
            <input
              id={`${id}-email`}
              type="email"
              aria-label="Owner's email"
              placeholder="name@client.com"
              value={email}
              autoComplete="off"
              onChange={(event) => setEmail(event.target.value)}
            />
          </span>
        ) : (
          <span className="co-combo">
            <span className={`co-search${open ? " is-open" : ""}`}>
              <UiIcon name="search" size={16} />
              <input
                id={`${id}-search`}
                role="combobox"
                aria-expanded={open}
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={
                  open && matches[active] !== undefined
                    ? `${listId}-${active}`
                    : undefined
                }
                placeholder="Search people by name or email"
                value={query}
                autoComplete="off"
                onFocus={() => setOpen(true)}
                onClick={() => setOpen(true)}
                onBlur={() => setOpen(false)}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setChosen(null);
                  setActive(0);
                  setOpen(true);
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setOpen(true);
                    setActive((at) => Math.min(at + 1, matches.length - 1));
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setActive((at) => Math.max(at - 1, 0));
                  } else if (event.key === "Enter" && open) {
                    const person = matches[active];
                    if (person !== undefined) {
                      event.preventDefault();
                      pick(person);
                    }
                  } else if (event.key === "Escape" && open) {
                    // The list closes first; the dialog stays.
                    event.preventDefault();
                    event.stopPropagation();
                    setOpen(false);
                  }
                }}
              />
              <UiIcon name="chevron" size={14} />
            </span>
            {open ? (
              <span className="co-pop" id={listId} role="listbox">
                {matches.map((person, index) => (
                  <span
                    key={person.email}
                    id={`${listId}-${index}`}
                    role="option"
                    tabIndex={-1}
                    aria-selected={index === active}
                    className={`co-option${index === active ? " is-active" : ""}`}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      pick(person);
                    }}
                    onMouseEnter={() => setActive(index)}
                  >
                    <span className="co-avatar" aria-hidden="true">
                      {initialsOf(person)}
                    </span>
                    <span className="co-option-text">
                      <strong>{person.name || person.email}</strong>
                      <span>{person.email}</span>
                    </span>
                  </span>
                ))}
                {matches.length === 0 ? (
                  <span className="co-empty">
                    No one matches. Enter the owner manually.
                  </span>
                ) : null}
              </span>
            ) : null}
          </span>
        )}
        <p className="co-hint">
          The selected owner will be linked to this control and receive future
          evidence requests.
        </p>
        {problem !== null ? (
          <p className="form-error" role="alert">
            {problem}
          </p>
        ) : null}
      </div>
      <footer className="co-foot">
        <p>
          <UiIcon name="info" size={15} />
          No request will be sent until you continue.
        </p>
        <span className="co-actions">
          <button type="button" className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit">
            Assign owner
            <UiIcon name="arrow" size={15} />
          </button>
        </span>
      </footer>
    </form>
  );
}
