"use client";

import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import {
  AttributeTickmark,
  type DigestAddEvidence,
  type DigestTickmarkAction,
  type DigestTickmarkRead,
} from "./attribute-tickmark";
import {
  ASK_OWNER,
  type AttentionItem,
  absentOf,
  askLines,
  askText,
  CHECK_PROPOSED,
  type CheckDigest,
  type Closing,
  calmUnderStatus,
  type DigestAsk,
  type DigestAttribute,
  type DigestPill,
  fileRef,
  MISSING,
  STATUS_SHOWN,
  tickedToStart,
  withClosing,
} from "./check-digest-model";
import {
  type AttributeLine,
  acceptNoteParts,
  CHECKED_IN_CODE,
  type CheckAction,
  type ElementLine,
  elementWords,
  type FollowUpLine,
  type RowFile,
  type ShownPassage,
} from "./evidence-assurance-model";
import { FileReliability, type ReliabilityAction } from "./file-reliability";
import { UiIcon } from "./ui-icon";

/**
 * A finished check as "Needs attention" (docs/evidence-assurance.md, section 10.12): the
 * first screen answers what this person needs to do (the verdict, only what waits on
 * them, what is fine with every caveat, and one sentence with two actions), and opening
 * an item replaces it, inside the same row, with that attribute alone. These components
 * arrange what the model (check-digest-model) words and handle opening, stepping and
 * ticking. They send nothing and decide nothing: a file's action, a finding's decisions,
 * a passage's viewer, the follow-up form and Accept are the row's own, handed in.
 *
 * Section 10.14: the first line says what is left after the person's work (the model's
 * status), and the check's outcome moves to a quiet "The check proposed: ..." line; a
 * file whose reliability is not established is an item whose button opens its decision
 * in place (file-reliability.tsx), sent through the row's own calls.
 */

/** Said beside the verdict of every finished check: it is the check's proposal. */
export const DIGEST_PROPOSED = "Proposed for your review";
export const DIGEST_ATTENTION = "Needs attention";
export const DIGEST_ALL_DETAILS = "All details";
/** The footer's sentence where accepting carries no warning of its own. */
export const DIGEST_NOTHING_SENT = "Nothing is sent until you approve it.";
export const DIGEST_ACCEPT = "Accept evidence";
/** "Ask owner for 2 items": the ticked requests, counted. */
export const digestAskFor = (count: number) =>
  `Ask owner for ${count} item${count === 1 ? "" : "s"}`;
/** Why "Ask owner for 0 items" is off. */
export const DIGEST_NONE_TICKED = "Tick an item to ask the owner for it.";
/** Where the ticked requests are longer than the follow-up form takes (ASK_LIMIT): only
 * those that fit are handed over, and it is said. */
export const digestFits = (fits: number, ticked: number) =>
  `${fits} of ${ticked} fit in one follow-up`;
/** One attribute at a time. */
export const DIGEST_SUMMARY = "Summary";
export const DIGEST_PREVIOUS = "Previous";
export const DIGEST_BACK = "Back to summary";
export const digestNext = (letter: string) =>
  letter === "" ? "Next" : `Next: ${letter}`;
export const digestPlace = (at: number, of: number) => `${at} of ${of}`;
export const DIGEST_ASKS = "Ask the owner";
export const DIGEST_MORE = "More about this attribute";
/** On an attribute the check lists that the request does not ask for. */
export const DIGEST_NOT_ASKED = "Not asked for by this request";
export const DIGEST_COPY_FAILED =
  "Could not copy. Select the request's text and copy it.";
/** On a row of an attribute's table: the file it rests on, with its annotations. */
export const DIGEST_VIEW = "View";
export const DIGEST_EVIDENCE = "Evidence";
/** What "View" opens, for a screen reader: "View E2 with its annotations for
 * attribute C". */
export const digestViewName = (ref: string, letter: string) =>
  ` ${ref} with its annotations for attribute ${letter}`.replace(/ {2,}/g, " ");

const flat = (text: string) => text.replace(/\s+/g, " ").trim();

/** An element's result where the evidence shows it in part, in the check's own words. */
const HALF_SHOWN = elementWords("PARTLY_MET");
/** Over what an attribute shown in part leaves to the other requests. */
export const DIGEST_LEFT = "Left to other requests";
const ROW_TONE = {
  SHOWN: "success",
  PART: "warning",
  AGAINST: "danger",
  MISSING: "danger",
} as const;
const ROW_MARK = {
  SHOWN: "check",
  PART: "layers",
  AGAINST: "x",
  MISSING: "x",
} as const;

/** The row's own way to ask the owner, as its menu's "Ask a follow-up" does. */
export type DigestAskAction = {
  /** Opens the row's follow-up form with this text for the person to edit and send. */
  onAsk: (text: string) => void;
  /** Why a follow-up cannot be asked now, in the menu's own words; null when it can. */
  unavailable: string | null;
};

/** The row's own Accept. */
export type DigestAcceptAction = {
  onAccept: () => void;
  /** The server has the decision and has not answered yet. */
  busy: boolean;
  /** Why it cannot be pressed now; null when it can. */
  off: string | null;
};

/** The evidence a row of an attribute rests on: its file, opened with its annotations on
 * the one that marks this passage for this attribute (the row's own preview). */
export type DigestEvidence = {
  fileId: string;
  attributeId: string;
  letter: string;
  /** The passage the row quotes; "" for a row without one of its own. */
  quote: string;
  /** The passage the file opens on where it has no annotations. */
  passage: ShownPassage;
};

/** The ticks, one state for the first screen and every attribute: each request the
 * person has ticked or unticked, by its key; any other starts as the model says. */
type Ticks = {
  /** Null for a person who may not act: no tick is offered. */
  ticked: ReadonlySet<string> | null;
  set: (keys: readonly string[], on: boolean) => void;
};

/** A state in words with a small mark; the colour repeats the words. */
function State({ pill }: { pill: DigestPill }) {
  return (
    <span className={`cdg-state is-${pill.tone}`}>
      <span className="cdg-dot" aria-hidden="true" />
      {pill.label}
    </span>
  );
}

/** A tick with its words: a real checkbox, labelled. */
function Tick({
  checked,
  onChange,
  children,
  about,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  children: ReactNode;
  /** What only a screen reader needs to tell this tick from the next. */
  about?: string;
}) {
  return (
    <label className="cdg-tick">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        {children}
        {about !== undefined ? <span className="sr-only">{about}</span> : null}
      </span>
    </label>
  );
}

