"use client";

import { SELECT_CONTROLS_EVENT } from "./controls-guide-model";
import { OpenScopeAction } from "./scope-actions";
import { withControlsFor } from "./scope-controls-model";
import { UiIcon } from "./ui-icon";

/**
 * A system's or a process's controls in brief (decided by the product owner on 26 October
 * 2026): how many there are, its approved control areas, what it is linked to, and the
 * way to its controls on the Controls tab, filtered to it. The controls themselves are
 * managed there, or chosen in the guided selection; never in a second table here.
 */
export function ScopeSummary({
  kind,
  id,
  name,
  controls,
  approved,
  suggested,
  linked,
  linkedLabel,
  editable,
  selectable,
  controlsHref,
}: {
  kind: "system" | "process";
  id: string;
  name: string;
  controls: number;
  /** The control areas a person approved, by label. */
  approved: string[];
  /** The agent's suggested areas no person approved yet, by label. */
  suggested: string[];
  linked: number;
  /** What `linked` counts: "Linked processes" for a system, "Linked systems" for a process. */
  linkedLabel: string;
  editable: boolean;
  /** Whether the guided selection can open for it (a named process, or any system). */
  selectable: boolean;
  /** The Controls page; View controls opens it filtered to this system or process. */
  controlsHref: string;
}) {
  return (
    <section className="ss" aria-label={`${name} in brief`}>
      <dl className="ss-counts">
        <div>
          <dt>Controls in scope</dt>
          <dd>{controls}</dd>
        </div>
        <div>
          <dt>Approved control areas</dt>
          <dd>{approved.length}</dd>
        </div>
        <div>
          <dt>{linkedLabel}</dt>
          <dd>{linked}</dd>
        </div>
      </dl>
      {approved.length > 0 || suggested.length > 0 ? (
        <p className="ss-areas">
          {approved.map((label) => (
            <span key={label} className="as-tag is-approved">
              <UiIcon name="check" size={11} />
              {label}
            </span>
          ))}
          {suggested.map((label) => (
            <span
              key={label}
              className="as-tag"
              title="Suggested by the agent, not approved"
            >
              {label}
            </span>
          ))}
        </p>
      ) : null}
      <div className="ss-actions">
        <a
          className="btn btn-sm"
          href={withControlsFor(controlsHref, { kind, id })}
        >
          View controls
          <UiIcon name="arrow" size={14} />
        </a>
        {editable && selectable ? (
          <OpenScopeAction
            event={SELECT_CONTROLS_EVENT}
            detail={id}
            label="Select controls"
            icon="plus"
            className="btn-secondary btn-sm"
          />
        ) : null}
      </div>
    </section>
  );
}
