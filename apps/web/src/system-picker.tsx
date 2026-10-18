"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  customCandidate,
  filterSystems,
  knownSystemGroups,
  LAYERS,
} from "./onboarding-model";
import { type IconName, UiIcon } from "./ui-icon";

type System = { name: string; layer: string };
type Custom = { name: string; layer: string };

type Props = {
  organizationId: string;
  projectId: string;
  /** Common systems not yet in scope. */
  systems: System[];
  /** Systems already in scope, so a custom name cannot repeat one. */
  existing: string[];
};

const LAYER_PLURAL: Record<string, string> = {
  APPLICATION: "Applications",
  DATABASE: "Databases",
  OPERATING_SYSTEM: "Operating systems",
  INFRASTRUCTURE: "Infrastructure",
  TOOL: "Tools",
};
const LAYER_ICON: Record<string, IconName> = {
  APPLICATION: "window",
  DATABASE: "database",
  OPERATING_SYSTEM: "server",
  INFRASTRUCTURE: "cloud",
  TOOL: "wrench",
};

/**
 * Adding in-scope systems: one button that opens a command palette. Search the
 * reviewed catalog, filter by kind, pick several, or add one the catalog lacks.
 */
export function SystemPicker(props: Props) {
  const [open, setOpen] = useState<Mode | null>(null);
  return (
    <span className="sp-triggers">
      <button
        type="button"
        className="btn-secondary btn-sm sp-trigger"
        onClick={() => setOpen("custom")}
      >
        Custom system
      </button>
      <button
        type="button"
        className="btn-sm sp-trigger"
        onClick={() => setOpen("browse")}
      >
        <UiIcon name="plus" size={14} />
        Add systems
      </button>
      {open !== null ? (
        <Palette {...props} start={open} onClose={() => setOpen(null)} />
      ) : null}
    </span>
  );
}

type Mode = "browse" | "custom";

type Row =
  | { kind: "custom"; key: string; name: string }
  | { kind: "system"; key: string; system: System };