/** One thing that waits on the person: a marker, a bold line, a quiet line, and its one
 * control. Where it has an attribute, the whole item outside its control opens it. */
function Item({
  item,
  digest,
  ticks,
  act,
  onOpen,
  onView,
  onReliability,
}: {
  item: AttentionItem;
  digest: CheckDigest;
  ticks: Ticks;
  act: (action: CheckAction) => ReactNode;
  onOpen: (key: string) => void;
  onView: (key: string) => void;
  /** Opens a file's reliability decision in place; null for a person who may not act. */
  onReliability: ((fileId: string, from: HTMLElement) => void) | null;
}) {
  const key = item.attributeKey;
  // The verdict counts the attributes the request asks for: an item on another says so.
  const unasked =
    key !== null &&
    digest.attributes.some((row) => row.key === key && !row.line.expected);
  const text = (
    <>
      <span className="cdg-item-head">
        <strong className="cdg-item-title" title={item.headline}>
          {item.headline}
        </strong>
        {item.more > 0 ? (
          // After a line that leads with the model's MISSING word, more of the same;
          // after a sentence of its own (a
          // judgment, an exception), things that are missing besides.
          <span className="cdg-item-more">
            {`+${item.more} ${item.headline.startsWith(`${MISSING}:`) ? "more" : "missing"}`}
          </span>
        ) : null}
      </span>
      <span className="cdg-item-sub">
        {/* The attribute's own state leads its line: a gap is never read as only a
            gap where the check says more. */}
        {item.status !== null ? (
          <span className={`cdg-state cdg-item-status is-${item.status.tone}`}>
            <span className="cdg-dot" aria-hidden="true" />
            {item.status.label}
          </span>
        ) : null}
        <span className="cdg-item-context" title={item.context}>
          {item.context}
        </span>
        {unasked ? (
          <span className="cdg-item-flag">{DIGEST_NOT_ASKED}</span>
        ) : null}
        {item.tickmark !== undefined ? (
          // A person's exception keeps the item: said in words, with its mark.
          <span
            className={`cdg-state cdg-item-tickmark is-${item.tickmark.tone}`}
          >
            <UiIcon name={item.tickmark.icon} size={12} />
            {item.tickmark.label}
          </span>
        ) : null}
        {item.flag !== "" ? (
          <span className="cdg-item-flag">{item.flag}</span>
        ) : null}
      </span>
      {item.note !== undefined ? (
        // A tickmark recorded on an earlier check (section 10.15, item 9): a quiet
        // line of its own, so the attribute's wording keeps its line.
        <span className="cdg-item-note">{item.note}</span>
      ) : null}
    </>
  );
  const control = item.control;
  // Every follow-up the tick stands for: each group's lead, and those folded under it.
  const groups =
    control.type === "ASK"
      ? digest.asks.filter((ask) => control.askKeys.includes(ask.key))
      : [];
  const every = groups.flatMap((ask) => [ask.line, ...ask.similar]);
  return (
    <li className={`cdg-item is-${item.kind.toLowerCase()}`}>
      <span className="cdg-mark" aria-hidden="true">
        {item.mark !== "" ? (
          item.mark
        ) : (
          <UiIcon
            name={item.kind === "OTHER" ? "target" : "message"}
            size={14}
          />
        )}
      </span>
      {key !== null ? (
        <button
          type="button"
          className="cdg-item-open"
          data-cdg-open={key}
          onClick={() => onOpen(key)}
        >
          <span className="sr-only">{`Attribute ${item.mark}: `}</span>
          {text}
        </button>
      ) : (
        <div className="cdg-item-text">
          {item.kind === "FILE" && item.mark !== "" ? (
            <span className="sr-only">{`File ${item.mark}: `}</span>
          ) : null}
          {text}
        </div>
      )}
      <span className="cdg-item-control">
        {control.type === "ASK" && ticks.ticked !== null ? (
          <Tick
            checked={every.some((line) => ticks.ticked?.has(line.key))}
            onChange={(on) =>
              // On: the requests the model starts with. Off: every one under it.
              ticks.set(
                on ? control.askKeys : every.map((line) => line.key),
                on,
              )
            }
            about={
              item.mark !== ""
                ? ` about attribute ${item.mark}`
                : `: ${item.headline}`
            }
          >
            {ASK_OWNER}
          </Tick>
        ) : null}
        {control.type === "OPEN" && key !== null ? (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => onOpen(key)}
          >
            {control.label}
            <span className="sr-only">{` attribute ${item.mark}`}</span>
          </button>
        ) : null}
        {control.type === "ACT" ? act(control.action) : null}
        {control.type === "RELIABILITY" && onReliability !== null ? (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            data-cdg-reliability={control.fileId}
            onClick={(event) =>
              onReliability(control.fileId, event.currentTarget)
            }
          >
            {control.label}
            <span className="sr-only">{` the reliability of ${item.mark || "this file"}`}</span>
          </button>
        ) : null}
        {control.type === "VIEW" ? (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            data-cdg-view={item.key}
            onClick={() => onView(item.key)}
          >
            {control.label}
            {item.mark !== "" ? (
              <span className="sr-only">{`: ${item.mark}`}</span>
            ) : null}
          </button>
        ) : null}
      </span>
      <span className="cdg-chev" aria-hidden="true">
        {key !== null ? <UiIcon name="chevron" size={14} /> : null}
      </span>
    </li>
  );
}

/** What a follow-up says besides its request: which attributes it serves, what is
 * missing, why it matters, and what else would do. Null where it says none of it. */
