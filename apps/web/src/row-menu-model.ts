/**
 * What a row's menu says beside the actions it holds (E1 design review, 18 November
 * 2026): the same reason for several held actions is said once, after the last of them,
 * naming them ("Replace and remove are held: the evidence item ... was accepted with it;
 * change that decision first."; round 5: "Held: …" did not say which), never under each;
 * a reason only one action has is said under it.
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

/** What a held line calls an item: its short action name where it has one ("move",
 * "keep out of D&I"), else its label's first word ("Replace file" → "replace"). One
 * helper (E1 design review, round 6: "Not D&I evidence: keep in the control's files"
 * was called "Not"). */
export function actionName(item: { label?: string; action?: string }): string {
  if (item.action !== undefined && item.action.trim() !== "") {
    return item.action.trim();
  }
  return (
    (item.label ?? "")
      .trim()
      .split(/\s+/)[0]
      ?.replace(/[…:.]+$/, "")
      .toLowerCase() ?? ""
  );
}

/** The actions a line names, as a person says them, each once: "Replace and remove",
 * "Move, keep out of D&I and withdraw". */
export function heldNames(
  items: ReadonlyArray<{ label?: string; action?: string }>,
): string {
  const words = [...new Set(items.map(actionName))].filter((w) => w !== "");
  const listed =
    words.length <= 1
      ? (words[0] ?? "")
      : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
  return `${listed.charAt(0).toUpperCase()}${listed.slice(1)}`;
}

/** For each item, the reason to say under it (or, for a reason several share, after the
 * last of them, naming them), or null. */
export function heldReasons(
  items: ReadonlyArray<{
    label?: string;
    action?: string;
    unavailable?: string | null | undefined;
  }>,
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
    const sharing = items.filter((item) => item.unavailable === reason);
    if (sharing.length < 2) {
      return reason;
    }
    const named = heldNames(sharing);
    return named !== ""
      ? `${named} ${named.includes(" and ") ? "are" : "is"} held: ${afterColon(reason)}`
      : `Held: ${afterColon(reason)}`;
  });
}

/** For each item, whether the reason said after it is one several items share (said on a
 * line of its own, under a divider, not inside the item). */
export function sharedReason(
  items: ReadonlyArray<{ unavailable?: string | null | undefined }>,
): boolean[] {
  const reasons = items.map((item) =>
    item.unavailable ? item.unavailable : null,
  );
  return reasons.map(
    (reason, index) =>
      reason !== null &&
      reasons.lastIndexOf(reason) === index &&
      reasons.filter((each) => each === reason).length > 1,
  );
}

/** One icon rule for a menu: its items carry their icons only when every item has one,
 * so no item's label sits out of line with the others (E1 design review, round 5). */
export function menuIcons(
  items: ReadonlyArray<{ icon?: string | undefined }>,
): boolean {
  return items.length > 0 && items.every((item) => item.icon !== undefined);
}

/** For each held item, the index of the item its reason is said under (heldReasons: the
 * last item with that reason), so every item it holds is described by that one line
 * (aria-describedby); null for an item that is not held. */
export function reasonHolder(
  items: ReadonlyArray<{ unavailable?: string | null | undefined }>,
): Array<number | null> {
  const reasons = items.map((item) =>
    item.unavailable ? item.unavailable : null,
  );
  return reasons.map((reason) =>
    reason === null ? null : reasons.lastIndexOf(reason),
  );
}

/** A control held with a reason: reachable by keyboard (aria-disabled, never disabled),
 * its reason its description, and a press that does nothing (the caller's handler checks
 * `held`). Nothing for a control that is not held. */
export function heldControl(
  held: boolean,
  describedBy: string | undefined,
): { "aria-disabled"?: true; "aria-describedby"?: string } {
  if (!held) {
    return {};
  }
  return describedBy === undefined
    ? { "aria-disabled": true }
    : { "aria-disabled": true, "aria-describedby": describedBy };
}
