"use client";

import { useRouter } from "next/navigation";
import {
  type CSSProperties,
  type DragEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { EVIDENCE_KIND_LABELS, EVIDENCE_KINDS } from "./analysis-model";
import {
  type AssuredRequest,
  assuranceProblem,
  FOLLOW_UP_TITLE,
  type Lettered,
  REVIEW_TITLE,
} from "./evidence-assurance-model";
import { FileChanges } from "./evidence-change";
import { type Picked, walk } from "./evidence-intake";
import { planUploads, systemsAnswer } from "./evidence-model";
import { usePlanAction } from "./evidence-plan-view";
import { PreviewButton } from "./evidence-preview";
import {
  addressesLine,
  analyzeLabel,
  announcement,
  apartTitle,
  askedAgain,
  attributesTitle,
  type BatchState,
  type BatchSummary,
  batchToShow,
  type Choice,
  type Destination,
  elapsedSeconds,
  estimateText,
  type FileLine,
  type FileMark,
  fileLines,
  fileMark,
  fileMeta,
  filesApart,
  finishedAt,
  finishedNote,
  formatElapsed,
  hintKey,
  type ItemCard,
  type ItemResult,
  itemCards,
  itemResults,
  type Lane,
  leftWithout,
  type NeedsFix,
  OUT,
  OUT_LABEL,
  type Progress,
  parseBatch,
  parseBatchFile,
  parseBatchList,
  placementProblem,
  plural,
  pollDelay,
  progressLine,
  progressOf,
  type Queued,
  queueHead,
  readHint,
  readingProblem,
  resultsNote,
  resultsSummary,
  retryDelay,
  type StageLine,
  serverClock,
  steadySeconds,
  UNREACHABLE,
  UNREACHABLE_AFTER,
  type Upload,
  uploadAnswer,
  type WizardContext,
  type WizardItem,
  windowHeading,
  withoutRepeats,
  writeHint,
} from "./evidence-wizard-model";
import { RowMenu, type RowMenuItem } from "./row-menu";
import { type IconName, UiIcon } from "./ui-icon";

type Ids = {
  organizationId: string;
  projectId: string;
  controlId: string;
  step?: string | null;
};

/** Files sent at once, as the evidence intake sends them. */
const AT_ONCE = 3;

/** One wizard session: its batch, the item it was opened on, whether this browser
 * started it, and when (this browser's clock, until the server records the batch). */
type Session = {
  batchId: string;
  requirementId: string | null;
  mine: boolean;
  startedAt: number | null;
  /** Which systems a policy applies to, as the person said: sent again on a retry. */
  applications: string | null;
};

/** Step 1's files, before anything is sent. */
type Draft = {
  requirementId: string | null;
  queue: Queued[];
  /** Adding to an open session, from its results. */
  addMore: boolean;
  /** A policy on a control over several systems: which ones it applies to. */
  systems: { all: boolean; ticked: string[] };
};

export type WizardSetup = {
  ids: Ids;
  items: WizardItem[];
  /** The control's approved attributes, with the list's letters. */
  attributes: Lettered[];
  context: WizardContext;
  canAct: boolean;
  /** The control's held files: why one cannot be withdrawn now. */
  held: ReadonlyArray<{ id: string; blocked?: string | null }>;
  /** The control's systems, where a policy may apply to several. */
  applications: ReadonlyArray<{ id: string; name: string }>;
  system: string | null;
  /** Uploads ended: the list reads the plan again before it offers anything else. */
  onUploaded: () => void;
  /** The control's readings of its files (the register's): a file's kind is confirmed,
   * or it is read again, on its reading. */
  analyses: ReadonlyArray<{ id: string; fileId: string; version: number }>;
};

function sessionStore(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** The files a drop carries: folders walked for their files, as the intake does. */
async function droppedFiles(data: DataTransfer): Promise<Picked[]> {
  const picked: Picked[] = [];
  const entries = [...data.items]
    .map((item) => item.webkitGetAsEntry?.() ?? null)
    .filter((entry): entry is FileSystemEntry => entry !== null);
  if (entries.length > 0) {
    for (const entry of entries) {
      await walk(entry, picked);
    }
  } else {
    for (const file of data.files) {
      picked.push({ file, path: file.name });
    }
  }
  return picked;
}

const carriesFiles = (event: DragEvent<HTMLElement>) =>
  [...(event.dataTransfer?.types ?? [])].includes("Files");

/**
 * The D&I evidence wizard's state, kept by the list so it survives the window closing:
 * the session (its batch), step 1's files, this browser's uploads, and the batch as the
 * server last read it. While something is under way the batch is read again (every 2
 * seconds while files are sent, read or sorted, every 5 while items are checked, every
 * 10 for the list's line when the window is closed; a newer read always wins). The
 * session is remembered in sessionStorage as a hint; the server's list of the control's
 * sessions is the record, so another device reopens the same one.
 */
export function useEvidenceWizard(setup: WizardSetup) {
  const { ids } = setup;
  const router = useRouter();
  const judge = usePlanAction(ids);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [session, setSession] = useState<Session | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [batch, setBatch] = useState<BatchState | null>(null);
  const [receivedAt, setReceivedAt] = useState<number | null>(null);
  // When the shown batch's read set out (see goneFromBatch).
  const [readFrom, setReadFrom] = useState<number | null>(null);
  const [summary, setSummary] = useState<BatchSummary | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [placing, setPlacing] = useState<Record<string, boolean>>({});
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [leftAlone, setLeftAlone] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [previous, setPrevious] = useState<Record<string, AssuredRequest>>({});
  const [accepted, setAccepted] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [accepting, setAccepting] = useState("");
  // The item last accepted: the plan action's refusal is shown on it.
  const [lastAccept, setLastAccept] = useState("");
  const [rerunning, setRerunning] = useState("");
  const [rerunProblem, setRerunProblem] = useState<{
    id: string;
    text: string;
  } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [live, setLive] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [polled, setPolled] = useState(0);
  // Reads in a row that did not reach the server: past three the window says so.
  const [failures, setFailures] = useState(0);
  // Cancel or Escape on Add files with files queued asks first.
  const [confirmDrop, setConfirmDrop] = useState(false);
  // A file whose kind is being confirmed, or which is being read again.
  const [fixing, setFixing] = useState("");
  // The window was open when the page was lost: it opens again once the batch is read.
  const [reopenOnRead, setReopenOnRead] = useState(false);
  const shownSeconds = useRef<{ batchId: string; seconds: number } | null>(
    null,
  );
  // The hint is written only once the arrival's own reading of it is done.
  const [ready, setReady] = useState(false);
  const files = useRef(new Map<string, File>());
  const keys = useRef(0);
  const seq = useRef(0);
  const sent = useRef(uploads);
  sent.current = uploads;

  const items = useMemo(
    () =>
      setup.items.map((item) =>
        accepted.has(item.requirementId) ? { ...item, accepted: true } : item,
      ),
    [setup.items, accepted],
  );
  const clock = serverClock(batch?.serverNow ?? null, receivedAt, now);
  const progress = useMemo(
    () => progressOf(uploads, batch, clock, readFrom),
    [uploads, batch, clock, readFrom],
  );
  const known = batch !== null || uploads.length > 0;
  // The list of sessions speaks only for the session it named.
  const listed =
    summary !== null && summary.batchId === session?.batchId ? summary : null;

  /** Reads the batch; an answer older than the latest read or move is dropped. */
  const read = useCallback(
    async (batchId: string): Promise<number> => {
      seq.current += 1;
      const mine = seq.current;
      // When this read set out: a file stored after it is not yet in its answer.
      const started = Date.now();
      const query = new URLSearchParams({
        organization: ids.organizationId,
        project: ids.projectId,
        control: ids.controlId,
        batch: batchId,
      });
      let status = 0;
      let result: unknown = null;
      try {
        const response = await fetch(`/workspace/evidence-batches?${query}`, {
          cache: "no-store",
        });
        const body = (await response.json()) as {
          status?: unknown;
          result?: unknown;
        };
        status = typeof body.status === "number" ? body.status : 0;
        result = body.result ?? null;
      } catch {
        status = 0;
      }
      setPolled((count) => count + 1);
      // Not reached (no answer, or the server failed): counted, and read again further
      // apart; any answer from the server resets it.
      setFailures((count) => (status === 0 || status >= 500 ? count + 1 : 0));
      if (mine !== seq.current) {
        return -1;
      }
      if (status === 200) {
        const parsed = parseBatch(result);
        if (parsed !== null && parsed.batchId === batchId) {
          setBatch(parsed);
          setReceivedAt(Date.now());
          setReadFrom(started);
          setNow(Date.now());
        }
      }
      return status;
    },
    [ids.organizationId, ids.projectId, ids.controlId],
  );

  // On arrival: the control's latest session still under way (or whose files still need
  // a person), from any device; an older server without that list, this tab's hint.
  useEffect(() => {
    let hint = null;
    try {
      hint = readHint(sessionStore()?.getItem(hintKey(ids.controlId)) ?? null);
    } catch {
      hint = null;
    }
    if (hint !== null) {
      setDismissed(hint.dismissed);
    }
    let gone = false;
    void (async () => {
      const query = new URLSearchParams({
        organization: ids.organizationId,
        project: ids.projectId,
        control: ids.controlId,
      });
      let status = 0;
      let result: unknown = null;
      try {
        const response = await fetch(`/workspace/evidence-batches?${query}`, {
          cache: "no-store",
        });
        const body = (await response.json()) as {
          status?: unknown;
          result?: unknown;
        };
        status = typeof body.status === "number" ? body.status : 0;
        result = body.result ?? null;
      } catch {
        status = 0;
      }
      if (gone) {
        return;
      }
      setReady(true);
      const list = status === 200 ? parseBatchList(result) : null;
      const shown =
        list === null
          ? null
          : batchToShow(list, new Set(hint?.dismissed ?? []));
      // The window was open on a session when the page was lost: that session, whatever
      // the list leads with, so the batch is never lost. Otherwise the list's pick, and
      // without the list (an older server) this tab's hint.
      const kept =
        hint !== null && hint.open === true && hint.batchId !== ""
          ? hint
          : null;
      const pick =
        kept !== null
          ? { batchId: kept.batchId, requirementId: kept.requirementId }
          : shown !== null
            ? {
                batchId: shown.batchId,
                requirementId: shown.chosenRequirementId,
              }
            : list === null && hint !== null && hint.batchId !== ""
              ? { batchId: hint.batchId, requirementId: hint.requirementId }
              : null;
      if (pick === null) {
        return;
      }
      if (kept !== null) {
        setReopenOnRead(true);
      }
      setSummary(list?.find((item) => item.batchId === pick.batchId) ?? shown);
      setSession(
        (current) =>
          current ?? {
            batchId: pick.batchId,
            requirementId: pick.requirementId,
            mine: hint?.batchId === pick.batchId,
            startedAt: null,
            applications: null,
          },
      );
    })();
    return () => {
      gone = true;
    };
  }, [ids.organizationId, ids.projectId, ids.controlId]);

  // A session taken up (from the list, or the hint) is read at once; one the server no
  // longer shows, with nothing sent from here, is let go.
  const sessionId = session?.batchId ?? null;
  useEffect(() => {
    if (sessionId === null || batch?.batchId === sessionId) {
      return;
    }
    void read(sessionId).then((status) => {
      if (status === 404 && sent.current.length === 0) {
        setSession((current) =>
          current?.batchId === sessionId ? null : current,
        );
      }
    });
  }, [sessionId, batch?.batchId, read]);

  // The hint follows the session (a hint only: try/catch, the page works without it).
  useEffect(() => {
    if (!ready) {
      return;
    }
    try {
      sessionStore()?.setItem(
        hintKey(ids.controlId),
        writeHint({
          batchId: session?.batchId ?? "",
          requirementId: session?.requirementId ?? null,
          dismissed,
          ...(open && session !== null ? { open: true as const } : {}),
        }),
      );
    } catch {
      // Storage can be unavailable; the server's list still reopens the session.
    }
  }, [ready, session, dismissed, open, ids.controlId]);

  // The window was open when the page was lost: once its batch is read, it opens again
  // where the session got to.
  useEffect(() => {
    if (!reopenOnRead || batch === null || batch.batchId !== sessionId) {
      return;
    }
    setReopenOnRead(false);
    setStep(progress.done ? 3 : 2);
    setOpen(true);
  }, [reopenOnRead, batch, sessionId, progress.done]);

  // Read again while something is under way; never while nothing is.
  // A read that did not reach the server is tried again, further apart each time, even
  // where the last answer said nothing is under way: the batch is never let go.
  const delay =
    session === null
      ? null
      : retryDelay(
          pollDelay({
            open,
            uploading: progress.uploading,
            reading: progress.reading || (!known && batch === null),
            checking: progress.checking,
          }),
          failures,
        );
  const unreachable = failures >= UNREACHABLE_AFTER;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `polled` counts the reads; it re-arms the timer after every one, answered or not, so a failed read never stops the polling.
  useEffect(() => {
    if (sessionId === null || delay === null) {
      return;
    }
    const timer = window.setTimeout(() => void read(sessionId), delay);
    return () => window.clearTimeout(timer);
  }, [sessionId, delay, read, polled]);

  // The elapsed time ticks while something is under way.
  const ticking =
    session !== null &&
    (progress.uploading || progress.reading || progress.checking);
  useEffect(() => {
    if (!ticking) {
      return;
    }
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [ticking]);

  // An item's last reviewed check is kept, so a check run again (a file moved) shows
  // what it found before, marked as such, until the new one ends.
  useEffect(() => {
    const reviewed = (batch?.items ?? []).filter(
      (item) => item.check?.status === "REVIEWED",
    );
    if (reviewed.length === 0) {
      return;
    }
    setPrevious((current) => {
      const next = { ...current };
      for (const item of reviewed) {
        if (item.check !== null) {
          next[item.requirementId] = item.check;
        }
      }
      return next;
    });
  }, [batch]);

  // Once the work ends, the list behind is read again: its rows show the checks.
  const wasDone = useRef(false);
  useEffect(() => {
    if (progress.done && !wasDone.current && known) {
      router.refresh();
    }
    wasDone.current = progress.done;
  }, [progress.done, known, router]);

  // A polite live region: stage changes, at most one every few seconds.
  const said = useRef<Progress | null>(null);
  const waiting = useRef<{ text: string; timer: number } | null>(null);
  const lastSaid = useRef(0);
  const progressKey = [
    progress.secured,
    progress.read,
    progress.sorted,
    progress.needs,
    progress.checked,
    progress.done,
    progress.stages[3]?.state,
  ].join("|");
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key stands for the counts it is made of; the clock alone says nothing new.
  useEffect(() => {
    const message = announcement(said.current, progress);
    said.current = progress;
    if (message === null || !open) {
      return;
    }
    const say = (text: string) => {
      lastSaid.current = Date.now();
      waiting.current = null;
      setLive(text);
    };
    const wait = 3500 - (Date.now() - lastSaid.current);
    if (wait <= 0) {
      say(message);
      return;
    }
    if (waiting.current !== null) {
      window.clearTimeout(waiting.current.timer);
    }
    waiting.current = {
      text: message,
      timer: window.setTimeout(() => say(message), wait),
    };
  }, [progressKey, open]);

  // While files are being sent, leaving the page asks first: they are not stored yet.
  useEffect(() => {
    if (!progress.uploading) {
      return;
    }
    const stay = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", stay);
    return () => window.removeEventListener("beforeunload", stay);
  }, [progress.uploading]);

  const update = (key: string, patch: Partial<Upload>) =>
    setUploads((current) =>
      current.map((item) => (item.key === key ? { ...item, ...patch } : item)),
    );

  /** One file, sent with its progress (bytes sent, then the server's answer). */
  function sendOne(
    upload: Upload,
    target: {
      batchId: string;
      requirementId: string | null;
      applications: string | null;
    },
  ): Promise<void> {
    const file = files.current.get(upload.key);
    if (file === undefined) {
      update(upload.key, uploadAnswer(0, null));
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const query = new URLSearchParams({
        organization: ids.organizationId,
        project: ids.projectId,
        batch: target.batchId,
        name: upload.name,
        path: upload.folder,
        control: ids.controlId,
      });
      if (target.requirementId !== null) {
        query.set("requirement", target.requirementId);
      }
      if (target.applications !== null) {
        query.set("applications", target.applications);
      }
      const request = new XMLHttpRequest();
      let shown = 0;
      request.open("POST", `/workspace/evidence-uploads?${query}`);
      request.setRequestHeader(
        "content-type",
        file.type || "application/octet-stream",
      );
      request.upload.onprogress = (event) => {
        // A few updates a second are enough to show the bytes going.
        if (event.lengthComputable && Date.now() - shown > 150) {
          shown = Date.now();
          update(upload.key, { sent: event.loaded });
        }
      };
      request.onload = () => {
        let body: unknown = null;
        try {
          body = JSON.parse(request.responseText) as unknown;
        } catch {
          body = null;
        }
        update(upload.key, {
          ...uploadAnswer(request.status, body),
          sent: upload.size,
          // A batch read after this that no longer lists the file: it was removed.
          answeredAt: Date.now(),
        });
        resolve();
      };
      const lost = () => {
        update(upload.key, uploadAnswer(0, null));
        resolve();
      };
      request.onerror = lost;
      request.onabort = lost;
      request.ontimeout = lost;
      update(upload.key, { state: "sending", sent: 0, detail: "" });
      request.send(file);
    });
  }

  async function sendAll(
    list: readonly Upload[],
    target: {
      batchId: string;
      requirementId: string | null;
      applications: string | null;
    },
  ) {
    let next = 0;
    const worker = async () => {
      while (next < list.length) {
        const upload = list[next];
        next += 1;
        if (upload !== undefined) {
          await sendOne(upload, target);
        }
      }
    };
    await Promise.all(Array.from({ length: AT_ONCE }, worker));
    // The list behind reads the plan again before it offers anything else.
    setup.onUploaded();
    router.refresh();
    void read(target.batchId);
  }

  const policyItem = (requirementId: string | null) => {
    const item = setup.items.find(
      (each) => each.requirementId === requirementId,
    );
    return (
      item !== undefined &&
      item.shows === "Design" &&
      setup.applications.length > 1
    );
  };

  function addFiles(picked: readonly Picked[]) {
    const plan = planUploads(
      picked.map((entry) => ({ path: entry.path, size: entry.file.size })),
    );
    const added: Queued[] = [
      ...plan.accepted.map((entry) => {
        keys.current += 1;
        const key = `u${keys.current}`;
        const source = picked[entry.index];
        if (source !== undefined) {
          files.current.set(key, source.file);
        }
        return {
          key,
          name: entry.name,
          folder: entry.folder,
          size: entry.size,
          skipped: "",
        };
      }),
      ...plan.skipped.map((entry) => {
        keys.current += 1;
        return {
          key: `u${keys.current}`,
          name: entry.name,
          folder: "",
          size: 0,
          skipped: entry.reason,
        };
      }),
    ];
    setDraft((current) =>
      current === null
        ? current
        : { ...current, queue: withoutRepeats(current.queue, added) },
    );
    setLive(`${plural(plan.accepted.length, "file")} added.`);
  }

  /** Step 1, fresh: for the whole control, or for a row's item, with files dropped. */
  function startNew(requirementId: string | null, picked: Picked[] = []) {
    setDraft({
      requirementId,
      queue: [],
      addMore: false,
      systems: {
        all: true,
        ticked: setup.system !== null ? [setup.system] : [],
      },
    });
    setNote("");
    setStep(1);
    setOpen(true);
    if (picked.length > 0) {
      addFiles(picked);
    }
  }

  /** The session open in this window, where it got to. */
  function reopen() {
    if (session === null) {
      startNew(null);
      return;
    }
    // Where it got to: its results once it is done (as the server last said, or as the
    // list of sessions says when its state is not read yet).
    const finished = known
      ? progress.done
      : listed !== null && !listed.inProgress;
    setDraft(null);
    setStep(finished ? 3 : 2);
    setOpen(true);
    void read(session.batchId);
  }

  function analyze() {
    if (draft === null) {
      return;
    }
    const going = draft.queue.filter((item) => item.skipped === "");
    if (going.length === 0) {
      return;
    }
    const answer =
      draft.requirementId !== null && policyItem(draft.requirementId)
        ? systemsAnswer(draft.systems.all, draft.systems.ticked)
        : null;
    const keep = draft.addMore && session !== null;
    const target: Session =
      keep && session !== null
        ? session
        : {
            batchId: crypto.randomUUID(),
            requirementId: draft.requirementId,
            mine: true,
            startedAt: Date.now(),
            applications: answer,
          };
    const added: Upload[] = going.map((item) => ({
      key: item.key,
      name: item.name,
      folder: item.folder,
      size: item.size,
      sent: 0,
      state: "queued",
      fileId: null,
      detail: "",
    }));
    if (keep) {
      setUploads((current) => [...current, ...added]);
    } else {
      seq.current += 1;
      setUploads(added);
      setBatch(null);
      setReceivedAt(null);
      setSummary(null);
      setPlacing({});
      setProblems({});
      setPrevious({});
      setLeftAlone(new Set());
      setAccepted(new Set());
      setRemoving(null);
      setSession(target);
    }
    setNote("");
    setDraft(null);
    setStep(2);
    setNow(Date.now());
    setLive(`Analyzing ${plural(added.length, "file")}.`);
    void sendAll(added, {
      batchId: target.batchId,
      requirementId: target.requirementId,
      applications: answer,
    });
  }

  function retry(key: string) {
    const upload = uploads.find((item) => item.key === key);
    if (session === null || upload === undefined) {
      return;
    }
    void sendAll([upload], {
      batchId: session.batchId,
      requirementId: session.requirementId,
      applications: session.applications,
    });
  }

  /** A person places a file: on an item, or out of D&I. Shown only once the server
   * confirms it; a refusal is its sentence on the file, and the batch is read again. */
  async function place(line: FileLine, choice: string) {
    if (session === null || line.file === null || placing[line.file.fileId]) {
      return;
    }
    const fileId = line.file.fileId;
    setPlacing((current) => ({ ...current, [fileId]: true }));
    setProblems((current) => {
      const next = { ...current };
      delete next[fileId];
      return next;
    });
    let status = 0;
    let detail = "";
    let result: unknown = null;
    try {
      const response = await fetch("/workspace/evidence-batches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organization_id: ids.organizationId,
          project_id: ids.projectId,
          control_id: ids.controlId,
          batch_id: session.batchId,
          file_id: fileId,
          requirement_ids: choice === OUT ? [] : [choice],
          version: line.version,
        }),
      });
      const body = (await response.json()) as {
        status?: unknown;
        detail?: unknown;
        result?: unknown;
      };
      status = typeof body.status === "number" ? body.status : 0;
      detail = typeof body.detail === "string" ? body.detail : "";
      result = body.result ?? null;
    } catch {
      status = 0;
    }
    // Any read already on its way is older than this move.
    seq.current += 1;
    setPlacing((current) => {
      const next = { ...current };
      delete next[fileId];
      return next;
    });
    const problem = placementProblem(status, detail);
    if (problem !== null) {
      setProblems((current) => ({ ...current, [fileId]: problem }));
      void read(session.batchId);
      return;
    }
    const entry = parseBatchFile(result);
    if (entry !== null) {
      setBatch((current) =>
        current === null
          ? current
          : {
              ...current,
              files: current.files.map((file) =>
                file.fileId === entry.fileId ? entry : file,
              ),
            },
      );
    }
    const title =
      setup.items.find((item) => item.requirementId === choice)?.title ??
      "the item";
    // An item the move leaves with no evidence is asked for again (the requests follow
    // the evidence): said, as the server does it.
    const emptied = leftWithout(
      fileId,
      line.on,
      choice === OUT ? [] : [choice],
      setup.items,
      batch,
    ).length;
    const said = [
      choice === OUT
        ? `${line.name} is kept in the control’s files.`
        : `${line.name} is now in ${title}. The item is checked again with it.`,
      askedAgain(emptied),
    ]
      .filter((part) => part !== "")
      .join(" ");
    setNote(said);
    setLive(said);
    router.refresh();
    void read(session.batchId);
  }

  /** "Confirm its kind" or "Read it again", where a reason names it: the reading's own
   * actions (the evidence dialog's route), said only once the server confirms them. */
  async function fixReading(
    line: FileLine,
    fix: NeedsFix,
    kind: string | null,
  ) {
    const fileId = line.fileId;
    const analysis =
      fileId === null
        ? undefined
        : setup.analyses.find((each) => each.fileId === fileId);
    if (session === null || fileId === null || fixing !== "") {
      return;
    }
    setProblems((current) => {
      const next = { ...current };
      delete next[fileId];
      return next;
    });
    if (analysis === undefined) {
      setProblems((current) => ({
        ...current,
        [fileId]: readingProblem(422) ?? "",
      }));
      router.refresh();
      return;
    }
    setFixing(fileId);
    let status = 0;
    let detail = "";
    try {
      const response = await fetch("/workspace/evidence-dialog", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organization_id: ids.organizationId,
          project_id: ids.projectId,
          intent: fix === "reread" ? "reanalyze" : "confirm-kind",
          analysis_id: analysis.id,
          version: analysis.version,
          ...(fix === "confirm-kind" ? { kind } : {}),
        }),
      });
      const body = (await response.json()) as {
        status?: unknown;
        detail?: unknown;
      };
      status = typeof body.status === "number" ? body.status : 0;
      detail = typeof body.detail === "string" ? body.detail : "";
    } catch {
      status = 0;
    }
    setFixing("");
    const problem = readingProblem(status, detail);
    if (problem !== null) {
      setProblems((current) => ({ ...current, [fileId]: problem }));
    } else {
      const said =
        fix === "reread"
          ? `${line.name} is being read again.`
          : `${line.name}: its kind is confirmed.`;
      setNote(said);
      setLive(said);
    }
    router.refresh();
    void read(session.batchId);
  }

  /** Accept an item's evidence: the list's own judgement, at the item's version; said
   * only once the server confirms it. */
  async function accept(item: WizardItem) {
    if (accepting !== "") {
      return;
    }
    setAccepting(item.requirementId);
    setLastAccept(item.requirementId);
    const ok = await judge.run(`judge-${item.requirementId}`, {
      intent: "sufficiency",
      requirement_id: item.requirementId,
      sufficiency: "ACCEPTED",
      version: item.version,
    });
    setAccepting("");
    if (ok) {
      setAccepted((current) => new Set(current).add(item.requirementId));
      setNote(`Evidence accepted for ${item.title}.`);
      setLive(`Evidence accepted for ${item.title}.`);
    }
  }

  // The plan action's refusal, in its words, shown on the item it was for.
  const acceptProblem =
    judge.problem !== null && accepting === "" && lastAccept !== ""
      ? { id: lastAccept, text: judge.problem }
      : null;

  /** "Check again" or "Check now": the list's own run, through its route. */
  async function rerun(requirementId: string) {
    if (rerunning !== "" || session === null) {
      return;
    }
    setRerunning(requirementId);
    setRerunProblem(null);
    let status = 0;
    let detail = "";
    try {
      const response = await fetch("/workspace/evidence-assurance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organization_id: ids.organizationId,
          project_id: ids.projectId,
          control_id: ids.controlId,
          intent: "rerun",
          requirement_id: requirementId,
        }),
      });
      const body = (await response.json()) as {
        status?: unknown;
        detail?: unknown;
      };
      status = typeof body.status === "number" ? body.status : 0;
      detail = typeof body.detail === "string" ? body.detail : "";
    } catch {
      status = 0;
    }
    setRerunning("");
    const problem = assuranceProblem(status, detail);
    if (problem !== null) {
      setRerunProblem({ id: requirementId, text: problem });
    } else {
      setNote("The check was started again.");
    }
    router.refresh();
    void read(session.batchId);
  }

  /** Files queued on Add files and not sent yet: closing would drop them. */
  const queued =
    step === 1 && draft !== null
      ? draft.queue.filter((item) => item.skipped === "").length
      : 0;

  /** Cancel, Close and Escape: with files queued on Add files, the window asks first. */
  function requestClose() {
    if (queued > 0 && !confirmDrop) {
      setConfirmDrop(true);
      setLive(
        `${plural(queued, "file")} queued and not sent. Drop them, or keep them?`,
      );
      return;
    }
    close();
  }

  function close() {
    setConfirmDrop(false);
    setOpen(false);
    setRemoving(null);
    if (session === null || draft !== null) {
      // Files queued and never sent are let go.
      for (const key of [...files.current.keys()]) {
        if (!uploads.some((item) => item.key === key)) {
          files.current.delete(key);
        }
      }
      setDraft(null);
    }
  }

  /** Done: the window closes and the session is put away; its results are on the list. */
  function done() {
    const id = session?.batchId;
    if (id !== undefined) {
      setDismissed((current) => [...current.filter((each) => each !== id), id]);
    }
    seq.current += 1;
    setOpen(false);
    setSession(null);
    setBatch(null);
    setUploads([]);
    setSummary(null);
    setDraft(null);
    setRemoving(null);
    files.current.clear();
  }

  // Never backwards: a newer answer that moves the clock offset back keeps the time
  // already shown (steadySeconds), until the session is done.
  const counted = elapsedSeconds({
    createdAt: batch?.createdAt ?? listed?.createdAt ?? null,
    now: clock,
    done: progress.done,
    finished: finishedAt(batch),
    startedAt: session?.startedAt ?? null,
  });
  const before =
    shownSeconds.current !== null &&
    shownSeconds.current.batchId === session?.batchId
      ? shownSeconds.current.seconds
      : null;
  const seconds = steadySeconds(before, counted, progress.done);
  shownSeconds.current =
    session === null ? null : { batchId: session.batchId, seconds };

  const offline = unreachable ? ` · ${UNREACHABLE}` : "";
  const shown =
    open || session === null
      ? null
      : progressLine({
          progress: known ? progress : null,
          summary: listed,
          seconds,
        });
  const line =
    shown === null ? null : { ...shown, text: `${shown.text}${offline}` };

  return {
    open,
    step,
    session,
    draft,
    uploads,
    batch,
    clock,
    progress,
    seconds,
    items,
    placing,
    problems,
    leftAlone,
    previous,
    accepting,
    acceptProblem,
    rerunning,
    rerunProblem,
    removing,
    note,
    live,
    line,
    setup,
    unreachable,
    readFrom,
    queued,
    confirmDrop,
    fixing,
    startNew,
    reopen,
    requestClose,
    keepQueued: () => setConfirmDrop(false),
    fixReading: (fileLine: FileLine, fix: NeedsFix, kind: string | null) =>
      void fixReading(fileLine, fix, kind),
    /** "Upload evidence": this browser's open session where there is one, else a new
     * one. Another person's session is reopened from the list's line. */
    openFromList: () => {
      if (session?.mine === true) {
        reopen();
      } else {
        startNew(null);
      }
    },
    close,
    done,
    analyze,
    addFiles,
    retry,
    place: (fileLine: FileLine, choice: string) => void place(fileLine, choice),
    accept: (item: WizardItem) => void accept(item),
    rerun: (requirementId: string) => void rerun(requirementId),
    leave: (fileId: string) =>
      setLeftAlone((current) => new Set(current).add(fileId)),
    unqueue: (key: string) => {
      files.current.delete(key);
      setDraft((current) =>
        current === null
          ? current
          : {
              ...current,
              queue: current.queue.filter((item) => item.key !== key),
            },
      );
    },
    clearQueue: () =>
      setDraft((current) => {
        for (const item of current?.queue ?? []) {
          files.current.delete(item.key);
        }
        return current === null ? current : { ...current, queue: [] };
      }),
    systems: (next: { all: boolean; ticked: string[] }) =>
      setDraft((current) =>
        current === null ? current : { ...current, systems: next },
      ),
    seeResults: () => setStep(3),
    keepWorking: () => setOpen(false),
    addMore: () => {
      setDraft({
        requirementId: session?.requirementId ?? null,
        queue: [],
        addMore: true,
        systems: {
          all: true,
          ticked: setup.system !== null ? [setup.system] : [],
        },
      });
      setNote("");
      setStep(1);
    },
    backToResults: () => {
      setDraft(null);
      setStep(3);
    },
    remove: (fileId: string | null) => setRemoving(fileId),
    removed: (name: string) => {
      setRemoving(null);
      const said = `${name} was removed from this upload. Its custody record stays, and it can be restored from the control’s files.`;
      setNote(said);
      setLive(said);
      if (session !== null) {
        void read(session.batchId);
      }
    },
    policyItem,
  };
}

