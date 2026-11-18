"use client";

/** Closes the result panel it sits in. On a phone the panel is a sheet at the foot of the
 * screen that can cover the result it opened from, so it needs its own way to close; on a
 * wider screen the result itself closes it and this button is not shown. */
export function PanelClose() {
  return (
    <button
      type="button"
      className="cell-close"
      onClick={(event) => {
        const fold = event.currentTarget.closest("details");
        if (fold !== null) {
          fold.open = false;
        }
      }}
    >
      Close
    </button>
  );
}
