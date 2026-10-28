"use client";

import {
  type KeyboardEvent,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import { type IconName, UiIcon } from "./ui-icon";

export type KnownSystemOption = {
  name: string;
  layer: string;
  /** What it is, such as ERP or HR; "" when the catalog does not say. */
  category: string;
};

type Look = { icon: IconName; tone: string };

const LAYER_WORDS: Record<string, string> = {
  APPLICATION: "Application",
  DATABASE: "Database",
  OPERATING_SYSTEM: "Operating system",
  INFRASTRUCTURE: "Infrastructure",
  TOOL: "Tool",
};

/** The tile a catalog system shows: an icon and a colour for what it is. */
function lookOf(item: KnownSystemOption): Look {
  const what = item.category.toLowerCase();
  if (/\b(hr|payroll)\b/.test(what)) {
    return { icon: "agents", tone: "is-purple" };
  }
  if (what.includes("crm")) {
    return { icon: "layers", tone: "is-green" };
  }
  if (what.includes("erp") || what.includes("accounting")) {
    return { icon: "server", tone: "is-blue" };
  }
  if (what.includes("database") || what.includes("data warehouse")) {
    return { icon: "database", tone: "is-orange" };
  }
  if (what.includes("identity") || what.includes("privileged")) {
    return { icon: "shield", tone: "is-green" };
  }
  if (what.includes("cloud")) {
    return { icon: "cloud", tone: "is-blue" };
  }
  if (item.layer === "OPERATING_SYSTEM") {
    return { icon: "window", tone: "is-blue" };
  }
  if (item.layer === "TOOL") {
    return { icon: "wrench", tone: "is-purple" };
  }
  return { icon: "window", tone: "is-blue" };
}

/**
 * The system's name in the Add system wizard (decided by the product owner): a picker that
 * opens a searchable list of the common systems, each with what it is, and lets a name the
 * catalog lacks be added as it was typed. Choosing a catalog system sets its type too.
 * Keyboard: the arrows move, Enter chooses, Escape closes.
 */
export function SystemNameField({
  labelId,
  value,
  known,
  triggerRef,
  onChoose,
}: {
  labelId: string;
  value: string;
  known: readonly KnownSystemOption[];
  triggerRef?: RefObject<HTMLButtonElement | null>;
  /** The name chosen, and the catalog entry when it came from the catalog. */
  onChoose: (name: string, item: KnownSystemOption | null) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const words = query.trim().toLowerCase();
  const shown = known.filter(
    (item) =>
      words === "" ||
      item.name.toLowerCase().includes(words) ||
      item.category.toLowerCase().includes(words),
  );
  const exact = known.some((item) => item.name.toLowerCase() === words);
  const custom = words !== "" && !exact ? query.trim() : null;
  const count = shown.length + (custom === null ? 0 : 1);

  useEffect(() => {
    if (!open) {
      return;
    }
    search.current?.focus();
    const outside = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [open]);

  // The option in view follows the arrows.
  useEffect(() => {
    if (!open) {
      return;
    }
    list.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function choose(name: string, item: KnownSystemOption | null) {
    onChoose(name, item);
    setOpen(false);
    setQuery("");
    triggerRef?.current?.focus();
  }

  function pick(index: number) {
    const item = shown[index];
    if (item !== undefined) {
      choose(item.name, item);
    } else if (custom !== null) {
      choose(custom, null);
    }
  }

  function onKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current) => Math.min(current + 1, count - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      pick(active);
    } else if (event.key === "Escape") {
      // Closes the list only, not the wizard around it.
      event.preventDefault();
      event.stopPropagation();
      event.nativeEvent.stopImmediatePropagation();
      setOpen(false);
      triggerRef?.current?.focus();
    }
  }

  const chosen = known.find(
    (item) => item.name.toLowerCase() === value.trim().toLowerCase(),
  );

  return (
    <div className={`snf${open ? " is-open" : ""}`} ref={root}>
      <button
        ref={triggerRef}
        type="button"
        className="snf-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${labelId} ${id}-value`}
        onClick={() => {
          setActive(0);
          setOpen((current) => !current);
        }}
      >
        {value.trim() === "" ? (
          <span id={`${id}-value`} className="snf-placeholder">
            Select a system
          </span>
        ) : (
          <span id={`${id}-value`} className="snf-value">
            {chosen !== undefined ? (
              <span
                className={`snf-icon is-small ${lookOf(chosen).tone}`}
                aria-hidden="true"
              >
                <UiIcon name={lookOf(chosen).icon} size={12} />
              </span>
            ) : null}
            {value}
          </span>
        )}
        <UiIcon name="chevron" size={14} />
      </button>
      {open ? (
        <div className="snf-panel">
          <p className="snf-title">
            Select a system
            <span>{known.length} in the catalog</span>
          </p>
          <label className="snf-search">
            <UiIcon name="search" size={15} />
            <input
              ref={search}
              role="combobox"
              aria-expanded="true"
              aria-controls={`${id}-list`}
              aria-activedescendant={
                count > 0 ? `${id}-option-${active}` : undefined
              }
              aria-label="Search applications and infrastructure"
              value={query}
              placeholder="Search applications and infrastructure…"
              autoComplete="off"
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={onKey}
            />
          </label>
          <div
            ref={list}
            id={`${id}-list`}
            className="snf-list"
            role="listbox"
            aria-label="Systems"
          >
            {shown.map((item, index) => {
              const look = lookOf(item);
              const selected = item === chosen;
              return (
                <div
                  key={item.name}
                  id={`${id}-option-${index}`}
                  data-index={index}
                  role="option"
                  tabIndex={-1}
                  aria-selected={selected}
                  className={index === active ? "is-active" : undefined}
                  onMouseEnter={() => setActive(index)}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    choose(item.name, item);
                  }}
                >
                  <span className={`snf-icon ${look.tone}`} aria-hidden="true">
                    <UiIcon name={look.icon} size={17} />
                  </span>
                  <span className="snf-text">
                    <strong>{item.name}</strong>
                    <small>
                      {item.category || LAYER_WORDS[item.layer] || item.layer}
                    </small>
                  </span>
                  <span className="snf-go" aria-hidden="true">
                    <UiIcon name={selected ? "check" : "chevron"} size={15} />
                  </span>
                </div>
              );
            })}
            {custom !== null ? (
              <div
                id={`${id}-option-${shown.length}`}
                data-index={shown.length}
                role="option"
                tabIndex={-1}
                aria-selected={false}
                className={`snf-custom${active === shown.length ? " is-active" : ""}`}
                onMouseEnter={() => setActive(shown.length)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(custom, null);
                }}
              >
                <span className="snf-icon is-plain" aria-hidden="true">
                  <UiIcon name="plus" size={17} />
                </span>
                <span className="snf-text">
                  <strong>Add “{custom}”</strong>
                  <small>Not in the catalog: choose its type next</small>
                </span>
              </div>
            ) : null}
          </div>
          {count === 0 ? (
            <p className="snf-none">Type the system&apos;s name to add it.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
