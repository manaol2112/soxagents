/** Approve and send a control's evidence requests from its Request step, to its owner
 * (decided by the product owner on 28 October 2026): what the API answers, what the page
 * asks for, and what it says. The API (control_send.py) does the work through the
 * Evidence center's own approval and send. */

const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

export type SendTarget = {
  id: string;
  reference: string;
  title: string;
  recipient: string;
  /** Other controls whose requests travel in the same email. */
  otherControls: string[];
  ok: boolean;
  detail: string;
  /** Prepared ahead and held until its phase is released: expected, not a failure. */
  waiting: boolean;
  /** Its testing phase (DESIGN, INTERIM, ROLLFORWARD), and the window it covers. */
  phase: string;
  period: string;
};

/** A request not sent, and why; held means it only waits for its phase. */
export type NotSent = { title: string; reason: string; held: boolean };

/** Someone the owner can be chosen from: the engagement's people at the client. */
export type OwnerChoice = { name: string; email: string; role: string };

export type SendResult = {
  preview: boolean;
  controlRef: string;
  controlTitle: string;
  contacts: OwnerChoice[];
  domains: string[];
  needsOwner: boolean;
  ownerName: string;
  ownerEmail: string;
  drafts: number;
  targets: SendTarget[];
  done: number;
  refused: number;
};

const str = (value: unknown) => (typeof value === "string" ? value : "");
const num = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

export function parseSendResult(value: unknown): SendResult | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.targets) || typeof v.needs_owner !== "boolean") {
    return null;
  }
  return {
    preview: v.preview === true,
    controlRef: str(v.control_ref),
    controlTitle: str(v.control_title),
    contacts: (Array.isArray(v.contacts) ? v.contacts : [])
      .filter(
        (c): c is Record<string, unknown> =>
          typeof c === "object" && c !== null,
      )
      .map((c) => ({
        name: str(c.name),
        email: str(c.email),
        role: str(c.role),
      }))
      .filter((c) => EMAIL.test(c.email)),
    domains: (Array.isArray(v.domains) ? v.domains : []).filter(
      (d): d is string => typeof d === "string",
    ),
    needsOwner: v.needs_owner,
    ownerName: str(v.owner_name),
    ownerEmail: str(v.owner_email),
    drafts: num(v.drafts),
    targets: v.targets
      .filter(
        (t): t is Record<string, unknown> =>
          typeof t === "object" && t !== null,
      )
      .map((t) => ({
        id: str(t.id),
        reference: str(t.reference),
        title: str(t.title),
        recipient: str(t.recipient),
        otherControls: Array.isArray(t.other_controls)
          ? t.other_controls.filter((c): c is string => typeof c === "string")
          : [],
        ok: t.ok === true,
        detail: str(t.detail),
        waiting: t.waiting === true,
        phase: str(t.phase),
        period: "",
      })),
    done: num(v.done),
    refused: num(v.refused),
  };
}

/** The owner as typed: a name and a valid email, or why not. */
export function checkOwner(
  name: string,
  email: string,
): { name: string; email: string } | { problem: string } {
  const cleanName = name.trim().replace(/\s+/g, " ");
  const cleanEmail = email.trim().toLowerCase();
  if (cleanName === "") {
    return { problem: "Name the control owner." };
  }
  if (!EMAIL.test(cleanEmail)) {
    return { problem: "Give the owner's email address." };
  }
  return { name: cleanName, email: cleanEmail };
}

/** A change made in the review: who one request goes to, and who is copied. */
export type Routing = { id: string; recipient: string; cc: string[] };

/** The body the page sends: a check first, then the send, with the owner when named and
 * the review's changes to who each request goes to. */
export function sendBody(
  preview: boolean,
  owner: { name: string; email: string } | null,
  routing: readonly Routing[] = [],
): Record<string, unknown> {
  return {
    preview,
    ...(owner === null
      ? {}
      : { owner_name: owner.name, owner_email: owner.email }),
    ...(routing.length === 0 ? {} : { routing }),
  };
}

/** An address as typed: trimmed and lower-cased when it is one, else null. */
export function addressOf(value: string): string | null {
  const email = value.trim().toLowerCase();
  return EMAIL.test(email) ? email : null;
}

