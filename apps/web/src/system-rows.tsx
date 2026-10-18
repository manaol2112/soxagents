"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";

export type SystemRow = {
  id: string;
  /** The row's one-line summary, rendered on the server. */
  head: ReactNode;
  /** The system's scoping, rendered on the server and shown when the row opens. */
  detail: ReactNode;
};

export type SystemGroup = { key: string; label: string; rows: SystemRow[] };

/**
 * The in-scope systems as rows that open in place, one at a time, without a page load.
 * A link naming a system opens it. Opening another stays in the page: changing the
 * address would make the page reload its data as a new page and jump to the top.
 */
export function SystemRows({
  groups,
  initial,
}: {
  groups: SystemGroup[];
  initial: string | null;
}) {
  const [open, setOpen] = useState<string | null>(initial);
  const clicked = useRef(false);

  useEffect(() => {
    if (open === null) {
      return;
    }
    const row = document.getElementById(`system-${open}`);
    if (row === null) {
      return;
    }
    // Back from a decision: land on the section it came from, inside the open system.
    const anchor = clicked.current
      ? null
      : document.getElementById(window.location.hash.slice(1));
    if (anchor !== null && anchor !== row && row.contains(anchor)) {
      anchor.scrollIntoView({ block: "start" });
      return;
    }
    // On load, land on the open system. After a click, move only if the row left the view.
    const top = row.getBoundingClientRect().top;
    if (!clicked.current || top < 56 || top > window.innerHeight - 120) {
      row.scrollIntoView({ block: "start" });
    }
  }, [open]);

  function toggle(id: string) {
    const next = open === id ? null : id;
    clicked.current = true;
    setOpen(next);
  }

  return (
    <div className="sys-groups">
      {groups.map((group) => (
        <section key={group.key} className="sys-group" aria-label={group.label}>
          <h4>
            {group.label}
            <span>{group.rows.length}</span>
          </h4>
          <ul className="sys-rows">
            {group.rows.map((row) => {
              const isOpen = row.id === open;
              return (
                <li
                  key={row.id}
                  id={`system-${row.id}`}
                  className={`sys-row${isOpen ? " is-open" : ""}`}
                >
                  <button
                    type="button"
                    className="sys-row-head"
                    aria-expanded={isOpen}
                    aria-controls={`system-${row.id}-scoping`}
                    onClick={() => toggle(row.id)}
                  >
                    {row.head}
                  </button>
                  {isOpen ? (
                    <div className="sys-expand" id={`system-${row.id}-scoping`}>
                      {row.detail}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
