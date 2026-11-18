"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";

import { PHASE_LABELS } from "./evidence-center-model";
import {
  assignSummary,
  type Choices,
  chooseAll,
  chosen,
  initialChoices,
  type Owners,
  type Section,
  sections,
  type Unassigned,
} from "./evidence-owners-model";
import { RecordDialog } from "./record-dialog";
import { ContactSearch } from "./request-review";
import { UiIcon } from "./ui-icon";

type Ids = { organizationId: string; projectId: string };

async function post(
  ids: Ids,
  items: { id: string; version: number; recipient: string }[],
): Promise<{ status: number; detail: string; body: unknown }> {
  try {
    const response = await fetch("/workspace/evidence-center", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        organization_id: ids.organizationId,
        project_id: ids.projectId,
        intent: "owners-assign",
        items,
      }),
    });
    const body = (await response.json()) as {
      status?: unknown;
      detail?: unknown;
      body?: unknown;
    };
    return {
      status: typeof body.status === "number" ? body.status : 0,
      detail: typeof body.detail === "string" ? body.detail : "",
      body: body.body ?? null,
    };
  } catch {
    return { status: 0, detail: "", body: null };
  }
}

/**
 * Who each request addressed to no one goes to: a suggestion from the engagement's own
 * records, with where it comes from, confirmed for many at once; anyone can be changed,
 * for one request or a whole section. A request with no suggestion waits for a pick.
 */
