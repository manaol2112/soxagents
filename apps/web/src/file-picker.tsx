"use client";

import { useId, useRef, useState } from "react";
import { formatBytes } from "./format";
import { UiIcon } from "./ui-icon";

/**
 * A file field for a plain form post. One button opens the file chooser; once a file is
 * picked its name shows with the button that sends it, and the choice can be cleared.
 * The browser's own file control stays hidden but still submits with the form.
 */
export function FilePicker({
  name,
  accept,
  label,
  chooseLabel,
  submitLabel,
  primary = false,
}: {
  name: string;
  accept?: string;
  /** What the file is, for screen readers: "Client RCM file". */
  label: string;
  chooseLabel: string;
  submitLabel: string;
  /** Show the choose button as the page's main action. */
  primary?: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<File | null>(null);

  function clear() {
    if (input.current !== null) {
      input.current.value = "";
    }
    setPicked(null);
  }

  return (
    <span className="file-picker">
      <input
        ref={input}
        id={id}
        className="sr-only"
        type="file"
        name={name}
        accept={accept}
        required
        aria-label={label}
        tabIndex={-1}
        onChange={(event) => setPicked(event.target.files?.[0] ?? null)}
      />
      {picked === null ? (
        <button
          type="button"
          className={primary ? "btn-sm" : "btn-secondary btn-sm"}
          onClick={() => input.current?.click()}
        >
          <UiIcon name="upload" size={13} /> {chooseLabel}
        </button>
      ) : (
        <>
          <span className="file-picker-name" title={picked.name}>
            <UiIcon name="file" size={13} />
            <span>{picked.name}</span>
            <small>{formatBytes(picked.size)}</small>
            <button
              type="button"
              className="file-picker-clear"
              aria-label={`Remove ${picked.name}`}
              onClick={clear}
            >
              <UiIcon name="x" size={12} />
            </button>
          </span>
          <button type="submit" className="btn-sm">
            {submitLabel}
          </button>
        </>
      )}
    </span>
  );
}
