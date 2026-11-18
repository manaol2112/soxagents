"use client";

import { type CSSProperties, useEffect, useId, useRef, useState } from "react";

import {
  AGENT_SAYS,
  AGENT_STATE_LABEL,
  type AgentState,
  avatarDetail,
  clickableAt,
  nextReaction,
  type Reaction,
} from "./agent-avatar-model";

/**
 * The agent, drawn as a sculpted character (product owner, 2 November 2026: agents
 * that look rendered and move with what they are doing): a pearl shell lit from the top
 * left with a rim light, violet ear pods, a deep glass visor with a reflection, glowing
 * eyes, floating hands, and a soft shadow on the ground. Its state shows in how it moves
 * and in the antenna's colour (agent-avatar.css): idle floats, blinks and glances;
 * thinking looks up while sparks orbit; working scans the visor inside a turning ring;
 * done smiles with a check; needing the person waves with an amber badge. Below 30px the
 * hands, sparks and badges are left out. Still for people who ask for less motion.
 */
function AgentFigure({
  state = "idle",
  size = 40,
  label,
  className,
  reaction = null,
  look = [0, 0],
}: {
  state?: AgentState;
  size?: number;
  /** The agent's name, when the avatar stands for it on its own; else decorative. */
  label?: string | undefined;
  className?: string | undefined;
  reaction?: Reaction | null;
  /** Where the pointer is, from -1 to 1 across and down, for the eyes to follow. */
  look?: readonly [number, number];
}) {
  const raw = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const id = (name: string) => `aa-${raw}-${name}`;
  const url = (name: string) => `url(#${id(name)})`;
  const full = avatarDetail(size) === "full";
  const named = label !== undefined && label !== "";
  return (
    <svg
      className={`aa is-${state}${full ? "" : " is-compact"}${reaction !== null ? ` is-react-${reaction}` : ""}${className ? ` ${className}` : ""}`}
      style={
        {
          "--aa-look-x": `${(look[0] * 3).toFixed(2)}px`,
          "--aa-look-y": `${(look[1] * 2.5).toFixed(2)}px`,
        } as CSSProperties
      }
      width={size}
      height={size}
      viewBox="0 0 120 120"
      role={named ? "img" : undefined}
      aria-label={named ? `${label}, ${AGENT_STATE_LABEL[state]}` : undefined}
      aria-hidden={named ? undefined : true}
      focusable="false"
    >
      <defs>
        <radialGradient id={id("shell")} cx="0.36" cy="0.26" r="0.86">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.4" stopColor="#f4f2ff" />
          <stop offset="0.78" stopColor="#d2cdf8" />
          <stop offset="1" stopColor="#9c94e4" />
        </radialGradient>
        <linearGradient id={id("rim")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="1" stopColor="#7a6fd6" stopOpacity="0.6" />
        </linearGradient>
        <linearGradient id={id("ear")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#b3a6ff" />
          <stop offset="1" stopColor="#5a45d4" />
        </linearGradient>
        <linearGradient id={id("visor")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2a3262" />
          <stop offset="0.55" stopColor="#131936" />
          <stop offset="1" stopColor="#090c1f" />
        </linearGradient>
        <linearGradient id={id("eye")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f0feff" />
          <stop offset="0.45" style={{ stopColor: "var(--aa-eye)" }} />
          <stop offset="1" style={{ stopColor: "var(--aa-eye-deep)" }} />
        </linearGradient>
        <radialGradient id={id("orb")} cx="0.35" cy="0.32" r="0.75">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" style={{ stopColor: "var(--aa-accent)" }} />
        </radialGradient>
        <clipPath id={id("visor-clip")}>
          <rect x="31" y="42" width="58" height="34" rx="17" />
        </clipPath>
        <filter id={id("glow")} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="2.6" />
        </filter>
        <filter id={id("soft")} x="-40%" y="-200%" width="180%" height="500%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
      </defs>

      <ellipse
        className="aa-shadow"
        cx="60"
        cy="111"
        rx="27"
        ry="4.5"
        filter={url("soft")}
      />
      {full && state === "working" ? (
        <circle className="aa-ring" cx="60" cy="60" r="55" />
      ) : null}

      <g className="aa-float">
        {full && state === "thinking" ? (
          <g className="aa-orbit">
            <circle className="aa-spark" cx="60" cy="5" r="3.4" />
            <circle className="aa-spark is-2" cx="111" cy="72" r="2.6" />
            <circle className="aa-spark is-3" cx="10" cy="78" r="2.1" />
          </g>
        ) : null}

        <g className="aa-antenna">
          <line x1="60" y1="27" x2="60" y2="15" />
          <circle
            className="aa-orb-glow"
            cx="60"
            cy="11"
            r="8"
            filter={url("glow")}
          />
          <circle cx="60" cy="11" r="5.2" fill={url("orb")} />
        </g>

        <rect
          className="aa-ear"
          x="15"
          y="46"
          width="11"
          height="26"
          rx="5.5"
          fill={url("ear")}
        />
        <rect
          className="aa-ear"
          x="94"
          y="46"
          width="11"
          height="26"
          rx="5.5"
          fill={url("ear")}
        />
        <rect
          className="aa-head"
          x="22"
          y="24"
          width="76"
          height="68"
          rx="31"
          fill={url("shell")}
          stroke={url("rim")}
          strokeWidth="1.4"
        />
        <ellipse
          className="aa-spec"
          cx="43"
          cy="34"
          rx="14"
          ry="5.5"
          transform="rotate(-18 43 34)"
        />
        <rect
          className="aa-visor"
          x="31"
          y="42"
          width="58"
          height="34"
          rx="17"
          fill={url("visor")}
        />
        <path className="aa-visor-shine" d="M39 47.5 Q49 43.5 62 44.5" />
        {state === "working" ? (
          <g clipPath={url("visor-clip")}>
            <rect className="aa-scan" x="20" y="42" width="9" height="34" />
          </g>
        ) : null}

        <g className="aa-look">
          <g className="aa-eyes">
            {state === "done" ? (
              <g className="aa-happy">
                <path d="M43 62 Q48.5 54.5 54 62" />
                <path d="M66 62 Q71.5 54.5 77 62" />
              </g>
            ) : (
              <>
                <g className="aa-eye-glow" filter={url("glow")}>
                  <rect x="44" y="52" width="9" height="13" rx="4.5" />
                  <rect
                    className="is-right"
                    x="67"
                    y="52"
                    width="9"
                    height="13"
                    rx="4.5"
                  />
                </g>
                <rect
                  className="aa-eye"
                  x="44"
                  y="52"
                  width="9"
                  height="13"
                  rx="4.5"
                  fill={url("eye")}
                />
                <rect
                  className="aa-eye is-right"
                  x="67"
                  y="52"
                  width="9"
                  height="13"
                  rx="4.5"
                  fill={url("eye")}
                />
                <circle className="aa-glint" cx="47" cy="55.5" r="1.5" />
                <circle
                  className="aa-glint is-right"
                  cx="70"
                  cy="55.5"
                  r="1.5"
                />
              </>
            )}
          </g>
        </g>
        <ellipse className="aa-cheek" cx="35.5" cy="81" rx="5" ry="2.6" />
        <ellipse className="aa-cheek" cx="84.5" cy="81" rx="5" ry="2.6" />
        {reaction === "love" ? (
          <>
            <g transform="translate(14 30)">
              <path className="aa-heart" d={HEART} />
            </g>
            <g transform="translate(92 24) scale(0.8)">
              <path className="aa-heart is-2" d={HEART} />
            </g>
          </>
        ) : null}

        {full ? (
          <>
            <ellipse
              className="aa-hand is-left"
              cx="16"
              cy="94"
              rx="7.5"
              ry="9"
              fill={url("shell")}
              stroke={url("rim")}
              strokeWidth="1.2"
            />
            <ellipse
              className="aa-hand is-right"
              cx="104"
              cy="94"
              rx="7.5"
              ry="9"
              fill={url("shell")}
              stroke={url("rim")}
              strokeWidth="1.2"
            />
          </>
        ) : null}
      </g>

      {full && state === "done" ? (
        <>
          <g className="aa-badge is-done">
            <circle cx="99" cy="21" r="11" />
            <path d="M94 21.5 L97.5 25 L104 17.5" />
          </g>
          <path
            className="aa-twinkle"
            d="M16 22 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2z"
          />
          <path
            className="aa-twinkle is-2"
            d="M104 56 l1.4 3.4 3.4 1.4 -3.4 1.4 -1.4 3.4 -1.4 -3.4 -3.4 -1.4 3.4 -1.4z"
          />
        </>
      ) : null}
      {full && state === "attention" ? (
        <g className="aa-badge is-attention">
          <circle cx="99" cy="21" r="11" />
          <path d="M99 15 V23" />
          <circle cx="99" cy="27.5" r="1.5" />
        </g>
      ) : null}
    </svg>
  );
}

const HEART =
  "M7 12.5 C7 12.5 0 8.2 0 3.8 C0 1.6 1.7 0 3.7 0 C5.1 0 6.3 0.8 7 2 C7.7 0.8 8.9 0 10.3 0 C12.3 0 14 1.6 14 3.8 C14 8.2 7 12.5 7 12.5 Z";

/**
 * The agent (product owner, 2 November 2026): the figure above, and, when it stands on
 * its own (larger than 30px), a button. Its eyes follow the pointer; a click makes it
 * react in turn (a hop, a wink, a little love, a spin) and shows, for a few seconds, what
 * it is doing, which is also announced to screen readers. Smaller, it is a mark inside
 * another control and never a button of its own.
 */
export function AgentAvatar({
  state = "idle",
  size = 40,
  label,
  className,
  says,
  interactive,
}: {
  state?: AgentState;
  size?: number;
  /** The agent's name: its button's name when clickable, else the figure's. */
  label?: string;
  className?: string;
  /** What it shows when clicked, where the screen knows more than its state. */
  says?: string;
  /** Clickable on its own; by default when larger than 30px. */
  interactive?: boolean;
}) {
  const clickable = interactive ?? clickableAt(size);
  const [clicks, setClicks] = useState(0);
  const [reaction, setReaction] = useState<Reaction | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [look, setLook] = useState<readonly [number, number]>([0, 0]);
  const timers = useRef<number[]>([]);
  useEffect(
    () => () => {
      for (const timer of timers.current) {
        window.clearTimeout(timer);
      }
    },
    [],
  );
  if (!clickable) {
    return (
      <AgentFigure
        state={state}
        size={size}
        label={label}
        className={className}
      />
    );
  }
  const name = label !== undefined && label !== "" ? label : "Audit Agent";
  const react = () => {
    const next = nextReaction(clicks);
    setClicks((count) => count + 1);
    // Cleared first, so the same reaction can play again from its start.
    setReaction(null);
    window.requestAnimationFrame(() => setReaction(next));
    setSpeaking(true);
    for (const timer of timers.current) {
      window.clearTimeout(timer);
    }
    timers.current = [
      window.setTimeout(() => setReaction(null), 1200),
      window.setTimeout(() => setSpeaking(false), 3600),
    ];
  };
  return (
    <span className={`aa-wrap${className ? ` ${className}` : ""}`}>
      <button
        type="button"
        className="aa-hit"
        aria-label={`${name}, ${AGENT_STATE_LABEL[state]}`}
        onClick={react}
        onPointerMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          setLook([
            Math.max(
              -1,
              Math.min(1, ((event.clientX - box.left) / box.width - 0.5) * 2),
            ),
            Math.max(
              -1,
              Math.min(1, ((event.clientY - box.top) / box.height - 0.5) * 2),
            ),
          ]);
        }}
        onPointerLeave={() => setLook([0, 0])}
      >
        <AgentFigure
          state={state}
          size={size}
          reaction={reaction}
          look={look}
        />
      </button>
      <span className={`aa-bubble${speaking ? " is-on" : ""}`} role="status">
        {speaking ? (says ?? AGENT_SAYS[state]) : ""}
      </span>
    </span>
  );
}
