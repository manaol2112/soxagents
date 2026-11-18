/** The last workspace page a person opened, kept on their account (migration 0124;
 * decided by the product owner on 28 October 2026), so the workspace opens where they left
 * off on any computer. What is kept, and when the workspace goes back to it. */

/** Address parts that say what just happened or open a form over the page: a notice, a
 * create or edit form, a new record's log. Returning to the page leaves them out. */
const PASSING = new Set(["notice", "create", "edit", "manage", "new"]);

/** The page as it is kept: the workspace address without its passing parts, in the order
 * given; null without a firm, which is nothing to return to. */
export function rememberedPath(
  params: Record<string, string | string[] | undefined>,
): string | null {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (PASSING.has(key)) {
      continue;
    }
    for (const item of Array.isArray(value) ? value : [value]) {
      if (typeof item === "string" && item !== "") {
        query.append(key, item);
      }
    }
  }
  if (query.getAll("organization").length !== 1) {
    return null;
  }
  const path = `/?${query.toString()}`;
  return path.length <= 2000 ? path : null;
}

/** Whether the workspace goes back to the last page: only when it is opened with no
 * address at all (signing in, the bookmark, the logo), never over one the person chose. */
export function opensOnLastPage(
  params: Record<string, string | string[] | undefined>,
): boolean {
  return Object.values(params).every(
    (value) =>
      value === undefined ||
      value === "" ||
      (Array.isArray(value) && value.length === 0),
  );
}

/** The last page the API returned, when it is a workspace address. */
export function lastPageTarget(body: unknown): string | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const path = (body as { path?: unknown }).path;
  return typeof path === "string" &&
    path.startsWith("/?") &&
    !path.startsWith("//") &&
    path.length <= 2000
    ? path
    : null;
}
