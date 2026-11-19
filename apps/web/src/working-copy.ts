"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  changed,
  type Draft,
  type EditSource,
  type SectionEditor,
  savePayload,
} from "./section-edit-model";
import type { EditPhase } from "./section-editor";
import { draftChanged } from "./section-redraft-model";
import {
  bodyBytes,
  type CopiesRead,
  copiesQuery,
  copyMayOutliveSave,
  discardRequest,
  goingKeep,
  KEEP_AFTER_MS,
  KEEP_RETRY_MS,
  type KeepCount,
  type Keeping,
  type KeepingOff,
  keepAction,
  keepBasis,
  keepProblem,
  keepRefusedDraft,
  keepRequest,
  mayKeep,
  parseWorkingCopies,
  type WorkingCopy,
} from "./working-copy-model";

/**
 * A person's working copy of the section they are editing, kept as they type
 * (docs/design-workpaper.md, section 3.4). What is kept, when, and what the bar says are
 * the model's (working-copy-model.ts); this file only sends and reads, through the page's
 * own route, which never redirects. A working copy is not the workpaper: nothing here
 * adds a version, and nothing here says "saved".
 *
 * Every write for the page goes through one queue, so they reach the server in the order
 * they were made: one request at a time, a keep always of the latest text, never an older
 * text after a newer one, and a discard never overtaken by a keep sent before it.
 */

const ROUTE = "/workspace/workpapers/draft";

type Scope = { organizationId: string; projectId: string };

/** One write through the page's route. An answer that cannot be read, or none, is status
 * 0: nothing is taken as kept. */
export async function sendCopy(
  body: Record<string, unknown>,
  keepalive = false,
): Promise<{ status: number; detail: string; updatedAt: string | null }> {
  try {
    const response = await fetch(ROUTE, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      keepalive,
    });
    const answer = (await response.json()) as {
      status?: unknown;
      detail?: unknown;
      updated_at?: unknown;
    };
    return {
      status: typeof answer.status === "number" ? answer.status : 0,
      detail: typeof answer.detail === "string" ? answer.detail : "",
      updatedAt:
        typeof answer.updated_at === "string" ? answer.updated_at : null,
    };
  } catch {
    return { status: 0, detail: "", updatedAt: null };
  }
}

/**
 * The caller's working copies of a workpaper: read once, and again when the workpaper or
 * its version changes or a write asks for it. A newer read stops the one before it, and an
 * answer that arrives late is dropped. A read that fails never blocks editing: what the page
 * already knows stays, and `read` says so ("failed"), so an editor opened then keeps nothing
 * over a copy that may be there. `read` is "reading" until a read of this workpaper's copies
 * has answered: "Edit" waits for it (independent review, 15 November 2026).
 *
 * For the section open in an editor that knows what the server holds (`openKey`), the
 * page's own writes are what is known, so a read made before one of them does not undo it;
 * for an editor that does not know, the caller passes null and the read is taken as it is.
 * `answered` counts the reads that answered, so the page sees one land.
 */
