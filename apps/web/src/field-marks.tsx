/**
 * How a setup field says whether the launch needs it. Saving never needs it: a profile
 * can be saved part done, and the launch waits for what is marked.
 */
export function RequiredMark() {
  return (
    <>
      <span className="field-mark" aria-hidden="true">
        *
      </span>
      <span className="sr-only"> (required before launch)</span>
    </>
  );
}

export function OptionalMark() {
  return <span className="field-optional"> (optional)</span>;
}