export type Wizard = ReturnType<typeof useEvidenceWizard>;

// ---------------------------------------------------------------------------------------
// The window
// ---------------------------------------------------------------------------------------

/** The window, opened with showModal() as the Review and send window is: fixed in size,
 * its panes scrolling on their own, the footer always on screen. Escape closes it, unless
 * a menu, the file viewer or a letter's wording is open inside it: that closes first. */
export function EvidenceWizard({ wizard }: { wizard: Wizard }) {
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [box, setBox] = useState<HTMLDialogElement | null>(null);
  const { open } = wizard;

  useEffect(() => {
    const node = dialog.current;
    if (node === null) {
      return;
    }
    if (!open) {
      if (node.open) node.close();
    } else if (!node.open) {
      node.showModal();
      // The window itself takes the focus, as the prototype's does; Tab then reaches its
      // first control. Closing returns the focus to what opened it.
      node.querySelector<HTMLElement>(".wz")?.focus({ preventScroll: true });
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      const inside = dialog.current?.querySelector(
        ".row-menu.is-open, .preview-backdrop, .wz-tip.is-pinned",
      );
      if (inside !== null && inside !== undefined) {
        // Caught first: what is open inside closes on its own; the window stays.
        event.preventDefault();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open]);

  return (
    <dialog
      ref={(node) => {
        dialog.current = node;
        setBox(node);
      }}
      className="confirm-dialog cs-dialog wz-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        if (
          dialog.current?.querySelector(
            ".row-menu.is-open, .preview-backdrop",
          ) != null
        ) {
          event.preventDefault();
          return;
        }
        // Files queued on Add files are never dropped by Escape alone: it asks, and a
        // second Escape keeps them.
        if (wizard.queued > 0) {
          event.preventDefault();
          if (wizard.confirmDrop) {
            wizard.keepQueued();
          } else {
            wizard.requestClose();
          }
        }
      }}
      onClose={() => {
        if (wizard.open) {
          wizard.close();
        }
      }}
    >
      {open ? (
        <WizardWindow
          titleId={titleId}
          wizard={wizard}
          container={box}
          view={windowView(wizard)}
        />
      ) : null}
      <p className="sr-only" aria-live="polite">
        {wizard.live}
      </p>
    </dialog>
  );
}

