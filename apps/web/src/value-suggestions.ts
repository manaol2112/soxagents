/**
 * A client value answered by choosing among the answers usually given (slot_options.py)
 * and, where none fits, writing the client's own. The value is stored as one phrase the
 * statement reads naturally ("Line manager and Application owner"); the choices are read
 * back from it when the value is shown again.
 */

/** Answers joined as a phrase: "A", "A and B", "A, B and C". */
export function joinAnswers(parts: readonly string[]): string {
  const kept = parts.filter((part) => part.trim() !== "");
  if (kept.length <= 1) {
    return kept[0] ?? "";
  }
  return `${kept.slice(0, -1).join(", ")} and ${kept[kept.length - 1]}`;
}

/** The value as it was answered: the suggested answers it holds, in their order, and the
 * rest, as the client's own words. */
export function readAnswer(
  value: string,
  options: readonly string[],
): { chosen: string[]; other: string } {
  const marker = "\u0000";
  let rest = value;
  const found = new Set<string>();
  // Longest first, so "IT service desk administrator" is not read as "IT service desk".
  for (const option of [...options].sort((a, b) => b.length - a.length)) {
    const at = rest.toLowerCase().indexOf(option.toLowerCase());
    if (option.trim() !== "" && at >= 0) {
      found.add(option);
      rest = `${rest.slice(0, at)}${marker}${rest.slice(at + option.length)}`;
    }
  }
  const other = rest
    .split(marker)
    .map((part) =>
      part
        .trim()
        .replace(/^(?:,|and\b)\s*/i, "")
        .replace(/\s*(?:,|\band)$/i, "")
        .trim(),
    )
    .filter((part) => part !== "")
    .join(", ");
  return { chosen: options.filter((option) => found.has(option)), other };
}

/**
 * The value with a suggestion picked or unpicked: added to the answers given, or taken out
 * of them, in the suggestions' order; the client's own words stay, last.
 */
export function toggleSuggestion(
  value: string,
  option: string,
  options: readonly string[],
): string {
  const { chosen, other } = readAnswer(value, options);
  const next = chosen.includes(option)
    ? chosen.filter((item) => item !== option)
    : options.filter((item) => item === option || chosen.includes(item));
  return joinAnswers([...next, other]);
}
