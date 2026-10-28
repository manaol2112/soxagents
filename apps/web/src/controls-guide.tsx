"use client";

import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useState,
} from "react";

import {
  ADD_PROCESS_EVENT,
  ADD_SYSTEM_EVENT,
  CONTROLS_GUIDE_SEEN_KEY,
  CONTROLS_PANES,
  type ControlsPane,
  type ControlsTile,
  FINALIZE_EVENT,
  OPEN_CONTROLS_GUIDE_EVENT,
  PANE_COUNT_EVENT,
  PROCESS_SAVED_EVENT,
  RCM_UPLOAD_EVENT,
  type ScopeStep,
  SELECT_CONTROLS_EVENT,
  SHOW_PANE_EVENT,
  SYSTEM_SAVED_EVENT,
} from "./controls-guide-model";
import { RowMenu } from "./row-menu";
import { SpotlightTour } from "./spotlight-tour";
import type { TourStep } from "./tour-model";
import { type IconName, UiIcon } from "./ui-icon";

const PANE_ICON: Record<ControlsPane, IconName> = {
  systems: "server",
  processes: "layers",
  policies: "file",
  references: "clock",
};

function isPane(value: unknown): value is ControlsPane {
  return (CONTROLS_PANES as readonly unknown[]).includes(value);
}

/** Shows a tab of the setup, then (once it is drawn) does what was asked there. */
function showPane(pane: ControlsPane, then?: () => void): void {
  document.dispatchEvent(new CustomEvent(SHOW_PANE_EVENT, { detail: pane }));
  if (then !== undefined) {
    requestAnimationFrame(() => requestAnimationFrame(then));
  }
}

/** The setup agent's tour of the Controls setup: by itself the first time, then from
 * Guide me or the agent's strip. Each stop shows the tab its parts are on. */
export function ControlsTour({ steps }: { steps: readonly TourStep[] }) {
  return (
    <SpotlightTour
      steps={steps}
      seenKey={CONTROLS_GUIDE_SEEN_KEY}
      openEvent={OPEN_CONTROLS_GUIDE_EVENT}
      onStep={(step) => {
        if (isPane(step.pane)) {
          showPane(step.pane);
        }
      }}
    />
  );
}

/** The agent's way into the tour. */
export function WalkThroughButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      className="ap-action"
      onClick={() =>
        document.dispatchEvent(new Event(OPEN_CONTROLS_GUIDE_EVENT))
      }
    >
      <UiIcon name="sparkles" size={14} />
      {label}
    </button>
  );
}

/**
 * The first setup's tiles and tabs (decided by the product owner): a tile for each of the
 * systems, processes, and controls, with how many and where they stand, over a tab for
 * each. Every tab is drawn by the server and only shown or hidden here, so moving between
 * them loads nothing and keeps what was entered; the tab open is kept in the address.
 */