/** Everything a step shows, from the wizard's state: pure, so the window renders the
 * same from a fixture as from the server. */
export type WindowView = {
  step: 1 | 2 | 3;
  heading: ReturnType<typeof windowHeading>;
  draft: Draft | null;
  progress: Progress;
  seconds: number;
  lines: FileLine[];
  cards: ItemCard[];
  results: ItemResult[];
  summary: ReturnType<typeof resultsSummary>;
  apart: FileLine[];
  items: WizardItem[];
  attributes: Lettered[];
  batch: BatchState | null;
  canAct: boolean;
  placing: Record<string, boolean>;
  problems: Record<string, string>;
  removing: string | null;
  accepting: string;
  acceptProblem: { id: string; text: string } | null;
  rerunning: string;
  rerunProblem: { id: string; text: string } | null;
  note: string;
  ids: Ids;
  held: ReadonlyArray<{ id: string; blocked?: string | null }>;
  applications: ReadonlyArray<{ id: string; name: string }>;
  policy: boolean;
  /** Three reads in a row did not reach the server: the window says so. */
  unreachable: boolean;
  /** Files queued on Add files, and whether closing asks before dropping them. */
  queued: number;
  confirmDrop: boolean;
  /** The file whose reading is being confirmed or read again. */
  fixing: string;
};

