import type { ReactNode } from "react";

/**
 * A form or a notice opened under a table's row, as a full-width row of its own (a
 * restoration's form and its confirmation, a row's detail). Its body is as wide as the
 * table's scroll box and stays in it at any sideways scroll, so nothing of it is cut off
 * where the table is wider than the screen (E1 design review, round 4, 18 November 2026:
 * the Withdrawn list's restore form, sized to the window rather than to the table's
 * scroll box, was cut off on the left at 390 px). The rules are `.row-extra` in
 * globals.css; every table row that opens a form under it uses this row.
 */
export function RowExtra({
  columns,
  className,
  children,
}: {
  /** The table's column count: the row spans them all. */
  columns: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <tr
      className={
        className === undefined ? "row-extra" : `row-extra ${className}`
      }
    >
      <td colSpan={columns} className="row-extra-cell">
        <div className="row-extra-body">{children}</div>
      </td>
    </tr>
  );
}
