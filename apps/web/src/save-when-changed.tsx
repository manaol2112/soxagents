"use client";

import { useEffect, useRef, useState } from "react";
import { formSignature } from "./form-change";

/**
 * A form's Save button that is offered only once something in the form has changed, so
 * a step already saved does not read as one still to do. Without scripts it is a plain
 * submit button, always available.
 */
export function SaveWhenChanged({ label }: { label: string }) {
  const button = useRef<HTMLButtonElement>(null);
  // Null until the page is live: the button stays a plain one until then.
  const [changed, setChanged] = useState<boolean | null>(null);
  useEffect(() => {
    const form = button.current?.form;
    if (form == null) {
      return;
    }
    const read = () => formSignature(new FormData(form).entries());
    const shown = read();
    const check = () => setChanged(read() !== shown);
    setChanged(false);
    form.addEventListener("input", check);
    form.addEventListener("change", check);
    return () => {
      form.removeEventListener("input", check);
      form.removeEventListener("change", check);
    };
  }, []);
  return (
    <>
      <button
        ref={button}
        type="submit"
        className={changed === false ? "btn-secondary" : undefined}
        disabled={changed === false}
      >
        {label}
      </button>
      {changed === false ? (
        <span className="form-hint" role="status">
          No unsaved changes.
        </span>
      ) : null}
    </>
  );
}
