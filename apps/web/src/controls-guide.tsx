"use client";

import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useState,
} from "react";

import {
  ADD_SYSTEM_EVENT,
  CONTROLS_GUIDE_SEEN_KEY,
  CONTROLS_PANES,
  type ControlsPane,
  type ControlsTile,
  OPEN_CONTROLS_GUIDE_EVENT,
  type ScopeStep,
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
  controls: "shield",
};

const LIBRARY_OPTION = ".rcm-options > .rcm-option:nth-child(1)";
const RCM_OPTION = ".rcm-options > .rcm-option:nth-child(2)";

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

function reveal(selector: string): HTMLElement | null {
  const element = document.querySelector<HTMLElement>(selector);
  element?.scrollIntoView({
    block: "center",
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth",
  });
  return element;
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
}: {
  initial: ControlsPane;
  tiles: readonly ControlsTile[];
  panes: Record<ControlsPane, ReactNode>;
  /** The workflow's four steps, shown until the scope is finalized. */
  steps?: readonly ScopeStep[] | null;
}) {
  const [pane, setPane] = useState<ControlsPane>(initial);
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
    // A system just saved shows on the Systems tab, wherever its wizard was opened.
    const saved = () => choose("systems");
    document.addEventListener(SHOW_PANE_EVENT, show);
    document.addEventListener(SYSTEM_SAVED_EVENT, saved);
    return () => {
      document.removeEventListener(SHOW_PANE_EVENT, show);
      document.removeEventListener(SYSTEM_SAVED_EVENT, saved);
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
                {stepPane === null ? (
                  <span className="sp-step-body">{body}</span>
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
        {tiles.map((tile) => (
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
        {tiles.map((tile) => (
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

/** The page's Add: a system (its wizard opens over the tab in view, and a saved system
 * shows on the Systems tab), a business process, or controls from the library or the
 * client's RCM while none are set up. */
export function ControlsAddMenu({ controlsSet }: { controlsSet: boolean }) {
  const later = controlsSet
    ? "The controls are set up; add more from a system or a process."
    : null;
  return (
    <RowMenu
      label="Add to the engagement's scope"
      trigger={{ label: "Add", icon: "plus" }}
      items={[
        {
          label: "Add a system",
          icon: "server",
          onSelect: () => document.dispatchEvent(new Event(ADD_SYSTEM_EVENT)),
        },
        {
          label: "Add a business process",
          icon: "layers",
          onSelect: () =>
            showPane("processes", () => {
              const form = document.querySelector<HTMLDetailsElement>(
                "#cs-pane-processes details.new-process",
              );
              if (form !== null) {
                form.open = true;
                reveal("#cs-pane-processes details.new-process");
                form
                  .querySelector<HTMLInputElement>('input[name="name"]')
                  ?.focus();
              }
            }),
        },
        {
          label: "Load from the standard library",
          icon: "shield",
          unavailable: later,
          onSelect: () => showPane("controls", () => reveal(LIBRARY_OPTION)),
        },
        {
          label: "Upload the client's RCM",
          icon: "upload",
          unavailable: later,
          onSelect: () => showPane("controls", () => reveal(RCM_OPTION)),
        },
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
      onClick={() => showPane("controls", () => reveal(RCM_OPTION))}
    >
      <UiIcon name="upload" size={14} />
      Upload the client's RCM instead
    </button>
  );
}
