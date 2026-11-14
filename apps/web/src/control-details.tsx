"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { AgentAvatar } from "./agent-avatar";
import {
  appliedTo,
  copiedTo,
  type DetailField,
  type DetailRow,
  type Details,
  initialOwnerForm,
  offerFor,
  parseDetails,
  recordWith,
  savedNote,
  saveProblem,
  suggestionNote,
  toAsk,
} from "./control-details-model";
import { UiIcon } from "./ui-icon";

type Ids = { organizationId: string; projectId: string; controlId: string };
type Options = ReadonlyArray<readonly [string, string]>;

const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

const QUESTION: Record<DetailRow["key"], string> = {
  owner: "Who owns this control?",
  frequency: "How often does the control operate?",
  nature: "How is the control performed?",
  description: "What does the control do?",
  objective: "What is the control's objective?",
  risk: "Which risk does the control address?",
};

const WHY: Record<DetailRow["key"], string> = {
  owner:
    "The control owner receives the evidence requests and answers for how the control runs.",
  frequency:
    "The frequency sets the sample size and the periods the evidence must cover.",
  nature:
    "Manual, IT-dependent manual and automated controls are tested in different ways.",
  description:
    "The understanding and the test attributes are drafted from what the control does.",
  objective: "The design is assessed against the control's objective.",
  risk: "The control is tested for the risk it addresses.",
};

/**
 * Step 01 of a control's workflow: its details from the client's RCM, with what is missing
 * asked one at a time (product owner, 10 November 2026: "says start here but there are no
 * actual section where I can put my answers or what are the things that are needed"). A
 * detail recorded here applies to this system's control; the same control on other systems
 * is offered it where empty, chosen system by system (decided the same day). The layout is
 * Control Understanding's, so the two steps read alike. A control with no owner opens on the
 * owner most used on its system, as a suggestion, and a saved owner also goes to the other
 * controls on the system that have none (product owner, 11 November 2026).
 */