export function useWorkingCopies(
  scope: Scope,
  workpaperId: string | null,
  version: number | null,
  openKey: string | null,
): {
  copies: WorkingCopy[];
  read: CopiesRead;
  answered: number;
  reread: () => void;
  remember: (copy: WorkingCopy) => void;
  forget: (section: string) => void;
} {
  const [copies, setCopies] = useState<WorkingCopy[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [answered, setAnswered] = useState(0);
  // What "Edit" waits for is a read of this workpaper's copies: they are the caller's own,
  // whatever the version (a copy's own `based_on` says whether it is stale), so a newer
  // version's read keeps what is known while it is out, and "Edit" (and the focus a save
  // hands back to it) is not taken away after every save.
  const target = workpaperId;
  const [status, setStatus] = useState<{
    target: string | null;
    read: CopiesRead;
  }>({ target: null, read: "reading" });
  const open = useRef(openKey);
  open.current = openKey;
  const { organizationId, projectId } = scope;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` and `attempt` are what ask for another read.
  useEffect(() => {
    if (workpaperId === null) {
      return;
    }
    const control = new AbortController();
    let current = true;
    const asked = target;
    (async () => {
      let found: WorkingCopy[] | null = null;
      try {
        const response = await fetch(
          `${ROUTE}?${copiesQuery({ organizationId, projectId }, workpaperId)}`,
          { cache: "no-store", signal: control.signal },
        );
        const body = (await response.json()) as {
          status?: unknown;
          result?: unknown;
        };
        found = body.status === 200 ? parseWorkingCopies(body.result) : null;
      } catch {
        found = null;
      }
      if (!current) {
        return;
      }
      if (found === null) {
        // Once a read of this workpaper's copies answered, the page knows them.
        setStatus((before) =>
          before.target === asked && before.read === "read"
            ? before
            : { target: asked, read: "failed" },
        );
        return;
      }
      const read = found;
      setCopies((before) => {
        const key = open.current;
        return key === null
          ? read
          : [
              ...read.filter((copy) => copy.section !== key),
              ...before.filter((copy) => copy.section === key),
            ];
      });
      setStatus({ target: asked, read: "read" });
      setAnswered((count) => count + 1);
    })();
    return () => {
      current = false;
      control.abort();
    };
  }, [organizationId, projectId, workpaperId, version, attempt]);
  const calls = useMemo(
    () => ({
      reread: () => setAttempt((count) => count + 1),
      remember: (copy: WorkingCopy) =>
        setCopies((before) => [
          ...before.filter((item) => item.section !== copy.section),
          copy,
        ]),
      forget: (section: string) =>
        setCopies((before) =>
          before.filter((item) => item.section !== section),
        ),
    }),
    [],
  );
  const read = status.target === target ? status.read : "reading";
  return { copies, read, answered, ...calls };
}

/** The open editor, as keeping its working copy needs it. */
export type KeepingOpen = {
  scope: Scope;
  source: EditSource;
  editor: SectionEditor;
  draft: Draft;
  phase: EditPhase;
  /** The server holds a working copy of this section (as far as the page knows). */
  hasCopy: boolean;
  /** The working copy the editor holds (it opened with it, or the person chose it): what
   * it holds is already kept, and a keep is based on the copy's own version. */
  restored: WorkingCopy | null;
  /** Keeping is off: the editor does not know what the server holds for it. */
  off: KeepingOff | null;
  /** The agent's draft the editor's text came from (section 3.11), kept with the copy so
   * a save after coming back still names it; null where none. */
  proposalId: string | null;
};

/** What a keep holds, as one string: two drafts that would send the same, naming the same
 * draft of the agent's or none, are the same. */
const keyOf = (
  editor: SectionEditor,
  draft: Draft,
  proposalId: string | null,
) => JSON.stringify([savePayload(editor, draft), proposalId]);

const pause = (ms: number) =>
  new Promise<void>((done) => {
    window.setTimeout(done, ms);
  });

export type Keeper = {
  /** Where the open editor's working copy stands, for its bar. */
  keeping: Keeping;
  /** Sends the latest at once (no pause), waiting for it no longer than `limit`. */
  flush: (limit: number) => Promise<void>;
  /** Waits, no longer than `limit`, for the writes already on their way. */
  settle: (limit: number) => Promise<void>;
  /** Discards a section's working copy, after any write already on its way. */
  discard: (
    scope: Scope,
    workpaperId: string,
    section: string,
    known: boolean,
  ) => void;
  /** How many keeps were sent and answered: taken as a save is sent. */
  mark: () => KeepCount;
  /** The server took a save of the section, and deleted its working copy with it. A keep
   * that was out as the save was sent (`atSave`), or sent after, could land after that: its
   * copy is discarded once it has. Nothing is kept for this editor after it. */
  saved: (
    scope: Scope,
    workpaperId: string,
    section: string,
    atSave: KeepCount,
  ) => void;
  /** Something changed is not kept yet (not confirmed by the server): what the browser's
   * own prompt asks about. A keep sent as the page goes is not confirmed, so it still is. */
  unkept: () => boolean;
  /** The page is going: what is not kept yet is sent with `keepalive`, unanswered (a body
   * too large for it was kept as the tab was hidden, or is not kept). */
  beacon: () => void;
  /** The tab is hidden: a body too large for `keepalive` is kept now, as a keep is. */
  hidden: () => void;
};

/**
 * Keeps the open editor's working copy as the person types: 1.5 s after the last change
 * the model's `keepAction` is sent (keep, or discard a copy of something changed back),
 * one request at a time, and a keep that failed is tried again on the next change and
 * every 15 s while it still fails (a refusal the server words is not tried again). Paused
 * while a save is out or the views read again; never for an editor that has closed.
 */
export function useKeeping(
  open: KeepingOpen | null,
  callbacks: {
    onKept: (copy: WorkingCopy) => void;
    onDiscarded: (section: string) => void;
    /** A discard the server took: the copies are read again. */
    onGone: () => void;
    /** A keep refused because the agent's draft it named changed (section 3.11): that
     * draft's id (the bar says the server's sentence). */
    onDraftChanged: (proposalId: string) => void;
  },
): Keeper {
  const [keeping, setKeeping] = useState<Keeping>({ state: "none" });
  const latest = useRef(open);
  latest.current = open;
  const told = useRef(callbacks);
  told.current = callbacks;
  // What the server holds for the open editor (its key), and since when.
  const kept = useRef<string | null>(null);
  const keptAt = useRef("");
  // The keep on its way, if one is.
  const sending = useRef<string | null>(null);
  // Sent as the page went, unanswered.
  const beaconed = useRef<string | null>(null);
  // The server refused in its own words: not tried again for this editor.
  const blocked = useRef(false);
  // The agent's draft a keep was refused for (it changed): nothing is kept naming it, and
  // keeping goes on once the editor names another or none.
  const refusedDraft = useRef<string | null>(null);
  // The editor whose save the server confirmed: nothing more is kept for it.
  const savedFor = useRef<SectionEditor | null>(null);
  // Keeps sent, and answered (independent review, 15 November 2026).
  const count = useRef<KeepCount>({ sent: 0, answered: 0 });
  const wait = useRef(0);
  const retry = useRef(0);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const pending = useRef(0);
  const queued = useRef(false);
  const gone = useRef(false);

  const keeper = useMemo(() => {
    const enqueue = (op: () => Promise<void>): Promise<void> => {
      pending.current += 1;
      const next = chain.current
        .then(op)
        .catch(() => undefined)
        .finally(() => {
          pending.current -= 1;
        });
      chain.current = next;
      return next;
    };
    const same = (editor: SectionEditor) => latest.current?.editor === editor;
    const may = (now: KeepingOpen) =>
      mayKeep(now, {
        blocked:
          blocked.current ||
          keepRefusedDraft(now.proposalId, refusedDraft.current),
        saved: savedFor.current === now.editor,
      });

    /** Keeps the latest, or drops a copy of something changed back: read when it runs,
     * so whatever is sent is the latest there is. */
    const sync = async (): Promise<void> => {
      queued.current = false;
      const now = latest.current;
      if (now === null || !may(now)) {
        return;
      }
      const { editor, draft, scope } = now;
      // A restored copy keeps the version it was started from.
      const source = keepBasis(now.source, now.restored);
      const action = keepAction(editor, draft, now.hasCopy);
      if (action === "none") {
        return;
      }
      if (action === "discard") {
        const answer = await sendCopy(discardRequest(scope, source, editor));
        if (answer.status === 200) {
          if (same(editor)) {
            kept.current = null;
            setKeeping({ state: "none" });
          }
          told.current.onDiscarded(editor.key);
          told.current.onGone();
        }
        return;
      }
      const { proposalId } = now;
      const key = keyOf(editor, draft, proposalId);
      if (key === kept.current || (gone.current && key === beaconed.current)) {
        if (same(editor) && key === kept.current) {
          setKeeping({ state: "kept", at: keptAt.current });
        }
        return;
      }
      sending.current = key;
      count.current = { ...count.current, sent: count.current.sent + 1 };
      const answer = await sendCopy(
        keepRequest(scope, source, editor, draft, proposalId),
      );
      count.current = {
        ...count.current,
        answered: count.current.answered + 1,
      };
      sending.current = null;
      const problem = keepProblem(answer.status, answer.detail);
      if (problem === null) {
        const at = answer.updatedAt ?? new Date().toISOString();
        const payload = savePayload(editor, draft);
        told.current.onKept({
          section: editor.key,
          basedOn: source.basedOn,
          text: "text" in payload ? payload.text : null,
          rows: "rows" in payload ? payload.rows : null,
          updatedAt: at,
          proposalId,
        });
        if (!same(editor)) {
          return;
        }
        window.clearTimeout(retry.current);
        kept.current = key;
        keptAt.current = at;
        const after = latest.current;
        // Typed on while it was out: the newer text is on its way after its own pause.
        setKeeping(
          after !== null &&
            keyOf(after.editor, after.draft, after.proposalId) === key
            ? { state: "kept", at }
            : { state: "keeping" },
        );
        return;
      }
      if (!same(editor)) {
        return;
      }
      setKeeping({ state: "failed", detail: problem.detail });
      window.clearTimeout(retry.current);
      if (proposalId !== null && draftChanged(answer.status, answer.detail)) {
        // The draft it named changed (section 3.11): the page keeps the link and shows
        // the ways on; nothing more is kept naming it.
        refusedDraft.current = proposalId;
        told.current.onDraftChanged(proposalId);
      } else if (problem.retry) {
        retry.current = window.setTimeout(() => {
          void request();
        }, KEEP_RETRY_MS);
      } else {
        blocked.current = true;
      }
    };
    /** One sync waiting at a time: it reads the latest when it runs. */
    const request = (): Promise<void> => {
      if (queued.current) {
        return chain.current;
      }
      queued.current = true;
      return enqueue(sync);
    };
    const discardOp =
      (scope: Scope, workpaperId: string, section: string) =>
      async (): Promise<void> => {
        const answer = await sendCopy(
          discardRequest(scope, { workpaperId }, { key: section }),
        );
        if (answer.status === 200) {
          const now = latest.current;
          if (now !== null && now.editor.key === section) {
            kept.current = null;
          }
          told.current.onDiscarded(section);
          told.current.onGone();
        }
      };
    const flush = async (limit: number): Promise<void> => {
      window.clearTimeout(wait.current);
      await Promise.race([request(), pause(limit)]);
    };
    const settle = async (limit: number): Promise<void> => {
      await Promise.race([chain.current, pause(limit)]);
    };
    const discard = (
      scope: Scope,
      workpaperId: string,
      section: string,
      known: boolean,
    ) => {
      const now = latest.current;
      if (now !== null && now.editor.key === section) {
        kept.current = null;
      }
      told.current.onDiscarded(section);
      // Known to be there, or perhaps about to be: a keep is on its way.
      if (known || pending.current > 0) {
        void enqueue(discardOp(scope, workpaperId, section));
      }
    };
    const mark = (): KeepCount => ({ ...count.current });
    const saved = (
      scope: Scope,
      workpaperId: string,
      section: string,
      atSave: KeepCount,
    ) => {
      kept.current = null;
      savedFor.current = latest.current?.editor ?? null;
      window.clearTimeout(wait.current);
      window.clearTimeout(retry.current);
      told.current.onDiscarded(section);
      if (copyMayOutliveSave(atSave, count.current)) {
        void enqueue(discardOp(scope, workpaperId, section));
      }
    };
    /** The latest is changed (from what is stored) and is not what the server holds:
     * what the browser's own prompt asks about, whether or not it may be kept. */
    const unkept = (): boolean => {
      const now = latest.current;
      return (
        now !== null &&
        now.phase !== "refreshing" &&
        changed(now.editor, now.draft) &&
        keyOf(now.editor, now.draft, now.proposalId) !== kept.current
      );
    };
    /** As the page goes, the tab is hidden, or the editor goes without being asked: what
     * is not kept yet, as `goingKeep` decides. Never while a save is out or after one the
     * server confirmed, never with keeping off. */
    const send = (when: "pagehide" | "hidden" | "unmount") => {
      const now = latest.current;
      if (now === null) {
        return;
      }
      const body = keepRequest(
        now.scope,
        keepBasis(now.source, now.restored),
        now.editor,
        now.draft,
        now.proposalId,
      );
      const key = keyOf(now.editor, now.draft, now.proposalId);
      const plan = goingKeep({
        when,
        may: may(now),
        unkept: unkept(),
        action: keepAction(now.editor, now.draft, now.hasCopy),
        key,
        beaconed: beaconed.current,
        sending: sending.current,
        bytes: bodyBytes(body),
      });
      if (plan === "keepalive") {
        beaconed.current = key;
        void sendCopy(body, true);
      } else if (plan === "queue") {
        // In the page's own queue, counted, and kept only once the server answered.
        window.clearTimeout(wait.current);
        void request();
      }
    };
    return {
      request,
      flush,
      settle,
      discard,
      mark,
      saved,
      unkept,
      beacon: () => send("pagehide"),
      hidden: () => send("hidden"),
      leave: () => send("unmount"),
    };
  }, []);

  // Another editor opened, or none is: it starts from what the server holds for it.
  const session = open?.editor ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new editor is what starts again.
  useEffect(() => {
    window.clearTimeout(retry.current);
    window.clearTimeout(wait.current);
    kept.current = null;
    keptAt.current = "";
    blocked.current = false;
    refusedDraft.current = null;
    savedFor.current = null;
    // Kept as it is when already none, so a new editor object alone draws nothing again.
    setKeeping((now) => (now.state === "none" ? now : { state: "none" }));
  }, [session]);

  // The editor holds a working copy (it opened with it, or the person chose one found
  // later): what it holds is what the server holds.
  const holding = open?.restored ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the copy the editor takes up is what is kept.
  useEffect(() => {
    const now = latest.current;
    if (now === null || holding === null) {
      return;
    }
    // What the server holds, the draft it names included.
    kept.current = keyOf(now.editor, now.draft, holding.proposalId);
    keptAt.current = holding.updatedAt;
    setKeeping({ state: "kept", at: holding.updatedAt });
  }, [session, holding]);

  // The pause after the last change. Paused while a save is out or the views read again;
  // the timer goes with the editor that set it.
  const phase = open?.phase ?? null;
  const key =
    open === null ? null : keyOf(open.editor, open.draft, open.proposalId);
  const hasCopy = open?.hasCopy ?? false;
  const off = open?.off ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a change of the text, the draft it names, the phase, the copy or keeping off is what starts the pause again.
  useEffect(() => {
    const now = latest.current;
    if (
      now === null ||
      now.phase !== "editing" ||
      blocked.current ||
      // Refused as the draft it names changed: the bar keeps saying so until the editor
      // names another draft or none.
      keepRefusedDraft(now.proposalId, refusedDraft.current)
    ) {
      return;
    }
    if (now.off !== null) {
      // Nothing is kept, nor discarded, over a copy that may be there: the bar says so.
      setKeeping(
        changed(now.editor, now.draft)
          ? { state: "off", why: now.off }
          : { state: "none" },
      );
      return;
    }
    const action = keepAction(now.editor, now.draft, now.hasCopy);
    if (action === "keep" && key === kept.current) {
      setKeeping({ state: "kept", at: keptAt.current });
      return;
    }
    setKeeping(action === "keep" ? { state: "keeping" } : { state: "none" });
    if (action === "none") {
      return;
    }
    wait.current = window.setTimeout(() => {
      void keeper.request();
    }, KEEP_AFTER_MS);
    return () => window.clearTimeout(wait.current);
  }, [session, key, phase, hasCopy, off, keeper]);

  // Gone to another page of the app without being asked (the browser's Back button): what
  // is not kept yet is kept, in the queue (never while a save is out, or after one).
  useEffect(() => {
    gone.current = false;
    return () => {
      gone.current = true;
      window.clearTimeout(wait.current);
      window.clearTimeout(retry.current);
      keeper.leave();
    };
  }, [keeper]);

  return {
    keeping,
    flush: keeper.flush,
    settle: keeper.settle,
    discard: keeper.discard,
    mark: keeper.mark,
    saved: keeper.saved,
    unkept: keeper.unkept,
    beacon: keeper.beacon,
    hidden: keeper.hidden,
  };
}
