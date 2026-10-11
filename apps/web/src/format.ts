const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/**
 * Formats a stored date or UTC timestamp as "Feb 28, 2027".
 * Values that are not dates are returned unchanged so nothing is hidden.
 */
export function formatDate(value: string): string {
  const time = DATE_ONLY.test(value)
    ? Date.parse(`${value}T00:00:00Z`)
    : Date.parse(value);
  if (Number.isNaN(time)) {
    return value;
  }
  return DATE_FORMAT.format(time);
}

export function initials(value: string): string {
  const name = value.split("@")[0] ?? "";
  const parts = name.split(/[.\s_-]+/).filter((part) => part !== "");
  const letters = parts
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
  return letters === "" ? "?" : letters;
}

/**
 * Two-letter mark for an engagement or workspace name.
 * Prefers letters in the title so "SOX 2026" becomes "SO".
 */
export function monogram(value: string): string {
  const letters = [...value].filter((char) => /[A-Za-z]/.test(char)).join("");
  if (letters.length >= 2) {
    return letters.slice(0, 2).toUpperCase();
  }
  if (letters.length === 1) {
    return letters.toUpperCase();
  }
  return "?";
}

/**
 * Engagement fieldwork window. Dates stay on their stored calendar day.
 */
export function formatPeriod(
  startsOn: string | null,
  endsOn: string | null,
): string {
  if (startsOn === null && endsOn === null) {
    return "Not scheduled";
  }
  if (startsOn === null) {
    return `Through ${formatDate(endsOn ?? "")}`;
  }
  if (endsOn === null) {
    return `From ${formatDate(startsOn)}`;
  }
  return `${formatDate(startsOn)} – ${formatDate(endsOn)}`;
}

export function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size < 0) {
    return "";
  }
  if (size < 1024) {
    return `${size} B`;
  }
  const units = ["KB", "MB", "GB"];
  let value = size / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "";
  }
  if (seconds < 60) {
    return `${seconds} sec`;
  }
  if (seconds < 3600) {
    return `${Math.round(seconds / 60)} min`;
  }
  const hours = seconds / 3600;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} h`;
}

/** Two letters for an agent avatar. "ITGC tester: access" reads IA, not IT. */
export function agentMonogram(name: string): string {
  const letter = (text: string) =>
    [...text].find((char) => /[A-Za-z]/.test(char))?.toUpperCase() ?? "";
  const wordsOf = (text: string) =>
    text.split(/\s+/).filter((word) => /[A-Za-z]/.test(word));
  const [before = "", after = ""] = name.split(":", 2);
  const tail = wordsOf(after);
  if (tail.length > 0) {
    // Skip acronyms such as "IT" so the specialty shows.
    const lead = tail.find((word) => word !== word.toUpperCase()) ?? tail[0];
    return `${letter(before)}${letter(lead ?? "")}` || "?";
  }
  const words = wordsOf(before);
  if (words.length >= 2) {
    return `${letter(words[0] ?? "")}${letter(words[1] ?? "")}`;
  }
  return monogram(before);
}