export function ControlDetails({
  ids,
  controlRef,
  system,
  rows,
  frequencies,
  natures,
  nextHref,
  setupHref,
}: {
  ids: Ids;
  controlRef: string;
  system: string;
  /** The control's details as the page read them; owner, frequency and nature are read
   * again from the API, which holds the version a save needs. */
  rows: readonly DetailRow[];
  frequencies: Options;
  natures: Options;
  /** Control Understanding, the step that follows. */
  nextHref: string | null;
  /** Controls setup, where the RCM is imported and the controls edited together. */
  setupHref: string | null;
}) {
  const router = useRouter();
  const [details, setDetails] = useState<Details | null>(null);
  const [failed, setFailed] = useState(false);
  const [course, setCourse] = useState<DetailRow["key"][] | null>(null);
  const [at, setAt] = useState(0);
  // A detail opened from the record to change, outside the course.
  const [changing, setChanging] = useState<DetailField | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const [copyTo, setCopyTo] = useState<Record<string, boolean>>({});
  // The owner also for the other controls on this system without one: on unless unticked.
  const [applyToSystem, setApplyToSystem] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const reads = useRef(0);

  // The record as it stands: the API's values for what is recorded here.
  const current = recordWith(rows, details, frequencies, natures);
  const started = useRef(false);

  const read = useCallback(async () => {
    reads.current += 1;
    const mine = reads.current;
    try {
      const answer = (await (
        await fetch(
          `/workspace/control-details?${new URLSearchParams({
            organization_id: ids.organizationId,
            project_id: ids.projectId,
            control_id: ids.controlId,
          }).toString()}`,
        )
      ).json()) as { body?: unknown };
      if (mine !== reads.current) {
        return;
      }
      const found = parseDetails(answer.body ?? null);
      setFailed(found === null);
      if (found !== null) {
        setDetails(found);
        // The course is fixed at the first read, so a recorded detail keeps its place.
        if (!started.current) {
          started.current = true;
          setCourse(
            toAsk(recordWith(rows, found, frequencies, natures)).map(
              (row) => row.key,
            ),
          );
        }
      }
    } catch {
      if (mine === reads.current) {
        setFailed(true);
      }
    }
  }, [ids, rows, frequencies, natures]);

  useEffect(() => {
    void read();
  }, [read]);

  const open = (key: DetailRow["key"]) =>
    current.find((row) => row.key === key)?.missing === true;
  const nextOpen = (from: number, list = course ?? []) => {
    for (let step = from + 1; step < list.length; step += 1) {
      const key = list[step];
      if (key !== undefined && open(key)) {
        return step;
      }
    }
    return list.length;
  };

  function reset() {
    setName(null);
    setEmail(null);
    setChoice(null);
    setCopyTo({});
    setApplyToSystem(true);
    setProblem(null);
  }

  async function save(field: DetailField) {
    if (details === null || !details.canEdit) {
      return;
    }
    const body: Record<string, unknown> = {
      organization_id: ids.organizationId,
      project_id: ids.projectId,
      control_id: ids.controlId,
      version: details.version,
      copy_to: offerFor(details, field)
        .filter((target) => copyTo[target.controlId] === true)
        .map((target) => target.controlId),
    };
    if (field === "owner") {
      // The form as shown: what the person typed, else the recorded owner or the suggestion.
      const form = initialOwnerForm(details);
      body.owner_name = (name ?? form.name).trim();
      body.owner_email = (email ?? form.email).trim();
      body.apply_to_system = system.trim() !== "" && applyToSystem;
    } else {
      body[field] =
        choice ?? (field === "frequency" ? details.frequency : details.nature);
    }
    setSaving(true);
    setSaved(null);
    setProblem(null);
    let status = 0;
    let detail: unknown = "";
    let applied = 0;
    // How many other systems the server actually copied to (it skips any that already had
    // a value); null when an older server did not say.
    let copiedActual: number | null = null;
    let found: Details | null = null;
    try {
      const answer = (await (
        await fetch("/workspace/control-details", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        })
      ).json()) as { status?: unknown; detail?: unknown; body?: unknown };
      status = typeof answer.status === "number" ? answer.status : 0;
      detail = answer.detail;
      found = status === 200 ? parseDetails(answer.body ?? null) : null;
      applied = field === "owner" ? appliedTo(answer.body ?? null) : 0;
      copiedActual = copiedTo(answer.body ?? null);
    } catch {
      status = 0;
    }
    setSaving(false);
    if (found === null) {
      // A 200 whose answer cannot be read is not a confirmed save.
      setProblem(saveProblem(status === 200 ? 500 : status, detail));
      if (status === 409) {
        void read();
      }
      return;
    }
    // Confirmed by the server: shown as recorded now.
    const copied = copiedActual ?? (body.copy_to as string[]).length;
    setDetails(found);
    setSaved(savedNote(field, system, copied, applied));
    reset();
    if (changing !== null) {
      setChanging(null);
    } else {
      setAt(nextOpen(at));
    }
    router.refresh();
  }

  if (details === null || course === null) {
    return failed ? (
      <p className="cc-problem" role="alert">
        The control's details could not be loaded.{" "}
        <button type="button" className="cs-link" onClick={() => void read()}>
          Try again
        </button>
      </p>
    ) : (
      <p className="ur-loading" role="status">
        <span className="spinner small" aria-hidden="true" /> Reading the
        control's details…
      </p>
    );
  }

  const counted = current.filter((row) => row.key !== "nature");
  const recorded = counted.filter((row) => !row.missing).length;
  const missing = current.filter((row) => row.missing);
  const step = changing ?? (at < course.length ? (course[at] ?? null) : null);
  const row = step === null ? null : current.find((each) => each.key === step);
  const busy = saving || !details.canEdit;

  /** The other systems a detail can also be recorded on: those that lack it. */
  const offer = (field: DetailField) => {
    const targets = offerFor(details, field);
    if (targets.length === 0) {
      return null;
    }
    return (
      <fieldset className="ur-systems is-many cd-offer">
        <legend>
          <strong>Also record it on</strong>
          <span>
            {targets.length === 1 ? "That system has" : "Those systems have"} no{" "}
            {field} for this control yet. Nothing is overwritten.
          </span>
        </legend>
        <ul>
          {targets.map((target) => (
            <li key={target.controlId}>
              <label htmlFor={`cd-copy-${target.controlId}`}>
                <input
                  type="checkbox"
                  id={`cd-copy-${target.controlId}`}
                  checked={copyTo[target.controlId] === true}
                  disabled={busy}
                  onChange={(event) => {
                    const on = event.target.checked;
                    setCopyTo((was) => ({ ...was, [target.controlId]: on }));
                  }}
                />
                <span>
                  <strong>{target.system || "Another system"}</strong>
                </span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
    );
  };

  const foot = (primary: ReactNode, skip: boolean) => (
    <div className="ur-foot">
      <p className="ur-foot-where">
        {changing === null && course.length > 1
          ? `Detail ${at + 1} of ${course.length}`
          : null}
        {skip && changing === null ? (
          <button
            type="button"
            className="ur-skip"
            disabled={saving}
            onClick={() => {
              reset();
              setAt(nextOpen(at));
            }}
          >
            Skip for now
          </button>
        ) : null}
      </p>
      <div className="ur-foot-actions">
        <button
          type="button"
          className="btn btn-secondary"
          disabled={saving || (changing === null && at === 0)}
          onClick={() => {
            reset();
            if (changing !== null) {
              setChanging(null);
            } else {
              setAt(Math.max(0, at - 1));
            }
          }}
        >
          <UiIcon name="back" size={14} />{" "}
          {changing !== null ? "Cancel" : "Back"}
        </button>
        {primary}
      </div>
    </div>
  );

  const ask = (each: DetailRow) => {
    const kicker = (
      <div className="ur-kicker">
        {each.missing ? (
          <span className="ur-chip is-warm">Not in the RCM</span>
        ) : (
          <span className="ur-chip is-ok">Recorded</span>
        )}
        <span className="ur-chip">
          {controlRef}
          {system !== "" ? ` · ${system}` : ""}
        </span>
      </div>
    );
    const why = (
      <details className="ur-why">
        <summary>Why this is needed</summary>
        <p>{WHY[each.key]}</p>
      </details>
    );
    if (!each.editable) {
      return (
        <>
          {kicker}
          <h3 className="ur-q" id="ur-q">
            {QUESTION[each.key]}
          </h3>
          <p className="ur-hint">
            The {each.label.toLowerCase()} comes from the organization's RCM or
            the control library. Record it in the RCM and import it again from
            Controls setup.
          </p>
          {why}
          {foot(
            setupHref !== null ? (
              <a className="btn btn-primary" href={setupHref}>
                Open Controls setup <UiIcon name="arrow" size={14} />
              </a>
            ) : null,
            true,
          )}
        </>
      );
    }
    const field = each.key as DetailField;
    if (field === "owner") {
      const form = initialOwnerForm(details);
      const who = name ?? form.name;
      const mail = email ?? form.email;
      // Still the suggestion while the person has not typed over it: shown as one, never as
      // recorded, until the server confirms the save.
      const suggestion =
        form.suggestion !== null && name === null && email === null
          ? form.suggestion
          : null;
      const valid =
        (who.trim() !== "" || mail.trim() !== "") &&
        (mail.trim() === "" || EMAIL.test(mail.trim()));
      return (
        <form
          className="ur-point"
          autoComplete="off"
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            void save("owner");
          }}
        >
          {kicker}
          <h3 className="ur-q" id="ur-q">
            Who owns {controlRef}
            {system !== "" ? ` on ${system}` : ""}?
          </h3>
          <p className="ur-hint">
            The person who performs or answers for the control at the
            organization.
          </p>
          {suggestion !== null ? (
            <p className="cd-suggest" id="cd-suggest">
              <span className="ai-mark">
                <UiIcon name="sparkles" size={11} /> Suggested
              </span>
              <span>
                {suggestionNote(suggestion, system)}. Use this owner, or type
                someone else.
              </span>
            </p>
          ) : null}
          <div className="cd-fields">
            <label className="cd-field">
              <span>Name</span>
              <input
                type="text"
                maxLength={200}
                value={who}
                disabled={busy}
                className={suggestion !== null ? "is-suggested" : undefined}
                aria-describedby={
                  suggestion !== null ? "cd-suggest" : undefined
                }
                placeholder="The control owner's name"
                onChange={(event) => {
                  setName(event.target.value);
                  setEmail((was) => was ?? mail);
                }}
              />
            </label>
            <label className="cd-field">
              <span>Email</span>
              <input
                type="email"
                maxLength={200}
                value={mail}
                disabled={busy}
                className={suggestion !== null ? "is-suggested" : undefined}
                aria-describedby={
                  suggestion !== null ? "cd-suggest" : undefined
                }
                placeholder="name@organization.com"
                aria-invalid={mail.trim() !== "" && !EMAIL.test(mail.trim())}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setName((was) => was ?? who);
                }}
              />
            </label>
          </div>
          {system.trim() !== "" ? (
            <label className="ur-systems cd-apply" htmlFor="cd-apply">
              <input
                type="checkbox"
                id="cd-apply"
                checked={applyToSystem}
                disabled={busy}
                onChange={(event) => setApplyToSystem(event.target.checked)}
              />
              <span>
                <strong>
                  Also use for other controls on {system} without an owner
                </strong>
                <span>Owners already recorded are not changed.</span>
              </span>
            </label>
          ) : null}
          {offer("owner")}
          {why}
          {foot(
            <button
              type="submit"
              className="btn btn-primary"
              disabled={busy || !valid}
            >
              {saving ? (
                <span className="spinner small" aria-hidden="true" />
              ) : null}
              {saving
                ? "Saving…"
                : suggestion !== null
                  ? "Use this owner"
                  : "Save & continue"}
              <UiIcon name="arrow" size={14} />
            </button>,
            each.missing,
          )}
        </form>
      );
    }
    const options = field === "frequency" ? frequencies : natures;
    const held = field === "frequency" ? details.frequency : details.nature;
    const picked = choice ?? held;
    return (
      <form
        className="ur-point"
        autoComplete="off"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          void save(field);
        }}
      >
        {kicker}
        <h3 className="ur-q" id="ur-q">
          {QUESTION[field]}
        </h3>
        <fieldset className="ur-options" aria-labelledby="ur-q">
          {options.map(([value, text]) => (
            <label
              key={value}
              className={`ur-option${picked === value ? " is-on" : ""}`}
            >
              <input
                type="radio"
                name={`cd-${field}`}
                value={value}
                checked={picked === value}
                disabled={busy}
                onChange={() => setChoice(value)}
              />
              <span className="ur-dot" aria-hidden="true" />
              <span className="ur-option-text">{text}</span>
              {value === held ? <span className="ur-tag">Recorded</span> : null}
            </label>
          ))}
        </fieldset>
        {offer(field)}
        {why}
        {foot(
          <button
            type="submit"
            className="btn btn-primary"
            disabled={busy || picked === ""}
          >
            {saving ? (
              <span className="spinner small" aria-hidden="true" />
            ) : null}
            {saving ? "Saving…" : "Save & continue"}
            <UiIcon name="arrow" size={14} />
          </button>,
          each.missing,
        )}
      </form>
    );
  };

  const end =
    missing.length === 0 ? (
      <div className="ur-end">
        <span className="ur-seal" aria-hidden="true">
          <UiIcon name="check" size={22} />
        </span>
        <h3 className="ur-q">{controlRef}'s details are recorded</h3>
        <p className="ur-hint">
          Everything the methodology needs from the RCM is on record. Change a
          detail from the record if the organization's RCM changes.
        </p>
        {nextHref !== null ? (
          <div className="ur-foot-actions">
            <Link className="btn btn-primary" href={nextHref} scroll={false}>
              Continue to Control Understanding{" "}
              <UiIcon name="arrow" size={14} />
            </Link>
          </div>
        ) : null}
      </div>
    ) : (
      <div className="ur-end">
        <h3 className="ur-q">
          {missing.length} {missing.length === 1 ? "detail is" : "details are"}{" "}
          still missing
        </h3>
        <ul className="ur-left">
          {missing.map((each) => (
            <li key={each.key}>
              <span>{each.label}</span>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  reset();
                  setAt(Math.max(0, course.indexOf(each.key)));
                }}
              >
                Record
              </button>
            </li>
          ))}
        </ul>
      </div>
    );

  return (
    <section className="ur cd" aria-labelledby="cd-title">
      <header className="ur-head">
        <span className="ur-tile" aria-hidden="true">
          <AgentAvatar size={30} state={saving ? "working" : "idle"} />
        </span>
        <div className="ur-head-text">
          <p className="ur-eyebrow">From the organization's RCM</p>
          <h2 id="cd-title">
            {missing.length === 0
              ? `${controlRef}'s details are recorded`
              : `Complete ${controlRef}'s details`}
          </h2>
          <p className="ur-lede">
            {missing.length === 0
              ? "The planner drafts the understanding and the evidence requests from these details."
              : `${missing.length} ${missing.length === 1 ? "detail is" : "details are"} not in the RCM. The planner needs ${missing.length === 1 ? "it" : "them"} to draft the understanding and the evidence requests.`}
          </p>
        </div>
        {setupHref !== null ? (
          <div className="ur-head-tools">
            <a className="btn btn-quiet" href={setupHref}>
              <UiIcon name="layers" size={15} /> Controls setup
            </a>
          </div>
        ) : null}
        <div className="ur-progress">
          <div className="ur-segments" aria-hidden="true">
            {counted.map((each) => (
              <span key={each.key} className={each.missing ? "" : "is-done"} />
            ))}
          </div>
          <span className="ur-progress-label">
            {recorded} of {counted.length} recorded
          </span>
        </div>
      </header>

      <div className="ur-body">
        <aside
          className="ur-doc cd-doc is-open"
          aria-label="The control as recorded"
        >
          <div className="ur-doc-head">
            <p className="ur-label">The control as recorded</p>
            {system !== "" ? <span className="ur-chip">{system}</span> : null}
          </div>
          <dl className="cd-record">
            {current.map((each) => (
              <div
                key={each.key}
                className={`${each.missing ? "is-missing" : ""}${each.key === step ? " is-current" : ""}`}
              >
                <dt>{each.label}</dt>
                <dd>
                  {each.missing ? (
                    <span className="ur-chip is-warm">Missing</span>
                  ) : (
                    <span className="cd-value">{each.value}</span>
                  )}
                  {each.editable && !each.missing && details.canEdit ? (
                    <button
                      type="button"
                      className="ur-skip"
                      onClick={() => {
                        reset();
                        setChanging(each.key as DetailField);
                      }}
                    >
                      Change
                    </button>
                  ) : null}
                </dd>
              </div>
            ))}
          </dl>
        </aside>

        <section
          className="ur-ask"
          aria-labelledby={
            row === null || row === undefined ? undefined : "ur-q"
          }
        >
          {saved !== null ? (
            <p className="ur-saved" role="status">
              <UiIcon name="check" size={13} /> {saved}
            </p>
          ) : null}
          {problem !== null ? (
            <p className="cc-problem" role="alert">
              {problem}
            </p>
          ) : null}
          {!details.canEdit ? (
            <p className="ur-hint cd-readonly">
              Only an engagement owner, admin or project manager can record a
              control's details.
            </p>
          ) : null}
          <div className="ur-step" key={step ?? "end"}>
            {row !== null && row !== undefined ? ask(row) : end}
          </div>
        </section>
      </div>
    </section>
  );
}
