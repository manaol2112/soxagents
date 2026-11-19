/**
 * What a row's menu says beside the actions it holds (E1 design review, 18 November
 * 2026): the same reason for several held actions is said once, after the last of them
 * ("Held: the evidence item ... was accepted with it; change that decision first."),
 * never under each; a reason only one action has is said under it.
 */

/** The sentence with its first letter lower case, after a colon, unless the word is an
 * acronym or a reference ("ITGC-AC-01", "SAP"). */
function afterColon(sentence: string): string {
  const [first, second] = sentence;
  if (first === undefined || second === undefined) {
    return sentence;
  }
  return second === second.toLowerCase() && second !== second.toUpperCase()
    ? `${first.toLowerCase()}${sentence.slice(1)}`
    : sentence;
}

/** For each item, the reason to say under it, or null. */
export function heldReasons(
  items: ReadonlyArray<{ unavailable?: string | null | undefined }>,
): Array<string | null> {
  const reasons = items.map((item) =>
    item.unavailable ? item.unavailable : null,
  );
  return reasons.map((reason, index) => {
    if (reason === null) {
      return null;
    }
    const later = reasons.slice(index + 1).includes(reason);
    if (later) {
      return null;
    }
    const count = reasons.filter((each) => each === reason).length;
    return count > 1 ? `Held: ${afterColon(reason)}` : reason;
  });
}
