"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  agentWorking,
  type Block,
  blocks,
  type Citation,
  CONSOLE_NOTICES,
  type ConsoleAction,
  type ConsoleFile,
  type ConsoleMessage,
  type ConsoleNotice,
  type ConsoleThread,
  citedFiles,
  fileHref,
  filtersLine,
  greeting,
  type Inline,
  plainText,
  previewCitations,
  REPORT_TITLES,
  stepOutcome,
  writtenSoFar,
} from "./console-model";
import { EvidencePreview } from "./evidence-preview";
import { UiIcon } from "./ui-icon";

// While an answer is being written the conversation is fetched often, so the text flows.
const POLL_MS = 500;
// How close to the end counts as reading the latest, in pixels.
const NEAR_END = 140;
const STARTERS: Array<{
  title: string;
  text: string;
  icon: "activity" | "mail" | "shield" | "clock";
}> = [
  {
    title: "Brief me",
    text: "What needs my attention today?",
    icon: "activity",
  },
  {
    title: "Move evidence forward",
    text: "Which evidence requests are still drafts? Submit them for approval.",
    icon: "mail",
  },
  {
    title: "Review a control",
    text: "Review ITGC-AC-01's evidence and get it ready for testing.",
    icon: "shield",
  },
  {
    title: "Chase what's late",
    text: "What is overdue, and who is it waiting on?",
    icon: "clock",
  },
];

type Reply = { notice?: ConsoleNotice; thread?: ConsoleThread | null };

function atEnd(margin: number): boolean {
  const page = document.documentElement;
  return window.innerHeight + window.scrollY >= page.scrollHeight - margin;
}

function toEnd(behavior: ScrollBehavior): void {
  window.scrollTo({ top: document.documentElement.scrollHeight, behavior });
}

/**
 * Text that is still arriving, revealed at reading pace rather than in jumps as each poll
 * lands. Settled text shows at once, and so does everything for a person who asks for
 * less motion.
 */
function useFlowingText(target: string, flowing: boolean): string {
  const [shown, setShown] = useState(flowing ? "" : target);
  useEffect(() => {
    const still =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!flowing || still) {
      setShown(target);
      return;
    }
    let frame = 0;
    const step = () => {
      setShown((current) => {
        if (!target.startsWith(current)) {
          // The text was taken back or rewritten: follow it, without replaying it.
          return target.slice(0, Math.min(current.length, target.length));
        }
        if (current.length >= target.length) {
          return current;
        }
        const behind = target.length - current.length;
        return target.slice(
          0,
          current.length + Math.max(2, Math.ceil(behind / 10)),
        );
      });
      frame = window.requestAnimationFrame(step);
    };
    frame = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(frame);
  }, [target, flowing]);
  return shown;
}

