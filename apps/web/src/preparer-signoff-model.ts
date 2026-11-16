// The preparer's sign-off of the design workpaper, at the end of section 7
// (docs/design-workpaper.md, section 3.7). Pure: what the sign-off needs before the
// press, the words, and the write the route validates. The server is the authority:
// its prepare refuses what this page has not seen, and its sentence is shown.

import type { ConclusionChoice } from "./design-conclusion-model.ts";
import { workpaperWrite } from "./workpaper-model.ts";

export const ATTESTATION =
  "I prepared this workpaper; the evidence, the testing and the conclusion above are complete and supported.";
export const SIGN_AS_PREPARER = "Sign as preparer";
export const REOPEN_TO_CHANGE = "Reopen to change";
export const NOTE_LABEL = "Note for the reviewer (optional)";

export const NEEDS_CONCLUSION = "Record a conclusion first.";
export const NEEDS_CONCLUDED =
  "Not concluded is not signed: record the conclusion the records support.";
export const NEEDS_SAVED = "Save or cancel the section you are editing first.";
export const NEEDS_DRAFT_DONE = "Wait for the agent to finish drafting.";
export const NEEDS_LATEST =
  "An earlier version is on screen: open the latest to sign it.";
export const NEEDS_READ = "Reading the workpaper again…";

/** Said in a status once the server confirmed a press, until the workpaper read again
 * shows it (independent review, 16 November 2026: before, the old state stayed live and
 * a second press was refused as stale). */
export const SIGNED_READING = "Signed. Reading the workpaper again…";
export const REOPENED_READING = "Reopened. Reading the workpaper again…";

/** What the sign-off rests on, as the page has it. */
export type SignOffFacts = {
  status: "DRAFT" | "PREPARED" | "OTHER";
  drafting: boolean;
  /** The version on screen is the latest one. */
  latest: boolean;
  choice: Pick<ConclusionChoice, "kind"> | null;
  /** A section is open in its editor with changes not saved to the workpaper. */
  unsaved: boolean;
  /** The page's records are a version behind the views (a choice or a save was just
   * confirmed): a press now would be refused as stale. */
  behind: boolean;
};

/** Why the preparer cannot sign yet, each in one line, in the order to do them; empty
 * where the press may be made. Never where the workpaper is not a draft. */
export function signOffProblems(facts: SignOffFacts): string[] {
  if (facts.status !== "DRAFT") {
    return [];
  }
  const problems: string[] = [];
  if (facts.drafting) {
    problems.push(NEEDS_DRAFT_DONE);
  }
  if (!facts.latest) {
    problems.push(NEEDS_LATEST);
  }
  if (facts.choice === null) {
    problems.push(NEEDS_CONCLUSION);
  } else if (facts.choice.kind === "NOT_CONCLUDED") {
    problems.push(NEEDS_CONCLUDED);
  }
  if (facts.unsaved) {
    problems.push(NEEDS_SAVED);
  }
  if (facts.behind && problems.length === 0) {
    problems.push(NEEDS_READ);
  }
  return problems;
}

/** "Prepared by Dana Lee on Nov 15, 2026 · version 4"; the parts the records have. */
export function preparedLine(
  by: string | null,
  on: string | null,
  version: number | null,
): string {
  const who = by === null || by.trim() === "" ? "a team member" : by.trim();
  return [
    `Prepared by ${who}${on === null || on === "" ? "" : ` on ${on}`}`,
    version === null || version < 1 ? "" : `version ${version}`,
  ]
    .filter((part) => part !== "")
    .join(" · ");
}

type Ids = { organizationId: string; projectId: string; controlId: string };

/** The JSON the page posts to `/workspace/workpapers/prepare`: the existing prepare or
 * reopen, through the same validation as the form (workpaperWrite). */
export function signOffRequest(
  ids: Ids,
  workpaperId: string,
  version: number,
  intent: "prepare" | "reopen",
  text: string,
): Record<string, string> {
  return {
    organization_id: ids.organizationId,
    project_id: ids.projectId,
    control_id: ids.controlId,
    workpaper_id: workpaperId,
    version: String(version),
    intent,
    ...(intent === "prepare" ? { note: text } : { reason: text }),
  };
}

/** The route's side: only a prepare or a reopen, validated as the form's are. */
export function signOffWrite(fields: Record<string, unknown>) {
  const strings: Record<string, string> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === "string") {
      strings[key] = value;
    }
  }
  if (strings.intent !== "prepare" && strings.intent !== "reopen") {
    return { error: "invalid" as const };
  }
  return workpaperWrite(strings);
}

/** Whether the answer leaves the page's reading of the workpaper in doubt, so it is read
 * again: a refusal as changed (409), or no answer, or a server error, after which the
 * press may have been taken (status 0 or 5xx). */
export function signOffRereads(status: number): boolean {
  return status === 409 || status === 0 || status >= 500;
}

/** Why a press was not taken, in one sentence; "" where the server confirmed. Where the
 * answer did not come back (0, 5xx) it may have been taken: it is said so, never "Not
 * signed", and the workpaper is read again (`signOffRereads`). */
export function signOffRefusal(
  intent: "prepare" | "reopen",
  status: number,
  detail: string,
): string {
  if (status === 200) {
    return "";
  }
  const said = detail.trim().replace(/[.\s]+$/, "");
  const lead = intent === "prepare" ? "Not signed" : "Not reopened";
  if (status === 0 || status >= 500) {
    return intent === "prepare"
      ? "The sign-off may not have been taken: the server's answer did not come back. Reading the workpaper again, to show what it holds."
      : "The workpaper may not have been reopened: the server's answer did not come back. Reading the workpaper again, to show what it holds.";
  }
  if ((status === 409 || status === 403) && said !== "") {
    return `${lead}: ${said}.`;
  }
  if (status === 409) {
    return `${lead}: the workpaper changed meanwhile. It is being read again: try once it is shown.`;
  }
  if (status === 401) {
    return `${lead}: your session has ended. Sign in again, then try again.`;
  }
  if (status === 403 || status === 404) {
    return `${lead}: you may not do this on this workpaper.`;
  }
  if (status === 422) {
    return intent === "reopen"
      ? `${lead}: say why, in at least 3 characters (500 at most).`
      : `${lead}: the note is too long, or reads as a credential.`;
  }
  return `${lead}: the server did not take it. Try again.`;
}
