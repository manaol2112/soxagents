import { refParts } from "./evidence-impact-model";

/** A sentence with each reference it names kept whole (refParts: "ITGC-AC-01" is never
 * broken at its hyphens; E1 design review, round 6). Every E1 sentence that names a
 * control or an item is drawn through it. */
export function RefText({ text }: { text: string }) {
  return (
    <>
      {refParts(text).map((part, index) =>
        typeof part === "string" ? (
          part
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: a sentence's parts are fixed.
          <span key={index} className="ref-token">
            {part.ref}
          </span>
        ),
      )}
    </>
  );
}
