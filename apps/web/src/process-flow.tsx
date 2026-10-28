"use client";

import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { ProcessStep } from "./control-context-model";
import {
  BASIS_LABEL,
  fitScale,
  flowSummary,
  type StepKind,
  stepKind,
  stepTitle,
  swimlaneLayout,
  zoomStep,
} from "./process-flow-model";
import { type IconName, UiIcon } from "./ui-icon";

const KIND_ICON: Record<StepKind, IconName> = {
  control: "shield",
  system: "database",
  person: "file",
};

/** Each lane takes the next of four tones, so roles read apart at a glance. */
const LANE_TONES = ["accent", "success", "ai", "warning"] as const;

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

/**
 * The narrative's steps as a swimlane diagram (the product owner's reference of 27
 * October 2026): a lane for each role, a card for each step with its system and the
 * control where it operates, decisions as diamonds whose Yes and No lead where the
 * narrative says, and the step's detail beside it. The diagram zooms, pans, fits the view,
 * and opens full screen for a long process.
 */
export function ProcessFlow({
  steps,
  attributes,
  controlRef = "",
}: {
  steps: ProcessStep[];
  attributes: Array<{ code: string; text: string }>;
  /** The control's reference, shown where it operates (Control ITGC-AC-04). */
  controlRef?: string;
}) {
  const layout = useMemo(() => swimlaneLayout(steps), [steps]);
  const summary = flowSummary(steps);
  const view = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState<[number, number]>([0, 0]);
  const [full, setFull] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  // Fitted until the person zooms or pans; then the view stays theirs.
  const fitted = useRef(true);
  const drag = useRef<{ x: number; y: number; from: [number, number] } | null>(
    null,
  );

  const fit = useCallback(() => {
    const node = view.current;
    if (node === null) {
      return;
    }
    const next = fitScale(layout, {
      width: node.clientWidth,
      height: node.clientHeight,
    });
    setScale(next);
    setOffset([
      Math.max(16, (node.clientWidth - layout.width * next) / 2),
      Math.max(16, (node.clientHeight - layout.height * next) / 2),
    ]);
    fitted.current = true;
  }, [layout]);

  // Fit on first view, when the steps change, when full screen opens or closes, and when
  // the view is resized, as long as the person has not moved it themselves.
  // biome-ignore lint/correctness/useExhaustiveDependencies: full re-fits on open and close.
  useEffect(() => {
    const node = view.current;
    if (node === null) {
      return;
    }
    fitted.current = true;
    fit();
    const observer = new ResizeObserver(() => {
      if (fitted.current) {
        fit();
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [fit, full]);

  // Full screen: Escape closes it, and the page beneath does not scroll.
  useEffect(() => {
    if (!full) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setFull(false);
      }
    };
    document.addEventListener("keydown", onKey);
    document.body.classList.add("has-dialog");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("has-dialog");
    };
  }, [full]);

  const zoom = (direction: 1 | -1) => {
    const node = view.current;
    const next = zoomStep(scale, direction);
    if (node !== null) {
      // Zoom about the middle of the view.
      const cx = node.clientWidth / 2;
      const cy = node.clientHeight / 2;
      setOffset([
        cx - ((cx - offset[0]) * next) / scale,
        cy - ((cy - offset[1]) * next) / scale,
      ]);
    }
    setScale(next);
    fitted.current = false;
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // Panning starts on the canvas itself, never on a step.
    if ((event.target as HTMLElement).closest("button") !== null) {
      return;
    }
    drag.current = { x: event.clientX, y: event.clientY, from: offset };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (start === null) {
      return;
    }
    setOffset([
      start.from[0] + event.clientX - start.x,
      start.from[1] + event.clientY - start.y,
    ]);
    fitted.current = false;
  };
  const endDrag = () => {
    drag.current = null;
  };

  const chosen = selected === null ? undefined : steps[selected];
  const chosenLane =
    selected === null ? 0 : (layout.nodes[selected]?.lane ?? 0);

  return (
    <div className={`pf${full ? " is-full" : ""}`}>
      <div className="pf-bar">
        <p className="pf-summary">
          <span>
            <UiIcon name="file" size={14} />
            {plural(summary.steps, "step")}
          </span>
          <span>
            <UiIcon name="shield" size={14} />
            {plural(summary.controls, "control point")}
          </span>
          <span>
            <UiIcon name="agents" size={14} />
            {plural(summary.owners, "owner")}
          </span>
          <span>
            <UiIcon name="flow" size={14} />
            {plural(summary.decisions, "decision")}
          </span>
        </p>
        <span className="pf-tools">
          <button type="button" className="btn-secondary btn-sm" onClick={fit}>
            <UiIcon name="fit" size={14} />
            Fit view
          </button>
          <button
            type="button"
            className="btn-secondary btn-sm"
            aria-pressed={full}
            onClick={() => setFull(!full)}
          >
            <UiIcon name={full ? "collapse" : "expand"} size={14} />
            {full ? "Exit full screen" : "Full screen"}
          </button>
        </span>
      </div>
      <div className={`pf-body${chosen !== undefined ? " has-detail" : ""}`}>
        <div
          ref={view}
          className="pf-view"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onWheel={(event) => {
            if (event.ctrlKey || event.metaKey) {
              event.preventDefault();
              zoom(event.deltaY < 0 ? 1 : -1);
            }
          }}
        >
          <section
            aria-label="Process flow"
            className="pf-canvas"
            style={{
              width: layout.width,
              height: layout.height,
              transform: `translate(${offset[0]}px, ${offset[1]}px) scale(${scale})`,
            }}
          >
            {layout.lanes.map((lane, index) => (
              <div
                key={lane.name}
                className={`pf-lane is-${LANE_TONES[index % LANE_TONES.length]}`}
                style={{ top: lane.y, height: lane.h, width: layout.width }}
              >
                <div className="pf-lane-label">
                  <span className="pf-lane-icon">
                    <UiIcon name={index === 0 ? "user" : "agents"} size={18} />
                  </span>
                  <strong>{lane.name}</strong>
                  <small>{plural(lane.steps, "step")}</small>
                </div>
              </div>
            ))}
            <svg
              className="pf-wires"
              width={layout.width}
              height={layout.height}
              aria-hidden="true"
            >
              <defs>
                <marker
                  id="pf-arrow"
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto-start-reverse"
                >
                  <path d="M0 0 L10 5 L0 10 z" />
                </marker>
                <marker
                  id="pf-arrow-no"
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto-start-reverse"
                >
                  <path d="M0 0 L10 5 L0 10 z" />
                </marker>
              </defs>
              {layout.edges.map((edge) => (
                <path
                  key={`${edge.from}-${edge.to}`}
                  className={`pf-wire${edge.label === "No" ? " is-no" : edge.label === "Yes" ? " is-yes" : ""}`}
                  d={edge.d}
                  markerEnd={
                    edge.label === "No" ? "url(#pf-arrow-no)" : "url(#pf-arrow)"
                  }
                />
              ))}
            </svg>
            {layout.edges.map((edge) =>
              edge.label !== null && edge.labelAt !== null ? (
                <span
                  key={`label-${edge.from}-${edge.to}`}
                  className={`pf-answer is-${edge.label.toLowerCase()}`}
                  style={{ left: edge.labelAt[0], top: edge.labelAt[1] }}
                >
                  {edge.label}
                </span>
              ) : null,
            )}
            {steps.map((step, index) => {
              const node = layout.nodes[index];
              if (node === undefined) {
                return null;
              }
              const tone = LANE_TONES[node.lane % LANE_TONES.length];
              const title = stepTitle(step);
              if (node.decision) {
                return (
                  <button
                    key={step.key || index}
                    type="button"
                    className={`pf-diamond is-${tone}`}
                    style={{
                      left: node.x,
                      top: node.y,
                      width: node.w,
                      height: node.h,
                    }}
                    aria-pressed={selected === index}
                    aria-label={`Step ${index + 1}: ${title}`}
                    onClick={() =>
                      setSelected(selected === index ? null : index)
                    }
                  >
                    <span className="pf-diamond-shape" aria-hidden="true" />
                    <span className="pf-diamond-text">
                      <UiIcon name="flow" size={16} />
                      {title}
                    </span>
                  </button>
                );
              }
              const kind = stepKind(step);
              return (
                <button
                  key={step.key || index}
                  type="button"
                  className={`pf-card is-${tone}${selected === index ? " is-selected" : ""}`}
                  style={{
                    left: node.x,
                    top: node.y,
                    width: node.w,
                    height: node.h,
                  }}
                  aria-pressed={selected === index}
                  onClick={() => setSelected(selected === index ? null : index)}
                >
                  <span className="pf-card-head">
                    <span className={`pf-icon is-${kind}`}>
                      <UiIcon name={KIND_ICON[kind]} size={16} />
                    </span>
                    <span className="pf-card-titles">
                      <small>Step {index + 1}</small>
                      <strong>{title}</strong>
                    </span>
                  </span>
                  <span className="pf-card-text">{step.description}</span>
                  <span className="pf-card-foot">
                    {step.controlPoint ? (
                      <span className="pf-chip is-control">
                        <UiIcon name="shield" size={12} />
                        Control{controlRef !== "" ? ` ${controlRef}` : ""}
                      </span>
                    ) : null}
                    {step.system !== "" ? (
                      <span className="pf-chip">
                        <UiIcon name="database" size={12} />
                        {step.system}
                      </span>
                    ) : null}
                    {step.attributes.map((code) => (
                      <span key={code} className="pa-code">
                        {code}
                      </span>
                    ))}
                  </span>
                </button>
              );
            })}
          </section>
          <fieldset className="pf-zoom">
            <legend className="sr-only">Zoom</legend>
            <button
              type="button"
              className="btn-ghost btn-sm"
              aria-label="Zoom out"
              onClick={() => zoom(-1)}
            >
              <UiIcon name="minus" size={14} />
            </button>
            <span aria-live="polite">{Math.round(scale * 100)}%</span>
            <button
              type="button"
              className="btn-ghost btn-sm"
              aria-label="Zoom in"
              onClick={() => zoom(1)}
            >
              <UiIcon name="plus" size={14} />
            </button>
          </fieldset>
          <p className="pf-hint">Drag to move · Ctrl and scroll to zoom</p>
        </div>
        {chosen !== undefined && selected !== null ? (
          <aside className="pf-detail" aria-label={`Step ${selected + 1}`}>
            <header>
              <h4>Step {selected + 1}</h4>
              <button
                type="button"
                className="btn-ghost btn-sm"
                aria-label="Close the step"
                onClick={() => setSelected(null)}
              >
                <UiIcon name="x" size={14} />
              </button>
            </header>
            <div className="pf-detail-title">
              <span
                className={`pf-detail-icon is-${LANE_TONES[chosenLane % LANE_TONES.length]}`}
              >
                <UiIcon
                  name={
                    chosen.kind === "DECISION"
                      ? "flow"
                      : KIND_ICON[stepKind(chosen)]
                  }
                  size={20}
                />
              </span>
              <span>
                <strong>{stepTitle(chosen)}</strong>
                <small>{chosen.description}</small>
              </span>
            </div>
            <dl>
              <div>
                <dt>Owner</dt>
                <dd>{chosen.actor !== "" ? chosen.actor : "Not named"}</dd>
              </div>
              <div>
                <dt>System</dt>
                <dd>{chosen.system !== "" ? chosen.system : "Not named"}</dd>
              </div>
              <div>
                <dt>Control</dt>
                <dd>
                  {chosen.controlPoint
                    ? `${controlRef !== "" ? `${controlRef} ` : ""}operates at this step`
                    : "Not at this step"}
                </dd>
              </div>
              <div>
                <dt>Evidence</dt>
                <dd>
                  {chosen.evidence.length > 0
                    ? chosen.evidence.join(", ")
                    : "None named"}
                </dd>
              </div>
              {chosen.kind === "DECISION" ? (
                <div>
                  <dt>Answers</dt>
                  <dd>
                    Yes leads to step{" "}
                    {chosen.yes > 0 ? chosen.yes : selected + 2}; no leads to
                    step {chosen.no > 0 ? chosen.no : selected + 2}
                  </dd>
                </div>
              ) : null}
              {chosen.attributes.length > 0 ? (
                <div>
                  <dt>Evaluates</dt>
                  <dd>
                    <ul>
                      {chosen.attributes.map((code) => (
                        <li key={code}>
                          <span className="pa-code">{code}</span>
                          {attributes.find((item) => item.code === code)
                            ?.text ?? ""}
                        </li>
                      ))}
                    </ul>
                  </dd>
                </div>
              ) : null}
            </dl>
            <p className={`pf-basis is-${chosen.basis.toLowerCase()}`}>
              <UiIcon
                name={chosen.basis === "DOCUMENTED" ? "check" : "sparkles"}
                size={14}
              />
              {chosen.basis === "DOCUMENTED" ? (
                <span>
                  {BASIS_LABEL.DOCUMENTED}
                  {chosen.sourceTitle !== "" ? ` in ${chosen.sourceTitle}` : ""}
                  {chosen.quote !== "" ? <q>{chosen.quote}</q> : null}
                </span>
              ) : chosen.basis === "INFERRED" ? (
                <span>AI-derived · Verify against source documents</span>
              ) : (
                <span>{BASIS_LABEL.TEAM}</span>
              )}
            </p>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
