/**
 * The engagements a person opened lately and the ones they starred. Both are kept in
 * their browser only (local storage), by the product owner's choice: they do not follow
 * the person to another browser or device, and clearing site data clears them.
 */

export const VISITS_KEY = "aw.engagements.visits";
export const FAVORITES_KEY = "aw.engagements.favorites";
/** How many recent engagements are remembered. */
export const MAX_VISITS = 30;
const MAX_FAVORITES = 200;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Engagement id to when it was last opened, in ms since the epoch. */
export type Visits = Record<string, number>;

/** What was stored, or nothing when it is missing or not ours. */
export function parseVisits(raw: string | null): Visits {
  let value: unknown;
  try {
    value = raw === null ? null : JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  const kept = Object.entries(value).filter(
    (entry): entry is [string, number] =>
      ID.test(entry[0]) &&
      typeof entry[1] === "number" &&
      Number.isFinite(entry[1]) &&
      entry[1] > 0,
  );
  return trim(Object.fromEntries(kept));
}

function trim(visits: Visits): Visits {
  return Object.fromEntries(
    Object.entries(visits)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_VISITS),
  );
}

/** The visits with this engagement opened at `at`; the oldest go past the limit. */
export function recordVisit(visits: Visits, id: string, at: number): Visits {
  if (!ID.test(id) || !Number.isFinite(at)) {
    return visits;
  }
  return trim({ ...visits, [id]: at });
}

export function parseFavorites(raw: string | null): string[] {
  let value: unknown;
  try {
    value = raw === null ? null : JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) {
    return [];
  }
  const ids = value.filter(
    (item): item is string => typeof item === "string" && ID.test(item),
  );
  return [...new Set(ids)].slice(0, MAX_FAVORITES);
}

/** Star an engagement, or unstar it when it is starred. */
export function toggleFavorite(
  favorites: readonly string[],
  id: string,
): string[] {
  if (!ID.test(id)) {
    return [...favorites];
  }
  return favorites.includes(id)
    ? favorites.filter((item) => item !== id)
    : [...favorites, id].slice(-MAX_FAVORITES);
}

/** Recently opened first, newest first; the rest keep the order they came in. */
export function byRecent<T extends { id: string }>(
  projects: readonly T[],
  visits: Visits,
): T[] {
  const seen = projects.filter((project) => visits[project.id] !== undefined);
  const rest = projects.filter((project) => visits[project.id] === undefined);
  seen.sort((a, b) => (visits[b.id] ?? 0) - (visits[a.id] ?? 0));
  return [...seen, ...rest];
}

/** The engagements under Recent: opened in this browser and not archived. */
export function recentOf<T extends { id: string; status: string }>(
  projects: readonly T[],
  visits: Visits,
): T[] {
  return projects.filter(
    (project) =>
      visits[project.id] !== undefined && project.status !== "ARCHIVED",
  );
}

/** The view the Engagements page opens on: Recent once any engagement on it has been
 * opened in this browser, otherwise all of them. A link to one engagement (its status
 * dialog) opens on all of them, where that engagement is. */
export function startingView(
  projectIds: readonly string[],
  visits: Visits,
  selectedId: string | null,
): "recent" | "all" {
  if (selectedId !== null) {
    return "all";
  }
  return projectIds.some((id) => visits[id] !== undefined) ? "recent" : "all";
}

/** "Opened just now", "Opened 2h ago", "Opened 3d ago", or the date. */
export function openedLabel(at: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - at) / 60000));
  if (minutes < 1) {
    return "Opened just now";
  }
  if (minutes < 60) {
    return `Opened ${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `Opened ${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 30) {
    return `Opened ${days}d ago`;
  }
  return `Opened ${new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
}

/** Read from the browser; storage can be off or blocked, which reads as empty. */
export function storedVisits(): Visits {
  try {
    return parseVisits(window.localStorage.getItem(VISITS_KEY));
  } catch {
    return {};
  }
}

export function storedFavorites(): string[] {
  try {
    return parseFavorites(window.localStorage.getItem(FAVORITES_KEY));
  } catch {
    return [];
  }
}

export function keep(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be off; the change then lasts for this page only.
  }
}