export function ControlsSetupFrame({
  initial,
  tiles,
  panes,
  steps = null,
  controlsHref = null,
}: {
  initial: ControlsPane;
  tiles: readonly ControlsTile[];
  panes: Record<ControlsPane, ReactNode>;
  /** The Controls page, where the controls selected for each system and process are. */
  controlsHref?: string | null;
  /** The workflow's four steps, shown until the scope is finalized. */
  steps?: readonly ScopeStep[] | null;
}) {
  const [pane, setPane] = useState<ControlsPane>(initial);
  // Counts a pane reported after a change in the page, over the server's.
  const [counted, setCounted] = useState<
    Partial<Record<ControlsPane, { count: number; status: string }>>
  >({});
  useEffect(() => {
    const count = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail as {
        pane?: unknown;
        count?: unknown;
        status?: unknown;
      } | null;
      if (
        detail !== null &&
        isPane(detail.pane) &&
        typeof detail.count === "number" &&
        typeof detail.status === "string"
      ) {
        const { pane: which, count: value, status } = detail;
        setCounted((now) => ({ ...now, [which]: { count: value, status } }));
      }
    };
    document.addEventListener(PANE_COUNT_EVENT, count);
    return () => document.removeEventListener(PANE_COUNT_EVENT, count);
  }, []);
  const shown = tiles.map((tile) => ({
    ...tile,
    ...(counted[tile.pane] ?? {}),
  }));
  const choose = useCallback((next: ControlsPane) => {
    setPane(next);
    const url = new URL(window.location.href);
    if (url.searchParams.get("pane") !== next) {
      url.searchParams.set("pane", next);
      window.history.replaceState(window.history.state, "", url);
    }
  }, []);
  useEffect(() => {
    const show = (event: Event) => {
      const next = (event as CustomEvent<unknown>).detail;
      if (isPane(next)) {
        choose(next);
      }
    };
    // What was just saved shows on its tab, wherever its wizard was opened.
    const saved: Array<[string, () => void]> = [
      [SYSTEM_SAVED_EVENT, () => choose("systems")],
      [PROCESS_SAVED_EVENT, () => choose("processes")],
    ];
    document.addEventListener(SHOW_PANE_EVENT, show);
    for (const [name, handler] of saved) {
      document.addEventListener(name, handler);
    }
    return () => {
      document.removeEventListener(SHOW_PANE_EVENT, show);
      for (const [name, handler] of saved) {
        document.removeEventListener(name, handler);
      }
    };
  }, [choose]);
  // The tabs follow the arrow keys, as a tab list does.
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const at = CONTROLS_PANES.indexOf(pane);
    const next =
      event.key === "ArrowRight"
        ? CONTROLS_PANES[(at + 1) % CONTROLS_PANES.length]
        : event.key === "ArrowLeft"
          ? CONTROLS_PANES[
              (at + CONTROLS_PANES.length - 1) % CONTROLS_PANES.length
            ]
          : undefined;
    if (next !== undefined) {
      event.preventDefault();
      choose(next);
      document.getElementById(`cs-tab-${next}`)?.focus();
    }
  };
  return (
    <>
      {steps === null ? null : (
        <ol className="sp-steps" aria-label="Workflow">
          {steps.map((step, at) => {
            const body = (
              <>
                <span className="sp-step-mark" aria-hidden="true">
                  {step.state === "done" ? (
                    <UiIcon name="check" size={16} />
                  ) : (
                    at + 1
                  )}
                </span>
                <span className="sp-step-text">
                  <strong>{step.title}</strong>
                  <small>{step.detail}</small>
                </span>
              </>
            );
            const { pane: stepPane } = step;
            return (
              <li
                key={step.key}
                className={`sp-step is-${step.key} is-${step.state}`}
                aria-current={step.state === "now" ? "step" : undefined}
              >
                {step.key === "controls" && controlsHref !== null ? (
                  <a className="sp-step-body" href={controlsHref}>
                    {body}
                  </a>
                ) : stepPane === null ? (
                  <button
                    type="button"
                    className="sp-step-body"
                    onClick={() =>
                      document.dispatchEvent(new Event(FINALIZE_EVENT))
                    }
                  >
                    {body}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="sp-step-body"
                    onClick={() => choose(stepPane)}
                  >
                    {body}
                  </button>
                )}
                <span className="sr-only">
                  {step.state === "done"
                    ? "Done"
                    : step.state === "now"
                      ? "Current step"
                      : "To do"}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      <section className="cs-tiles" aria-label="Setup summary">
        {shown.map((tile) => (
          <button
            key={tile.pane}
            type="button"
            className={`cs-tile is-${tile.pane}${tile.pane === pane ? " is-on" : ""}`}
            aria-controls={`cs-pane-${tile.pane}`}
            onClick={() => choose(tile.pane)}
          >
            <span className="cs-tile-icon" aria-hidden="true">
              <UiIcon name={PANE_ICON[tile.pane]} size={24} />
            </span>
            <span className="cs-tile-text">
              <span className="cs-tile-label">{tile.label}</span>
              <strong className="cs-tile-count">{tile.count}</strong>
              <span className="cs-tile-status">{tile.status}</span>
            </span>
            <span className="cs-tile-go" aria-hidden="true">
              <UiIcon name="chevron" size={16} />
            </span>
          </button>
        ))}
      </section>
      <div
        className="cs-tabs"
        role="tablist"
        aria-label="Controls setup"
        onKeyDown={onKey}
      >
        {shown.map((tile) => (
          <button
            key={tile.pane}
            id={`cs-tab-${tile.pane}`}
            type="button"
            role="tab"
            aria-selected={tile.pane === pane}
            aria-controls={`cs-pane-${tile.pane}`}
            tabIndex={tile.pane === pane ? 0 : -1}
            className={tile.pane === pane ? "is-on" : undefined}
            onClick={() => choose(tile.pane)}
          >
            <UiIcon name={PANE_ICON[tile.pane]} size={18} />
            {tile.label} ({tile.count})
          </button>
        ))}
      </div>
      {CONTROLS_PANES.map((key) => (
        <div
          key={key}
          id={`cs-pane-${key}`}
          className="stack cs-pane"
          role="tabpanel"
          aria-labelledby={`cs-tab-${key}`}
          hidden={key !== pane}
        >
          {panes[key]}
        </div>
      ))}
    </>
  );
}

/** The page's Add: a system or a business process (each wizard opens over the tab in
 * view, and what it saved shows on its tab), controls from the library, the client's RCM
 * while no control is set up, and, until the scope is final, Review and finalize. */
export function ControlsAddMenu({
  controlsSet,
  finalized,
}: {
  controlsSet: boolean;
  finalized: boolean;
}) {
  const raise = (event: string) => () =>
    document.dispatchEvent(new Event(event));
  return (
    <RowMenu
      label="Add to the engagement's scope"
      trigger={{ label: "Add", icon: "plus" }}
      items={[
        {
          label: "Add a system",
          icon: "server",
          onSelect: raise(ADD_SYSTEM_EVENT),
        },
        {
          label: "Add a business process",
          icon: "layers",
          onSelect: raise(ADD_PROCESS_EVENT),
        },
        {
          label: "Select controls from the library",
          icon: "shield",
          onSelect: raise(SELECT_CONTROLS_EVENT),
        },
        {
          label: "Upload the client's RCM",
          icon: "upload",
          unavailable: controlsSet
            ? "The controls are set up; select more from the library."
            : null,
          onSelect: raise(RCM_UPLOAD_EVENT),
        },
        ...(finalized
          ? []
          : [
              {
                label: "Review and finalize",
                icon: "check" as const,
                onSelect: raise(FINALIZE_EVENT),
              },
            ]),
      ]}
    />
  );
}

/** A way to another tab's option, such as the RCM from the empty systems tab. */
export function RcmInsteadButton() {
  return (
    <button
      type="button"
      className="btn-secondary"
      onClick={() => document.dispatchEvent(new Event(RCM_UPLOAD_EVENT))}
    >
      <UiIcon name="upload" size={14} />
      Upload the client's RCM instead
    </button>
  );
}
