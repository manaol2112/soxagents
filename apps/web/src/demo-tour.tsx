"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { AgentAvatar } from "./agent-avatar";
import {
  moveOutcome,
  nextStage,
  onStagePage,
  previousStage,
  progressLabel,
  STAGE_KEYS,
  type StageKey,
  secondExampleHref,
  stageHref,
  stageOf,
  type TourState,
  type TourStatus,
  WELCOME_COPY,
} from "./demo-tour-model";
import { RecordDialog } from "./record-dialog";
import { UiIcon } from "./ui-icon";

const COLLAPSED_KEY = "aw.demo.guide.collapsed";
const PAD = 8;

type Rect = { top: number; left: number; width: number; height: number };

async function move(
  organizationId: string,
  stage: StageKey,
  status: TourStatus,
): Promise<{ status: number; body: unknown }> {
  try {
    const response = await fetch("/workspace/demo/tour", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ organization_id: organizationId, stage, status }),
    });
    return (await response.json()) as { status: number; body: unknown };
  } catch {
    return { status: 0, body: null };
  }
}

function collapsedStored(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === "yes";
  } catch {
    return false;
  }
}

function storeCollapsed(value: boolean): void {
  try {
    window.localStorage.setItem(COLLAPSED_KEY, value ? "yes" : "no");
  } catch {
    // A browser without storage still shows the guide; it only forgets the fold.
  }
}

/** The union of the parts a stage points at, as drawn now; null when none is on the page. */
function measure(selectors: readonly string[]): Rect | null {
  for (const selector of selectors) {
    const found = Array.from(document.querySelectorAll(selector)).filter(
      (element) => element.getClientRects().length > 0,
    );
    if (found.length === 0) {
      continue;
    }
    const boxes = found.map((element) => element.getBoundingClientRect());
    const top = Math.min(...boxes.map((box) => box.top)) - PAD;
    const left = Math.min(...boxes.map((box) => box.left)) - PAD;
    const right = Math.max(...boxes.map((box) => box.right)) + PAD;
    const bottom = Math.max(...boxes.map((box) => box.bottom)) + PAD;
    return { top, left, width: right - left, height: bottom - top };
  }
  return null;
}

/**
 * The welcome to the demo engagement (Step 5): once, on a member's first visit, over the
 * engagement's page. "Start guided tour" records the start and opens the first stage;
 * "Explore independently" records the choice so the welcome does not come back, and the
 * tour stays one click away in the top bar. Nothing here calls an AI agent.
 */
export function DemoWelcome({
  organizationId,
  projectId,
  tour,
  closeHref,
}: {
  organizationId: string;
  projectId: string;
  tour: TourState;
  closeHref: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"start" | "explore" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const answer = async (choice: "start" | "explore") => {
    if (busy !== null) {
      return;
    }
    setBusy(choice);
    setProblem(null);
    const result = await move(
      organizationId,
      "overview",
      choice === "start" ? "IN_PROGRESS" : "SKIPPED",
    );
    const words = moveOutcome(result.status, result.body);
    if (words !== null) {
      setProblem(words);
      setBusy(null);
      return;
    }
    startTransition(() => {
      if (choice === "start") {
        router.push(
          stageHref("overview", organizationId, projectId, tour.anchors),
        );
      } else {
        router.replace(closeHref, { scroll: false });
      }
      router.refresh();
    });
  };

  return (
    <RecordDialog
      className="demo-dialog demo-welcome"
      eyebrow={WELCOME_COPY.eyebrow}
      title={WELCOME_COPY.title}
      closeHref={closeHref}
      onClose={() => void answer("explore")}
    >
      <div className="demo-invite" aria-busy={busy !== null}>
        <p className="demo-lead">{WELCOME_COPY.lead}</p>
        <p className="demo-welcome-detail">{WELCOME_COPY.detail}</p>
        <ol className="demo-welcome-stages" aria-label="The tour's stages">
          {STAGE_KEYS.map((key) => (
            <li key={key}>{stageOf(key).title}</li>
          ))}
        </ol>
        {problem !== null ? (
          <p className="demo-outcome is-failed" role="alert">
            <UiIcon name="info" size={15} />
            <span>{problem}</span>
          </p>
        ) : null}
        <div className="demo-actions">
          <button
            type="button"
            className="btn"
            onClick={() => void answer("start")}
            disabled={busy !== null}
          >
            {busy === "start" ? "Opening the tour…" : WELCOME_COPY.start}
            <UiIcon name="arrow" size={15} />
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void answer("explore")}
            disabled={busy !== null}
          >
            {busy === "explore" ? "One moment…" : WELCOME_COPY.explore}
          </button>
        </div>
        <p className="demo-note">
          <UiIcon name="sparkles" size={14} />
          <span>{WELCOME_COPY.mix}</span>
        </p>
      </div>
    </RecordDialog>
  );
}

