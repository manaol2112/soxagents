"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import {
  type Client,
  clientNamed,
  nextPeriodEnd,
  periodNotAfter,
  ROLLFORWARD_NOTE,
  rollforwardSources,
} from "./client-model";
import { statusLabel } from "./engagement-lifecycle";
import { formatDate } from "./format";

const NEW = "new";
// The New engagement form's period end, which a roll-forward proposes (engagement-create).
const PERIOD_INPUT = "create-period";

/**
 * Who the engagement is for (Milestone 8.18): one of the firm's clients, or a new one by
 * name. For an existing client with earlier engagements, a new engagement can start from
 * one of them (`rollforward`). A link can name the client to start with (`?client=`).
 */
export function ClientPicker({
  clients,
  initialClientId = null,
  rollforward = false,
}: {
  clients: readonly Client[];
  initialClientId?: string | null;
  /** Offer to start from one of the client's earlier engagements (new engagements). */
  rollforward?: boolean;
}) {
  const id = useId();
  const params = useSearchParams();
  const linked = params.get("client");
  const start =
    initialClientId ??
    (linked !== null && clients.some((c) => c.id === linked) ? linked : null);
  const [choice, setChoice] = useState<string>(
    start ?? (clients.length === 0 ? NEW : ""),
  );
  const [name, setName] = useState("");
  const [source, setSource] = useState("");
  const [period, setPeriod] = useState("");
  // The period end this picker filled in, so a date the person typed is never replaced.
  const proposed = useRef<string | null>(null);
  const chosen = clients.find((c) => c.id === choice);
  const existing = choice === NEW ? clientNamed(clients, name) : undefined;
  const sources = rollforward ? rollforwardSources(chosen) : [];
  const from = sources.find((engagement) => engagement.id === source);

  useEffect(() => {
    const input = periodInput();
    if (input === null) {
      return;
    }
    const read = () => setPeriod(input.value);
    read();
    input.addEventListener("input", read);
    input.addEventListener("change", read);
    return () => {
      input.removeEventListener("input", read);
      input.removeEventListener("change", read);
    };
  }, []);

  // Starting from an earlier engagement proposes the next period; a fresh start takes the
  // proposal back. Either way only a period end this picker filled in changes.
  function startFrom(next: string) {
    setSource(next);
    const input = periodInput();
    if (input === null || input.disabled) {
      return;
    }
    if (input.value !== "" && input.value !== proposed.current) {
      return;
    }
    const earlier = sources.find((engagement) => engagement.id === next);
    const proposal =
      earlier?.periodEnd != null ? nextPeriodEnd(earlier.periodEnd) : null;
    input.value = proposal ?? "";
    // The audit period written beneath the date follows the input's own events.
    input.dispatchEvent(new Event("input", { bubbles: true }));
    proposed.current = proposal;
    setPeriod(input.value);
  }

  return (
    <div className="client-picker">
      {clients.length > 0 ? (
        <label htmlFor={`${id}-client`}>
          Client
          <select
            id={`${id}-client`}
            required
            value={choice}
            onChange={(event) => {
              setChoice(event.target.value);
              startFrom("");
            }}
          >
            <option value="" disabled>
              Choose a client
            </option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
                {client.engagements.length > 0
                  ? ` (${client.engagements.length} engagement${client.engagements.length === 1 ? "" : "s"})`
                  : ""}
              </option>
            ))}
            <option value={NEW}>+ New client</option>
          </select>
        </label>
      ) : null}
      {chosen !== undefined ? (
        // The name goes too: the engagement's identifier is made from it.
        <>
          <input type="hidden" name="client_id" value={chosen.id} />
          <input type="hidden" name="client_name" value={chosen.name} />
        </>
      ) : null}
      {choice === NEW ? (
        <label htmlFor={`${id}-name`}>
          {clients.length > 0 ? "New client's name" : "Client"}
          <input
            id={`${id}-name`}
            name="client_name"
            required
            maxLength={200}
            autoComplete="off"
            placeholder="Client company name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          {existing !== undefined ? (
            <span className="form-hint client-exists" role="status">
              {existing.name} is already a client.{" "}
              <button
                type="button"
                className="text-link"
                onClick={() => {
                  setChoice(existing.id);
                  setName("");
                }}
              >
                Use {existing.name}
              </button>
            </span>
          ) : null}
        </label>
      ) : null}
      {sources.length > 0 ? (
        <fieldset className="client-start field-wide">
          <legend>Start from</legend>
          <p className="client-start-intro">
            Start fresh, or copy the setup of an earlier engagement for this
            client.
          </p>
          <label className="client-start-option" htmlFor={`${id}-fresh`}>
            <input
              id={`${id}-fresh`}
              type="radio"
              name="rollforward_from"
              value=""
              checked={source === ""}
              onChange={() => startFrom("")}
            />
            <span>
              <strong>A fresh setup</strong>
              <small>
                Only the client's details carry over: its email domains,
                evidence coordinator, and request cadence.
              </small>
            </span>
          </label>
          {sources.map((engagement) => (
            <label
              key={engagement.id}
              className="client-start-option"
              htmlFor={`${id}-from-${engagement.id}`}
            >
              <input
                id={`${id}-from-${engagement.id}`}
                type="radio"
                name="rollforward_from"
                value={engagement.id}
                checked={source === engagement.id}
                onChange={() => startFrom(engagement.id)}
              />
              <span>
                <strong>{engagement.name}</strong>
                <small>
                  {statusLabel(engagement.status)}
                  {engagement.periodEnd !== null
                    ? ` · Period end ${formatDate(engagement.periodEnd)}`
                    : ""}
                </small>
              </span>
            </label>
          ))}
          {from !== undefined ? (
            <p className="form-hint">{ROLLFORWARD_NOTE}</p>
          ) : null}
          {from !== undefined && periodNotAfter(period, from.periodEnd) ? (
            <p className="form-hint client-period is-warn" role="status">
              The period end, {formatDate(period)}, is not after {from.name}
              &rsquo;s ({formatDate(from.periodEnd ?? period)}). A roll-forward
              usually covers the next period.
            </p>
          ) : from !== undefined &&
            period !== "" &&
            period === proposed.current ? (
            <p className="form-hint client-period" role="status">
              Period end set to {formatDate(period)}, a year after {from.name}
              &rsquo;s. Change it below if this engagement covers another
              period.
            </p>
          ) : null}
        </fieldset>
      ) : null}
    </div>
  );
}

function periodInput(): HTMLInputElement | null {
  const element = document.getElementById(PERIOD_INPUT);
  return element instanceof HTMLInputElement ? element : null;
}