export function OwnersPanel({
  ids,
  owners,
  closeHref,
  canAct,
}: {
  ids: Ids;
  owners: Owners;
  closeHref: string;
  canAct: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [choices, setChoices] = useState<Choices>(() =>
    initialChoices(owners.items),
  );
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [refusals, setRefusals] = useState<Record<string, string>>({});
  const inFlight = useRef(false);
  const ready = chosen(owners.items, choices);
  const working = busy || pending;

  const confirm = async () => {
    if (inFlight.current || ready.length === 0) return;
    inFlight.current = true;
    setBusy(true);
    setSummary(null);
    const answer = await post(ids, ready);
    inFlight.current = false;
    setBusy(false);
    const result = answer.body as {
      done?: number;
      refused?: number;
      outcomes?: { id: string; ok: boolean; detail: string }[];
    } | null;
    if (answer.status !== 200 || result === null) {
      setSummary(
        answer.detail ||
          (answer.status === 403
            ? "Your role does not permit assigning owners."
            : "The owners could not be assigned. Try again."),
      );
      return;
    }
    setRefusals(
      Object.fromEntries(
        (result.outcomes ?? [])
          .filter((item) => !item.ok)
          .map((item) => [item.id, item.detail]),
      ),
    );
    setSummary(assignSummary(result.done ?? 0, result.refused ?? 0));
    startTransition(() => router.refresh());
  };

  return (
    <RecordDialog
      eyebrow="Evidence requests"
      title="Assign owners"
      description="Suggested from the engagement's records. Confirm them, or choose someone else."
      closeHref={closeHref}
    >
      <div className="ec-dialog-body">
        {owners.items.length === 0 ? (
          <p className="eo-empty" role="status">
            <UiIcon name="check" size={14} />
            {summary !== null ? `${summary} ` : ""}Every request has an owner.
          </p>
        ) : (
          <div className="eo" aria-busy={working}>
            {sections(owners.items).map((section) => (
              <OwnerSection
                key={section.email || "none"}
                section={section}
                owners={owners}
                choices={choices}
                refusals={refusals}
                disabled={working || !canAct}
                onChange={setChoices}
              />
            ))}
            <footer className="eo-foot">
              {summary !== null ? (
                <p className="eo-summary" role="status">
                  {summary}
                </p>
              ) : (
                <p className="eo-summary">
                  Requests without an owner are not sent.
                </p>
              )}
              <button
                type="button"
                className="btn"
                disabled={working || !canAct || ready.length === 0}
                onClick={() => void confirm()}
              >
                <UiIcon name="check" size={13} />
                {busy
                  ? "Assigning…"
                  : ready.length === 0
                    ? "Assign"
                    : `Assign ${ready.length} request${ready.length === 1 ? "" : "s"}`}
              </button>
            </footer>
          </div>
        )}
      </div>
    </RecordDialog>
  );
}

function OwnerSection({
  section,
  owners,
  choices,
  refusals,
  disabled,
  onChange,
}: {
  section: Section;
  owners: Owners;
  choices: Choices;
  refusals: Record<string, string>;
  disabled: boolean;
  onChange: (next: Choices) => void;
}) {
  const id = useId();
  const [changing, setChanging] = useState(false);
  const pick = (email: string) => {
    onChange(
      chooseAll(
        choices,
        section.items.map((item) => item.id),
        email,
      ),
    );
    setChanging(false);
  };
  return (
    <section className="eo-section" aria-labelledby={`${id}-who`}>
      <div className="eo-head">
        <div className="eo-who">
          <h4 id={`${id}-who`}>
            {section.email === ""
              ? "No suggestion"
              : section.name || section.email}
          </h4>
          {section.email !== "" && section.name !== "" ? (
            <span className="eo-sub">{section.email}</span>
          ) : null}
          {section.labels.length > 0 ? (
            <span className="eo-sources">
              {section.labels.map((label) => (
                <span key={label} className="eo-source">
                  {label}
                </span>
              ))}
            </span>
          ) : (
            <span className="eo-sub">
              No reliable record names an owner. Choose who these go to.
            </span>
          )}
        </div>
        {!changing ? (
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            disabled={disabled}
            onClick={() => setChanging(true)}
          >
            {section.email === "" ? "Choose for all" : "Change for all"}
          </button>
        ) : null}
      </div>
      {changing ? (
        <ContactSearch
          id={`${id}-all`}
          labelledBy={`${id}-who`}
          contacts={owners.contacts}
          exclude={[]}
          domains={owners.domains}
          placeholder="Search people, or type an email address"
          disabled={disabled}
          focus
          onPick={pick}
          onCreate={pick}
          onClose={() => setChanging(false)}
        />
      ) : null}
      <ul className="eo-items">
        {section.items.map((item) => (
          <Row
            key={item.id}
            item={item}
            owners={owners}
            choice={choices[item.id]}
            refusal={refusals[item.id]}
            disabled={disabled}
            onChange={(recipient, include) =>
              onChange({ ...choices, [item.id]: { recipient, include } })
            }
          />
        ))}
      </ul>
    </section>
  );
}

function Row({
  item,
  owners,
  choice,
  refusal,
  disabled,
  onChange,
}: {
  item: Unassigned;
  owners: Owners;
  choice: { recipient: string; include: boolean } | undefined;
  refusal: string | undefined;
  disabled: boolean;
  onChange: (recipient: string, include: boolean) => void;
}) {
  const id = useId();
  const [changing, setChanging] = useState(false);
  const recipient = choice?.recipient ?? "";
  const overridden =
    recipient !== "" && recipient !== (item.suggestion?.email ?? "");
  const pick = (email: string) => {
    onChange(email.toLowerCase(), true);
    setChanging(false);
  };
  return (
    <li className="eo-item">
      <label className="eo-check">
        <input
          type="checkbox"
          checked={(choice?.include ?? false) && recipient !== ""}
          disabled={disabled || recipient === ""}
          onChange={(event) => onChange(recipient, event.target.checked)}
        />
        <span className="eo-control">
          <span className="eo-name" id={`${id}-name`}>
            {item.controlTitle || item.controlRef}
          </span>
          <span className="eo-sub">
            {[
              item.controlRef,
              item.phase === null
                ? ""
                : (PHASE_LABELS[item.phase] ?? item.phase),
              item.system,
            ]
              .filter((part) => part !== "")
              .join(" · ")}
          </span>
        </span>
      </label>
      <div className="eo-to">
        {changing ? (
          <ContactSearch
            id={`${id}-pick`}
            labelledBy={`${id}-name`}
            contacts={owners.contacts}
            exclude={[]}
            domains={owners.domains}
            placeholder="Search people, or type an email address"
            disabled={disabled}
            focus
            onPick={pick}
            onCreate={pick}
            onClose={() => setChanging(false)}
          />
        ) : (
          <>
            {overridden ? (
              <span className="eo-picked">To {recipient}</span>
            ) : null}
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              disabled={disabled}
              onClick={() => setChanging(true)}
            >
              {recipient === "" ? "Choose" : "Change"}
            </button>
          </>
        )}
      </div>
      {refusal !== undefined ? (
        <p className="rr-field-error" role="alert">
          {refusal}
        </p>
      ) : null}
    </li>
  );
}