/**
 * The guide panel (Step 5): a small card docked at the corner of the page while the tour
 * runs, with the stage, its words, its progress, and the way forward, back, out and
 * back in. It points at the part of the page the stage is about and never covers the
 * application: everything beneath stays usable. Progress is kept on the person's account
 * by the server; a skipped or finished tour shows only a quiet offer to resume.
 */
export function DemoGuide({
  organizationId,
  projectId,
  tour,
}: {
  organizationId: string;
  projectId: string;
  tour: TourState;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [, startTransition] = useTransition();
  const [status, setStatus] = useState<TourStatus>(tour.status);
  const [stage, setStage] = useState<StageKey>(tour.stage);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [spot, setSpot] = useState<Rect | null>(null);
  const panel = useRef<HTMLElement>(null);
  const synced = useRef<string | null>(null);

  useEffect(() => {
    setCollapsed(collapsedStored());
  }, []);
  useEffect(() => {
    setStatus(tour.status);
    setStage(tour.stage);
  }, [tour.status, tour.stage]);

  const here = onStagePage(stage, params, tour.anchors);
  const current = stageOf(stage);

  // A stage address opened directly (a link, the top bar's "Resume") moves the tour to
  // that stage once, so the record follows the person.
  useEffect(() => {
    const asked = params.get("tour");
    if (
      status !== "IN_PROGRESS" ||
      asked === null ||
      asked === stage ||
      synced.current === asked ||
      !(STAGE_KEYS as readonly string[]).includes(asked)
    ) {
      return;
    }
    synced.current = asked;
    const wanted = asked as StageKey;
    setStage(wanted);
    void move(organizationId, wanted, "IN_PROGRESS");
  }, [params, stage, status, organizationId]);

  // The spotlight: where the stage's part of the page is drawn now.
  useLayoutEffect(() => {
    if (status !== "IN_PROGRESS" || !here || collapsed) {
      setSpot(null);
      return;
    }
    let frame = 0;
    const update = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() =>
        setSpot(measure(current.targets)),
      );
    };
    update();
    const settle = window.setTimeout(update, 450);
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(settle);
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [status, here, collapsed, current]);

  const go = useCallback(
    (href: string) => {
      startTransition(() => {
        router.push(href);
      });
    },
    [router],
  );

  const record = async (
    next: StageKey,
    nextStatus: TourStatus,
    then: (() => void) | null,
  ) => {
    if (busy) {
      return;
    }
    setBusy(true);
    setProblem(null);
    const result = await move(organizationId, next, nextStatus);
    const words = moveOutcome(result.status, result.body);
    setBusy(false);
    if (words !== null) {
      setProblem(words);
      return;
    }
    setStage(next);
    setStatus(nextStatus);
    then?.();
  };

  const fold = useCallback((value: boolean) => {
    setCollapsed(value);
    storeCollapsed(value);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !collapsed && status === "IN_PROGRESS") {
        fold(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [collapsed, status, fold]);

  if (!tour.available) {
    return null;
  }

  if (status === "SKIPPED" || status === "COMPLETED") {
    return (
      <div className="dg dg-resume">
        <button
          type="button"
          className="dg-pill"
          disabled={busy}
          onClick={() =>
            void record(stage, "IN_PROGRESS", () =>
              go(stageHref(stage, organizationId, projectId, tour.anchors)),
            )
          }
        >
          <UiIcon name="sparkles" size={14} />
          <span>
            {status === "COMPLETED"
              ? "Take the tour again"
              : "Resume guided tour"}
          </span>
          <small>{progressLabel(stage)}</small>
        </button>
        {problem !== null ? (
          <p className="dg-problem" role="alert">
            {problem}
          </p>
        ) : null}
      </div>
    );
  }
  if (status !== "IN_PROGRESS") {
    return null;
  }

  if (collapsed) {
    return (
      <div className="dg dg-resume">
        <button
          type="button"
          className="dg-pill"
          onClick={() => fold(false)}
          aria-expanded="false"
          aria-controls="demo-guide"
        >
          <UiIcon name="sparkles" size={14} />
          <span>Guided tour</span>
          <small>{progressLabel(stage)}</small>
        </button>
      </div>
    );
  }

  const before = previousStage(stage);
  const after = nextStage(stage);
  const href = stageHref(stage, organizationId, projectId, tour.anchors);
  const second =
    stage === "remediation"
      ? secondExampleHref(organizationId, projectId, tour.anchors)
      : null;
  const failed = stage === "testing" ? (tour.anchors?.failedSample ?? "") : "";

  return (
    <>
      {spot !== null ? (
        <div
          className="dg-spot"
          aria-hidden="true"
          style={{
            top: spot.top,
            left: spot.left,
            width: spot.width,
            height: spot.height,
          }}
        />
      ) : null}
      <aside
        id="demo-guide"
        ref={panel}
        className="dg dg-panel"
        aria-label="Guided tour"
        aria-busy={busy}
      >
        <header className="dg-head">
          <AgentAvatar
            size={40}
            label="Guide"
            state={busy ? "working" : "idle"}
          />
          <div className="dg-head-text">
            <strong>Guided tour</strong>
            <span className="dg-progress-label">{progressLabel(stage)}</span>
          </div>
          <button
            type="button"
            className="dg-icon"
            onClick={() => fold(true)}
            aria-label="Collapse the guided tour"
            aria-expanded="true"
            aria-controls="demo-guide"
          >
            <UiIcon name="chevron" size={14} />
          </button>
        </header>
        <ol className="dg-steps" aria-label="Stages">
          {STAGE_KEYS.map((key) => (
            <li
              key={key}
              className={
                key === stage
                  ? "is-current"
                  : stageOf(key).number < current.number
                    ? "is-done"
                    : ""
              }
              aria-current={key === stage ? "step" : undefined}
            >
              <span className="sr-only">{stageOf(key).title}</span>
            </li>
          ))}
        </ol>
        <h2 className="dg-title">{current.title}</h2>
        <p className="dg-lead">{current.lead}</p>
        {here ? (
          <ul className="dg-points">
            {current.points.map((point) => (
              <li key={point}>
                <UiIcon name="check" size={13} />
                <span>{point}</span>
              </li>
            ))}
            {failed !== "" ? (
              <li className="dg-point-strong">
                <UiIcon name="info" size={13} />
                <span>Failed sample to inspect: {failed}.</span>
              </li>
            ) : null}
          </ul>
        ) : null}
        {current.note !== null ? (
          <p className="dg-note">
            <UiIcon name="info" size={13} />
            <span>{current.note}</span>
          </p>
        ) : null}
        {problem !== null ? (
          <p className="dg-problem" role="alert">
            {problem}
          </p>
        ) : null}
        <div className="dg-actions">
          {!here ? (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => go(href)}
              disabled={busy}
            >
              {current.action}
              <UiIcon name="arrow" size={13} />
            </button>
          ) : after !== null ? (
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy}
              onClick={() =>
                void record(after, "IN_PROGRESS", () =>
                  go(stageHref(after, organizationId, projectId, tour.anchors)),
                )
              }
            >
              Next: {stageOf(after).title}
              <UiIcon name="arrow" size={13} />
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy}
              onClick={() => void record(stage, "COMPLETED", null)}
            >
              Finish tour
              <UiIcon name="check" size={13} />
            </button>
          )}
          {here && second !== null ? (
            <a className="btn btn-secondary btn-sm" href={second}>
              Open D-003
            </a>
          ) : null}
          {before !== null ? (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={busy}
              onClick={() =>
                void record(before, "IN_PROGRESS", () =>
                  go(
                    stageHref(before, organizationId, projectId, tour.anchors),
                  ),
                )
              }
            >
              Previous
            </button>
          ) : null}
          <button
            type="button"
            className="dg-skip"
            disabled={busy}
            onClick={() => void record(stage, "SKIPPED", null)}
          >
            Skip tour
          </button>
        </div>
      </aside>
    </>
  );
}
