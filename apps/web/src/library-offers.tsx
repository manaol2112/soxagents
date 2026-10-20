"use client";

import { type ReactNode, useId, useState } from "react";
import { filterOffers, type OtherControl } from "./onboarding-model";
import { UiIcon } from "./ui-icon";

type Area = { domain: string; label: string; offers: OtherControl[] };

const offerKey = (offer: OtherControl): string =>
  offer.libraryKey || offer.controlRef;

/**
 * A system's library offers with a quick search and filters: words in the ID or title,
 * one area, or only the controls taken out of scope. Each offer's action is rendered on
 * the server and passed in by its key, so adding works as before.
 */
export function FilterableOffers({
  system,
  areas,
  actions,
}: {
  system: string;
  areas: Area[];
  actions: Record<string, ReactNode>;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [domain, setDomain] = useState<string | null>(null);
  const [removed, setRemoved] = useState(false);
  const shown = filterOffers(areas, { query, domain, removed });
  const total = areas.reduce((sum, area) => sum + area.offers.length, 0);
  const matching = shown.reduce((sum, area) => sum + area.offers.length, 0);
  const back = areas.reduce(
    (sum, area) =>
      sum + area.offers.filter((offer) => offer.controlId !== null).length,
    0,
  );
  const filtered = query.trim() !== "" || domain !== null || removed;
  const clear = () => {
    setQuery("");
    setDomain(null);
    setRemoved(false);
  };
  return (
    <>
      <div className="sys-more-tools">
        <label className="sys-more-search" htmlFor={`${id}-search`}>
          <UiIcon name="search" size={14} />
          <span className="sr-only">Search the library controls</span>
          <input
            id={`${id}-search`}
            type="search"
            autoComplete="off"
            value={query}
            placeholder="Search by ID or title"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <fieldset className="sys-more-chips">
          <legend className="sr-only">Show</legend>
          <button
            type="button"
            className="sys-more-chip"
            aria-pressed={domain === null && !removed}
            onClick={() => {
              setDomain(null);
              setRemoved(false);
            }}
          >
            All <span>{total}</span>
          </button>
          {areas.map((area) => (
            <button
              key={area.domain}
              type="button"
              className="sys-more-chip"
              aria-pressed={domain === area.domain}
              onClick={() =>
                setDomain(domain === area.domain ? null : area.domain)
              }
            >
              {area.label} <span>{area.offers.length}</span>
            </button>
          ))}
          {back > 0 ? (
            <button
              type="button"
              className="sys-more-chip"
              aria-pressed={removed}
              onClick={() => setRemoved(!removed)}
            >
              Removed from {system} <span>{back}</span>
            </button>
          ) : null}
        </fieldset>
      </div>
      {filtered ? (
        <p className="sys-more-count" role="status">
          {matching === 0
            ? "No library control matches."
            : `${matching} of ${total} shown.`}{" "}
          <button type="button" className="sys-more-clear" onClick={clear}>
            Clear
          </button>
        </p>
      ) : null}
      {shown.map((area) => (
        <section
          key={area.domain}
          className="sys-more-group"
          aria-label={area.label}
        >
          <h5>{area.label}</h5>
          <ul>
            {area.offers.map((offer) => (
              <li key={offerKey(offer)}>
                <span>
                  <strong>{offer.controlRef}</strong> {offer.title}
                </span>
                {actions[offerKey(offer)]}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