/** The review's changes, as sent: only the requests whose recipient or copies changed. */
export function routingOf(
  plan: ReadonlyArray<{ id: string; recipient: string }>,
  edits: Readonly<Record<string, { recipient: string; cc: string[] }>>,
): Routing[] {
  return plan.flatMap((item) => {
    const edit = edits[item.id];
    if (edit === undefined) {
      return [];
    }
    const cc = [...new Set(edit.cc.filter((a) => a !== edit.recipient))];
    return edit.recipient === item.recipient && cc.length === 0
      ? []
      : [{ id: item.id, recipient: edit.recipient, cc }];
  });
}

/** How the list shows a request: its title, and the window its phase covers. */
export type ListedRequest = { title: string; period: string };

/** The requests named as the list names them (by request id), with their period; else as
 * the API names them; never a reference the reader would have to look up. */
export function withTitles(
  result: SendResult,
  titles: Readonly<Record<string, ListedRequest>>,
): SendResult {
  return {
    ...result,
    targets: result.targets.map((target) => {
      const listed = titles[target.id];
      return listed === undefined
        ? target
        : {
            ...target,
            title: listed.title || target.title,
            period: listed.period,
          };
    }),
  };
}

/** A title without the window it ends with, when the period is shown on its own line
 * ("All access grants and changes, 1 Jan to 30 Sep 2027" reads as its first part). */
export function shortTitle(title: string): string {
  const cut = title.match(
    /^(.*?),\s*\d{1,2} [A-Za-z]{3,9}(?: \d{4})? (?:to|–|-) \d{1,2} [A-Za-z]{3,9} \d{4}$/,
  );
  return cut?.[1]?.trim() || title;
}

/** The review before anything is sent (the product owner's reference, 28 October 2026):
 * what goes now, what is scheduled for later and why, and what a check holds back. */
export function reviewPlan(result: SendResult): {
  sending: Array<{
    id: string;
    title: string;
    recipient: string;
    others: string[];
  }>;
  later: Array<{ id: string; title: string; period: string; note: string }>;
  attention: Array<{ id: string; title: string; reason: string }>;
  laterLead: string;
  emails: number;
} {
  const later = result.targets.filter((t) => !t.ok && t.waiting);
  const phases = new Set(later.map((t) => t.phase));
  return {
    sending: result.targets
      .filter((t) => t.ok)
      .map((t) => ({
        id: t.id,
        title: shortTitle(t.title),
        recipient: t.recipient,
        others: t.otherControls,
      })),
    later: later.map((t) => ({
      id: t.id,
      title: shortTitle(t.title),
      period: t.period,
      note: t.detail,
    })),
    attention: result.targets
      .filter((t) => !t.ok && !t.waiting)
      .map((t) => ({ id: t.id, title: shortTitle(t.title), reason: t.detail })),
    laterLead:
      phases.size === 1 && phases.has("INTERIM")
        ? "These requests will be sent after design and implementation testing is released."
        : phases.size === 1 && phases.has("ROLLFORWARD")
          ? "These requests will be sent after interim testing is released."
          : "These requests will be sent once their phase is released.",
    // One email for each request that goes (a request for several controls is one).
    emails: result.targets.filter((t) => t.ok).length,
  };
}

/** "1 request", "2 requests". */
export function requests(count: number): string {
  return `${count} request${count === 1 ? "" : "s"}`;
}

/** One line for a request that goes: what it is, to whom, and what travels with it. */
function line(target: SendTarget): string {
  const with_ =
    target.otherControls.length > 0
      ? `, with ${target.otherControls.join(", ")} in the same email`
      : "";
  return `${target.title} to ${target.recipient}${with_}`;
}

function notSent(result: SendResult): NotSent[] {
  return result.targets
    .filter((t) => !t.ok)
    .map((t) => ({ title: t.title, reason: t.detail, held: t.waiting }));
}

/** What the confirmation says before anything goes: what will be sent, and what is not
 * sent with why, each on its own line; a request held for its phase only waits. */
export function confirmLines(result: SendResult): {
  ready: string[];
  waiting: NotSent[];
} {
  return {
    ready: result.targets.filter((t) => t.ok).map(line),
    waiting: notSent(result),
  };
}

/** What the page says after sending (the product owner, 28 October 2026: no "Some"
 * requests): how many went and to whom, plainly; a request scheduled for its phase is still
 * scheduled, as the review said, not a request that failed; only one a check refused is
 * not sent, with why. */
export type SentReport = {
  tone: "success" | "attention" | "waiting";
  title: string;
  lead: string;
  scheduled: Array<{ title: string; period: string }>;
  scheduledLead: string;
  problems: Array<{ title: string; reason: string }>;
};