function AskWhy({ line, serves }: { line: FollowUpLine; serves: boolean }) {
  const any =
    line.missing !== "" || line.why !== "" || line.alternatives !== "";
  if (!any && !(serves && line.serves !== "")) {
    return null;
  }
  return (
    <div className="cdg-why">
      {serves && line.serves !== "" ? (
        <span className="cdg-cap">{line.serves}</span>
      ) : null}
      {any ? (
        <dl className="de-follow-why">
          {line.missing !== "" ? (
            <div>
              <dt>What is missing</dt>
              <dd>{line.missing}</dd>
            </div>
          ) : null}
          {line.why !== "" ? (
            <div>
              <dt>Why it matters</dt>
              <dd>{line.why}</dd>
            </div>
          ) : null}
          {line.alternatives !== "" ? (
            <div>
              <dt>An alternative</dt>
              <dd>{line.alternatives}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </div>
  );
}

/** One recommended follow-up in full: its tick for a person who may act, the request's
 * own text, and what kind of ask it is with its priority, in words. `full`: with all it
 * says besides (a request listed outside its attribute's own view). */
function AskRow({
  line,
  ticks,
  full,
}: {
  line: FollowUpLine;
  ticks: Ticks;
  full: boolean;
}) {
  const facts = [line.kind, line.priority]
    .filter((part) => part !== "")
    .join(" · ");
  const said = (
    <>
      <span className="cdg-ask-text">{line.request}</span>
      {facts !== "" ? <span className="cdg-ask-priority">{facts}</span> : null}
    </>
  );
  if (full) {
    return (
      <>
        <AskRow line={line} ticks={ticks} full={false} />
        <AskWhy line={line} serves />
      </>
    );
  }
  return ticks.ticked !== null ? (
    <label className="cdg-ask">
      <input
        type="checkbox"
        checked={ticks.ticked.has(line.key)}
        onChange={(event) => ticks.set([line.key], event.target.checked)}
      />
      <span className="cdg-ask-said">{said}</span>
    </label>
  ) : (
    <p className="cdg-ask">
      <span className="cdg-ask-said">{said}</span>
    </p>
  );
}

/** A follow-up with those of the same kind for the same attributes folded under it:
 * "1 similar" lists each, still its own request with its own tick. */
function AskGroup({
  ask,
  ticks,
  full,
}: {
  ask: DigestAsk;
  ticks: Ticks;
  full: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const count = ask.similar.length;
  return (
    <li>
      <AskRow line={ask.line} ticks={ticks} full={full} />
      {count > 0 ? (
        <>
          <button
            type="button"
            className="cdg-link cdg-similar"
            aria-expanded={open}
            aria-controls={`${id}-similar`}
            onClick={() => setOpen((value) => !value)}
          >
            {`${count} similar`}
            <span className="sr-only">
              {` request${count === 1 ? "" : "s"}, folded under this one`}
            </span>
            <UiIcon name="chevron" size={12} />
          </button>
          <ul id={`${id}-similar`} className="cdg-asks" hidden={!open}>
            {ask.similar.map((line) => (
              <li key={line.key}>
                <AskRow line={line} ticks={ticks} full={full} />
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </li>
  );
}

/** "Ask the owner": the follow-ups given, each in full with its tick, and Copy for the
 * ticked ones. Copy puts every ticked request here on the clipboard, never fewer, and
 * sends nothing. */
function AskBox({
  asks,
  digest,
  ticks,
  full = false,
}: {
  asks: DigestAsk[];
  digest: CheckDigest;
  ticks: Ticks;
  /** Each request with all it says besides: where it is listed outside an attribute. */
  full?: boolean;
}) {
  const id = useId();
  const [copied, setCopied] = useState<"" | "done" | "failed">("");
  useEffect(() => {
    if (copied === "") {
      return;
    }
    const timer = window.setTimeout(
      () => setCopied(""),
      copied === "done" ? 2000 : 6000,
    );
    return () => window.clearTimeout(timer);
  }, [copied]);
  const here = new Set(
    asks.flatMap((ask) => [ask.line, ...ask.similar]).map((line) => line.key),
  );
  // What is ticked here; for a person who may not act, what the list holds.
  const chosen = new Set(
    [...here].filter((key) => ticks.ticked?.has(key) ?? true),
  );
  // Every chosen request in full, however long: the form's limit is not copying's.
  const text = askLines(digest, chosen).join("\n");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied("done");
    } catch {
      setCopied("failed");
    }
  };
  return (
    <section className="cdg-askbox" aria-labelledby={`${id}-title`}>
      <div className="cdg-askbox-head">
        <h6 id={`${id}-title`}>{DIGEST_ASKS}</h6>
        <button
          type="button"
          className="cdg-link cdg-copy"
          disabled={text === ""}
          onClick={() => void copy()}
        >
          {copied === "done" ? "Copied" : "Copy"}
          <span className="sr-only">
            {copied === "done" ? "" : " the ticked requests"}
          </span>
        </button>
      </div>
      {/* Said politely to a screen reader; seen only where copying did not work. */}
      <p
        className={copied === "failed" ? "cdg-copy-note" : "sr-only"}
        role="status"
      >
        {copied === "done"
          ? "Copied"
          : copied === "failed"
            ? DIGEST_COPY_FAILED
            : ""}
      </p>
      <ul className="cdg-asks">
        {asks.map((ask) => (
          <AskGroup key={ask.key} ask={ask} ticks={ticks} full={full} />
        ))}
      </ul>
    </section>
  );
}

/** A row of an attribute's short table: an element shown, one shown in part with what
 * of it is missing, one the check found against, or something absent. */
type TableRow = {
  key: string;
  kind: "SHOWN" | "PART" | "AGAINST" | "MISSING";
  /** The row's own words for what it is: an element's result ("Shown", "Shown in
   * part", "Not met", "Not shown"), or the model's word for something absent. */
  label: string;
  text: string;
  /** What of the row's own element is missing, said under it and nowhere else. */
  lacks: string[];
  /** The passages the row's own element rests on: the row quotes, names and opens only
   * these, never another element's. */
  passages: ShownPassage[];
};

/** A passage known from another: its file, where it is, and its words. */
const passageKey = (shown: ShownPassage) =>
  `${shown.fileId ?? ""}|${shown.location}|${shown.quote}`;

/** How one absent thing is known from another: its words, whatever its case or its
 * closing stop (as the model's own list tells them apart). */
const lackKey = (text: string) =>
  flat(text)
    .toLowerCase()
    .replace(/[.\s]+$/, "");

/** What the short table of an attribute holds: each element shown; each element shown in
 * part, in its own result's words, with what of it is missing under it; each element the
 * check found against; then each absent thing that belongs to no row, once. */
function tableOf(line: AttributeLine): TableRow[] {
  const elements = (
    kind: "SHOWN" | "PART" | "AGAINST",
    only: (element: ElementLine) => boolean,
  ): TableRow[] =>
    line.elements.filter(only).map((element) => ({
      key: `${kind}:${element.key}`,
      kind,
      label: element.result,
      text: element.text,
      lacks: [],
      passages: element.passages,
    }));
  const shown = elements("SHOWN", (element) => element.tone === "success");
  const said = flat(line.summary) || flat(line.label);
  // An element shown in part is a row of its own: what it shows is not hidden behind
  // what it lacks. Each thing it lacks is under it, once across the rows.
  const told = new Set<string>();
  const part = line.elements
    .filter((element) => element.result === HALF_SHOWN)
    .map(
      (element): TableRow => ({
        key: `PART:${element.key}`,
        kind: "PART",
        label: element.result,
        text: element.text,
        lacks: element.absent.map(flat).filter((gap) => {
          const key = lackKey(gap);
          if (key === "" || told.has(key)) {
            return false;
          }
          told.add(key);
          return true;
        }),
        passages: element.passages,
      }),
    );
  return [
    // A supported attribute the check gave no elements for is shown by its sentence.
    ...(shown.length === 0 &&
    line.elements.length === 0 &&
    line.state === "SUPPORTED" &&
    said !== ""
      ? [
          {
            key: "SHOWN:",
            kind: "SHOWN" as const,
            label: STATUS_SHOWN,
            text: said,
            lacks: [],
            // Sent without its elements, the attribute is its one element: its own
            // passages are this row's.
            passages: line.passages,
          },
        ]
      : shown),
    ...part,
    // An element the check found against, where it names nothing absent of its own (an
    // exception a record shows among them), is a row in its own result's words, with the
    // record it rests on: never the word for what is absent.
    ...elements(
      "AGAINST",
      (element) =>
        element.deviation ||
        (element.tone === "danger" && element.absent.length === 0),
    ),
    // What is absent and belongs to no row above.
    ...absentOf(line)
      .filter((gap) => !told.has(lackKey(gap)))
      .map((gap) => ({
        key: `MISSING:${gap}`,
        kind: "MISSING" as const,
        label: MISSING,
        text: gap,
        lacks: [],
        passages: [],
      })),
  ];
}

/** One attribute alone: its wording and state, the short table of what is shown and what
 * is missing, the two readings where a judgment is owed, the comparisons made in code,
 * what to ask the owner, the finding on it, and the rest on request. */
function Attribute({
  row,
  digest,
  files,
  ticks,
  hidden,
  headingRef,
  passage,
  onEvidence,
  finding,
  tickmark,
  addEvidence,
  read,
}: {
  row: DigestAttribute;
  digest: CheckDigest;
  files: RowFile[];
  ticks: Ticks;
  hidden: boolean;
  headingRef: (element: HTMLHeadingElement | null) => void;
  passage: (passage: ShownPassage, letter: string) => ReactNode;
  onEvidence: (evidence: DigestEvidence) => void;
  finding: (line: AttributeLine) => ReactNode;
  tickmark: DigestTickmarkAction | null;
  addEvidence: DigestAddEvidence | null;
  read: DigestTickmarkRead | null;
}) {
  const id = useId();
  const [more, setMore] = useState(false);
  const { line } = row;
  const table = tableOf(line);
  // Each row quotes the first passage its own element rests on; every other passage of
  // the attribute and of its elements, each once, is on request.
  const quoted = new Set(
    table.flatMap((each) =>
      each.passages[0] === undefined ? [] : [passageKey(each.passages[0])],
    ),
  );
  const further = [
    ...line.passages,
    ...line.elements.flatMap((element) => element.passages),
  ].filter(
    (shown, at, all) =>
      !quoted.has(passageKey(shown)) &&
      all.findIndex((each) => passageKey(each) === passageKey(shown)) === at,
  );
  const nameOf = (shown: ShownPassage) =>
    files.find((file) => file.id === shown.fileId)?.name ?? shown.fileLabel;
  /** What "View" opens for a passage: its file, with its annotations, where the row's
   * viewer can open it. */
  const evidenceOf = (
    shown: ShownPassage | undefined,
    quote: string,
  ): DigestEvidence | null =>
    shown === undefined || !shown.opens || shown.fileId === null
      ? null
      : {
          fileId: shown.fileId,
          attributeId: line.attributeId,
          letter: row.letter,
          quote,
          passage: shown,
        };
  // The files the attribute's passages are in, each once, in the passages' order.
  const sources = line.passages.filter(
    (shown, at) =>
      evidenceOf(shown, "") !== null &&
      line.passages.findIndex((each) => each.fileId === shown.fileId) === at,
  );
  /** The button that opens a file with its annotations for this attribute: its words
   * on the screen, and its whole name for a screen reader. */
  const view = (evidence: DigestEvidence, words: string) => (
    <button
      type="button"
      className="cdg-link cdg-view"
      onClick={() => onEvidence(evidence)}
    >
      <span aria-hidden="true">{words}</span>
      <span className="sr-only">
        {`${DIGEST_VIEW}${digestViewName(fileRef(files, evidence.fileId), row.letter)}`}
      </span>
    </button>
  );
  // Where the two readings are drawn, the check's own sentence is over them.
  const over =
    line.readings.length > 0 || line.state === "JUDGMENT"
      ? [line.judgment ?? "", line.summary]
          .map(flat)
          .filter((part, at, all) => part !== "" && all.indexOf(part) === at)
      : [];
  const sentence = [
    line.label !== row.status.label ? line.label : "",
    over.includes(flat(line.summary)) ? "" : line.summary,
  ]
    .map(flat)
    .filter((part) => part !== "");
  const element = (item: ElementLine) => (
    <li key={item.key}>
      <strong>{item.result}.</strong> {item.text}
    </li>
  );
  // For an attribute this request shows in part: what it leaves to the other requests
  // is said under the table; the elements it shows are listed in full on request.
  // An element shown in part is a row of the table, with what it lacks: what is left
  // besides is what these files do not bear on.
  const halves = new Set(
    table.filter((each) => each.kind === "PART").map((each) => each.text),
  );
  const left = (line.inPart?.leaves ?? []).filter((text) => !halves.has(text));
  const leaves = new Set(left);
  const listed = line.elements.filter((item) => !leaves.has(item.text));
  const asked = row.asks.flatMap((ask) => [ask.line, ...ask.similar]);
  const reasons = asked.filter(
    (ask) =>
      ask.missing !== "" ||
      ask.why !== "" ||
      ask.alternatives !== "" ||
      ask.serves !== "",
  );
  const any =
    sentence.length > 0 ||
    listed.length > 0 ||
    further.length > 0 ||
    reasons.length > 0;
  return (
    <article
      className="cdg-focus"
      hidden={hidden}
      aria-labelledby={`${id}-title`}
    >
      <h5
        className="cdg-focus-title"
        id={`${id}-title`}
        tabIndex={-1}
        ref={headingRef}
      >
        <span className="cdg-mark" aria-hidden="true">
          {row.letter}
        </span>
        <span className="sr-only">{`Attribute ${row.letter}: `}</span>
        {row.text !== "" ? row.text : `Attribute ${row.letter}`}
      </h5>
      <p className="cdg-focus-state">
        <State pill={row.status} />
        {!line.expected ? (
          <span className="cdg-quiet-note">{DIGEST_NOT_ASKED}</span>
        ) : null}
        {sources.length > 0 ? (
          // The evidence the attribute rests on, without reading the table: each file
          // opens with its annotations for this attribute.
          <span className="cdg-sources">
            <span aria-hidden="true">{`${DIGEST_EVIDENCE}:`}</span>
            {sources.map((shown) => {
              const evidence = evidenceOf(shown, "");
              const ref = fileRef(files, shown.fileId);
              return evidence === null ? null : (
                <span key={shown.fileId} title={nameOf(shown)}>
                  {view(evidence, ref)}
                </span>
              );
            })}
          </span>
        ) : null}
      </p>
      {/* A person's tickmark and the ways to add evidence (section 10.13), above what
          the check found, which stays below as it was. */}
      <AttributeTickmark
        line={line}
        letter={row.letter}
        files={files}
        tickmark={tickmark}
        addEvidence={addEvidence}
        read={read}
      />
      {table.length > 0 ? (
        <ul className="cdg-rows">
          {table.map((each) => {
            // A row quotes, names and opens only the passage its own element rests on:
            // no quote, no reference and no View where it has none.
            const own = each.passages[0];
            const evidence = evidenceOf(own, own?.quote ?? "");
            const ref =
              evidence === null ? "" : fileRef(files, evidence.fileId);
            const where =
              own === undefined
                ? ""
                : [nameOf(own), own.location]
                    .filter((part) => part !== "")
                    .join(", ");
            return (
              <li key={each.key} className="cdg-row">
                <span className={`cdg-row-key is-${ROW_TONE[each.kind]}`}>
                  <UiIcon name={ROW_MARK[each.kind]} size={13} />
                  {each.label}
                </span>
                <div className="cdg-row-text">
                  <p>{each.text}</p>
                  {own !== undefined ? (
                    <q className="cdg-quote">{own.quote}</q>
                  ) : null}
                  {each.lacks.map((gap) => (
                    // What of this element is missing: under it, and nowhere else.
                    <p key={gap} className="cdg-row-lack">
                      <span className="cdg-row-key is-danger">
                        <UiIcon name="x" size={12} />
                        {MISSING}
                      </span>
                      {gap}
                    </p>
                  ))}
                </div>
                {evidence !== null ? (
                  <span className="cdg-row-ref">
                    <span title={where} aria-hidden="true">
                      {ref}
                    </span>
                    {view(evidence, DIGEST_VIEW)}
                  </span>
                ) : own !== undefined && where !== "" ? (
                  <span className="cdg-row-ref">
                    <span>{where}</span>
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {left.length > 0 ? (
        // An attribute this request shows in part: what it leaves to the others, said
        // here rather than behind "More about this attribute".
        <div className="cdg-left">
          <span className="cdg-cap" id={`${id}-left`}>
            {DIGEST_LEFT}
          </span>
          <ul aria-labelledby={`${id}-left`}>
            {left.map((each) => (
              <li key={each}>{each}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {over.map((part, at) => (
        <p key={part} className={at === 0 ? "cdg-judgment" : "cdg-over"}>
          {part}
        </p>
      ))}
      {line.readings.length > 0 ? (
        <div className="de-views">
          {line.readings.map((reading) => (
            <div key={reading.who} className="de-view">
              <strong>{reading.who}</strong>
              <span className="de-view-result">{reading.result}</span>
              <p>
                {reading.reason !== "" ? reading.reason : "It gave no reason."}
              </p>
            </div>
          ))}
        </div>
      ) : null}
      {line.checks.length > 0 ? (
        // Comparisons of the records' own values: each sentence states the values, with
        // whether it passed in words and a mark.
        <div className="cdg-checks">
          <span className="cdg-cap" id={`${id}-checks`}>
            {CHECKED_IN_CODE}
          </span>
          <ul aria-labelledby={`${id}-checks`}>
            {line.checks.map((item) => (
              <li key={item.key}>
                <span className={`cdg-state is-${item.tone}`}>
                  <UiIcon name={item.icon} size={12} />
                  {item.result}
                </span>
                <span>{item.sentence}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {row.asks.length > 0 ? (
        <AskBox asks={row.asks} digest={digest} ticks={ticks} />
      ) : null}
      {finding(line)}
      {any ? (
        <div className="cdg-more">
          <button
            type="button"
            className="cdg-link"
            aria-expanded={more}
            aria-controls={`${id}-more`}
            onClick={() => setMore((value) => !value)}
          >
            {DIGEST_MORE}
            <UiIcon name="chevron" size={12} />
          </button>
          <div id={`${id}-more`} className="cdg-more-body" hidden={!more}>
            {sentence.length > 0 ? (
              <p>
                {sentence.map((part, at) => (
                  <span key={part}>
                    {at > 0 ? " " : ""}
                    {at === 0 && sentence.length > 1 ? (
                      <strong>
                        {/[.!?…]$/.test(part) ? part : `${part}.`}
                      </strong>
                    ) : (
                      part
                    )}
                  </span>
                ))}
              </p>
            ) : null}
            {listed.length > 0 ? (
              <div className="cdg-group">
                <span className="cdg-cap" id={`${id}-elements`}>
                  {line.inPart !== null ? "This request shows" : "Its elements"}
                </span>
                <ul className="cdg-elements" aria-labelledby={`${id}-elements`}>
                  {listed.map(element)}
                </ul>
              </div>
            ) : null}
            {further.length > 0 ? (
              <div className="cdg-group">
                <span className="cdg-cap">
                  {quoted.size === 0
                    ? "What the readings rest on"
                    : "Further passages"}
                </span>
                <ul className="de-passages">
                  {further.map((each) => passage(each, row.letter))}
                </ul>
              </div>
            ) : null}
            {reasons.map((ask) => (
              // Each request's own reasons, under its words where there is more than
              // one to tell apart.
              <div key={ask.key} className="cdg-group">
                {reasons.length > 1 ? (
                  <span className="cdg-cap">{ask.request}</span>
                ) : null}
                <AskWhy line={ask} serves />
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}

/**
 * The result of a finished check: its first screen, or one attribute alone. The first
 * screen holds, in the contract's order, the verdict, what needs attention, the quiet
 * line with "All details", and the footer.
 */
export function CheckDigestView({
  digest: made,
  title,
  files,
  upgrade,
  passage,
  onEvidence,
  finding,
  act,
  onView,
  under,
  ask,
  accept,
  acceptNote,
  details,
  tickmark = null,
  addEvidence = null,
  read = null,
  reliability = null,
  closing = null,
}: {
  /** The check's digest as the model made it. */
  digest: CheckDigest;
  /** The request's title, said quietly over an opened attribute. */
  title: string;
  /** The row's files, in their order: a passage's file is named `E1`, `E2`... */
  files: RowFile[];
  /** "Check again with the current engine", where the row offers it; null otherwise. */
  upgrade: ReactNode;
  /** A passage as the row draws it in full (a list item), opening in its file. */
  passage: (passage: ShownPassage, letter: string) => ReactNode;
  /** Opens a row's evidence in the row's own preview: the file with its annotations, on
   * the one that marks the row's passage. */
  onEvidence: (evidence: DigestEvidence) => void;
  /** The finding on an attribute as the row draws it, with its own actions; null where
   * the attribute has none. */
  finding: (line: AttributeLine) => ReactNode;
  /** A file's own action (its type, a file left out) as the row's button; null where
   * this person is not offered it. */
  act: (action: CheckAction) => ReactNode;
  /** Reveals something of the row's own that an item is about (the sample to confirm, a
   * file with something to settle), by the item's key. */
  onView: (key: string) => void;
  /** What the row has revealed for an item, drawn directly under the list. */
  under: ReactNode;
  /** The row's follow-up; null for a person who may not act. */
  ask: DigestAskAction | null;
  /** The row's Accept; null where the row does not offer it to this person. */
  accept: DigestAcceptAction | null;
  /** The row's warning about accepting; "" where it has none. */
  acceptNote: string;
  /** What "All details" opens to: the request and the check's details, as the row
   * draws them. */
  details: ReactNode;
  /** The row's calls for a person's tickmark on an attribute (section 10.13); null for a
   * person who may not act. */
  tickmark?: DigestTickmarkAction | null;
  /** The row's own ways to add evidence; null for a person who may not act. */
  addEvidence?: DigestAddEvidence | null;
  /** What anyone who can see the row may read of a tickmark (the annotation it rests
   * on); null where nothing can be read. */
  read?: DigestTickmarkRead | null;
  /** The row's calls for a decision on a file's reliability (section 10.14); null for a
   * person who may not act: the decisions are read, nothing is offered. */
  reliability?: ReliabilityAction | null;
  /** Where the request stands for closing (section 10.15): whether a person accepted
   * its evidence, and whether the row offers Accept to this person. Null where the row
   * does not say: the first line is then the check's own status. */
  closing?: Closing | null;
}) {
  const id = useId();
  // Where every attribute the request asks for is shown or carries a tickmark, the
  // first line says where the request stands for closing: the model's words.
  const digest = withClosing(made, closing);
  // A file's reliability, open in place under "Needs attention": from its item's
  // button (the form at once) or from the quiet line (the decision that stands).
  const [relOpen, setRelOpen] = useState<{
    fileId: string;
    form: boolean;
  } | null>(null);
  const relOpener = useRef<HTMLElement | null>(null);
  const relLine =
    relOpen === null
      ? null
      : (digest.reliability.find((line) => line.fileId === relOpen.fileId) ??
        null);
  // The file is no longer listed once the list is read again: nothing is left open.
  const relGone = relOpen !== null && relLine === null;
  useEffect(() => {
    if (relGone) {
      setRelOpen(null);
    }
  }, [relGone]);
  const openReliability = (
    fileId: string,
    from: HTMLElement,
    form: boolean,
  ) => {
    relOpener.current = from;
    setRelOpen({ fileId, form });
  };
  const closeReliability = () => {
    const from = relOpener.current;
    setRelOpen(null);
    // Back to what opened it where it is still there (an item that left the list once
    // decided is not), else to the first screen's heading.
    window.setTimeout(() => {
      (from?.isConnected === true
        ? from
        : root.current?.querySelector<HTMLElement>(".cdg-outcome")
      )?.focus();
    }, 0);
  };
  const root = useRef<HTMLDivElement>(null);
  // The attribute shown alone, by its key: it stays when the list is read again, and
  // the first screen comes back where the check no longer has it.
  const [openKey, setOpenKey] = useState<string | null>(null);
  const current =
    openKey !== null && digest.steps.includes(openKey) ? openKey : null;
  // Every attribute opened so far stays in the page, hidden: what a person half typed
  // in one (a finding's note) is there when they come back to it.
  const [visited, setVisited] = useState<readonly string[]>([]);
  const [detailsOpen, setDetailsOpen] = useState(false);
  // Once opened, the details stay in the page: what was opened inside them stays open.
  const [detailsSeen, setDetailsSeen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  // Each request the person ticked or unticked, by its key: any other is ticked as
  // the model starts it, so follow-ups that arrive when the list is read again start
  // as the model says and nothing the person chose is turned over.
  const [chosen, setChosen] = useState<ReadonlyMap<string, boolean>>(
    () => new Map(),
  );
  const start = tickedToStart(digest);
  const listed = digest.asks.flatMap((each) => [each.line, ...each.similar]);
  const ticked = new Set(
    listed
      .map((line) => line.key)
      .filter((key) => chosen.get(key) ?? start.has(key)),
  );
  const ticks: Ticks = {
    ticked: ask === null ? null : ticked,
    set: (keys, on) =>
      setChosen((was) => {
        const next = new Map(was);
        for (const key of keys) {
          next.set(key, on);
        }
        return next;
      }),
  };
  // Where the focus goes once the screen has changed: an attribute's heading, or the
  // item of the attribute just left.
  const headings = useRef(new Map<string, HTMLHeadingElement>());
  const [focus, setFocus] = useState<
    { to: "heading"; key: string } | { to: "item"; key: string } | null
  >(null);
  useEffect(() => {
    if (focus === null) {
      return;
    }
    if (focus.to === "heading") {
      headings.current.get(focus.key)?.focus();
    } else {
      const items = [
        ...(root.current?.querySelectorAll<HTMLElement>("[data-cdg-open]") ??
          []),
      ];
      (
        items.find((item) => item.dataset.cdgOpen === focus.key) ??
        root.current?.querySelector<HTMLElement>(".cdg-outcome")
      )?.focus();
    }
    setFocus(null);
  }, [focus]);
  // The check changed under the person and the open attribute is gone: the first
  // screen is back, and the focus with it.
  useEffect(() => {
    if (openKey !== null && current === null) {
      setOpenKey(null);
      root.current?.querySelector<HTMLElement>(".cdg-outcome")?.focus();
    }
  }, [openKey, current]);
  const show = (key: string) => {
    setOpenKey(key);
    setVisited((was) => (was.includes(key) ? was : [...was, key]));
    setFocus({ to: "heading", key });
  };
  const back = () => {
    if (current !== null) {
      setFocus({ to: "item", key: current });
    }
    setOpenKey(null);
  };
  const at = current === null ? -1 : digest.steps.indexOf(current);
  const rowOf = (key: string | undefined) =>
    digest.attributes.find((row) => row.key === key);
  const previous = digest.steps[at - 1];
  const next = digest.steps[at + 1];

  // The requests whose item opens no attribute (one that names none, or only attributes
  // with no item): each is in the details in full, so the one line of its item is never
  // all there is of it.
  const general = new Set(
    digest.attention.flatMap((item) =>
      item.kind === "GENERAL" && item.control.type === "ASK"
        ? item.control.askKeys
        : [],
    ),
  );
  const loose = digest.asks.filter((each) => general.has(each.key));

  // The footer: the ticked requests, as the follow-up form will hold them.
  const text = askText(digest, ticked);
  const wanted = askLines(digest, ticked).length;
  // The form takes so many characters: what does not fit is said, never dropped unsaid.
  const fits = text === "" ? 0 : text.split("\n").length;
  const asking = ask !== null && digest.askTotal > 0 ? ask : null;
  const askOff =
    asking === null
      ? null
      : wanted === 0
        ? DIGEST_NONE_TICKED
        : asking.unavailable || null;
  // What is said beside the two actions, each sentence once: why asking the owner cannot
  // be pressed, or what does not fit one follow-up; the follow-ups not listed; and why
  // Accept cannot be pressed (said, not left to a tooltip). The same reason for both is
  // one sentence that describes both.
  const askSays = [
    askOff ??
      (asking !== null && fits < wanted ? `${digestFits(fits, wanted)}.` : ""),
    // Follow-ups the check did not list are said beside the action that asks.
    asking !== null ? digest.asksMore : "",
  ].filter((part) => part !== "");
  const acceptSays = accept?.off ?? "";
  const hints = [...askSays, acceptSays].filter(
    (part, at, all) => part !== "" && all.indexOf(part) === at,
  );
  const hintId = (part: string) => `${id}-hint-${hints.indexOf(part)}`;
  const askDescribed = askSays.map(hintId).join(" ") || undefined;
  // The row's warning about accepting. What cautions is always read; only the sentence
  // in favour ("Accepting marks attribute A as evidenced.") waits behind "more".
  const warning = accept !== null ? flat(acceptNote) : "";
  const { favour, caution } = acceptNoteParts(warning);
  // Where nothing waits, the calm line is not the footer's own caution said again, nor
  // what the status line already says (section 10.14).
  const calm = digest.calm === caution ? "" : calmUnderStatus(digest);

  return (
    <div className="cdg" ref={root}>
      <div className="cdg-summary" hidden={current !== null}>
        <div className="cdg-verdict">
          {/* What is left after the person's work (section 10.14, A), first and large;
              then the counts; then, quietly, the check's own outcome in its words, with
              whose proposal it is. */}
          <h5 className="cdg-outcome" tabIndex={-1}>
            {digest.status}
          </h5>
          <p className="cdg-sentence">{digest.verdict}</p>
          <p className="cdg-proposed-line">
            {digest.outcome !== null ? (
              <span className="cdg-check-said">
                {CHECK_PROPOSED}{" "}
                <span className={`cdg-state is-${digest.outcome.tone}`}>
                  <span className="cdg-dot" aria-hidden="true" />
                  {digest.outcome.label}
                </span>
              </span>
            ) : null}
            <span className="cdg-proposed">
              <UiIcon name="sparkles" size={12} />
              {DIGEST_PROPOSED}
            </span>
          </p>
          {upgrade}
        </div>
        {digest.attention.length > 0 ? (
          <section
            className="cdg-attention"
            aria-labelledby={`${id}-attention`}
          >
            <h6 className="cdg-label" id={`${id}-attention`}>
              {DIGEST_ATTENTION}
            </h6>
            <ul className="cdg-items">
              {digest.attention.map((item) => (
                <Item
                  key={item.key}
                  item={item}
                  digest={digest}
                  ticks={ticks}
                  act={act}
                  onOpen={show}
                  onView={onView}
                  onReliability={
                    reliability === null
                      ? null
                      : (fileId, from) => openReliability(fileId, from, true)
                  }
                />
              ))}
            </ul>
          </section>
        ) : calm !== "" ? (
          // Nothing waits on the person: what the check itself says of that, which is
          // "nothing needs your attention" only where nothing says otherwise.
          <p className="cdg-calm">{calm}</p>
        ) : null}
        {relOpen !== null && relLine !== null ? (
          // A file's reliability, in place: the form its item opens, or the
          // decision that stands; it stays open once recorded, with its confirmation.
          <div className="cdg-rel-wrap">
            <FileReliability
              key={relLine.fileId}
              line={relLine}
              fileRef={fileRef(files, relLine.fileId)}
              action={reliability}
              startForm={relOpen.form}
              onClose={closeReliability}
            />
          </div>
        ) : null}
        {under}
        <div className="cdg-quiet">
          {digest.quiet.length > 0 ? (
            // What is fine, then every caveat: each in full, wrapping where it must.
            <ul className="cdg-quiet-items">
              {digest.quiet.map((item) => {
                const key = item.attributeKey;
                const fileId = item.fileId;
                return (
                  <li key={item.key} className={`is-${item.tone}`}>
                    {fileId !== undefined ? (
                      // A file whose reliability a person decided: its decision, in
                      // place, with its own Close.
                      <button
                        type="button"
                        className="cdg-link cdg-quiet-open"
                        data-cdg-reliability={fileId}
                        onClick={(event) =>
                          openReliability(fileId, event.currentTarget, false)
                        }
                      >
                        <UiIcon name={item.icon} size={13} />
                        {item.text}
                      </button>
                    ) : key !== null ? (
                      <button
                        type="button"
                        className="cdg-link cdg-quiet-open"
                        data-cdg-open={key}
                        onClick={() => show(key)}
                      >
                        <UiIcon name={item.icon} size={13} />
                        {item.text}
                      </button>
                    ) : (
                      <span className="cdg-caveat">
                        <UiIcon name={item.icon} size={13} />
                        {item.text}
                      </span>
                    )}
                    {item.note !== undefined ? (
                      // A tickmark that stands through a later check (section 10.15,
                      // item 9): said quietly beside it.
                      <>
                        {" "}
                        <span className="cdg-quiet-note cdg-earlier">
                          {item.note}
                        </span>
                      </>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
          <button
            type="button"
            className="cdg-link cdg-all"
            aria-expanded={detailsOpen}
            aria-controls={`${id}-details`}
            aria-describedby={
              digest.details.any ? `${id}-details-holds` : undefined
            }
            title={digest.details.any ? digest.details.summary : undefined}
            onClick={() => {
              setDetailsOpen((value) => !value);
              setDetailsSeen(true);
            }}
          >
            {DIGEST_ALL_DETAILS}
            <UiIcon name="chevron" size={12} />
          </button>
          {digest.details.any ? (
            // What "All details" holds, as the model names it: the button's description,
            // not more words on the first screen.
            <span className="sr-only" id={`${id}-details-holds`}>
              {digest.details.summary}
            </span>
          ) : null}
        </div>
        <div id={`${id}-details`} className="cdg-details" hidden={!detailsOpen}>
          {detailsSeen ? (
            <>
              {details}
              {loose.length > 0 ? (
                // Outside an attribute's own view, a request keeps all it says: what
                // kind of ask it is, for which attributes, what is missing, why it
                // matters, and what else would do.
                <AskBox asks={loose} digest={digest} ticks={ticks} full />
              ) : null}
              {digest.asksMore !== "" ? (
                <p className="cdg-quiet-note">{digest.asksMore}</p>
              ) : null}
            </>
          ) : null}
        </div>
        {ask !== null || accept !== null ? (
          <div
            className={`cdg-foot${noteOpen || caution.length > 110 ? " is-open" : ""}`}
          >
            <p className="cdg-foot-note">
              {warning === "" ? (
                DIGEST_NOTHING_SENT
              ) : (
                <>
                  <span id={`${id}-note`}>
                    {noteOpen && favour !== "" ? `${favour} ` : ""}
                    {caution}
                  </span>
                  {favour !== "" ? (
                    <>
                      {" "}
                      <button
                        type="button"
                        className="cdg-link"
                        aria-expanded={noteOpen}
                        aria-controls={`${id}-note`}
                        onClick={() => setNoteOpen((value) => !value)}
                      >
                        {noteOpen ? "less" : "more"}
                        <span className="sr-only"> about accepting</span>
                      </button>
                    </>
                  ) : null}
                </>
              )}
            </p>
            {/* What Accept is described by: the whole note, with nothing of the "more"
                control in it. */}
            <span id={`${id}-accepting`} hidden>
              {warning === "" ? DIGEST_NOTHING_SENT : warning}
            </span>
            <div className="cdg-foot-acts">
              {hints.length > 0 ? (
                <span className="cdg-foot-hint">
                  {hints.map((part, at) => (
                    <span key={part} id={hintId(part)}>
                      {at > 0 ? " " : ""}
                      {part}
                    </span>
                  ))}
                </span>
              ) : null}
              {asking !== null ? (
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={askOff !== null}
                  aria-describedby={askDescribed}
                  onClick={() => asking.onAsk(text)}
                >
                  {digestAskFor(wanted)}
                </button>
              ) : null}
              {accept !== null ? (
                <button
                  type="button"
                  className="btn"
                  disabled={accept.off !== null}
                  aria-describedby={
                    acceptSays !== ""
                      ? `${id}-accepting ${hintId(acceptSays)}`
                      : `${id}-accepting`
                  }
                  onClick={accept.onAccept}
                >
                  {accept.busy ? "Accepting…" : DIGEST_ACCEPT}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
      {visited.length > 0 ? (
        <div className="cdg-one" hidden={current === null}>
          <div className="cdg-step">
            <button type="button" className="cdg-link cdg-back" onClick={back}>
              <UiIcon name="back" size={13} />
              {DIGEST_SUMMARY}
            </button>
            <span className="cdg-step-title" title={title}>
              {title}
            </span>
            <span className="cdg-step-place">
              {digestPlace(at + 1, digest.steps.length)}
            </span>
            <button
              type="button"
              className="cdg-step-nav is-previous"
              aria-label="Previous attribute"
              disabled={previous === undefined}
              onClick={() => previous !== undefined && show(previous)}
            >
              <UiIcon name="chevron" size={14} />
            </button>
            <button
              type="button"
              className="cdg-step-nav"
              aria-label="Next attribute"
              disabled={next === undefined}
              onClick={() => next !== undefined && show(next)}
            >
              <UiIcon name="chevron" size={14} />
            </button>
          </div>
          {visited.map((key) => {
            const row = rowOf(key);
            return row === undefined ? null : (
              <Attribute
                key={key}
                row={row}
                digest={digest}
                files={files}
                ticks={ticks}
                hidden={key !== current}
                headingRef={(element) => {
                  if (element === null) {
                    headings.current.delete(key);
                  } else {
                    headings.current.set(key, element);
                  }
                }}
                passage={passage}
                onEvidence={onEvidence}
                finding={finding}
                tickmark={tickmark}
                addEvidence={addEvidence}
                read={read}
              />
            );
          })}
          <div className="cdg-foot is-step">
            <button
              type="button"
              className="btn btn-ghost"
              disabled={previous === undefined}
              onClick={() => previous !== undefined && show(previous)}
            >
              {DIGEST_PREVIOUS}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => (next !== undefined ? show(next) : back())}
            >
              {next !== undefined
                ? digestNext(rowOf(next)?.letter ?? "")
                : DIGEST_BACK}
              {next !== undefined ? <UiIcon name="arrow" size={14} /> : null}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