function Palette({
  organizationId,
  projectId,
  systems,
  existing,
  start,
  onClose,
}: Props & { start: Mode; onClose: () => void }) {
  const [mode, setMode] = useState<Mode>(start);
  const [draft, setDraft] = useState("");
  const draftInput = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [layer, setLayer] = useState("ALL");
  const [picked, setPicked] = useState<string[]>([]);
  const [custom, setCustom] = useState<Custom[]>([]);
  const [customLayer, setCustomLayer] = useState("APPLICATION");
  const [active, setActive] = useState(0);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const groups = useMemo(() => knownSystemGroups(systems), [systems]);
  const matching = useMemo(
    () => filterSystems(systems, query, "ALL"),
    [systems, query],
  );
  const shown = useMemo(
    () => filterSystems(systems, query, layer),
    [systems, query, layer],
  );
  const candidate = customCandidate(query, [
    ...systems.map((system) => system.name),
    ...existing,
    ...custom.map((item) => item.name),
  ]);
  const sections = useMemo(
    () =>
      LAYERS.map(([key]) => ({
        layer: key,
        systems: shown.filter((system) => system.layer === key),
      })).filter((section) => section.systems.length > 0),
    [shown],
  );
  const systemRows: Row[] = sections.flatMap((section) =>
    section.systems.map((system) => ({
      kind: "system" as const,
      key: system.name,
      system,
    })),
  );
  // With matches, Enter picks the first match and the custom option waits below them.
  const customFirst = systemRows.length === 0;
  const customRow: Row[] =
    candidate === null
      ? []
      : [{ kind: "custom", key: "custom", name: candidate }];
  const rows: Row[] = customFirst
    ? [...customRow, ...systemRows]
    : [...systemRows, ...customRow];
  const customIndex = customFirst ? 0 : systemRows.length;
  const count = picked.length + custom.length;
  const taken = [
    ...systems.map((system) => system.name),
    ...existing,
    ...custom.map((item) => item.name),
  ];
  const draftName = customCandidate(draft, taken);
  const draftProblem =
    draft.trim() === "" || draftName !== null
      ? null
      : taken.some((name) => name.toLowerCase() === draft.trim().toLowerCase())
        ? "That system is already in the list or in scope."
        : "Use a name of at least two characters, with no passwords or keys.";
  const addDraft = () => {
    if (draftName === null) {
      return;
    }
    setCustom((current) => [
      ...current,
      { name: draftName, layer: customLayer },
    ]);
    setDraft("");
    draftInput.current?.focus();
  };

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    (start === "custom" ? draftInput : search).current?.focus();
    document.body.classList.add("has-dialog");
    return () => {
      document.body.classList.remove("has-dialog");
      previous?.focus();
    };
  }, [start]);

  // A new search or kind starts at the top of the list.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on these inputs only.
  useEffect(() => {
    setActive(0);
    list.current?.scrollTo({ top: 0 });
  }, [query, layer]);

  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>(`[data-row="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const toggle = (name: string) =>
    setPicked((current) =>
      current.includes(name)
        ? current.filter((item) => item !== name)
        : [...current, name],
    );
  const addCustom = (name: string) => {
    setCustom((current) => [...current, { name, layer: customLayer }]);
    setQuery("");
    search.current?.focus();
  };
  const choose = (row: Row | undefined) => {
    if (row === undefined) {
      return;
    }
    if (row.kind === "custom") {
      addCustom(row.name);
    } else {
      toggle(row.system.name);
    }
  };

  const onKey = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (mode === "browse" && event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => Math.min(index + 1, rows.length - 1));
    } else if (mode === "browse" && event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (mode === "custom") {
      if (event.key === "Enter" && event.target === draftInput.current) {
        event.preventDefault();
        addDraft();
      }
    } else if (
      event.key === "Enter" &&
      (event.target as HTMLElement).tagName === "INPUT"
    ) {
      event.preventDefault();
      choose(rows[active]);
    }
  };

  let index = customFirst && candidate !== null ? 1 : 0;
  const customOption =
    candidate !== null ? (
      <div
        className={`sp-row sp-custom${active === customIndex ? " is-active" : ""}`}
        data-row={customIndex}
      >
        <span className="sp-icon is-new" aria-hidden="true">
          <UiIcon name="plus" size={15} />
        </span>
        <button
          type="button"
          className="sp-row-main"
          onMouseEnter={() => setActive(customIndex)}
          onClick={() => addCustom(candidate)}
        >
          <span className="sp-name">Add “{candidate}”</span>
          <span className="sp-sub">A custom system, not in the list</span>
        </button>
        <label className="sp-custom-kind">
          <span className="sr-only">Kind of system</span>
          <select
            value={customLayer}
            onChange={(event) => setCustomLayer(event.target.value)}
          >
            {LAYERS.map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
    ) : null;
  return createPortal(
    // biome-ignore lint/a11y/noStaticElementInteractions: a click on the backdrop closes; Escape and Cancel do too.
    <div
      className="sp-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <form
        autoComplete="off"
        className="sp"
        role="dialog"
        aria-modal="true"
        aria-label="Add in-scope systems"
        method="post"
        action="/workspace/setup"
        onKeyDown={onKey}
      >
        <input type="hidden" name="organization_id" value={organizationId} />
        <input type="hidden" name="project_id" value={projectId} />
        <input type="hidden" name="intent" value="add-known-systems" />
        <input type="hidden" name="step" value="controls" />
        {picked.map((name) => (
          <input key={name} type="hidden" name="systems" value={name} />
        ))}
        {custom.map((item) => (
          <span key={item.name} hidden>
            <input type="hidden" name="custom_name" value={item.name} />
            <input type="hidden" name="custom_layer" value={item.layer} />
          </span>
        ))}

        <div className="sp-search">
          <UiIcon name="search" size={18} />
          <input
            ref={search}
            type="text"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setMode("browse");
            }}
            placeholder="Search systems, or type one to add"
            aria-label="Search systems"
            aria-controls="sp-list"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd>Esc</kbd>
        </div>

        <div className="sp-main">
          <nav className="sp-kinds" aria-label="Kind of system">
            {[
              { key: "ALL", label: "All systems", n: matching.length },
              ...groups.map((group) => ({
                key: group.layer,
                label: LAYER_PLURAL[group.layer] ?? group.label,
                n: matching.filter((system) => system.layer === group.layer)
                  .length,
              })),
            ].map((item) => (
              <button
                key={item.key}
                type="button"
                className={`sp-kind${mode === "browse" && layer === item.key ? " is-on" : ""}`}
                aria-pressed={mode === "browse" && layer === item.key}
                onClick={() => {
                  setLayer(item.key);
                  setMode("browse");
                  search.current?.focus();
                }}
              >
                <UiIcon
                  name={
                    item.key === "ALL"
                      ? "grid"
                      : (LAYER_ICON[item.key] ?? "grid")
                  }
                  size={15}
                />
                <span>{item.label}</span>
                <small>{item.n}</small>
              </button>
            ))}
            <hr />
            <button
              type="button"
              className={`sp-kind sp-kind-custom${mode === "custom" ? " is-on" : ""}`}
              aria-pressed={mode === "custom"}
              onClick={() => {
                setMode("custom");
                window.setTimeout(() => draftInput.current?.focus(), 0);
              }}
            >
              <UiIcon name="plus" size={15} />
              <span>Custom system</span>
            </button>
          </nav>

          {mode === "custom" ? (
            <div className="sp-custom-pane">
              <div>
                <h3>Add a custom system</h3>
                <p>
                  For a system the list does not have, such as an in-house
                  application. It joins every control like any other system.
                </p>
              </div>
              <label className="sp-field">
                <span>Name</span>
                <input
                  ref={draftInput}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="For example, the in-house billing system"
                  maxLength={120}
                  autoComplete="off"
                  spellCheck={false}
                />
                {draftProblem !== null ? (
                  <small className="sp-field-error">{draftProblem}</small>
                ) : null}
              </label>
              <fieldset className="sp-field">
                <legend>Kind</legend>
                <div className="sp-kind-choices">
                  {LAYERS.map(([key, label]) => (
                    <label
                      key={key}
                      className={`sp-kind-choice${customLayer === key ? " is-on" : ""}`}
                    >
                      <input
                        type="radio"
                        name="sp-custom-kind"
                        value={key}
                        checked={customLayer === key}
                        onChange={() => setCustomLayer(key)}
                      />
                      <UiIcon name={LAYER_ICON[key] ?? "window"} size={16} />
                      {label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="sp-custom-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={draftName === null}
                  onClick={addDraft}
                >
                  <UiIcon name="plus" size={14} />
                  Add to selection
                </button>
                <span className="form-hint">
                  Add several, then add them all at once below.
                </span>
              </div>
            </div>
          ) : (
            <div className="sp-list" id="sp-list" ref={list}>
              {customFirst ? customOption : null}
              {sections.map((section) => (
                <section key={section.layer} className="sp-section">
                  <h3>{LAYER_PLURAL[section.layer] ?? section.layer}</h3>
                  {section.systems.map((system) => {
                    const position = index;
                    index += 1;
                    const on = picked.includes(system.name);
                    return (
                      <button
                        key={system.name}
                        type="button"
                        data-row={position}
                        className={`sp-row${on ? " is-on" : ""}${active === position ? " is-active" : ""}`}
                        aria-pressed={on}
                        onMouseEnter={() => setActive(position)}
                        onClick={() => toggle(system.name)}
                      >
                        <span className="sp-icon" aria-hidden="true">
                          <UiIcon
                            name={LAYER_ICON[system.layer] ?? "window"}
                            size={15}
                          />
                        </span>
                        <span className="sp-name">{system.name}</span>
                        <span className="sp-check" aria-hidden="true">
                          <UiIcon name="check" size={12} />
                        </span>
                      </button>
                    );
                  })}
                </section>
              ))}

              {customFirst ? null : customOption}
              {rows.length === 0 ? (
                <p className="sp-empty">
                  Every system of this kind is already in scope.
                </p>
              ) : null}
            </div>
          )}
        </div>

        <footer className="sp-foot">
          <div className="sp-tray" aria-live="polite">
            {count === 0 && mode === "custom" ? (
              <span className="sp-hint">
                <kbd>Enter</kbd> to add it to the selection
              </span>
            ) : count === 0 ? (
              <span className="sp-hint">
                <kbd>↑</kbd>
                <kbd>↓</kbd> to move <span aria-hidden="true">·</span>{" "}
                <kbd>Enter</kbd> to select
              </span>
            ) : (
              [
                ...picked.map((name) => ({ name, custom: false })),
                ...custom.map((item) => ({ name: item.name, custom: true })),
              ].map((item) => (
                <span key={item.name} className="sp-chip">
                  {item.name}
                  <button
                    type="button"
                    aria-label={`Remove ${item.name}`}
                    onClick={() =>
                      item.custom
                        ? setCustom((current) =>
                            current.filter((c) => c.name !== item.name),
                          )
                        : toggle(item.name)
                    }
                  >
                    <UiIcon name="x" size={11} />
                  </button>
                </span>
              ))
            )}
          </div>
          <div className="sp-actions">
            <button type="button" className="btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" disabled={count === 0}>
              {count === 0
                ? "Add systems"
                : `Add ${count} system${count === 1 ? "" : "s"}`}
            </button>
          </div>
        </footer>
      </form>
    </div>,
    document.body,
  );
}