/** Who the requests went to, as a person reads it: "Jordan Lee", "Jordan Lee and Alex
 * Morgan", "3 people". */
function whoOf(result: SendResult): string {
  const names = [
    ...new Set(
      result.targets
        .filter((t) => t.ok && t.recipient !== "")
        .map((t) => personOf(t.recipient.toLowerCase(), result.contacts).name),
    ),
  ];
  return names.length <= 2 ? names.join(" and ") : `${names.length} people`;
}

export function sentReport(result: SendResult): SentReport {
  const plan = reviewPlan(result);
  const sent = plan.sending.length;
  const problems = plan.attention.map((a) => ({
    title: a.title,
    reason: a.reason,
  }));
  const scheduled = plan.later.map((l) => ({
    title: l.title,
    period: l.period,
  }));
  const who = whoOf(result);
  const emailed = `Approved and emailed${who === "" ? "" : ` to ${who}`}. Replies and evidence will appear in the Evidence center.`;
  const base = { scheduled, scheduledLead: plan.laterLead, problems };
  if (sent > 0) {
    return {
      ...base,
      tone: problems.length === 0 ? "success" : "attention",
      title:
        problems.length === 0
          ? sent === 1
            ? "Request sent"
            : `${sent} requests sent`
          : `${sent} of ${sent + problems.length} requests sent`,
      lead: emailed,
    };
  }
  if (problems.length > 0) {
    return {
      ...base,
      tone: "attention",
      title: "Not sent",
      lead: "No request was sent. Resolve what is below, then approve and send again.",
    };
  }
  return {
    ...base,
    tone: "waiting",
    title: scheduled.length > 0 ? "Nothing to send yet" : "Nothing to send",
    lead:
      scheduled.length > 0
        ? "This control's requests are scheduled for their phase."
        : "Nothing was waiting to be sent.",
  };
}

/** The people matching what is typed, by name, email or role; all of them when nothing is
 * typed. At most eight, as the list shows. */
export function matchOwners(
  people: readonly OwnerChoice[],
  query: string,
): OwnerChoice[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return people
    .filter((person) =>
      words.every((word) =>
        `${person.name} ${person.email} ${person.role}`
          .toLowerCase()
          .includes(word),
      ),
    )
    .slice(0, 8);
}

/** Two letters for a person's avatar: their initials, else their address's. */
export function initialsOf(
  person: Pick<OwnerChoice, "name" | "email">,
): string {
  const source = person.name.trim() || person.email.split("@")[0] || "";
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  const letters =
    parts.length >= 2
      ? `${parts[0]?.[0] ?? ""}${parts[parts.length - 1]?.[0] ?? ""}`
      : source.slice(0, 2);
  return letters.toUpperCase();
}

/** A chosen person as the owner: their name, or, with none on record, the email itself. */
export function ownerOf(person: OwnerChoice): { name: string; email: string } {
  return {
    name: person.name.trim() || person.email,
    email: person.email.toLowerCase(),
  };
}

/** The person an address names: the engagement's contact when it is one, else the
 * address itself (an owner needs a name; the address stands in for one). */
export function personOf(
  email: string,
  contacts: readonly OwnerChoice[],
): { name: string; email: string } {
  const known = contacts.find((c) => c.email.toLowerCase() === email);
  return known === undefined ? { name: email, email } : ownerOf(known);
}

/** An address outside the client's domains: worth a second look before it is sent. */
export function outsideDomains(
  email: string,
  domains: readonly string[],
): boolean {
  const domain = email.split("@")[1] ?? "";
  return (
    domains.length > 0 &&
    !domains.some(
      (d) =>
        domain === d.toLowerCase() || domain.endsWith(`.${d.toLowerCase()}`),
    )
  );
}

/** Who can be picked for one request: the matching contacts not already on it, then the
 * typed address when it is one and no contact has it. */
export function recipientChoices(
  contacts: readonly OwnerChoice[],
  query: string,
  taken: readonly string[],
): OwnerChoice[] {
  const matches = matchOwners(contacts, query).filter(
    (c) => !taken.includes(c.email.toLowerCase()),
  );
  const typed = addressOf(query);
  return typed !== null &&
    !taken.includes(typed) &&
    !contacts.some((c) => c.email.toLowerCase() === typed)
    ? [...matches, { name: "", email: typed, role: "" }]
    : matches;
}
