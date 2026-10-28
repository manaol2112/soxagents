"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { ProcessStep } from "./control-context-model";
import {
  BASIS_LABEL,
  FLOW_PASSES,
  FLOW_REST_MS,
  FLOW_SPEED,
  flowLayout,
  type StepKind,
  stepKind,
} from "./process-flow-model";
import { type IconName, UiIcon } from "./ui-icon";

const KIND_ICON: Record<StepKind, IconName> = {
  control: "shield",
  system: "database",
  person: "user",
};

/** How long the marker waits at the last step before the flow runs again. */
const LOOP_REST_MS = 3000;

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/**
 * The narrative's steps as a map: cards joined by connectors, a marker travelling from
 * each step to the next and lighting the step it reaches, twice, then still until it is
 * replayed. Off when the person prefers reduced motion; paused while the map is out of
 * view, while the pointer or focus is on it, and while a step's detail is open, so it never
 * moves under what is being read. A step opens its detail below.
 */
export function ProcessFlow({
  steps,
  attributes,
}: {
  steps: ProcessStep[];
  attributes: Array<{ code: string; text: string }>;
}) {
  const canvas = useRef<HTMLElement | null>(null);
  const atom = useRef<SVGGElement | null>(null);
  const wires = useRef<Array<SVGPathElement | null>>([]);
  const [width, setWidth] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  const [lit, setLit] = useState(-1);
  const [moving, setMoving] = useState(false);
  const [done, setDone] = useState(false);
  const [run, setRun] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  // Held while the person is reading: the pointer or focus on the map, or a step open.
  const hovered = useRef(false);
  const reading = useRef(false);
  reading.current = selected !== null;

  useEffect(() => {
    const node = canvas.current;
    if (node === null) {
      return;
    }
    const measure = () => setWidth(Math.round(node.clientWidth));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const layout = useMemo(
    () => (width === null ? null : flowLayout(steps.length, width)),
    [steps.length, width],
  );
  const route = layout?.segments.join("|") ?? "";

  // The marker: rests at a step, travels its connector to the next, and runs through
  // FLOW_PASSES times. run is a dependency so Replay starts it again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: run restarts the marker on Replay.
  useEffect(() => {
    const node = canvas.current;
    const marker = atom.current;
    if (route === "" || node === null || marker === null) {
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setMoving(false);
      return;
    }
    const paths = route.split("|");
    let visible = true;
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
    });
    observer.observe(node);
    let segment = 0;
    let travelling = false;
    let elapsed = 0;
    let last = performance.now();
    const place = (at: number, share: number) => {
      const wire = wires.current[at];
      if (wire === null || wire === undefined) {
        return;
      }
      const point = wire.getPointAtLength(wire.getTotalLength() * share);
      marker.setAttribute("transform", `translate(${point.x} ${point.y})`);
    };
    let passes = 1;
    setActive(0);
    setLit(-1);
    setDone(false);
    setMoving(true);
    place(0, 0);
    let frame = requestAnimationFrame(function tick(now) {
      frame = requestAnimationFrame(tick);
      const step = Math.min(now - last, 50);
      last = now;
      if (!visible || document.hidden || hovered.current || reading.current) {
        return;
      }
      elapsed += step;
      if (!travelling) {
        const atEnd = segment >= paths.length;
        if (elapsed < (atEnd ? LOOP_REST_MS : FLOW_REST_MS)) {
          return;
        }
        elapsed = 0;
        if (atEnd && passes >= FLOW_PASSES) {
          cancelAnimationFrame(frame);
          setMoving(false);
          setDone(true);
          return;
        }
        if (atEnd) {
          passes += 1;
          segment = 0;
          setActive(0);
          place(0, 0);
          return;
        }
        travelling = true;
        setLit(segment);
        return;
      }
      const wire = wires.current[segment];
      const length = wire?.getTotalLength() ?? 0;
      const duration = Math.max(450, (length / FLOW_SPEED) * 1000);
      const share = Math.min(1, elapsed / duration);
      place(segment, ease(share));
      if (share >= 1) {
        travelling = false;
        elapsed = 0;
        segment += 1;
        setLit(-1);
        setActive(segment);
      }
    });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [route, run]);

  const chosen = selected === null ? undefined : steps[selected];
  return (
    <div className="pf">
      <section
        ref={canvas}
        aria-label="Process flow"
        className={`pf-canvas${layout?.compact ? " is-compact" : ""}${moving ? " is-moving" : ""}`}
        style={{ height: layout?.height ?? 240 }}
        onPointerEnter={() => {
          hovered.current = true;
        }}
        onPointerLeave={() => {
          hovered.current = false;
        }}
        onFocus={() => {
          hovered.current = true;
        }}
        onBlur={() => {
          hovered.current = false;
        }}
      >
        {layout !== null ? (
          <>
            <svg
              className="pf-wires"
              width={layout.width}
              height={layout.height}
              aria-hidden="true"
            >
              {layout.segments.map((d, index) => (
                <g key={d} className={index === lit ? "is-lit" : undefined}>
                  <path
                    ref={(element) => {
                      wires.current[index] = element;
                    }}
                    className="pf-wire"
                    d={d}
                  />
                  <path className="pf-wire-flow" d={d} />
                </g>
              ))}
              {layout.ports.map((port) => (
                <g key={`${port.from.join()}-${port.to.join()}`}>
                  <circle
                    className="pf-port"
                    cx={port.from[0]}
                    cy={port.from[1]}
                    r={4}
                  />
                  <circle
                    className="pf-port"
                    cx={port.to[0]}
                    cy={port.to[1]}
                    r={4}
                  />
                </g>
              ))}
              {layout.segments.length > 0 ? (
                <g ref={atom} className={`pf-atom${moving ? "" : " is-still"}`}>
                  <circle className="pf-atom-halo" r={18} />
                  <g className="pf-atom-orbits">
                    <ellipse rx={13} ry={4.6} />
                    <ellipse rx={13} ry={4.6} transform="rotate(60)" />
                    <ellipse rx={13} ry={4.6} transform="rotate(-60)" />
                  </g>
                  <circle className="pf-atom-core" r={4.6} />
                </g>
              ) : null}
            </svg>
            <ol className="pf-cards">
              {steps.map((step, index) => {
                const box = layout.boxes[index];
                if (box === undefined) {
                  return null;
                }
                const kind = stepKind(step);
                return (
                  <li
                    key={step.key || index}
                    style={{
                      left: box.x,
                      top: box.y,
                      width: box.w,
                      height: box.h,
                    }}
                  >
                    <button
                      type="button"
                      className={`pf-card is-${kind}${moving && index === active ? " is-active" : ""}`}
                      aria-pressed={selected === index}
                      onClick={() =>
                        setSelected(selected === index ? null : index)
                      }
                    >
                      <span className="pf-card-head">
                        <span className={`pf-icon is-${kind}`}>
                          <UiIcon name={KIND_ICON[kind]} size={15} />
                        </span>
                        <span className="pf-card-step">Step {index + 1}</span>
                        {step.controlPoint ? (
                          <span className="pf-chip is-control">Control</span>
                        ) : null}
                        <span
                          className={`pf-basis is-${step.basis.toLowerCase()}`}
                          title={BASIS_LABEL[step.basis]}
                        >
                          {step.basis === "DOCUMENTED" ? (
                            <UiIcon name="check" size={10} />
                          ) : null}
                          <span className="sr-only">
                            {BASIS_LABEL[step.basis]}
                          </span>
                        </span>
                      </span>
                      <span className="pf-card-text">{step.description}</span>
                      <span className="pf-card-foot">
                        <span className="pf-who">
                          {[step.actor, step.system]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                        {step.attributes.map((code) => (
                          <span key={code} className="pa-code">
                            {code}
                          </span>
                        ))}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </>
        ) : null}
      </section>
      {chosen !== undefined && selected !== null ? (
        <section className="pf-detail" aria-label={`Step ${selected + 1}`}>
          <header>
            <h4>Step {selected + 1}</h4>
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => setSelected(null)}
            >
              <UiIcon name="x" size={13} />
              Close
            </button>
          </header>
          <p>{chosen.description}</p>
          <dl>
            {chosen.actor !== "" ? (
              <div>
                <dt>Performed by</dt>
                <dd>{chosen.actor}</dd>
              </div>
            ) : null}
            {chosen.system !== "" ? (
              <div>
                <dt>System</dt>
                <dd>{chosen.system}</dd>
              </div>
            ) : null}
            <div>
              <dt>Basis</dt>
              <dd>
                {BASIS_LABEL[chosen.basis]}
                {chosen.quote !== "" ? (
                  <q>
                    {chosen.quote}
                    {chosen.sourceTitle !== ""
                      ? ` (${chosen.sourceTitle})`
                      : ""}
                  </q>
                ) : null}
              </dd>
            </div>
            {chosen.controlPoint ? (
              <div>
                <dt>Control</dt>
                <dd>The control operates at this step.</dd>
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
                        {attributes.find((item) => item.code === code)?.text ??
                          ""}
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
            ) : null}
          </dl>
        </section>
      ) : (
        <p className="pf-hint">Select a step to see its details.</p>
      )}
      {done ? (
        <button
          type="button"
          className="btn-secondary btn-sm pf-replay"
          onClick={() => setRun(run + 1)}
        >
          <UiIcon name="retry" size={13} />
          Replay the flow
        </button>
      ) : null}
    </div>
  );
}
