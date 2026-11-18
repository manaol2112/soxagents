import { cookies } from "next/headers";

import {
  type Category,
  type LibraryEntry,
  type LibraryIndex,
  type LibraryStatus,
  type LibraryTab,
  parseCategory,
  parseLibraryEntry,
  parseLibraryIndex,
  parseLibraryTab,
  parseStatus,
} from "./library-model";
import { apiGet, sessionToken } from "./load-workspace";
import type { ShellModel } from "./shell-model";

export type LibraryPageState = {
  /** Null when it could not be loaded. */
  index: LibraryIndex | null;
  /** The standard control open, when one is chosen; null when not found or not chosen. */
  entry: LibraryEntry | null;
  controlKey: string | null;
  tab: LibraryTab;
  category: Category | null;
  status: LibraryStatus | null;
  query: string;
};

export type LibraryQuery = {
  control: string | null;
  tab: string | null;
  category: string | null;
  status: string | null;
  q: string | null;
};

const KEY = /^[a-z0-9][a-z0-9-]{1,59}$/;

/** The firm's standard library and, when a standard control is chosen, its entry. Read
 * only on the Library page; it needs no engagement. */
export async function loadLibrary(
  model: ShellModel,
  query: LibraryQuery,
): Promise<LibraryPageState | null> {
  if (model.status !== "ready" || model.section !== "library") {
    return null;
  }
  const session = sessionToken((await cookies()).get("aw_session")?.value);
  const base = `/organizations/${model.organization.id}/library`;
  const controlKey =
    query.control !== null && KEY.test(query.control) ? query.control : null;
  const [index, entry] = await Promise.all([
    apiGet(base, session),
    controlKey === null
      ? Promise.resolve(null)
      : apiGet(`${base}/${controlKey}`, session),
  ]);
  return {
    index: index.status === 200 ? parseLibraryIndex(index.body) : null,
    entry:
      entry !== null && entry.status === 200
        ? parseLibraryEntry(entry.body)
        : null,
    controlKey,
    tab: parseLibraryTab(query.tab),
    category: parseCategory(query.category),
    status: parseStatus(query.status),
    query: query.q ?? "",
  };
}