export function windowView(wizard: Wizard): WindowView {
  const { setup, batch, clock, progress, items } = wizard;
  const lines = fileLines(wizard.uploads, batch, {
    items,
    chosenRequirementId:
      batch?.chosenRequirementId ?? wizard.session?.requirementId ?? null,
    mine: wizard.session?.mine ?? false,
    now: clock,
    leftAlone: wizard.leftAlone,
    readAt: wizard.readFrom,
  });
  const results = itemResults(batch, {
    items,
    attributes: setup.attributes,
    now: clock,
    previous: wizard.previous,
  });
  return {
    step: wizard.step,
    heading: windowHeading(setup.context),
    draft: wizard.draft,
    progress,
    seconds: wizard.seconds,
    lines,
    cards: itemCards(batch, {
      items,
      attributes: setup.attributes,
      now: clock,
    }),
    results,
    summary: resultsSummary(batch, results, progress),
    apart: filesApart(lines),
    items,
    attributes: setup.attributes,
    batch,
    canAct: setup.canAct,
    placing: wizard.placing,
    problems: wizard.problems,
    removing: wizard.removing,
    accepting: wizard.accepting,
    acceptProblem: wizard.acceptProblem,
    rerunning: wizard.rerunning,
    rerunProblem: wizard.rerunProblem,
    note: wizard.note,
    ids: setup.ids,
    held: setup.held,
    applications: setup.applications,
    policy:
      wizard.draft !== null && wizard.policyItem(wizard.draft.requirementId),
    unreachable: wizard.unreachable,
    queued: wizard.queued,
    confirmDrop: wizard.confirmDrop,
    fixing: wizard.fixing,
  };
}

/** What the window's buttons do. */
export type WindowActions = Pick<
  Wizard,
  | "close"
  | "requestClose"
  | "keepQueued"
  | "fixReading"
  | "done"
  | "analyze"
  | "addFiles"
  | "retry"
  | "place"
  | "accept"
  | "rerun"
  | "leave"
  | "unqueue"
  | "clearQueue"
  | "systems"
  | "seeResults"
  | "keepWorking"
  | "addMore"
  | "backToResults"
  | "remove"
  | "removed"
>;

const STEPS = ["Add files", "Analyze", "Results"] as const;

export function WizardWindow({
  titleId,
  wizard,
  view,
  container,
}: {
  titleId: string;
  wizard: WindowActions;
  view: WindowView;
  container: HTMLElement | null;
}) {
  const { step } = view;
  const root = useRef<HTMLDivElement>(null);
  // A new step: the button that moved it is gone, so the window takes the focus.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the step is what changes; the focus moves when it does.
  useEffect(() => {
    if (!root.current?.contains(document.activeElement)) {
      root.current?.focus({ preventScroll: true });
    }
  }, [step]);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: files dropped on the window go to its drop zone on Add files; elsewhere a drop is only kept from opening the file in the browser.
    <div
      ref={root}
      className="wz"
      data-step={step}
      tabIndex={-1}
      onDragOver={(event) => {
        // The window's own: the list it sits on never takes these files.
        event.stopPropagation();
        if (carriesFiles(event)) {
          event.preventDefault();
        }
      }}
      onDrop={(event) => {
        event.stopPropagation();
        if (!carriesFiles(event)) {
          return;
        }
        event.preventDefault();
        if (step === 1) {
          void droppedFiles(event.dataTransfer).then(wizard.addFiles);
        }
      }}
    >
      <header className="wz-head">
        <span
          className={`wz-icon${step === 2 ? " is-working" : step === 3 ? " is-results" : ""}`}
          aria-hidden="true"
        >
          <UiIcon
            name={
              step === 1 ? "cloudUpload" : step === 2 ? "sparkles" : "listCheck"
            }
            size={21}
          />
        </span>
        <div className="wz-titles">
          <p className="wz-kicker">D&amp;I evidence</p>
          <h2 className="wz-title" id={titleId}>
            {view.heading.title}
          </h2>
          {view.heading.sub !== "" ? (
            <p className="wz-sub">{view.heading.sub}</p>
          ) : null}
        </div>
        <ol className="wz-steps" aria-label="Steps">
          {STEPS.map((name, at) => {
            const number = at + 1;
            const state =
              number === step ? "is-current" : number < step ? "is-done" : "";
            return [
              at > 0 ? (
                <li
                  key={`sep-${name}`}
                  className={`wz-step-sep${number <= step ? " is-done" : ""}`}
                  aria-hidden="true"
                />
              ) : null,
              <li
                key={name}
                className={`wz-step ${state}`}
                aria-current={number === step ? "step" : undefined}
              >
                <span className="wz-step-mark" aria-hidden="true">
                  <span>{number}</span>
                  <UiIcon name="check" size={12} />
                </span>
                {name}
                <span className="sr-only">
                  {number === step
                    ? ", current step"
                    : number < step
                      ? ", done"
                      : ""}
                </span>
              </li>,
            ];
          })}
        </ol>
        <button
          type="button"
          className="btn btn-ghost wz-close"
          aria-label="Close"
          onClick={wizard.requestClose}
        >
          <UiIcon name="x" size={17} />
        </button>
      </header>
      <div className="wz-body">
        {step === 1 ? (
          <AddFiles view={view} wizard={wizard} />
        ) : step === 2 ? (
          <Analyze view={view} wizard={wizard} />
        ) : (
          <Results view={view} wizard={wizard} container={container} />
        )}
      </div>
      <Footer view={view} wizard={wizard} />
    </div>
  );
}

