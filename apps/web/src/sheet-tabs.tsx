"use client";

import { type KeyboardEvent, type ReactNode, useState } from "react";

import { UiIcon } from "./ui-icon";

export type SheetTabInfo = {
  key: string;
  title: string;
  /** A short note under the title: a reference, or the tab's status. */
  note?: string | undefined;
  tone?: string | undefined;
};

export type SheetTab = SheetTabInfo & { content: ReactNode };

/**
 * A workbook's sheet tabs, as in a spreadsheet: numbered, the open one fused to the
 * sheet above, the others set back. Left and right arrow keys move between them.
 */
export function SheetTabBar({
  tabs,
  active,
  onSelect,
  label,
  trailing,
}: {
  tabs: readonly SheetTabInfo[];
  active: string;
  onSelect: (key: string) => void;
  label: string;
  trailing?: ReactNode;
}) {
  const index = Math.max(
    0,
    tabs.findIndex((tab) => tab.key === active),
  );
  const go = (to: number) => {
    const target = tabs[to];
    if (target !== undefined) {
      onSelect(target.key);
    }
  };
  const onKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      go(index - 1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      go(index + 1);
    }
  };
  return (
    <nav className="sheet-tabs" aria-label={label} onKeyDown={onKey}>
      <div className="sheet-tabs-strip" role="tablist">
        {tabs.map((tab, position) => {
          const selected = position === index;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              className={`sheet-tab ${selected ? "is-active" : ""} ${tab.tone ?? ""}`}
              onClick={() => onSelect(tab.key)}
            >
              <span className="sheet-tab-number" aria-hidden="true">
                {position + 1}
              </span>
              <span className="sheet-tab-text">
                <span className="sheet-tab-title">{tab.title}</span>
                {tab.note !== undefined && tab.note !== "" ? (
                  <small>{tab.note}</small>
                ) : null}
              </span>
            </button>
          );
        })}
        {trailing}
      </div>
      <div className="sheet-tabs-nav">
        <span className="sheet-tabs-count">
          {index + 1} of {tabs.length}
        </span>
        <button
          type="button"
          className="btn-ghost btn-sm sheet-tabs-prev"
          aria-label="Previous tab"
          disabled={index === 0}
          onClick={() => go(index - 1)}
        >
          <UiIcon name="chevron" size={14} />
        </button>
        <button
          type="button"
          className="btn-ghost btn-sm"
          aria-label="Next tab"
          disabled={index >= tabs.length - 1}
          onClick={() => go(index + 1)}
        >
          <UiIcon name="chevron" size={14} />
        </button>
      </div>
    </nav>
  );
}

/**
 * A workbook on the page: one panel open, the sheet tabs along the bottom. Switching
 * tabs is on the page itself; nothing reloads.
 */
export function SheetTabs({
  tabs,
  initial,
  label,
}: {
  tabs: readonly SheetTab[];
  initial?: string | undefined;
  label: string;
}) {
  const [active, setActive] = useState(
    tabs.some((tab) => tab.key === initial)
      ? (initial ?? "")
      : (tabs[0]?.key ?? ""),
  );
  const shown = tabs.find((tab) => tab.key === active) ?? tabs[0];
  return (
    <div className="workbook workbook-page">
      <div className="workbook-sheet">{shown?.content}</div>
      <SheetTabBar
        tabs={tabs}
        active={shown?.key ?? ""}
        onSelect={setActive}
        label={label}
      />
    </div>
  );
}
