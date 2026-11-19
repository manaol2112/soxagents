/**
 * What a change to an evidence file would do, before a person makes it (E1, product
 * owner, 18 November 2026): the API's impact read model (`GET .../evidence-files/{id}
 * /impact`), shaped for the screens. Whether the change is allowed, and why not, is the
 * server's: a screen offers or holds an action from `allowed` and `refusal`, never from
 * the words of a sentence. Also the labels each place offers a file's actions with, the
 * "Remove from this request" write, the messages a confirmed change is said with, and a
 * file's history as the register serves it.
 */

import { asSentence, cleanReason } from "./evidence-change-model.ts";
import type { WithdrawnFile } from "./evidence-model.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const IMPACT_ACTIONS = [
  "WITHDRAW",
  "REPLACE",
  "REMOVE_FROM_REQUEST",
  "UNLINK",
  "MOVE",
  "REREAD",
  "RESTORE",
] as const;
export type ImpactAction = (typeof IMPACT_ACTIONS)[number];

/** What relies on a file (evidence_reliance.py), in the order a refusal names them. */
export const RELIANCE_KINDS = [
  "READING",
  "SCREENSHOT_SIGNED",
  "APPROVED_SAMPLE",
  "ACCEPTED_ITEM",
  "SIGNED_TESTING",
  "PREPARED_WORKPAPER",
  "TICKMARK",
  "RELIABILITY",
  "WALKTHROUGH_PICK",
  "SIGNED_DI_CONCLUSION",
  "SENT_FINDING",
] as const;
export type RelianceKind = (typeof RELIANCE_KINDS)[number];

export type ImpactBlocking = {
  kind: RelianceKind;
  sentence: string;
  controlId: string | null;
  requirementId: string | null;
  requestId: string | null;
};

export type ImpactItem = {
  id: string;
  title: string;
  phase: string;
  controlId: string;
  controlRef: string;
  requestId: string | null;
  via: "FILING" | "LINK" | "SHARED";
  sufficiency: string;
  /** The item's judgment goes back to not reviewed when the change is made. */
  resets: boolean;
};