function Footer({ view, wizard }: { view: WindowView; wizard: WindowActions }) {
  const note = (icon: IconName, text: string, done = false) => (
    <p className={`wz-note${done ? " is-done" : ""}`}>
      <UiIcon name={icon} size={15} />
      <span>{text}</span>
    </p>
  );
  // Three reads in a row did not reach the server: said, while it keeps trying.
  const offline = (
    <p className="wz-note is-warning" role="status">
      <UiIcon name="retry" size={15} />
      <span>{UNREACHABLE}</span>
    </p>
  );
  if (view.step === 1 && view.confirmDrop) {
    // Cancel, Close or Escape with files queued: asked before they are dropped.
    return (
      <footer className="wz-foot is-asking">
        <p className="wz-note is-warning" role="alert">
          <UiIcon name="info" size={15} />
          <span>
            {`Drop the ${plural(view.queued, "file")} queued? ${view.queued === 1 ? "It has" : "They have"} not been sent.`}
          </span>
        </p>
        <div className="wz-acts">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={wizard.keepQueued}
          >
            Keep {view.queued === 1 ? "it" : "them"}
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={wizard.close}
          >
            Drop {view.queued === 1 ? "it" : "them"}
          </button>
        </div>
      </footer>
    );
  }
  if (view.step === 1) {
    const action = analyzeLabel(view.draft?.queue ?? []);
    const systems = view.draft?.systems;
    const answered =
      !view.policy ||
      systems === undefined ||
      systemsAnswer(systems.all, systems.ticked) !== null;
    return (
      <footer className="wz-foot">
        {note(
          "lock",
          "Files are kept with a custody record. Nothing is sent to the organization.",
        )}
        <div className="wz-acts">
          {view.draft?.addMore === true ? (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={wizard.backToResults}
            >
              Back to results
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={wizard.requestClose}
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            className="btn"
            disabled={!action.ready || !answered}
            onClick={wizard.analyze}
          >
            {action.label}
            {action.ready ? <UiIcon name="arrow" size={14} /> : null}
          </button>
        </div>
      </footer>
    );
  }
  if (view.step === 2) {
    const done = view.progress.done;
    return (
      <footer className="wz-foot">
        {view.unreachable
          ? offline
          : done
            ? note(
                "checkCircle",
                finishedNote(view.seconds, view.progress),
                true,
              )
            : note(
                "info",
                "You can close this window. The results appear on the list when they are ready.",
              )}
        <div className="wz-acts">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={wizard.keepWorking}
          >
            Keep working
          </button>
          <button
            type="button"
            className="btn"
            disabled={!done}
            onClick={wizard.seeResults}
          >
            See results
            <UiIcon name="arrow" size={14} />
          </button>
        </div>
      </footer>
    );
  }
  return (
    <footer className="wz-foot">
      {view.unreachable
        ? offline
        : note("listCheck", resultsNote(view.progress))}
      <div className="wz-acts">
        {view.canAct ? (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={wizard.addMore}
          >
            <UiIcon name="upload" size={14} />
            Add more files
          </button>
        ) : null}
        <button type="button" className="btn" onClick={wizard.done}>
          Done
        </button>
      </div>
    </footer>
  );
}

function Dots() {
  return (
    <span className="ep-dots wz-dots" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

function Mark({ mark, className }: { mark: FileMark; className?: string }) {
  return (
    <span
      className={`wz-fm is-${mark.mark}${className ? ` ${className}` : ""}`}
      aria-hidden="true"
    >
      <span className="wz-fm-label">{mark.label}</span>
    </span>
  );
}

/** The attributes' letters: each shows its wording on hover or focus, and stays on a
 * click; the arrow keys move between them, and Escape puts the wording away. */
function Letters({
  letters,
  wording,
  label,
}: {
  letters: readonly string[];
  wording: ReadonlyMap<string, string>;
  label: string;
}) {
  const id = useId();
  const [shown, setShown] = useState<{
    letter: string;
    pinned: boolean;
    at: { left: number; top: number };
  } | null>(null);
  const [focus, setFocus] = useState(0);
  const group = useRef<HTMLFieldSetElement>(null);
  const show = (letter: string, target: HTMLElement, pinned: boolean) => {
    const rect = target.getBoundingClientRect();
    setShown({
      letter,
      pinned,
      at: {
        left: Math.max(12, Math.min(rect.left - 8, window.innerWidth - 316)),
        top: rect.bottom + 8,
      },
    });
  };
  const hide = (force = false) =>
    setShown((current) =>
      current === null || (current.pinned && !force) ? current : null,
    );
  return (
    <fieldset
      ref={group}
      className="wz-letters is-group"
      onKeyDown={(event) => {
        const at = letters.indexOf(shown?.letter ?? letters[focus] ?? "");
        const move =
          event.key === "ArrowRight"
            ? 1
            : event.key === "ArrowLeft"
              ? -1
              : event.key === "Home"
                ? -at
                : event.key === "End"
                  ? letters.length - 1 - at
                  : null;
        if (event.key === "Escape" && shown !== null) {
          event.preventDefault();
          event.stopPropagation();
          setShown(null);
          return;
        }
        if (move === null) {
          return;
        }
        event.preventDefault();
        const next = (Math.max(0, at) + move + letters.length) % letters.length;
        setFocus(next);
        group.current
          ?.querySelectorAll<HTMLButtonElement>("button")
          [next]?.focus();
      }}
    >
      <legend className="sr-only">{label}</legend>
      {letters.map((letter, at) => (
        <button
          key={letter}
          type="button"
          className={`wz-code${shown?.letter === letter ? " is-on" : ""}`}
          aria-label={`Attribute ${letter}`}
          aria-describedby={shown?.letter === letter ? `${id}-tip` : undefined}
          tabIndex={at === focus ? 0 : -1}
          onPointerEnter={(event) => show(letter, event.currentTarget, false)}
          onPointerLeave={() => hide()}
          onFocus={(event) => {
            setFocus(at);
            show(letter, event.currentTarget, false);
          }}
          onBlur={() => hide(true)}
          onClick={(event) => {
            if (shown?.letter === letter && shown.pinned) {
              setShown(null);
            } else {
              show(letter, event.currentTarget, true);
            }
          }}
        >
          {letter}
        </button>
      ))}
      {shown !== null ? (
        <span
          id={`${id}-tip`}
          role="tooltip"
          className={`wz-tip${shown.pinned ? " is-pinned" : ""}`}
          style={{ left: shown.at.left, top: shown.at.top }}
        >
          <b>Attribute {shown.letter}</b>
          {wording.get(shown.letter) ??
            "Its wording is not on the control now."}
        </span>
      ) : null}
    </fieldset>
  );
}

// ---------------------------------------------------------------------------------------
// Step 1: Add files
// ---------------------------------------------------------------------------------------

function DropZone({
  compact,
  onFiles,
}: {
  compact: boolean;
  onFiles: (picked: Picked[]) => void;
}) {
  const [over, setOver] = useState(false);
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // React has no prop for folder picking; the attribute is standard in every browser.
    folderInput.current?.setAttribute("webkitdirectory", "");
  }, []);
  const fromInput = (input: HTMLInputElement) => {
    const chosen = [...(input.files ?? [])].map((file) => ({
      file,
      path: file.webkitRelativePath || file.name,
    }));
    input.value = "";
    if (chosen.length > 0) {
      onFiles(chosen);
    }
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a drop target for the mouse; "browse your computer" and "Choose a folder" pick files from the keyboard.
    <div
      className={`wz-drop${compact ? " is-compact" : ""}${over ? " is-over" : ""}`}
      onDragOver={(event) => {
        if (carriesFiles(event)) {
          event.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setOver(false);
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setOver(false);
        void droppedFiles(event.dataTransfer).then(onFiles);
      }}
    >
      <span className="wz-drop-icon" aria-hidden="true">
        <UiIcon name="cloudUpload" size={24} />
      </span>
      <div className="wz-drop-text">
        <p className="wz-drop-title">Drop files here</p>
        <p className="wz-drop-sub">
          Several files or a whole folder at once, or{" "}
          <button
            type="button"
            className="wz-link"
            onClick={() => filesInput.current?.click()}
          >
            browse your computer
          </button>
          .
        </p>
        <p className="wz-drop-sub">
          PDF, Word, Excel, CSV, images and scans, up to 25 MB each.
        </p>
        <p className="wz-drop-over">Release to add the files</p>
      </div>
      {/* Files first (product owner, 14 November 2026: Choose a folder alone read as the way
          to pick files, and a folder picker greys out single files such as a PNG). */}
      <div className="wz-drop-acts">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => filesInput.current?.click()}
        >
          <UiIcon name="file" size={13} />
          Choose files
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => folderInput.current?.click()}
        >
          <UiIcon name="folder" size={13} />
          Choose a folder
        </button>
      </div>
      <input
        ref={filesInput}
        type="file"
        multiple
        hidden
        aria-label="Choose evidence files"
        onChange={(event) => fromInput(event.currentTarget)}
      />
      <input
        ref={folderInput}
        type="file"
        multiple
        hidden
        aria-label="Choose an evidence folder"
        onChange={(event) => fromInput(event.currentTarget)}
      />
    </div>
  );
}

function AddFiles({
  view,
  wizard,
}: {
  view: WindowView;
  wizard: WindowActions;
}) {
  const sideId = useId();
  const draft = view.draft;
  const queue = draft?.queue ?? [];
  const target =
    draft?.requirementId === null || draft === null
      ? null
      : (view.items.find(
          (item) => item.requirementId === draft.requirementId,
        ) ?? null);
  const wording = new Map(
    view.attributes.map((item) => [item.letter, item.text]),
  );
  const head = queueHead(queue);
  const list = useRef<HTMLUListElement>(null);
  const unqueue = (key: string) => {
    const at = queue.findIndex((item) => item.key === key);
    const next = queue[at + 1] ?? queue[at - 1];
    wizard.unqueue(key);
    // Focus stays in the list: on the next file's remove, else the drop zone's link.
    window.requestAnimationFrame(() => {
      const button =
        next === undefined
          ? null
          : list.current?.querySelector<HTMLButtonElement>(
              `[data-key="${next.key}"]`,
            );
      (
        button ??
        list.current
          ?.closest(".wz-v1-main")
          ?.querySelector<HTMLButtonElement>(".wz-link")
      )?.focus();
    });
  };
  const open = view.items.filter((item) => item.choosable);
  return (
    <div className="wz-view wz-v1">
      <div className="wz-v1-main">
        {target !== null ? (
          <div className="wz-adding">
            <UiIcon name="target" size={16} />
            <div>
              <strong>Adding to: {target.title}</strong>
              <small>
                The agent will tell you if a file fits another item better.
              </small>
            </div>
          </div>
        ) : null}
        <DropZone compact={queue.length > 0} onFiles={wizard.addFiles} />
        {view.policy && draft !== null ? (
          <fieldset className="wz-systems">
            <legend>
              Which systems{" "}
              {queue.length === 1 ? "does this file" : "do these files"} apply
              to?
            </legend>
            <label>
              <input
                type="radio"
                checked={draft.systems.all}
                onChange={() => wizard.systems({ ...draft.systems, all: true })}
              />
              All systems
            </label>
            <label>
              <input
                type="radio"
                checked={!draft.systems.all}
                onChange={() =>
                  wizard.systems({ ...draft.systems, all: false })
                }
              />
              Only some
            </label>
            {draft.systems.all ? null : (
              <span className="wz-systems-list">
                {view.applications.map((item) => (
                  <label key={item.id}>
                    <input
                      type="checkbox"
                      checked={draft.systems.ticked.includes(item.id)}
                      onChange={(event) => {
                        const on = event.currentTarget.checked;
                        wizard.systems({
                          all: false,
                          ticked: on
                            ? [...draft.systems.ticked, item.id]
                            : draft.systems.ticked.filter(
                                (each) => each !== item.id,
                              ),
                        });
                      }}
                    />
                    {item.name}
                  </label>
                ))}
              </span>
            )}
          </fieldset>
        ) : null}
        <div className="wz-queue">
          {queue.length === 0 ? (
            <p className="wz-q-empty">
              {draft?.addMore === true
                ? "Add the files you have now. A file already held is recognised and shown where it is."
                : "No files yet. Drop them above, or browse your computer."}
            </p>
          ) : (
            <>
              <div className="wz-q-head">
                <h3 className="wz-q-title">{head.title}</h3>
                <span className="wz-q-meta">{head.size}</span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm wz-q-clear"
                  onClick={wizard.clearQueue}
                >
                  Remove all
                </button>
              </div>
              <ul
                ref={list}
                className="wz-q-list"
                aria-label="Files to analyze"
              >
                {queue.map((item, at) => {
                  const mark = fileMark(item.name);
                  return (
                    <li
                      key={item.key}
                      className="wz-q-row"
                      style={{ "--i": at } as CSSProperties}
                    >
                      <Mark mark={mark} />
                      <span className="wz-q-text">
                        <span className="wz-q-name">{item.name}</span>
                        <span
                          className={`wz-q-sub${item.skipped !== "" ? " is-skipped" : ""}`}
                        >
                          {item.skipped !== ""
                            ? `Not added: ${item.skipped}`
                            : fileMeta(mark, item.size)}
                          {item.folder !== "" ? ` · in ${item.folder}` : ""}
                        </span>
                      </span>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm wz-icon-btn"
                        data-key={item.key}
                        aria-label={`Remove ${item.name}`}
                        onClick={() => unqueue(item.key)}
                      >
                        <UiIcon name="x" size={15} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      </div>
      <aside className="wz-v1-side" aria-labelledby={sideId}>
        <h3 className="wz-side-kicker" id={sideId}>
          <UiIcon name="target" size={13} />
          What the agent looks for
        </h3>
        <p className="wz-side-lead">
          The agent sorts each file into one of the control’s D&amp;I items.
          Then two independent readings check the item’s files against its
          attributes.
        </p>
        <div className="wz-side-items">
          {open.length === 0 ? (
            <p className="wz-q-empty">
              No D&amp;I item expects evidence now, so the files stay in the
              control’s files.
            </p>
          ) : (
            open.map((item) => {
              const chosen = item.requirementId === draft?.requirementId;
              return (
                <div
                  key={item.requirementId}
                  className={`wz-it${chosen ? " is-target" : ""}`}
                >
                  <div className="wz-it-head">
                    <span className="dr-tile" aria-hidden="true">
                      <UiIcon name={item.icon} size={16} />
                    </span>
                    <div>
                      <p className="wz-it-title">{item.title}</p>
                      <p className="wz-it-sub">
                        {[item.kind, item.shows]
                          .filter((part) => part !== "")
                          .join(" · ")}
                      </p>
                    </div>
                  </div>
                  <div className="wz-it-foot">
                    {item.letters.length > 0 ? (
                      <Letters
                        letters={item.letters}
                        wording={wording}
                        label={`Attributes it addresses: ${item.letters.join(", ")}. Each letter shows its wording.`}
                      />
                    ) : (
                      <span className="wz-it-sub">No attribute yet</span>
                    )}
                    {chosen ? (
                      <span className="pill tone-info">
                        <UiIcon name="target" size={12} />
                        Adding to this item
                      </span>
                    ) : item.files > 0 ? (
                      <span className="pill tone-neutral">
                        <UiIcon name="file" size={12} />
                        {plural(item.files, "file")}
                      </span>
                    ) : (
                      <span className="pill tone-warning">No file yet</span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
        {view.heading.requested !== null ? (
          <p className="wz-side-req">
            <UiIcon name="mail" size={14} />
            <span>
              Requested from <strong>{view.heading.requested.to}</strong>
              {view.heading.requested.rest !== ""
                ? `, ${view.heading.requested.rest}`
                : ""}
            </span>
          </p>
        ) : null}
        {view.attributes.length > 0 ? (
          <details className="wz-fold">
            <summary>
              {attributesTitle(view.attributes.length)}
              <UiIcon name="chevron" size={14} />
            </summary>
            <ul className="wz-attr-list">
              {view.attributes.map((item) => (
                <li key={item.id}>
                  <span className="dr-code" aria-hidden="true">
                    {item.letter}
                  </span>
                  <span>
                    <span className="sr-only">Attribute {item.letter}: </span>
                    {item.text}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------------------------------
// Step 2: Analyze
// ---------------------------------------------------------------------------------------

const STAGE_ICONS: Record<StageLine["key"], IconName> = {
  secure: "lock",
  read: "eye",
  sort: "tag",
  check: "listCheck",
};
const STAGE_WORDS = { wait: "waiting", active: "under way", done: "done" };
const TRACK = ["Secured", "Read", "Classified", "Sorted"] as const;

function Analyze({
  view,
  wizard,
}: {
  view: WindowView;
  wizard: WindowActions;
}) {
  const filesId = useId();
  const itemsId = useId();
  const { progress } = view;
  return (
    <div className="wz-view wz-v2">
      <div className="wz-pipe">
        <ol className="wz-stages" aria-label="Analysis stages">
          {progress.stages.map((stage) => (
            <li key={stage.key} className={`wz-stage is-${stage.state}`}>
              <span className="wz-stage-mark" aria-hidden="true">
                <span className="wz-stage-ic">
                  <UiIcon name={STAGE_ICONS[stage.key]} size={14} />
                </span>
                <span className="wz-tick">
                  <UiIcon name="check" size={14} />
                </span>
              </span>
              <span className="wz-stage-name">{stage.name}</span>
              <span className="wz-stage-count">
                {stage.count}
                {stage.flag !== "" ? (
                  <span
                    className={`wz-flag${stage.key === "secure" ? " is-danger" : ""}`}
                  >
                    {" "}
                    · {stage.flag}
                  </span>
                ) : null}
                <span className="sr-only">, {STAGE_WORDS[stage.state]}</span>
              </span>
              <span className="wz-stage-track" aria-hidden="true" />
            </li>
          ))}
        </ol>
        <div className="wz-pipe-time">
          <p className="wz-elapsed">
            <small>Elapsed</small>
            <span className="num">{formatElapsed(view.seconds)}</span>
          </p>
          <p className={`wz-est${progress.done ? " is-done" : ""}`}>
            {progress.done
              ? `Finished in ${formatElapsed(view.seconds)}`
              : estimateText(Math.max(1, progress.files))}
          </p>
        </div>
      </div>
      <div className="wz-v2-main">
        <section className="wz-pane" aria-labelledby={filesId}>
          <div className="wz-pane-head">
            <h3 className="wz-side-kicker" id={filesId}>
              Files
            </h3>
            <span className="wz-pane-note">
              {progress.files > 0 && progress.sorted === progress.files
                ? `${plural(progress.files, "file")} sorted`
                : `Sorted ${progress.sorted} of ${progress.files}`}
            </span>
          </div>
          <ul className="wz-fl">
            {view.lines.map((line) => (
              <FileRow key={line.key} line={line} view={view} wizard={wizard} />
            ))}
          </ul>
        </section>
        <section className="wz-pane is-items" aria-labelledby={itemsId}>
          <div className="wz-pane-head">
            <h3 className="wz-side-kicker" id={itemsId}>
              D&amp;I items
            </h3>
            <span className="wz-pane-note">Two readings each</span>
          </div>
          <div className="wz-ics">
            {view.cards.length === 0 ? (
              <p className="wz-q-empty">
                {progress.done
                  ? "No file went to a D&I item, so nothing is checked against the attributes."
                  : "Each D&I item appears here as files are sorted into it."}
              </p>
            ) : (
              view.cards.map((card) => (
                <ItemCardView key={card.requirementId} card={card} />
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function FileRow({
  line,
  view,
  wizard,
}: {
  line: FileLine;
  view: WindowView;
  wizard: WindowActions;
}) {
  const busy = line.fileId !== null && view.placing[line.fileId] === true;
  const problem = line.fileId === null ? undefined : view.problems[line.fileId];
  return (
    <li className={`wz-fr${line.dest?.kind === "needs" ? " is-needs" : ""}`}>
      <Mark mark={line.mark} className="wz-fr-mark" />
      <span className="wz-fr-text">
        <span className="wz-fr-name">{line.name}</span>
        <span className="wz-fr-meta">{line.meta}</span>
      </span>
      <span className="wz-fr-track" aria-hidden="true">
        {TRACK.map((name, at) => {
          const state = line.track[at] ?? "wait";
          return (
            <span key={name} className={`wz-tk is-${state}`}>
              <span className="wz-tk-bar">
                {at === 0 && line.sent !== null ? (
                  <span
                    className="wz-tk-fill"
                    style={{ transform: `scaleX(${line.sent})` }}
                  />
                ) : null}
              </span>
              <span className="wz-tk-label">
                <span className="wz-tk-ic">
                  <i />
                  <UiIcon name={state === "failed" ? "x" : "check"} size={11} />
                </span>
                {name}
              </span>
            </span>
          );
        })}
      </span>
      <span className="wz-fr-res">
        {line.activity !== null ? (
          <span
            className={`wz-fr-act is-${line.activity.tone}${line.activity.on ? " is-on" : ""}`}
          >
            {line.activity.text}
            {line.activity.on ? <Dots /> : null}
          </span>
        ) : null}
        {line.kind !== null ? <KindChip kind={line.kind} /> : null}
        {line.dest !== null ? (
          <DestinationView
            line={line}
            dest={line.dest}
            busy={busy}
            canAct={view.canAct}
            fixing={line.fileId !== null && view.fixing === line.fileId}
            onPlace={(choice) => wizard.place(line, choice)}
            onFix={(fix, kind) => wizard.fixReading(line, fix, kind)}
          />
        ) : null}
        {line.suggestion !== null && view.canAct ? (
          <SuggestionView
            line={line}
            busy={busy}
            onPlace={(choice) => wizard.place(line, choice)}
            onLeave={() => line.fileId !== null && wizard.leave(line.fileId)}
          />
        ) : null}
        {problem !== undefined ? (
          <span className="wz-problem" role="alert">
            {problem}
          </span>
        ) : null}
        {line.retry && view.canAct && line.upload !== null ? (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() =>
              line.upload !== null && wizard.retry(line.upload.key)
            }
          >
            <UiIcon name="retry" size={13} />
            Try again
          </button>
        ) : null}
      </span>
    </li>
  );
}

function KindChip({ kind }: { kind: NonNullable<FileLine["kind"]> }) {
  return (
    <>
      <span className="pill tone-neutral wz-kind">
        <UiIcon name="tag" size={11} />
        {kind.label}
      </span>
      {kind.confidence !== "" ? (
        <span className={`wz-conf${kind.low ? " is-low" : ""}`}>
          {kind.confidence}
        </span>
      ) : null}
    </>
  );
}

function DestinationView({
  line,
  dest,
  busy,
  canAct,
  fixing,
  onPlace,
  onFix,
}: {
  line: FileLine;
  dest: Destination;
  busy: boolean;
  canAct: boolean;
  fixing: boolean;
  onPlace: (choice: string) => void;
  onFix: (fix: NeedsFix, kind: string | null) => void;
}) {
  if (dest.kind === "placed") {
    return (
      <span className="wz-dest">
        <UiIcon name="arrow" size={13} />
        <span>
          To: <strong>{dest.titles.join(" and ")}</strong>
          {dest.note !== "" ? <small> · {dest.note}</small> : null}
        </span>
      </span>
    );
  }
  if (dest.kind === "out") {
    return (
      <span className="wz-dest is-out">
        <UiIcon name="folder" size={13} />
        <span>
          Not D&amp;I evidence: kept in the control’s files
          {dest.note !== "" ? <small> · {dest.note}</small> : null}
        </span>
      </span>
    );
  }
  return (
    <span className="wz-needs">
      <span className="wz-needs-line">
        <UiIcon name="help" size={14} />
        Needs you: choose where this goes
      </span>
      <span className="wz-needs-why">{dest.reason}</span>
      {canAct && dest.fix !== null ? (
        <FixReading line={line} fix={dest.fix} busy={fixing} onFix={onFix} />
      ) : null}
      {canAct && line.movable ? (
        <Choose
          key={`${line.fileId ?? line.key}:${line.version}`}
          name={line.name}
          choices={dest.choices}
          preselect={dest.preselect}
          busy={busy}
          onPlace={onPlace}
        />
      ) : null}
    </span>
  );
}

/** The action a "Needs you" reason names, in place: "Confirm its kind" (the reading's
 * kind confirmed, the agent's own kind selected first where it named one) or "Read it
 * again". Said done only once the server confirms it. */
function FixReading({
  line,
  fix,
  busy,
  onFix,
}: {
  line: FileLine;
  fix: NeedsFix;
  busy: boolean;
  onFix: (fix: NeedsFix, kind: string | null) => void;
}) {
  const id = useId();
  const said = line.file?.classification?.kind ?? "";
  const [kind, setKind] = useState(
    EVIDENCE_KINDS.find((each) => each === said) ?? "",
  );
  const spinner = <span className="spinner small" aria-hidden="true" />;
  if (fix === "reread") {
    return (
      <span className="wz-choose">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          aria-disabled={busy || undefined}
          onClick={() => {
            if (!busy) {
              onFix("reread", null);
            }
          }}
        >
          {busy ? spinner : <UiIcon name="retry" size={13} />}
          {busy ? "Starting…" : "Read it again"}
        </button>
      </span>
    );
  }
  return (
    <span className="wz-choose">
      <label className="sr-only" htmlFor={id}>
        What {line.name} is
      </label>
      <select
        id={id}
        value={kind}
        disabled={busy}
        onChange={(event) => setKind(event.target.value)}
      >
        {kind === "" ? (
          <option value="" disabled>
            Choose its kind
          </option>
        ) : null}
        {EVIDENCE_KINDS.map((each) => (
          <option key={each} value={each}>
            {EVIDENCE_KIND_LABELS[each]}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        disabled={kind === ""}
        aria-disabled={busy || undefined}
        onClick={() => {
          if (!busy && kind !== "") {
            onFix("confirm-kind", kind);
          }
        }}
      >
        {busy ? spinner : null}
        {busy ? "Confirming…" : "Confirm its kind"}
      </button>
    </span>
  );
}

/** Where a file a person must place goes: the agent's suggestion selected first, and
 * Place file. Keyed by the placement's version, so a file moved meanwhile (here or
 * elsewhere) starts its choice again. */
function Choose({
  name,
  choices,
  preselect,
  busy,
  onPlace,
}: {
  name: string;
  choices: readonly Choice[];
  preselect: string;
  busy: boolean;
  onPlace: (choice: string) => void;
}) {
  const id = useId();
  const [value, setValue] = useState(preselect);
  return (
    <span className="wz-choose">
      <label className="sr-only" htmlFor={id}>
        Where {name} goes
      </label>
      <select
        id={id}
        value={value}
        disabled={busy}
        onChange={(event) => setValue(event.target.value)}
      >
        {value === "" ? (
          <option value="" disabled>
            Choose where it goes
          </option>
        ) : null}
        {choices.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="btn btn-sm"
        disabled={value === ""}
        aria-disabled={busy || undefined}
        onClick={() => {
          if (!busy && value !== "") {
            onPlace(value);
          }
        }}
      >
        {busy ? (
          <>
            <span className="spinner small" aria-hidden="true" />
            Placing…
          </>
        ) : (
          "Place file"
        )}
      </button>
    </span>
  );
}

function SuggestionView({
  line,
  busy,
  onPlace,
  onLeave,
}: {
  line: FileLine;
  busy: boolean;
  onPlace: (choice: string) => void;
  onLeave: () => void;
}) {
  const suggestion = line.suggestion;
  if (suggestion === null) {
    return null;
  }
  return (
    <span className="wz-suggest">
      <span>
        <UiIcon name="sparkles" size={14} />
        <span>{suggestion.text}</span>
      </span>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        aria-disabled={busy || undefined}
        onClick={() => {
          if (!busy) {
            onPlace(suggestion.requirementId);
          }
        }}
      >
        {busy ? (
          <>
            <span className="spinner small" aria-hidden="true" />
            Moving…
          </>
        ) : (
          "Move it"
        )}
      </button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onLeave}>
        Leave it
      </button>
    </span>
  );
}

const STATUS_ICONS: Record<ItemCard["status"]["mode"], IconName> = {
  wait: "clock",
  on: "sparkles",
  done: "checkCircle",
  held: "info",
  failed: "retry",
};

function LaneView({
  name,
  lane,
  second = false,
}: {
  name: string;
  lane: Lane;
  second?: boolean;
}) {
  return (
    <div className={`wz-lane is-${lane.state}${second ? " is-second" : ""}`}>
      <div className="wz-lane-top">
        <span className="wz-lane-name">{name}</span>
        <span className="wz-lane-state">
          {lane.state === "done" ? <UiIcon name="check" size={12} /> : null}
          {lane.text}
          {lane.state === "active" ? <Dots /> : null}
        </span>
      </div>
      <div className="wz-lane-track" aria-hidden="true">
        <span className="wz-lane-fill" />
      </div>
    </div>
  );
}

function ItemCardView({ card }: { card: ItemCard }) {
  const id = useId();
  return (
    <article className="wz-ic" aria-labelledby={id}>
      <div className="wz-ic-head">
        <span className="dr-tile" aria-hidden="true">
          <UiIcon name={card.icon} size={16} />
        </span>
        <div>
          <h4 className="wz-ic-title" id={id}>
            {card.title}
          </h4>
          <p className="wz-ic-sub">
            {[card.kind, card.count].filter((part) => part !== "").join(" · ")}
          </p>
        </div>
      </div>
      {card.fileNames.length > 0 ? (
        <div className="wz-ic-files">
          {card.fileNames.map((name) => (
            <span key={name} className="wz-ic-file">
              <UiIcon name="file" size={12} />
              {name}
            </span>
          ))}
        </div>
      ) : null}
      <p className={`wz-ic-status is-${card.status.mode}`}>
        <UiIcon name={STATUS_ICONS[card.status.mode]} size={14} />
        <span>{card.status.text}</span>
        {card.status.mode === "on" && card.lanes === null ? <Dots /> : null}
      </p>
      {card.lanes !== null ? (
        <div className="wz-lanes">
          <LaneView name="First reading" lane={card.lanes.first} />
          <LaneView
            name="Second reading, without seeing the first"
            lane={card.lanes.second}
            second
          />
          <div className={`wz-cmp is-${card.lanes.compare.state}`}>
            <span className="wz-cmp-name">
              <UiIcon name="layers" size={14} />
              Comparing the readings
            </span>
            <span className="wz-lane-state">
              {card.lanes.compare.state === "done" ? (
                <UiIcon name="check" size={12} />
              ) : null}
              {card.lanes.compare.text}
              {card.lanes.compare.state === "active" ? <Dots /> : null}
            </span>
          </div>
        </div>
      ) : null}
      {card.tally.length > 0 ? (
        <div className="wz-ic-result">
          {card.tally.map((group) => (
            <span key={group.key} className={`pill tone-${group.tone}`}>
              <UiIcon name={group.icon} size={12} />
              {group.text}
            </span>
          ))}
        </div>
      ) : null}
    </article>
  );
}

// ---------------------------------------------------------------------------------------
// Step 3: Results
// ---------------------------------------------------------------------------------------

function Results({
  view,
  wizard,
  container,
}: {
  view: WindowView;
  wizard: WindowActions;
  container: HTMLElement | null;
}) {
  const sumId = useId();
  const lookId = useId();
  const { summary } = view;
  return (
    <div className="wz-view wz-v3">
      <div className="wz-v3-scroll">
        <section className="wz-sum" aria-labelledby={sumId}>
          <h3 className="wz-sum-lead" id={sumId}>
            {summary.lead}
          </h3>
          <p className="wz-sum-meta">
            Analyzed in {formatElapsed(view.seconds)}
            <br />
            Two readings per item
          </p>
          {summary.lines.length > 0 ? (
            <dl className="wz-sum-lines">
              {summary.lines.map((line) => (
                <div key={line.key} className={`wz-sum-line is-${line.tone}`}>
                  <dt>
                    <UiIcon name={line.icon} size={15} />
                    {line.label}
                  </dt>
                  <dd>{line.text}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </section>
        {view.note !== "" ? (
          <p className="wz-done" role="status">
            <UiIcon name="check" size={14} />
            {view.note}
          </p>
        ) : null}
        {view.apart.length > 0 ? (
          <section className="wz-look" aria-labelledby={lookId}>
            <div className="wz-look-head">
              <h3 className="wz-look-title" id={lookId}>
                {apartTitle(view.apart.length)}
              </h3>
              <span className="wz-q-meta">
                Choose where a file goes, or leave it in the control’s files.
              </span>
            </div>
            {view.apart.map((line) => (
              <ApartRow
                key={line.key}
                line={line}
                view={view}
                wizard={wizard}
              />
            ))}
          </section>
        ) : null}
        {view.results.map((item) => (
          <ResultCard
            key={item.requirementId}
            item={item}
            view={view}
            wizard={wizard}
            container={container}
          />
        ))}
      </div>
    </div>
  );
}

function ApartRow({
  line,
  view,
  wizard,
}: {
  line: FileLine;
  view: WindowView;
  wizard: WindowActions;
}) {
  const busy = line.fileId !== null && view.placing[line.fileId] === true;
  const problem = line.fileId === null ? undefined : view.problems[line.fileId];
  const needs = line.dest?.kind === "needs" ? line.dest : null;
  const meta = [
    line.meta,
    line.kind === null
      ? ""
      : `${line.kind.label}${line.kind.confidence !== "" ? `, ${line.kind.confidence.toLowerCase()}` : ""}`,
  ]
    .filter((part) => part !== "")
    .join(" · ");
  return (
    <div className={`wz-look-row${needs !== null ? " is-needs" : ""}`}>
      <Mark mark={line.mark} />
      <div className="wz-look-body">
        <span className="wz-rf-name">{line.name}</span>
        <span className="wz-rf-meta">{meta}</span>
        {needs !== null ? (
          <>
            <span className="wz-state-line is-warning">
              <UiIcon name="help" size={14} />
              Needs you: choose where this goes
            </span>
            <span className="wz-why">{needs.reason}</span>
            {view.canAct && needs.fix !== null ? (
              <FixReading
                line={line}
                fix={needs.fix}
                busy={line.fileId !== null && view.fixing === line.fileId}
                onFix={(fix, kind) => wizard.fixReading(line, fix, kind)}
              />
            ) : null}
          </>
        ) : line.dest?.kind === "out" ? (
          <>
            <span className="wz-state-line is-neutral">
              <UiIcon name="folder" size={14} />
              Not D&amp;I evidence: kept in the control’s files
            </span>
            <span className="wz-why">
              {line.dest.note !== ""
                ? "A person kept it out of the D&I items."
                : line.dest.reason !== ""
                  ? line.dest.reason
                  : "The reader found it is not evidence for any of the control’s D&I items."}
            </span>
          </>
        ) : (
          <span className="wz-state-line is-danger">
            <UiIcon name="xCircle" size={14} />
            {line.activity?.text ?? "Not added."}
          </span>
        )}
        {line.duplicate ? (
          <span className="wz-why">
            Already added earlier: shown where it is.
          </span>
        ) : null}
        {problem !== undefined ? (
          <span className="wz-problem" role="alert">
            {problem}
          </span>
        ) : null}
        {view.removing !== null && view.removing === line.fileId ? (
          <Withdraw line={line} view={view} wizard={wizard} />
        ) : null}
      </div>
      {!view.canAct || (line.duplicate && !line.movable) ? null : needs !==
        null ? (
        <Choose
          key={`${line.fileId ?? line.key}:${line.version}`}
          name={line.name}
          choices={needs.choices}
          preselect={needs.preselect}
          busy={busy}
          onPlace={(choice) => wizard.place(line, choice)}
        />
      ) : line.dest?.kind === "out" ? (
        <MoveMenu line={line} view={view} wizard={wizard} busy={busy} />
      ) : line.retry && line.upload !== null ? (
        <button
          type="button"
          className="btn btn-secondary btn-sm wz-look-act"
          onClick={() => line.upload !== null && wizard.retry(line.upload.key)}
        >
          <UiIcon name="retry" size={13} />
          Try again
        </button>
      ) : null}
    </div>
  );
}

/** Move a file (to another item, or out of D&I), or remove it from this upload: the
 * existing withdrawal, which keeps its custody record. A file of an accepted item stays
 * until the decision is reopened on the list. */
function MoveMenu({
  line,
  view,
  wizard,
  busy,
}: {
  line: FileLine;
  view: WindowView;
  wizard: WindowActions;
  busy: boolean;
}) {
  const here = new Set(line.on);
  const locked = view.items.some(
    (item) => here.has(item.requirementId) && item.accepted,
  )
    ? "This item’s evidence is accepted. Reopen the decision on the list to move its files."
    : !line.movable
      ? "The agent is still reading this file."
      : null;
  const entries: RowMenuItem[] = [
    ...view.items
      .filter((item) => item.choosable && !here.has(item.requirementId))
      .map((item) => ({
        label: `Move to ${item.title}`,
        icon: "arrow" as const,
        unavailable: locked,
        onSelect: () => wizard.place(line, item.requirementId),
      })),
    ...(line.dest?.kind === "out"
      ? []
      : [
          {
            label: OUT_LABEL,
            icon: "folder" as const,
            unavailable: locked,
            onSelect: () => wizard.place(line, OUT),
          },
        ]),
    {
      label: "Remove from this upload",
      icon: "trash" as const,
      danger: true,
      section: "This upload",
      unavailable: locked,
      onSelect: () => wizard.remove(line.fileId),
    },
  ];
  return (
    <span className="wz-move-wrap">
      {busy ? (
        <span className="wz-moving" role="status">
          <span className="spinner small" aria-hidden="true" />
          Moving…
        </span>
      ) : (
        <RowMenu
          label={`Move ${line.name}`}
          items={entries}
          trigger={{
            label: "Move",
            icon: "chevronDown",
            className: "wz-move",
            ariaLabel: `Move ${line.name}`,
          }}
        />
      )}
    </span>
  );
}

/** "Remove from this upload": the existing withdrawal, in place; the window stays. */
function Withdraw({
  line,
  view,
  wizard,
}: {
  line: FileLine;
  view: WindowView;
  wizard: WindowActions;
}) {
  if (line.fileId === null) {
    return null;
  }
  const blocked =
    view.held.find((file) => file.id === line.fileId)?.blocked ?? null;
  return (
    <div className="wz-withdraw">
      <FileChanges
        organizationId={view.ids.organizationId}
        projectId={view.ids.projectId}
        fileId={line.fileId}
        fileName={line.name}
        blocked={blocked}
        controlId={view.ids.controlId}
        step={view.ids.step ?? null}
        start="withdraw"
        onCancel={() => wizard.remove(null)}
        onDone={() => wizard.removed(line.name)}
      />
    </div>
  );
}

function ResultCard({
  item,
  view,
  wizard,
  container,
}: {
  item: ItemResult;
  view: WindowView;
  wizard: WindowActions;
  container: HTMLElement | null;
}) {
  const id = useId();
  const known = view.items.find(
    (each) => each.requirementId === item.requirementId,
  );
  const lines = view.lines.filter(
    (line) => line.fileId !== null && item.fileIds.includes(line.fileId),
  );
  // The files a passage can open in: this session's and the item's own.
  const openable = [
    ...(view.batch?.files ?? []).map((file) => ({
      id: file.fileId,
      fileName: file.name,
    })),
    ...(known?.held ?? [])
      .filter(
        (file) =>
          !(view.batch?.files ?? []).some((each) => each.fileId === file.id),
      )
      .map((file) => ({ id: file.id, fileName: file.name })),
  ];
  const accepted = item.accept.state === "accepted";
  const busy = view.accepting === item.requirementId;
  const acceptProblem =
    view.acceptProblem?.id === item.requirementId
      ? view.acceptProblem.text
      : "";
  const rerunProblem =
    view.rerunProblem?.id === item.requirementId ? view.rerunProblem.text : "";
  return (
    <article className="wz-rc" aria-labelledby={id}>
      <header className="wz-rc-head">
        <span className="dr-tile" aria-hidden="true">
          <UiIcon name={item.icon} size={16} />
        </span>
        <div className="wz-rc-titles">
          <h3 className="wz-rc-title" id={id}>
            {item.title}
          </h3>
          <p className="wz-rc-sub">
            <span>
              {item.sub}
              {item.requestTitle !== "" ? ` · ${item.requestTitle}` : ""}
            </span>
            {item.letters.length > 0 ? (
              <>
                <span className="sr-only">
                  Addresses {item.letters.join(", ")}.
                </span>
                <span className="wz-letters" aria-hidden="true">
                  {item.letters.map((letter) => (
                    <span key={letter} className="dr-code">
                      {letter}
                    </span>
                  ))}
                </span>
              </>
            ) : null}
          </p>
        </div>
        <div className="wz-rc-tally">
          {accepted ? (
            <span className="pill tone-success">
              <UiIcon name="checkCircle" size={12} />
              Evidence accepted
            </span>
          ) : (
            item.tally.map((group) => (
              <span key={group.key} className={`pill tone-${group.tone}`}>
                <UiIcon name={group.icon} size={12} />
                {group.text}
              </span>
            ))
          )}
        </div>
      </header>
      <div className="wz-rc-body">
        <div className="wz-rc-files">
          <h4 className="wz-rc-label">Files</h4>
          {lines.length === 0 ? (
            <p className="wz-why">
              No file of this upload is on it now. Move a file here, or add more
              files.
            </p>
          ) : (
            lines.map((line) => (
              <ResultFile
                key={line.key}
                line={line}
                requirementId={item.requirementId}
                view={view}
                wizard={wizard}
              />
            ))
          )}
          {item.earlier > 0 ? (
            <p className="wz-why">
              Checked together with {plural(item.earlier, "earlier file")} of
              this item.
            </p>
          ) : null}
        </div>
        <ul
          className={`wz-rc-attrs${item.rechecking ? " is-stale" : ""}`}
          aria-label={`Attributes ${item.letters.join(", ")}`}
        >
          {item.rechecking ? (
            <li className="wz-recheck">
              <UiIcon name="sparkles" size={14} />
              Checking again with the files as they are now
              <Dots />
              <span className="sr-only">
                . The results below are from before the change.
              </span>
            </li>
          ) : null}
          {item.hold !== null ? (
            <li className="wz-hold">
              <UiIcon name="info" size={14} />
              <span>{item.hold.text}</span>
              {item.hold.rerun !== null && view.canAct ? (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  aria-disabled={view.rerunning !== "" || undefined}
                  onClick={() => {
                    if (view.rerunning === "") {
                      wizard.rerun(item.requirementId);
                    }
                  }}
                >
                  {view.rerunning === item.requirementId
                    ? "Starting…"
                    : item.hold.rerun}
                </button>
              ) : null}
              {rerunProblem !== "" ? (
                <span className="wz-problem" role="alert">
                  {rerunProblem}
                </span>
              ) : null}
            </li>
          ) : null}
          {item.review !== null ? (
            // The check's review of the item's evidence, above its attributes: the
            // proposed outcome and why, then what to ask for. It decides nothing.
            <li className="wz-review">
              <p className="wz-review-head">
                <span className="wz-review-title">{REVIEW_TITLE}</span>
                <span className={`wz-state tone-${item.review.tone}`}>
                  <UiIcon name={item.review.icon} size={13} />
                  {item.review.label}
                </span>
              </p>
              <p className="wz-ar-reason">{item.review.explanation}</p>
              {item.review.followUps.length > 0 || item.review.more !== "" ? (
                <div className="wz-review-asks">
                  <h4 className="wz-rc-label" id={`${id}-asks`}>
                    {FOLLOW_UP_TITLE}
                  </h4>
                  {item.review.followUps.length > 0 ? (
                    <ol aria-labelledby={`${id}-asks`}>
                      {item.review.followUps.map((ask) => (
                        <li key={ask.key}>{ask.request}</li>
                      ))}
                    </ol>
                  ) : null}
                  {item.review.more !== "" ? (
                    <p className="wz-why">{item.review.more}</p>
                  ) : null}
                </div>
              ) : null}
            </li>
          ) : null}
          {item.attributes.map((row, at) => (
            <li
              key={row.key}
              className="wz-ar"
              style={{ "--i": at } as CSSProperties}
            >
              <span className="dr-code" aria-hidden="true">
                {row.letter}
              </span>
              <div className="wz-ar-body">
                <span className="sr-only">Attribute {row.letter}: </span>
                <div className="wz-ar-head">
                  <span className={`wz-state tone-${row.tone}`}>
                    <UiIcon name={row.icon} size={13} />
                    {row.label}
                  </span>
                  {row.wording !== "" ? (
                    <span className="wz-ar-attr" title={row.wording}>
                      {row.wording}
                    </span>
                  ) : null}
                </div>
                {row.reason !== "" ? (
                  <p className="wz-ar-reason">{row.reason}</p>
                ) : null}
                {row.readings.length === 2 ? (
                  <div className="wz-views">
                    {row.readings.map((reading) => (
                      <div key={reading.who} className="wz-vw">
                        <span className="wz-vw-who">{reading.who}</span>
                        <span className={`wz-vw-res is-${reading.met}`}>
                          <UiIcon
                            name={
                              reading.met === "met"
                                ? "checkCircle"
                                : reading.met === "not"
                                  ? "xCircle"
                                  : reading.met === "part"
                                    ? "layers"
                                    : "help"
                            }
                            size={13}
                          />
                          {reading.result}
                        </span>
                        <p>{reading.reason}</p>
                      </div>
                    ))}
                  </div>
                ) : null}
                {row.quotes.map((quote) => (
                  <figure
                    key={`${quote.fileId ?? ""}:${quote.location}:${quote.quote}`}
                    className="wz-quote"
                  >
                    <q>{quote.quote}</q>
                    <figcaption className="wz-quote-where">
                      <span className="wz-quote-file">{quote.fileName}</span>
                      {quote.location !== "" ? (
                        <span>{quote.location}</span>
                      ) : null}
                      {quote.opens && quote.fileId !== null ? (
                        <PreviewButton
                          organizationId={view.ids.organizationId}
                          projectId={view.ids.projectId}
                          files={openable}
                          startFileId={quote.fileId}
                          citations={[
                            {
                              fileId: quote.fileId,
                              fileName: quote.fileName,
                              quote: quote.quote,
                              found: true,
                              location: quote.location,
                              page: quote.page,
                              box: null,
                              label: row.letter,
                            },
                          ]}
                          sourcesTitle="What the readings rest on"
                          label={
                            <>
                              Open in the file
                              <UiIcon name="external" size={12} />
                            </>
                          }
                          className="wz-link wz-open"
                          container={container}
                        />
                      ) : null}
                    </figcaption>
                  </figure>
                ))}
                {row.missing.length > 0 ? (
                  <p className="wz-missing">
                    <span>
                      {item.fileIds.length + item.earlier > 1
                        ? "Not found in the files"
                        : "Not found in the file"}
                    </span>
                    {row.missing.join(" ")}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </div>
      <footer className="wz-rc-foot">
        {accepted ? (
          <p className="wz-accepted">
            <UiIcon name="checkCircle" size={15} />
            Evidence accepted
            {item.accept.note !== "" ? <small>{item.accept.note}</small> : null}
          </p>
        ) : (
          <>
            <p className="wz-accept-note">{item.accept.note}</p>
            {view.canAct && known !== undefined ? (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={item.accept.state !== "open"}
                aria-disabled={busy || undefined}
                onClick={() => {
                  if (!busy) {
                    wizard.accept(known);
                  }
                }}
              >
                {busy ? (
                  <>
                    <span className="spinner small" aria-hidden="true" />
                    Accepting…
                  </>
                ) : (
                  <>
                    <UiIcon name="check" size={14} />
                    Accept evidence
                  </>
                )}
              </button>
            ) : null}
          </>
        )}
        {acceptProblem !== "" ? (
          <p className="wz-problem" role="alert">
            {acceptProblem}
          </p>
        ) : null}
      </footer>
    </article>
  );
}

function ResultFile({
  line,
  requirementId,
  view,
  wizard,
}: {
  line: FileLine;
  /** The item whose card this is: the file's letters are from its own check. */
  requirementId: string;
  view: WindowView;
  wizard: WindowActions;
}) {
  const busy = line.fileId !== null && view.placing[line.fileId] === true;
  const problem = line.fileId === null ? undefined : view.problems[line.fileId];
  const addresses = addressesLine(line.file, view.batch, requirementId);
  const by =
    line.dest?.kind === "placed" && line.dest.note !== ""
      ? line.dest.note === "your choice" ||
        line.dest.note === "chosen on its row"
        ? "added from the row"
        : line.dest.note
      : "";
  return (
    <div className="wz-rf">
      <Mark mark={line.mark} />
      <span className="wz-rf-text">
        <span className="wz-rf-name">{line.name}</span>
        <span className="wz-rf-meta">
          {[line.meta, by].filter((part) => part !== "").join(" · ")}
        </span>
      </span>
      {view.canAct && !line.duplicate ? (
        <MoveMenu line={line} view={view} wizard={wizard} busy={busy} />
      ) : (
        <span />
      )}
      <span className="wz-rf-tags">
        {line.kind !== null ? (
          <span className="pill tone-neutral">
            <UiIcon name="tag" size={11} />
            {line.kind.label}
          </span>
        ) : null}
        {addresses.kind === "later" ? (
          <span className="wz-addr-none">
            <UiIcon name="clock" size={12} />
            Not checked yet
          </span>
        ) : addresses.kind === "none" ? (
          <span className="wz-addr-none">Addresses no attribute</span>
        ) : addresses.kind === "unknown" ? null : (
          <span className="wz-addr">
            Addresses
            <span className="sr-only"> {addresses.spoken}</span>
            {addresses.letters.map((letter) => (
              <span key={letter} className="dr-code" aria-hidden="true">
                {letter}
              </span>
            ))}
          </span>
        )}
      </span>
      {line.duplicate ? (
        <span className="wz-why wz-rf-full">
          Already added earlier: shown where it is.
        </span>
      ) : null}
      {line.suggestion !== null && view.canAct ? (
        <span className="wz-rf-full">
          <SuggestionView
            line={line}
            busy={busy}
            onPlace={(choice) => wizard.place(line, choice)}
            onLeave={() => line.fileId !== null && wizard.leave(line.fileId)}
          />
        </span>
      ) : null}
      {problem !== undefined ? (
        <span className="wz-problem wz-rf-full" role="alert">
          {problem}
        </span>
      ) : null}
      {view.removing !== null && view.removing === line.fileId ? (
        <span className="wz-rf-full">
          <Withdraw line={line} view={view} wizard={wizard} />
        </span>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------
// The list's line
// ---------------------------------------------------------------------------------------

/** On the D&I list while a session is open and its window closed: where it stands, and
 * the way back into it. */
export function WizardProgress({ wizard }: { wizard: Wizard }) {
  const line = wizard.line;
  if (line === null) {
    return null;
  }
  return (
    <div className={`de-progress${line.done ? " is-done" : ""}`}>
      <UiIcon name={line.done ? "checkCircle" : "sparkles"} size={15} />
      <span className="de-progress-text">{line.text}</span>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={wizard.reopen}
      >
        {line.action}
      </button>
    </div>
  );
}

export { carriesFiles, droppedFiles };
