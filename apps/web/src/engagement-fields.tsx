"use client";

import { useEffect, useRef, useState } from "react";

import { type FactsBase, useEngagementFacts } from "./engagement-form-facts";
import { clientName, scopeDraft } from "./engagement-guide-model";
import { periodRange } from "./new-engagement-model";
import { UiIcon } from "./ui-icon";

/**
 * The period end, with the audit period it implies written out beneath it. The client
 * picker can fill the date in (a roll-forward proposes the next period) and raises the
 * input's event when it does, so the range follows the input's own events.
 */
export function PeriodField({
  id,
  name,
  defaultValue,
  disabled = false,
  hint,
}: {
  id: string;
  name: string | undefined;
  defaultValue: string | undefined;
  disabled?: boolean;
  hint: string;
}) {
  const [value, setValue] = useState(defaultValue ?? "");
  useEffect(() => {
    const input = document.getElementById(id);
    if (!(input instanceof HTMLInputElement)) {
      return;
    }
    const read = () => setValue(input.value);
    input.addEventListener("input", read);
    input.addEventListener("change", read);
    return () => {
      input.removeEventListener("input", read);
      input.removeEventListener("change", read);
    };
  }, [id]);
  const range = periodRange(value);
  return (
    <label htmlFor={id}>
      Audit period end
      <input
        id={id}
        name={name}
        type="date"
        disabled={disabled}
        defaultValue={defaultValue}
      />
      {range !== "" ? (
        <span className="ne-period" aria-live="polite">
          <UiIcon name="calendar" size={13} />
          Audit period {range}
        </span>
      ) : null}
      <span className="form-hint">{hint}</span>
    </label>
  );
}

/**
 * The scope, drafted from the client, the period, and the methodology as they are
 * chosen (decided by the product owner: the client and the scope are one step), until
 * someone writes their own. Required: launch needs it.
 */
export function ScopeField({ clients }: FactsBase) {
  const facts = useEngagementFacts({ clients });
  const draft =
    facts === null
      ? ""
      : scopeDraft({
          client: clientName(facts),
          periodEnd: facts.periodEnd,
          methodology: facts.methodology,
        });
  const [value, setValue] = useState("");
  const [edited, setEdited] = useState(false);
  const draftNow = useRef(draft);
  draftNow.current = draft;
  // The draft follows the other fields until the scope is edited.
  useEffect(() => {
    if (!edited) {
      setValue(draft);
    }
  }, [draft, edited]);
  return (
    <label htmlFor="create-scope" className="field-wide">
      Scope
      <textarea
        id="create-scope"
        name="scope"
        required
        rows={3}
        maxLength={4000}
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          setEdited(event.target.value !== draftNow.current);
        }}
      />
      <span className="form-hint">
        {edited
          ? "Written for this engagement."
          : "Drafted from the client, the period, and the methodology. Edit it to describe the engagement in your own words."}
      </span>
    </label>
  );
}