export type Impact = {
  fileId: string;
  action: ImpactAction;
  requirementId: string | null;
  allowed: boolean;
  /** The refusal the change would answer with, as the API words it. */
  refusal: string | null;
  blocking: ImpactBlocking[];
  /** REMOVE_FROM_REQUEST only: how the file serves the item, and the version to send. */
  removal: {
    via: "LINK" | "FILING";
    requestId: string | null;
    linkId: string | null;
    version: number;
  } | null;
  controls: Array<{
    id: string;
    controlRef: string;
    title: string;
    application: string | null;
  }>;
  requests: Array<{
    id: string;
    title: string;
    phase: string | null;
    status: string;
    controlId: string;
    controlRef: string;
  }>;
  items: ImpactItem[];
  /** The open test sheets the tester looks at again. */
  retestedSheets: Array<{
    id: string;
    controlId: string;
    controlRef: string;
    application: string | null;
    items: number;
  }>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string =>
  typeof value === "string" ? value : "";
const id = (value: unknown): string | null =>
  typeof value === "string" && UUID.test(value) ? value : null;
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const actionOf = (value: unknown): ImpactAction | null =>
  IMPACT_ACTIONS.find((action) => action === value) ?? null;

/** The API's impact body, or null when it is not one. */
export function parseFileImpact(value: unknown): Impact | null {
  if (!isRecord(value)) {
    return null;
  }
  const fileId = id(value.file_id);
  const action = actionOf(value.action);
  if (
    fileId === null ||
    action === null ||
    typeof value.allowed !== "boolean"
  ) {
    return null;
  }
  const removal = isRecord(value.removal) ? value.removal : null;
  return {
    fileId,
    action,
    requirementId: id(value.requirement_id),
    allowed: value.allowed,
    refusal:
      typeof value.refusal === "string" && value.refusal.trim() !== ""
        ? value.refusal
        : null,
    blocking: list(value.blocking).flatMap((entry) => {
      if (!isRecord(entry) || typeof entry.sentence !== "string") {
        return [];
      }
      const kind = RELIANCE_KINDS.find((each) => each === entry.kind);
      return kind === undefined
        ? []
        : [
            {
              kind,
              sentence: entry.sentence,
              controlId: id(entry.control_id),
              requirementId: id(entry.requirement_id),
              requestId: id(entry.request_id),
            },
          ];
    }),
    removal:
      removal !== null &&
      (removal.via === "LINK" || removal.via === "FILING") &&
      typeof removal.version === "number"
        ? {
            via: removal.via,
            requestId: id(removal.request_id),
            linkId: id(removal.link_id),
            version: removal.version,
          }
        : null,
    controls: list(value.controls).flatMap((entry) =>
      isRecord(entry) && id(entry.id) !== null
        ? [
            {
              id: str(entry.id),
              controlRef: str(entry.control_ref),
              title: str(entry.title),
              application:
                typeof entry.application === "string"
                  ? entry.application
                  : null,
            },
          ]
        : [],
    ),
    requests: list(value.requests).flatMap((entry) =>
      isRecord(entry) && id(entry.id) !== null
        ? [
            {
              id: str(entry.id),
              title: str(entry.title),
              phase: typeof entry.phase === "string" ? entry.phase : null,
              status: str(entry.status),
              controlId: str(entry.control_id),
              controlRef: str(entry.control_ref),
            },
          ]
        : [],
    ),
    items: list(value.items).flatMap((entry): ImpactItem[] => {
      if (!isRecord(entry) || id(entry.id) === null) {
        return [];
      }
      const via =
        entry.via === "FILING" || entry.via === "LINK" || entry.via === "SHARED"
          ? entry.via
          : null;
      return via === null
        ? []
        : [
            {
              id: str(entry.id),
              title: str(entry.title),
              phase: str(entry.phase),
              controlId: str(entry.control_id),
              controlRef: str(entry.control_ref),
              requestId: id(entry.request_id),
              via,
              sufficiency: str(entry.sufficiency),
              resets: entry.resets === true,
            },
          ];
    }),
    retestedSheets: list(value.retested_sheets).flatMap((entry) =>
      isRecord(entry) && id(entry.id) !== null
        ? [
            {
              id: str(entry.id),
              controlId: str(entry.control_id),
              controlRef: str(entry.control_ref),
              application:
                typeof entry.application === "string"
                  ? entry.application
                  : null,
              items: typeof entry.items === "number" ? entry.items : 0,
            },
          ]
        : [],
    ),
  };
}

export type ImpactAsk = {
  fileId: string;
  action: ImpactAction;
  /** The evidence item a removal or an unlink is for. */
  requirementId?: string | null;
};

export const impactKey = (ask: ImpactAsk): string =>
  `${ask.fileId}:${ask.action}:${ask.requirementId ?? ""}`;

/** The web route that reads an impact for the browser. */
export function impactHref(
  ids: { organizationId: string; projectId: string },
  ask: ImpactAsk,
): string {
  const params = new URLSearchParams({
    organization: ids.organizationId,
    project: ids.projectId,
    action: ask.action,
  });
  if (ask.requirementId) {
    params.set("requirement", ask.requirementId);
  }
  return `/workspace/evidence-files/${ask.fileId}/impact?${params.toString()}`;
}

/** The API call the impact route makes, from its query; null when anything is wrong. */
export function impactApiPath(
  fileId: string,
  params: URLSearchParams,
): string | null {
  const organization = params.get("organization") ?? "";
  const project = params.get("project") ?? "";
  const action = actionOf(params.get("action"));
  const requirement = params.get("requirement") ?? "";
  if (
    !UUID.test(fileId) ||
    !UUID.test(organization) ||
    !UUID.test(project) ||
    action === null ||
    (requirement !== "" && !UUID.test(requirement))
  ) {
    return null;
  }
  const query = new URLSearchParams({ action });
  if (requirement !== "") {
    query.set("requirement_id", requirement);
  }
  return `/organizations/${organization}/projects/${project}/evidence-files/${fileId}/impact?${query.toString()}`;
}

/** What an impact the browser holds is: on its way, read, or not read. */
export type ImpactState =
  | { status: "loading" }
  | { status: "ready"; impact: Impact; at: number }
  | { status: "failed" };

/** Why the change cannot be made now, in the server's words, or null when it can (or
 * while that is not known: the confirm form reads the impact again before it sends, and
 * the server decides). A menu says the reliance itself, beside the action it holds: its
 * first blocking sentence, else the refusal. */
export function impactReason(impact: Impact): string | null {
  if (impact.allowed) {
    return null;
  }
  const first = impact.blocking[0]?.sentence ?? impact.refusal ?? "";
  return first === "" ? null : asSentence(first);
}

export function impactUnavailable(
  state: ImpactState | null | undefined,
): string | null {
  return state?.status === "ready" ? impactReason(state.impact) : null;
}

/** The confirm form's first line when the change cannot be made, by its action. */
export const IMPACT_HELD: Record<ImpactAction, string> = {
  WITHDRAW: "It cannot be withdrawn now.",
  REPLACE: "It cannot be replaced now.",
  REMOVE_FROM_REQUEST: "It cannot be removed from this request now.",
  UNLINK: "It cannot be taken off this item now.",
  MOVE: "It cannot be moved now.",
  REREAD: "It cannot be read again now.",
  RESTORE: "It cannot be restored now.",
};

const SUFFICIENCY_WORDS: Record<string, string> = {
  ACCEPTED: "accepted",
  INSUFFICIENT: "insufficient",
  FOLLOW_UP_REQUIRED: "follow-up asked",
  NOT_REVIEWED: "not reviewed",
};

const count = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

const controlName = (control: {
  controlRef: string;
  application: string | null;
}) =>
  control.application
    ? `${control.controlRef} (${control.application})`
    : control.controlRef;

/** What the confirm form says of a change, each line only where it has something to say:
 * where the file is used now (one line, its items on request), whose judgment goes back
 * to not reviewed, which open test sheets are tested again, and, when the change cannot
 * be made, every reliance in its way. */
export type ImpactSummary = {
  used: string | null;
  items: Array<{ key: string; text: string }>;
  resets: string | null;
  retests: string | null;
  blocking: string[];
};

export function impactSummary(impact: Impact): ImpactSummary {
  // An item served two ways (its filing and a link) is one item.
  const items = [
    ...new Map(impact.items.map((item) => [item.id, item])).values(),
  ];
  const requests = impact.requests.length;
  const controls = impact.controls;
  const where =
    controls.length === 0
      ? ""
      : controls.length <= 2
        ? controls.map(controlName).join(" and ")
        : count(controls.length, "control");
  const used =
    where === "" && items.length === 0
      ? null
      : items.length === 0
        ? `Filed to ${where}; no evidence item uses it yet.`
        : `Used on ${where === "" ? "" : `${where}: `}${count(items.length, "evidence item")}${requests > 0 ? ` on ${count(requests, "request")}` : ""}.`;
  const reset = items.filter((item) => item.resets);
  const sheets = impact.retestedSheets;
  return {
    used,
    items: items.map((item) => ({
      key: item.id,
      text: `${item.controlRef} · ${item.title} · ${SUFFICIENCY_WORDS[item.sufficiency] ?? "not reviewed"}`,
    })),
    resets:
      reset.length === 0
        ? null
        : `The decision on ${reset.length === 1 ? "1 evidence item goes" : `${reset.length} evidence items go`} back to not reviewed: ${reset.map((item) => item.title).join(", ")}.`,
    retests:
      sheets.length === 0
        ? null
        : `${sheets.length === 1 ? "1 open test sheet is" : `${sheets.length} open test sheets are`} tested again: ${sheets.map(controlName).join(", ")}.`,
    blocking: impact.allowed
      ? []
      : impact.blocking.length > 0
        ? impact.blocking.map((entry) => asSentence(entry.sentence))
        : impact.refusal !== null
          ? [asSentence(impact.refusal)]
          : [],
  };
}

// The actions a file is offered, by where it is shown

/** Where a file's actions are offered: on a request's or an item's file (REQUEST), in
 * the file's own panel or viewer (PANEL), in the Evidence Library (LIBRARY), and in an
 * upload that has just taken it (UPLOAD). */
export type FilePlace = "REQUEST" | "PANEL" | "LIBRARY" | "UPLOAD";
export type FileAction = "REPLACE" | "REMOVE" | "WITHDRAW";

/** One word, one meaning: "Remove from this request" takes the file off that request
 * only and never withdraws it; "Withdraw from the engagement…" withdraws it everywhere,
 * kept on record, and is offered only where the file is shown on its own. */
export const FILE_ACTION_LABELS: Record<FileAction, string> = {
  REPLACE: "Replace file",
  REMOVE: "Remove from this request",
  WITHDRAW: "Withdraw from the engagement…",
};

/** The impact each action is checked with. */
export const FILE_ACTION_IMPACT: Record<FileAction, ImpactAction> = {
  REPLACE: "REPLACE",
  REMOVE: "REMOVE_FROM_REQUEST",
  WITHDRAW: "WITHDRAW",
};

/** The actions a place offers for a file, in menu order: the item's own first, what
 * cannot be undone in place last. `onRequest`: the place knows the request the file is
 * shown on. */
export function fileActions(
  place: FilePlace,
  facts: { canAct: boolean; onRequest: boolean },
): FileAction[] {
  if (!facts.canAct) {
    return [];
  }
  if (place === "REQUEST") {
    return facts.onRequest ? ["REPLACE", "REMOVE"] : ["REPLACE"];
  }
  if (place === "PANEL") {
    return facts.onRequest ? ["REMOVE", "WITHDRAW"] : ["WITHDRAW"];
  }
  if (place === "LIBRARY") {
    return ["REPLACE", "WITHDRAW"];
  }
  return ["WITHDRAW"];
}

// Taking a file off one request

export type RemoveWrite =
  | { error: "invalid" }
  | {
      path: string;
      body: { requirement_id: string; reason: string; version: number };
    };

/** The API call for "Remove from this request", from the browser's fields. The version
 * is the one the impact named (`removal.version`, the link's or the filing's): the API
 * refuses a page that is out of date rather than take off what the person did not see. */
export function removeWrite(fields: Record<string, unknown>): RemoveWrite {
  const organization = str(fields.organization_id);
  const project = str(fields.project_id);
  const file = str(fields.file_id);
  const requirement = str(fields.requirement_id);
  const reason = cleanReason(str(fields.reason));
  const version = fields.version;
  if (
    !UUID.test(organization) ||
    !UUID.test(project) ||
    !UUID.test(file) ||
    !UUID.test(requirement) ||
    reason === null ||
    typeof version !== "number" ||
    !Number.isInteger(version) ||
    version < 1
  ) {
    return { error: "invalid" };
  }
  return {
    path: `/organizations/${organization}/projects/${project}/evidence-files/${file}/remove-from-request`,
    body: { requirement_id: requirement, reason, version },
  };
}

/** What the person reads when "Remove from this request" did not go through: the
 * server's own sentence for a refusal; null when the server confirmed it. */
export function removeProblem(status: number, detail: string): string | null {
  if (status === 200) {
    return null;
  }
  if (status === 409 && detail.trim() !== "") {
    return asSentence(detail);
  }
  if (status === 403) {
    return "You do not have permission to change this file on this engagement.";
  }
  if (status === 404) {
    return "That file or request is no longer here. Refresh the page.";
  }
  if (status === 422) {
    return "Give a reason of 3 to 500 characters.";
  }
  return "The file could not be removed from this request. Try again in a moment.";
}

/** A withdrawal's reason as the person typed it: none (the API records that none was
 * given), or one plain line of 3 to 500 characters; null when it is neither. */
export function withdrawReason(value: string): string | null {
  return value.trim() === "" ? "" : cleanReason(value);
}

// What a confirmed change is said with, on the row the person acted on

export function withdrawnMessage(name: string, reasonGiven: boolean): string {
  return `${name} was withdrawn${reasonGiven ? " with your reason" : ""}. It is kept on record under Withdrawn and can be restored.`;
}

export function removedMessage(name: string): string {
  return `${name} was removed from this request. It stays on its control and on any other request it serves.`;
}

export function restoredMessage(name: string): string {
  return `${name} was restored. It is back on its control, and the tester looks at it again.`;
}

// A file's history

export type HistoryLine = {
  key: string;
  event:
    | "UPLOADED"
    | "RECEIVED"
    | "REPLACES"
    | "WITHDRAWN"
    | "REPLACED_BY"
    | "RESTORED"
    | "LINKED"
    | "UNLINKED"
    | "REMOVED_FROM_REQUEST";
  label: string;
  /** The evidence item a link or a removal was for. */
  item: string | null;
  by: string;
  at: string;
  /** Why, where the person said; a withdrawal without one says so. */
  why: string | null;
  /** The other version it names, and how ("Replaces", "Replaced by") where the label
   * does not say it. */
  file: { id: string; name: string; withdrawn: boolean } | null;
  relation: "Replaces" | "Replaced by" | null;
  /** The size it came in at, where the history says. */
  sizeBytes: number | null;
};

export const HISTORY_KINDS = [
  "ADDED",
  "WITHDRAWN",
  "RESTORED",
  "LINKED",
  "UNLINKED",
  "REMOVED_FROM_REQUEST",
] as const;
export type HistoryKind = (typeof HISTORY_KINDS)[number];

export type HistoryEvent = {
  kind: HistoryKind;
  at: string;
  by: string | null;
  reason: string;
  source: "UPLOAD" | "MAILBOX" | "PORTAL" | null;
  sizeBytes: number | null;
  replaces: { id: string; name: string } | null;
  replacedBy: { id: string; name: string } | null;
  requirementId: string | null;
  requirementTitle: string | null;
};

export type FileHistoryBody = {
  fileId: string;
  fileName: string;
  events: HistoryEvent[];
};

const fileRef = (value: unknown): { id: string; name: string } | null =>
  isRecord(value) && id(value.id) !== null
    ? { id: str(value.id), name: str(value.name) }
    : null;

/** The API's file history (`GET .../evidence-files/{id}/history`), or null when it is
 * not one. An event of a kind this page does not know is left out. */
export function parseFileHistory(value: unknown): FileHistoryBody | null {
  if (!isRecord(value) || id(value.file_id) === null) {
    return null;
  }
  return {
    fileId: str(value.file_id),
    fileName: str(value.file_name),
    events: list(value.events).flatMap((entry): HistoryEvent[] => {
      if (!isRecord(entry) || typeof entry.at !== "string") {
        return [];
      }
      const kind = HISTORY_KINDS.find((each) => each === entry.kind);
      if (kind === undefined) {
        return [];
      }
      const source =
        entry.source === "UPLOAD" ||
        entry.source === "MAILBOX" ||
        entry.source === "PORTAL"
          ? entry.source
          : null;
      return [
        {
          kind,
          at: entry.at,
          by:
            typeof entry.by === "string" && entry.by.trim() !== ""
              ? entry.by
              : null,
          reason: str(entry.reason),
          source,
          sizeBytes:
            typeof entry.size_bytes === "number" ? entry.size_bytes : null,
          replaces: fileRef(entry.replaces),
          replacedBy: fileRef(entry.replaced_by),
          requirementId: id(entry.requirement_id),
          requirementTitle:
            typeof entry.requirement_title === "string" &&
            entry.requirement_title !== ""
              ? entry.requirement_title
              : null,
        },
      ];
    }),
  };
}

const ADDED_LABELS: Record<NonNullable<HistoryEvent["source"]>, string> = {
  UPLOAD: "Uploaded",
  MAILBOX: "Received by email",
  PORTAL: "Uploaded through the secure link",
};

/**
 * The server's history as the viewer lists it, in the order the server gives it (oldest
 * first): how the file came in, with the version it replaced; each withdrawal, with
 * what replaced it; each restoration; and each link to an item, its removal, or the
 * file's removal from a request. `withdrawn` names the files the page knows are
 * withdrawn, so a link to another version leads where it is kept; the version a file
 * replaced always is.
 */
export function historyLines(
  body: FileHistoryBody,
  withdrawn: ReadonlySet<string> = new Set(),
): HistoryLine[] {
  return body.events.map((event, index): HistoryLine => {
    const base = {
      key: `${event.kind}-${index}`,
      item: null,
      by: event.by ?? "",
      at: event.at,
      why: event.reason.trim() === "" ? null : event.reason,
      file: null,
      relation: null,
      sizeBytes: null,
    };
    if (event.kind === "ADDED") {
      return {
        ...base,
        event: event.source === "MAILBOX" ? "RECEIVED" : "UPLOADED",
        label: ADDED_LABELS[event.source ?? "UPLOAD"],
        sizeBytes: event.sizeBytes,
        ...(event.replaces === null
          ? {}
          : {
              file: { ...event.replaces, withdrawn: true },
              relation: "Replaces" as const,
            }),
      };
    }
    if (event.kind === "WITHDRAWN") {
      return {
        ...base,
        event: "WITHDRAWN",
        label: "Withdrawn",
        ...(event.replacedBy === null
          ? {}
          : {
              file: {
                ...event.replacedBy,
                withdrawn: withdrawn.has(event.replacedBy.id),
              },
              relation: "Replaced by" as const,
            }),
      };
    }
    if (event.kind === "RESTORED") {
      return { ...base, event: "RESTORED", label: "Restored" };
    }
    return {
      ...base,
      event: event.kind,
      item: event.requirementTitle,
      label:
        event.kind === "LINKED"
          ? "Linked to"
          : event.kind === "UNLINKED"
            ? "Taken off"
            : "Removed from the request for",
    };
  });
}

/**
 * The file's history as the register serves it, for when the server's history cannot be
 * read: when it came and who added it, the
 * withdrawn version it replaced, and, while it is withdrawn, who withdrew it, when and
 * why, and what replaced it. Oldest first. A restoration is not served (the register
 * lists only the withdrawals in force), so a restored file shows no line for it.
 */
export function fileHistory(
  file: {
    id: string;
    createdAt: string | null;
    addedBy: string;
    source?: "UPLOAD" | "MAILBOX";
  },
  withdrawn: readonly WithdrawnFile[],
): HistoryLine[] {
  const lines: HistoryLine[] = [];
  if (file.createdAt !== null && file.createdAt !== "") {
    lines.push({
      key: "added",
      event: file.source === "MAILBOX" ? "RECEIVED" : "UPLOADED",
      label: file.source === "MAILBOX" ? "Received by email" : "Uploaded",
      item: null,
      by: file.source === "MAILBOX" ? "" : file.addedBy,
      at: file.createdAt,
      why: null,
      file: null,
      relation: null,
      sizeBytes: null,
    });
  }
  for (const older of withdrawn) {
    if (older.replacedBy === file.id && older.id !== file.id) {
      lines.push({
        key: `replaces-${older.id}`,
        event: "REPLACES",
        label: "Replaces",
        item: null,
        by: older.withdrawnBy,
        at: older.withdrawnAt,
        why: older.reason === "" ? null : older.reason,
        file: { id: older.id, name: older.fileName, withdrawn: true },
        relation: null,
        sizeBytes: null,
      });
    }
  }
  const own = withdrawn.find((entry) => entry.id === file.id);
  if (own !== undefined) {
    lines.push({
      key: "withdrawn",
      event: own.replacedBy === null ? "WITHDRAWN" : "REPLACED_BY",
      label: own.replacedBy === null ? "Withdrawn" : "Replaced by",
      item: null,
      relation: null,
      sizeBytes: null,
      by: own.withdrawnBy,
      at: own.withdrawnAt,
      why: own.reason === "" ? null : own.reason,
      file:
        own.replacedBy === null
          ? null
          : {
              id: own.replacedBy,
              name: own.replacedByName ?? "the newer version",
              withdrawn: false,
            },
    });
  }
  return lines.sort((a, b) =>
    a.event === "UPLOADED" || a.event === "RECEIVED"
      ? -1
      : b.event === "UPLOADED" || b.event === "RECEIVED"
        ? 1
        : Date.parse(a.at) - Date.parse(b.at),
  );
}

/** Where a version a history line names is found: a file in force on the Evidence
 * Library, a withdrawn one under its Withdrawn queue. */
export function historyHref(
  ids: { organizationId: string; projectId: string },
  file: { id: string; name: string; withdrawn: boolean },
): string {
  const params = new URLSearchParams({
    organization: ids.organizationId,
    project: ids.projectId,
    section: "evidence",
    tab: "files",
  });
  if (file.withdrawn) {
    params.set("queue", "withdrawn");
    params.set("q", file.name.slice(0, 120));
  } else {
    params.set("file", file.id);
  }
  return `/?${params.toString()}`;
}

/** The web route that reads a file's history for the browser. */
export function historyReadHref(
  ids: { organizationId: string; projectId: string },
  fileId: string,
): string {
  const params = new URLSearchParams({
    organization: ids.organizationId,
    project: ids.projectId,
  });
  return `/workspace/evidence-files/${fileId}/history?${params.toString()}`;
}

/** The API call the history route makes, from its query; null when anything is wrong. */
export function historyApiPath(
  fileId: string,
  params: URLSearchParams,
): string | null {
  const organization = params.get("organization") ?? "";
  const project = params.get("project") ?? "";
  if (!UUID.test(fileId) || !UUID.test(organization) || !UUID.test(project)) {
    return null;
  }
  return `/organizations/${organization}/projects/${project}/evidence-files/${fileId}/history`;
}