export function ConsoleChat({
  organizationId,
  projectId,
  engagement,
  initial,
  alert,
  panelOpen,
  onTogglePanel,
  waitingCount,
}: {
  organizationId: string;
  projectId: string;
  /** The engagement the agents work on, as the person knows it. */
  engagement: string;
  initial: ConsoleThread | null;
  alert: string | null;
  panelOpen: boolean;
  onTogglePanel: () => void;
  waitingCount: number;
}) {
  const router = useRouter();
  const [thread, setThread] = useState<ConsoleThread | null>(initial);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState<string | null>(null);
  const [hello, setHello] = useState("");
  const [away, setAway] = useState(false);
  const column = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  // Whether the person is reading the latest; then the page follows new text.
  const following = useRef(true);
  const working = agentWorking(thread);
  const messages = thread?.messages ?? [];
  const empty = messages.length === 0;

  useEffect(() => {
    setThread(initial);
  }, [initial]);

  // The greeting follows the person's own clock, so it is set in the browser.
  useEffect(() => {
    setHello(greeting(new Date().getHours()));
  }, []);

  // A pointer and keyboard user starts typing at once; a phone keeps its keyboard down.
  // biome-ignore lint/correctness/useExhaustiveDependencies: focus when the conversation changes.
  useEffect(() => {
    if (window.matchMedia("(pointer: fine)").matches) {
      box.current?.focus({ preventScroll: true });
    }
  }, [thread?.id]);

  const remember = useCallback((next: ConsoleThread | null) => {
    if (next?.id) {
      const url = new URL(window.location.href);
      url.searchParams.set("section", "console");
      url.searchParams.set("thread", next.id);
      window.history.replaceState(null, "", url.toString());
    }
  }, []);

  const post = useCallback(
    async (body: Record<string, string>): Promise<Reply> => {
      const response = await fetch("/workspace/console/live", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organization_id: organizationId,
          project_id: projectId,
          ...body,
        }),
      });
      const reply = (await response.json().catch(() => ({}))) as Reply;
      if (!response.ok) {
        throw new Error(
          CONSOLE_NOTICES[reply.notice ?? "unavailable"] ||
            CONSOLE_NOTICES.unavailable,
        );
      }
      return reply;
    },
    [organizationId, projectId],
  );

  // While an agent works, fetch the conversation quietly. No page reloads.
  useEffect(() => {
    if (!working || thread?.id == null) {
      return;
    }
    const id = thread.id;
    let stopped = false;
    let waiting = false;
    const timer = window.setInterval(async () => {
      if (waiting) {
        return;
      }
      waiting = true;
      try {
        const response = await fetch(
          `/workspace/console/live?organization=${organizationId}&project=${projectId}&thread=${id}`,
          { cache: "no-store" },
        );
        const body = (await response.json()) as { thread?: ConsoleThread };
        if (!stopped && body.thread) {
          setThread(body.thread);
          if (!agentWorking(body.thread)) {
            // The rail (waiting, activity, conversations) catches up once.
            router.refresh();
          }
        }
      } catch {
        // A missed poll is retried on the next tick.
      } finally {
        waiting = false;
      }
    }, POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [working, thread?.id, organizationId, projectId, router]);

  // Follow the conversation while the person reads its end; leave them be when they scroll up.
  useEffect(() => {
    const onScroll = () => {
      following.current = atEnd(NEAR_END);
      setAway(!atEnd(NEAR_END * 3));
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  // A conversation opens at its latest message.
  // biome-ignore lint/correctness/useExhaustiveDependencies: run when the conversation changes.
  useEffect(() => {
    following.current = true;
    window.requestAnimationFrame(() => toEnd("auto"));
  }, [thread?.id]);

  // As the column grows (a new message, words arriving), keep the end in view.
  useEffect(() => {
    const element = column.current;
    if (element === null) {
      return;
    }
    const observer = new ResizeObserver(() => {
      if (following.current) {
        toEnd("auto");
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const resize = () => {
    const element = box.current;
    if (element !== null) {
      element.style.height = "auto";
      element.style.height = `${Math.min(element.scrollHeight, 220)}px`;
    }
  };

  const send = async (text: string) => {
    const message = text.trim();
    if (message === "" || sending || working) {
      return;
    }
    setError(null);
    setSending(true);
    following.current = true;
    const now = new Date().toISOString();
    const optimistic: ConsoleThread = {
      id: thread?.id ?? null,
      title: thread?.title ?? "",
      modelConfigured: thread?.modelConfigured ?? true,
      messages: [
        ...messages,
        {
          id: `local-user-${now}`,
          role: "USER",
          content: message,
          status: "DONE",
          note: "",
          createdAt: now,
          actions: [],
          canRetry: false,
          citations: [],
        },
        {
          id: `local-agent-${now}`,
          role: "AGENT",
          content: "",
          status: "PENDING",
          note: "",
          createdAt: now,
          actions: [],
          canRetry: false,
          citations: [],
        },
      ],
    };
    const before = thread;
    setThread(optimistic);
    setDraft("");
    window.requestAnimationFrame(() => {
      resize();
      toEnd("smooth");
    });
    try {
      const reply = await post({
        intent: "ask",
        text: message,
        ...(thread?.id ? { thread_id: thread.id } : {}),
      });
      if (reply.thread) {
        setThread(reply.thread);
        remember(reply.thread);
      }
    } catch (failure) {
      setThread(before);
      setDraft(message);
      setError(failure instanceof Error ? failure.message : "Try again.");
    } finally {
      setSending(false);
    }
  };

  const act = async (
    intent: "confirm" | "confirm-all" | "cancel",
    id: string,
  ) => {
    setError(null);
    setBusy(id);
    try {
      const reply = await post(
        intent === "confirm-all"
          ? { intent, message_id: id }
          : { intent, action_id: id },
      );
      if (reply.thread) {
        setThread(reply.thread);
      }
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Try again.");
    } finally {
      setBusy(null);
    }
  };

  const stopSpeaking = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setSpeaking(null);
  }, []);

  const retry = async (message: ConsoleMessage) => {
    if (sending || working || busy !== null) {
      return;
    }
    setError(null);
    stopSpeaking();
    setBusy(message.id);
    following.current = true;
    const before = thread;
    if (thread !== null && message.actions.length === 0) {
      // The answer is redone in place: show it working at once.
      setThread({
        ...thread,
        messages: thread.messages.map((item) =>
          item.id === message.id
            ? {
                ...item,
                status: "PENDING",
                content: "",
                note: "",
                canRetry: false,
              }
            : item,
        ),
      });
    }
    try {
      const reply = await post({ intent: "retry", message_id: message.id });
      if (reply.thread) {
        setThread(reply.thread);
      }
    } catch (failure) {
      setThread(before);
      setError(failure instanceof Error ? failure.message : "Try again.");
    } finally {
      setBusy(null);
    }
  };

  const speak = (message: ConsoleMessage) => {
    if (!("speechSynthesis" in window)) {
      setError("Reading aloud is not available in this browser.");
      return;
    }
    if (speaking === message.id) {
      stopSpeaking();
      return;
    }
    window.speechSynthesis.cancel();
    // Spoken by the browser on this device; the text is not sent anywhere.
    const utterance = new SpeechSynthesisUtterance(
      plainText(message.content, "speech"),
    );
    utterance.rate = 1.02;
    utterance.onend = () =>
      setSpeaking((current) => (current === message.id ? null : current));
    utterance.onerror = utterance.onend;
    setSpeaking(message.id);
    window.speechSynthesis.speak(utterance);
  };

  // Stop reading when the conversation changes or the page closes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: stop when the conversation changes.
  useEffect(() => stopSpeaking, [thread?.id, stopSpeaking]);

  const fresh = async () => {
    setError(null);
    try {
      const reply = await post({ intent: "new-thread" });
      if (reply.thread) {
        setThread(reply.thread);
        remember(reply.thread);
        router.refresh();
        box.current?.focus();
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Try again.");
    }
  };

  const notices = (
    <>
      {alert !== null ? <p className="cv-alert">{alert}</p> : null}
      {thread !== null && !thread.modelConfigured ? (
        <p className="cv-alert">
          The assistant is not available in this workspace yet. Ask your
          administrator to turn it on.
        </p>
      ) : null}
    </>
  );
  const failure =
    error !== null ? (
      <p className="cv-error" role="alert">
        <UiIcon name="risk" size={14} />
        {error}
        <button
          type="button"
          className="cv-error-close"
          aria-label="Dismiss"
          onClick={() => setError(null)}
        >
          <UiIcon name="x" size={12} />
        </button>
      </p>
    ) : null;
  const composer = (
    <Composer
      inputRef={box}
      value={draft}
      working={working}
      sending={sending}
      large={empty}
      onChange={(value) => {
        setDraft(value);
        resize();
      }}
      onSend={() => void send(draft)}
    />
  );

  return (
    <section
      className={`cv-chat${empty ? " is-empty" : ""}`}
      aria-label="Conversation with the agents"
    >
      <header className="cv-bar">
        <h1 className="cv-title">
          {empty ? "New chat" : thread?.title || "Conversation"}
        </h1>
        <div className="cv-bar-actions">
          <button
            type="button"
            className="cv-iconbtn"
            onClick={() => void fresh()}
            aria-label="New chat"
            data-tip="New chat"
          >
            <UiIcon name="compose" size={17} />
          </button>
          <button
            type="button"
            className={`cv-iconbtn${panelOpen ? " is-on" : ""}`}
            onClick={onTogglePanel}
            aria-pressed={panelOpen}
            aria-label={
              panelOpen
                ? "Hide chats and what needs you"
                : "Show chats and what needs you"
            }
            data-tip={
              panelOpen ? "Hide the side panel" : "Chats and what needs you"
            }
          >
            <UiIcon name="panel" size={17} />
            {waitingCount > 0 ? (
              <span className="cv-badge">{waitingCount}</span>
            ) : null}
          </button>
        </div>
      </header>
      {empty ? (
        <div className="cv-hero">
          <div className="cv-hero-inner">
            <h2>{hello === "" ? " " : `${hello}.`}</h2>
            <p>What should the workforce do on {engagement}?</p>
            {notices}
            {failure}
            {composer}
            <fieldset className="cv-chips">
              <legend className="sr-only">Suggestions</legend>
              {STARTERS.map((starter) => (
                <button
                  key={starter.title}
                  type="button"
                  className="cv-chip"
                  onClick={() => void send(starter.text)}
                  title={starter.text}
                >
                  <UiIcon name={starter.icon} size={14} />
                  {starter.title}
                </button>
              ))}
            </fieldset>
            <p className="cv-footnote">
              Agents read the engagement and do routine work. Anything that
              reaches a client or signs off waits for your approval.
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="cv-column" ref={column}>
            {notices}
            {messages.map((message) => (
              <Message
                key={message.id}
                message={message}
                busy={busy}
                onAct={act}
                locked={sending || working || busy !== null}
                speaking={speaking === message.id}
                onSpeak={() => speak(message)}
                onRetry={() => void retry(message)}
                fileHref={(fileId) =>
                  `/?organization=${organizationId}&project=${projectId}&section=evidence&file=${fileId}`
                }
                ids={{ organizationId, projectId }}
              />
            ))}
          </div>
          <div className="cv-dock">
            {away ? (
              <button
                type="button"
                className="cv-latest"
                onClick={() => {
                  following.current = true;
                  toEnd("smooth");
                }}
                aria-label="Jump to the latest message"
              >
                <UiIcon name="arrowDown" size={16} />
              </button>
            ) : null}
            <div className="cv-dock-inner">
              {failure}
              {composer}
              <p className="cv-footnote">
                Anything that reaches a client or signs off waits for your
                approval.
              </p>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

/** Where the person writes: it grows with the message, and sends on Enter. */
function Composer({
  inputRef,
  value,
  working,
  sending,
  large,
  onChange,
  onSend,
}: {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  working: boolean;
  sending: boolean;
  /** The first message of a chat: a roomier box in the middle of the page. */
  large: boolean;
  onChange: (value: string) => void;
  onSend: () => void;
}) {
  const ready = value.trim() !== "" && !working && !sending;
  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      if (ready) {
        onSend();
      }
    }
  };
  return (
    <form
      autoComplete="off"
      className={`cv-composer${large ? " is-large" : ""}${working ? " is-working" : ""}`}
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) {
          onSend();
        }
      }}
    >
      <label className="sr-only" htmlFor="chat-input">
        Message the agents
      </label>
      <textarea
        id="chat-input"
        ref={inputRef}
        rows={large ? 2 : 1}
        maxLength={4000}
        value={value}
        placeholder={
          working ? "Write your next message…" : "Ask the agents anything"
        }
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKey}
      />
      <button
        type="submit"
        className="cv-send"
        disabled={!ready}
        aria-label={working ? "The agent is answering" : "Send"}
        data-tip={working ? "Wait for the answer to finish" : undefined}
      >
        {sending || working ? (
          <span className="cv-send-wait" aria-hidden="true" />
        ) : (
          <UiIcon name="arrowUp" size={17} />
        )}
      </button>
    </form>
  );
}

/** The open answer's citations and where its files open, for the chips in its text. */
const Sources = createContext<{
  citations: readonly Citation[];
  fileHref: (fileId: string) => string;
  /** Opens the cited file itself, with its cited passages marked. */
  openFile: (fileId: string) => void;
}>({ citations: [], fileHref: () => "#", openFile: () => undefined });

function CitationChip({
  number,
  quoted = false,
}: {
  number: number;
  /** After a colon, the sentence introduces the quote: show it inline. */
  quoted?: boolean;
}) {
  const { citations, fileHref, openFile } = useContext(Sources);
  const [open, setOpen] = useState(false);
  const citation = citations.find((item) => item.number === number);
  if (citation === undefined) {
    return null;
  }
  return (
    <span className="cite">
      {quoted ? <q className="cite-quote">{citation.quote}</q> : null}
      <button
        type="button"
        className={`cite-chip${open ? " is-open" : ""}`}
        aria-expanded={open}
        aria-label={`Source ${number}: ${citation.fileName}`}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
          }
        }}
        onBlur={(event) => {
          if (
            !event.currentTarget.parentElement?.contains(event.relatedTarget)
          ) {
            setOpen(false);
          }
        }}
      >
        {number}
      </button>
      {open ? (
        <span
          className="cite-card"
          role="dialog"
          aria-label={`Source ${number}`}
        >
          <span className="cite-head">
            <span className="cite-num">{number}</span>
            <span className="cite-file">
              <strong title={citation.fileName}>{citation.fileName}</strong>
              {citation.location !== "" ? (
                <small>{citation.location}</small>
              ) : null}
            </span>
          </span>
          <span className="cite-passage">
            {citation.before !== "" ? <span>…{citation.before}</span> : null}
            <mark>{citation.quote}</mark>
            {citation.after !== "" ? <span>{citation.after}…</span> : null}
          </span>
          <span className="cite-actions">
            <button
              type="button"
              className="cite-open"
              onClick={() => {
                setOpen(false);
                openFile(citation.fileId);
              }}
            >
              <UiIcon name="grid" size={12} /> View the evidence
            </button>
            <a className="cite-link" href={fileHref(citation.fileId)}>
              Evidence page <UiIcon name="arrow" size={12} />
            </a>
          </span>
        </span>
      ) : null}
    </span>
  );
}

function SourceList() {
  const { citations, openFile } = useContext(Sources);
  if (citations.length === 0) {
    return null;
  }
  return (
    <div className="cv-sources">
      <span className="cv-sources-label">
        <UiIcon name="copy" size={12} /> Sources
      </span>
      {citedFiles(citations).map((file) => {
        const mine = citations.filter((item) => item.fileId === file.id);
        const first = mine[0];
        return (
          <button
            key={file.id}
            type="button"
            className="cv-source"
            onClick={() => openFile(file.id)}
            title={`View the evidence with ${mine.length === 1 ? "this passage" : "these passages"} marked`}
          >
            <span className="cv-source-num">
              {mine.length === 1
                ? first?.number
                : mine.map((item) => item.number).join(" ")}
            </span>
            <span className="cv-source-name">{file.fileName}</span>
            <small>
              {mine.length === 1 && first !== undefined && first.location !== ""
                ? first.location
                : `${mine.length} passages`}
            </small>
          </button>
        );
      })}
    </div>
  );
}

function Text({ parts }: { parts: Inline[] }) {
  // A citation right after a colon is introduced by the sentence: its quote shows inline.
  const q = parts.map((_, index) => /:\s*$/.test(parts[index - 1]?.text ?? ""));
  return (
    <>
      {parts.map((part, index) => {
        if (part.cite !== undefined) {
          return (
            <CitationChip
              // biome-ignore lint/suspicious/noArrayIndexKey: parts of one line keep their order.
              key={index}
              number={part.cite}
              quoted={q[index] === true}
            />
          );
        }
        let node: ReactNode = part.text;
        if (part.code) {
          node = <code>{node}</code>;
        }
        if (part.em) {
          node = <em>{node}</em>;
        }
        if (part.strong) {
          node = <strong>{node}</strong>;
        }
        if (part.href !== undefined) {
          // Only the web or a page of this app (safeHref); the web opens on its own.
          node = part.href.startsWith("/") ? (
            <a href={part.href}>{node}</a>
          ) : (
            <a href={part.href} target="_blank" rel="noopener noreferrer">
              {node}
            </a>
          );
        }
        // biome-ignore lint/suspicious/noArrayIndexKey: parts of one line keep their order.
        return <span key={index}>{node}</span>;
      })}
    </>
  );
}

function Items({
  ordered,
  start = 1,
  items,
}: {
  ordered: boolean;
  start?: number;
  items: Array<{
    parts: Inline[];
    children?: { ordered: boolean; items: Inline[][] };
  }>;
}) {
  const body = items.map((item, index) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: items keep their order.
    <li key={index}>
      <Text parts={item.parts} />
      {item.children !== undefined ? (
        <Items
          ordered={item.children.ordered}
          items={item.children.items.map((parts) => ({ parts }))}
        />
      ) : null}
    </li>
  ));
  return ordered ? (
    <ol start={start === 1 ? undefined : start}>{body}</ol>
  ) : (
    <ul>{body}</ul>
  );
}

function Piece({ block }: { block: Block }) {
  switch (block.kind) {
    case "heading":
      return block.level === 2 ? (
        <h3>
          <Text parts={block.parts} />
        </h3>
      ) : block.level === 3 ? (
        <h4>
          <Text parts={block.parts} />
        </h4>
      ) : (
        <h5>
          <Text parts={block.parts} />
        </h5>
      );
    case "list":
      return (
        <Items
          ordered={block.ordered}
          start={block.start}
          items={block.items}
        />
      );
    case "table":
      return (
        <div className="prose-table">
          <table>
            <thead>
              <tr>
                {block.header.map((cell, cellIndex) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: columns keep their order.
                  <th key={cellIndex} scope="col">
                    <Text parts={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: rows keep their order.
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: columns keep their order.
                    <td key={cellIndex}>
                      <Text parts={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "code":
      return (
        <pre className="prose-code">
          <code>{block.text}</code>
        </pre>
      );
    case "quote":
      return (
        <blockquote>
          <Text parts={block.parts} />
        </blockquote>
      );
    case "rule":
      return <hr />;
    default:
      return (
        <p>
          <Text parts={block.parts} />
        </p>
      );
  }
}

function Prose({
  content,
  streaming = false,
}: {
  content: string;
  /** Still being written: the end shows where the next words land. */
  streaming?: boolean;
}) {
  return (
    <div className={`prose${streaming ? " is-streaming" : ""}`}>
      {blocks(content).map((block, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: blocks of one reply keep their order.
        <Piece key={index} block={block} />
      ))}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      className={`cv-tool${copied ? " is-on" : ""}`}
      aria-label={copied ? "Copied" : "Copy"}
      data-tip={copied ? "Copied" : "Copy"}
      onClick={() => {
        void navigator.clipboard
          ?.writeText(text)
          .then(() => setCopied(true))
          .catch(() => setCopied(false));
      }}
    >
      <UiIcon name={copied ? "check" : "copy"} size={14} />
    </button>
  );
}

function Message({
  message,
  busy,
  onAct,
  locked,
  speaking,
  onSpeak,
  onRetry,
  fileHref,
  ids,
}: {
  message: ConsoleMessage;
  busy: string | null;
  onAct: (intent: "confirm" | "confirm-all" | "cancel", id: string) => void;
  locked: boolean;
  speaking: boolean;
  onSpeak: () => void;
  onRetry: () => void;
  /** Where a cited file opens: its panel on the Evidence page. */
  fileHref: (fileId: string) => string;
  ids: { organizationId: string; projectId: string };
}) {
  const [previewing, setPreviewing] = useState<string | null>(null);
  const working = message.status === "PENDING" || message.status === "WORKING";
  const written = useFlowingText(message.content, working);
  if (message.role === "USER") {
    return (
      <div className="cv-msg cv-msg-user">
        <div className="cv-bubble">{message.content}</div>
        <div className="cv-tools">
          <CopyButton text={message.content} />
        </div>
      </div>
    );
  }
  const failed = message.status === "FAILED";
  // A file the agent made shows as the file itself; other routine work as a line.
  const files = message.actions.filter(
    (action) => action.status === "DONE" && action.file !== null,
  );
  const routine = message.actions.filter(
    (action) => action.risk === "ROUTINE" && !files.includes(action),
  );
  const steps = message.actions.filter((action) => action.risk === "CONFIRM");
  const open = steps.filter((action) => action.status === "PROPOSED");
  return (
    <article
      className={`cv-msg cv-msg-agent${failed ? " is-failed" : ""}${working ? " is-working" : ""}`}
      aria-busy={working}
    >
      {working ? (
        <>
          <p className="cv-thinking" aria-live="polite">
            <span className="cv-spark" aria-hidden="true">
              <UiIcon name="sparkles" size={14} />
            </span>
            <span className="cv-shimmer">
              {message.note || (written === "" ? "Thinking" : "Writing")}
            </span>
          </p>
          {written !== "" ? (
            <Prose content={writtenSoFar(written)} streaming />
          ) : null}
        </>
      ) : failed ? (
        <div className="cv-failed" role="status">
          <UiIcon name="risk" size={15} />
          <div>
            <strong>{message.content}</strong>
            {message.note !== "" ? <span>{message.note}</span> : null}
          </div>
          {message.canRetry ? (
            <button
              type="button"
              className="cv-btn"
              disabled={locked}
              onClick={onRetry}
            >
              <UiIcon name="retry" size={13} /> Retry
            </button>
          ) : null}
        </div>
      ) : (
        <Sources.Provider
          value={{
            citations: message.citations,
            fileHref,
            openFile: setPreviewing,
          }}
        >
          <Prose content={message.content} />
          <SourceList />
          {previewing !== null ? (
            <EvidencePreview
              organizationId={ids.organizationId}
              projectId={ids.projectId}
              files={citedFiles(message.citations)}
              citations={previewCitations(message.citations)}
              startFileId={previewing}
              title="The evidence this answer cites"
              sourcesTitle="What the answer cites"
              onClose={() => setPreviewing(null)}
            />
          ) : null}
        </Sources.Provider>
      )}
      {!working && !failed && message.note !== "" ? (
        <p className="cv-note">{message.note}</p>
      ) : null}
      {files.length > 0 ? (
        <div className="cv-files">
          {files.map((action) =>
            action.file === null ? null : (
              <FileCard
                key={action.id}
                file={action.file}
                organizationId={ids.organizationId}
              />
            ),
          )}
        </div>
      ) : null}
      {routine.length > 0 ? (
        <div className="cv-ran">
          {routine.map((action) => (
            <span
              key={action.id}
              className={`cv-ran-chip ${action.status === "DONE" ? "is-done" : "is-failed"}`}
              title={action.error || undefined}
            >
              <UiIcon
                name={action.status === "DONE" ? "check" : "x"}
                size={11}
              />
              {action.summary}
            </span>
          ))}
        </div>
      ) : null}
      {steps.length > 0 ? (
        <div className={`cv-steps${open.length > 0 ? " has-open" : ""}`}>
          <div className="cv-steps-head">
            <div>
              <strong>
                {open.length > 0
                  ? `${open.length} step${open.length === 1 ? "" : "s"} ready for you`
                  : "Steps"}
              </strong>
              <span>
                {open.length > 0
                  ? "Each runs as you, through the usual checks."
                  : "All steps are settled."}
              </span>
            </div>
            {open.length > 1 ? (
              <button
                type="button"
                className="cv-btn"
                disabled={busy !== null}
                onClick={() => onAct("confirm-all", message.id)}
              >
                {busy === message.id ? (
                  <span className="spinner small" aria-hidden="true" />
                ) : (
                  <UiIcon name="check" size={13} />
                )}
                Approve all
              </button>
            ) : null}
          </div>
          <ol>
            {steps.map((action) => (
              <Step
                key={action.id}
                action={action}
                busy={busy}
                onAct={onAct}
                running={busy === message.id && action.status === "PROPOSED"}
              />
            ))}
          </ol>
        </div>
      ) : null}
      {!working && !failed && message.content !== "" ? (
        <div className="cv-tools" role="toolbar" aria-label="Answer actions">
          <CopyButton text={plainText(message.content, "copy")} />
          <button
            type="button"
            className={`cv-tool${speaking ? " is-on" : ""}`}
            aria-label={speaking ? "Stop reading" : "Read aloud"}
            aria-pressed={speaking}
            data-tip={speaking ? "Stop reading" : "Read aloud"}
            onClick={onSpeak}
          >
            <UiIcon name={speaking ? "stop" : "speaker"} size={14} />
            {speaking ? (
              <span className="speaking-bars" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
            ) : null}
          </button>
          {message.canRetry ? (
            <button
              type="button"
              className="cv-tool"
              aria-label="Retry"
              data-tip={
                open.length > 0
                  ? "Retry: answers again and skips these steps"
                  : "Retry"
              }
              disabled={locked}
              onClick={onRetry}
            >
              <UiIcon name="retry" size={14} />
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

/** A file the agent made: what it holds, as of when, and the way to download it. */
const FORMAT_NAMES: Record<ConsoleFile["fileFormat"], string> = {
  xlsx: "Excel",
  csv: "CSV",
  pdf: "PDF",
  docx: "Word",
};

function FileCard({
  file,
  organizationId,
}: {
  file: ConsoleFile;
  organizationId: string;
}) {
  const asOf = new Date(file.asOf);
  const when = Number.isNaN(asOf.getTime())
    ? ""
    : `${asOf.toLocaleString("en-US", {
        timeZone: "UTC",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      })} UTC`;
  return (
    <a className="cv-file" href={fileHref(file, organizationId)} download>
      <span className={`cv-file-icon is-${file.fileFormat}`} aria-hidden="true">
        <UiIcon
          name={
            file.fileFormat === "xlsx" || file.fileFormat === "csv"
              ? "table"
              : "file"
          }
          size={18}
        />
      </span>
      <span className="cv-file-text">
        <strong>{file.fileName}</strong>
        <small>
          {FORMAT_NAMES[file.fileFormat]} ·{" "}
          {REPORT_TITLES[file.dataset] ??
            `${file.rows.toLocaleString("en-US")} record${file.rows === 1 ? "" : "s"}`}{" "}
          · {filtersLine(file.filters)}
          {when !== "" ? ` · data as of ${when}` : ""}
        </small>
      </span>
      <span className="cv-file-action">
        <UiIcon name="arrowDown" size={15} />
        Download
      </span>
    </a>
  );
}

const STEP_WORDS: Record<ConsoleAction["status"], string> = {
  PROPOSED: "Waiting for you",
  DONE: "Done",
  FAILED: "Did not run",
  CANCELLED: "Skipped",
};

function Step({
  action,
  busy,
  onAct,
  running,
}: {
  action: ConsoleAction;
  busy: string | null;
  onAct: (intent: "confirm" | "confirm-all" | "cancel", id: string) => void;
  running: boolean;
}) {
  const pending = action.status === "PROPOSED";
  const mine = busy === action.id || running;
  return (
    <li className={`cv-step is-${action.status.toLowerCase()}`}>
      <span className="cv-step-icon" aria-hidden="true">
        {mine ? (
          <span className="spinner small" />
        ) : action.status === "DONE" ? (
          <UiIcon name="check" size={14} />
        ) : action.status === "FAILED" ? (
          <UiIcon name="x" size={14} />
        ) : action.status === "CANCELLED" ? (
          <UiIcon name="stop" size={13} />
        ) : (
          <UiIcon name={STEP_ICONS[action.tool] ?? "arrow"} size={14} />
        )}
      </span>
      <span className="cv-step-text">
        <strong>{action.summary}</strong>
        <small>
          {action.label}
          {!pending ? ` · ${stepOutcome(action)}` : ""}
        </small>
        {action.error !== "" ? (
          <small className="cv-step-error">{action.error}</small>
        ) : null}
      </span>
      {pending ? (
        <span className="cv-step-actions">
          <button
            type="button"
            className="cv-btn-ghost"
            disabled={busy !== null}
            onClick={() => onAct("cancel", action.id)}
          >
            Skip
          </button>
          <button
            type="button"
            className="cv-btn"
            disabled={busy !== null}
            onClick={() => onAct("confirm", action.id)}
          >
            Approve
          </button>
        </span>
      ) : (
        <span className="cv-step-state">{STEP_WORDS[action.status]}</span>
      )}
    </li>
  );
}

const STEP_ICONS: Record<
  string,
  "mail" | "check" | "table" | "shield" | "risk"
> = {
  submit_request: "mail",
  send_request: "mail",
  draft_request: "mail",
  edit_request: "mail",
  update_request_status: "mail",
  decide_approval: "check",
  approve_samples: "table",
  replace_sample: "table",
  confirm_evidence_kind: "check",
  sign_off_review: "shield",
  sign_off_testing: "shield",
  sign_off_control_review: "shield",
  decide_review_note: "shield",
  raise_review_note: "shield",
  respond_review_note: "shield",
  clear_review_note: "shield",
  log_deficiency: "risk",
  decide_test_deficiency: "risk",
  override_test_result: "table",
  link_evidence: "table",
};
