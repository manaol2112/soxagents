import { GoogleMark } from "./provider-marks";
import { UiIcon } from "./ui-icon";
import {
  ControlRun,
  CYCLE,
  CYCLE_RING,
  CYCLE_STEPS,
  MissionControl,
  Workpaper,
} from "./welcome-mocks";
import {
  DEMO_FOCUS,
  type LibrarySummary,
  WELCOME_NOTICES,
  type WelcomeNotice,
} from "./welcome-model";
import { WelcomeReveal } from "./welcome-reveal";

// The landing page, after the product owner's references (27 October 2026): a dark,
// cinematic hero with the agents at work, the product drawn in code, a light section that
// follows one control, and the case that it is for every auditor, not only the largest
// firms. Every figure in a product view is synthetic and captioned so.

/** The hero's cycle runs one step after another: each element carries its step. */
const stepOf = (index: number) => ({ "--i": index }) as React.CSSProperties;
const ART = "/welcome";

const STEPS = [
  ["Plan", "The planner drafts procedures, attributes and evidence."],
  ["Request", "The coordinator asks the owner, then files what returns."],
  ["Test", "The tester checks every sample and cites each result."],
  ["Challenge", "An independent agent re-performs and challenges."],
  ["Sign off", "A person decides, with the reasoning on record."],
] as const;

const ASSURANCE = [
  {
    icon: "file",
    title: "Every assertion traceable",
    text: "From objective to conclusion, every step links to the evidence it rests on, quoted from the file and checked against it before anyone sees it.",
  },
  {
    icon: "agents",
    title: "Independent agent review",
    text: "A separate agent re-performs the testing from the evidence, validates the citations and the sampling, and challenges the result, so nothing relies on a single output.",
  },
  {
    icon: "shield",
    title: "Human-owned sign-off",
    text: "Your team reviews, adds judgment and signs off. The person who prepared the work can never review it, and every decision records who, what and when.",
  },
] as const;

const AUDITORS = [
  {
    icon: "user",
    title: "Independent auditors",
    text: "Run a full SOX or IT audit engagement without a back office. The agents draft the plan, the requests and the workpaper; you bring the judgment.",
  },
  {
    icon: "briefcase",
    title: "Small and mid-sized firms",
    text: "Take on more engagements with the team you have. Every control gets the same documentation standard and an independent review.",
  },
  {
    icon: "shield",
    title: "Internal audit teams",
    text: "Cover more of the audit plan. Evidence is requested, filed and tested for you, and every result is ready to show your audit committee.",
  },
  {
    icon: "layers",
    title: "Large firms and SOX programmes",
    text: "Standardise delivery across teams and clients, with segregation of duties enforced by the system and a full audit trail on every control.",
  },
] as const;

// The questions as the product owner's design words them (27 October 2026); the first
// answer is the design's own, the others the owner's earlier answers to the same question.
const FAQ = [
  {
    icon: "file",
    q: "How is this different from a traditional audit platform?",
    a: "A coordinated agent workforce moves controls from planning to testing and independent review, with evidence linked at every step.",
  },
  {
    icon: "agents",
    q: "How do specialized agents work together?",
    a: "Each agent has a defined responsibility. The planning agent develops the testing approach, the evidence agent coordinates information requirements, and the testing agent evaluates samples against defined criteria. An independent reviewer challenges the findings before the auditor approves the final conclusion.",
  },
  {
    icon: "copy",
    q: "Can every finding be traced to its evidence?",
    a: "Testing results are linked to supporting documents, evaluated control attributes, and documented rationale, so auditors can review how each finding was developed rather than relying on an unexplained AI response.",
  },
  {
    icon: "risk",
    q: "What happens when an agent flags an exception?",
    a: "Potential exceptions, insufficient evidence, and inconsistent findings are surfaced for further review. An independent agent provides an additional layer of challenge, while the auditor retains authority to investigate, override, or approve conclusions based on professional judgment.",
  },
  {
    icon: "shield",
    q: "Who owns the final audit conclusion?",
    a: "The auditor. The agents perform the preparation, analysis, and testing activities that support the audit. Professional skepticism, final conclusions, and sign-off remain with your team, so audit capacity grows without compromising accountability.",
  },
  {
    icon: "table",
    q: "Can we use our existing RCM and methodology?",
    a: "Yes. The workspace works from your existing risk and control matrix, control objectives, and testing methodology. Your team reviews and approves the proposed procedures, attributes, and evidence requirements before execution.",
  },
] as const;

const FAQ_FLOW = [
  ["file", "Plan"],
  ["check", "Test"],
  ["search", "Review"],
  ["user", "Sign off"],
] as const;

function Point({ children }: { children: React.ReactNode }) {
  return (
    <li>
      <UiIcon name="check" size={13} />
      <span>{children}</span>
    </li>
  );
}

/** A share of the artwork's width or height, for placing a card on it. */
const across = (value: number) => `${(value / CYCLE.width) * 100}%`;
const down = (value: number) => `${(value / CYCLE.height) * 100}%`;

export function WelcomePage({
  notice,
  googleHref,
  library,
}: {
  notice: WelcomeNotice | null;
  /** The Google sign-in link, or null when Google sign-in is not configured. */
  googleHref: string | null;
  /** The library's figures from the API; left out when unknown. */
  library: LibrarySummary | null;
}) {
  return (
    <div className="lp theme-light">
      <WelcomeReveal />
      <a className="skip" href="#control">
        Skip to content
      </a>

      <header className="lp-nav">
        <a className="lp-brand" href="/welcome">
          <span className="lp-logo" aria-hidden="true">
            <UiIcon name="logo" size={17} />
          </span>
          Audit Workforce
        </a>
        <nav className="lp-nav-links" aria-label="Page">
          <a href="#control">Product</a>
          <a href="#assurance">Assurance</a>
          <a href="#auditors">Who it's for</a>
          <a href="#faq">FAQ</a>
        </nav>
        <div className="lp-nav-actions">
          <a className="lp-btn lp-btn-ghost" href="/sign-in">
            Sign in
          </a>
          <a className="lp-btn lp-btn-primary" href="#demo">
            Book a demo
            <UiIcon name="arrow" size={14} />
          </a>
        </div>
      </header>

      <section className="lp-hero" id="top">
        <div className="lp-hero-art">
          <div className="lp-hero-stage">
            {/* The ring, its arrows, the spokes and the outer orbit, behind the orbs. */}
            <svg
              className="lp-hero-ring"
              viewBox={`0 0 ${CYCLE.width} ${CYCLE.height}`}
              aria-hidden="true"
              focusable="false"
            >
              <defs>
                <marker
                  id="lp-arrow"
                  viewBox="0 0 12 12"
                  refX="7"
                  refY="6"
                  markerWidth="9"
                  markerHeight="9"
                  orient="auto-start-reverse"
                >
                  <path d="M1 1 L10 6 L1 11 Z" fill="#9fb4ff" />
                </marker>
                <radialGradient id="lp-orb-glow">
                  <stop offset="55%" stopColor="#4f7bff" stopOpacity="0.55" />
                  <stop offset="100%" stopColor="#4f7bff" stopOpacity="0" />
                </radialGradient>
                <linearGradient id="lp-comet-grad">
                  <stop offset="0%" stopColor="#ffffff" />
                  <stop offset="100%" stopColor="#c9d6ff" />
                </linearGradient>
                <radialGradient id="lp-core-glow">
                  <stop offset="0%" stopColor="#6a8cff" stopOpacity="0.55" />
                  <stop offset="60%" stopColor="#3b5bdb" stopOpacity="0.18" />
                  <stop offset="100%" stopColor="#3b5bdb" stopOpacity="0" />
                </radialGradient>
              </defs>
              <ellipse
                className="lp-core-glow"
                cx={CYCLE_RING.core[0]}
                cy={CYCLE_RING.core[1]}
                rx="300"
                ry="320"
                fill="url(#lp-core-glow)"
              />
              {CYCLE_RING.orbs.map(([x, y], index) => (
                <circle
                  key={`glow-${x}-${y}`}
                  className="lp-orb-glow"
                  style={stepOf(index)}
                  cx={x}
                  cy={y}
                  r="168"
                  fill="url(#lp-orb-glow)"
                />
              ))}
              <circle
                className="lp-ring-orbit"
                cx={CYCLE_RING.center[0]}
                cy={CYCLE_RING.center[1]}
                r="404"
              />
              {CYCLE_RING.dots.map(([x, y]) => (
                <circle
                  key={`${x}-${y}`}
                  className="lp-ring-dot"
                  cx={x}
                  cy={y}
                  r="4"
                />
              ))}
              {CYCLE_RING.spokes.map((d, index) => (
                <path
                  key={d}
                  className="lp-ring-spoke"
                  style={stepOf(index)}
                  d={d}
                />
              ))}
              {CYCLE_RING.arcs.map((d, index) => (
                <g key={d}>
                  <path className="lp-ring-glow" d={d} />
                  <path
                    className="lp-ring-arc"
                    d={d}
                    markerEnd="url(#lp-arrow)"
                  />
                  {/* The work travelling to the next step. */}
                  <path
                    className="lp-comet-glow"
                    style={stepOf(index)}
                    d={d}
                    pathLength={1}
                  />
                  <path
                    className="lp-comet"
                    style={stepOf(index)}
                    d={d}
                    pathLength={1}
                  />
                </g>
              ))}
            </svg>
            {/* biome-ignore lint/performance/noImgElement: a sized WebP from /public; no image optimiser is configured. */}
            <img
              src={`${ART}/audit-cycle.webp`}
              alt=""
              width={CYCLE.width}
              height={CYCLE.height}
              fetchPriority="high"
              decoding="async"
            />
            {/* Each step's label is wired to its orb. */}
            <svg
              className="lp-hero-wires"
              viewBox={`0 0 ${CYCLE.width} ${CYCLE.height}`}
              aria-hidden="true"
              focusable="false"
            >
              {/* Each orb's halo and ripple as its step arrives. */}
              {CYCLE_RING.orbs.map(([x, y], index) => (
                <g key={`halo-${x}-${y}`} style={stepOf(index)}>
                  <circle className="lp-orb-halo" cx={x} cy={y} r="124" />
                  <circle className="lp-orb-ping" cx={x} cy={y} r="124" />
                </g>
              ))}
              {/* The seal's burst when a person signs off. */}
              <circle
                className="lp-seal-burst"
                cx={CYCLE_RING.seal[0]}
                cy={CYCLE_RING.seal[1]}
                r="52"
              />
              <circle
                className="lp-seal-burst is-late"
                cx={CYCLE_RING.seal[0]}
                cy={CYCLE_RING.seal[1]}
                r="52"
              />
              {CYCLE_STEPS.map((step, index) => (
                <g key={step.key} className={step.tone} style={stepOf(index)}>
                  <line
                    className="lp-wire"
                    x1={step.wire.from[0]}
                    y1={step.wire.from[1]}
                    x2={step.wire.to[0]}
                    y2={step.wire.to[1]}
                  />
                  <circle
                    className="lp-wire-node"
                    cx={step.wire.from[0]}
                    cy={step.wire.from[1]}
                    r="7"
                  />
                </g>
              ))}
            </svg>
            <ol
              className="lp-hero-steps"
              aria-label="The steps of every control"
            >
              {CYCLE_STEPS.map((step, index) => (
                <li
                  key={step.key}
                  className={`is-${step.side}`}
                  style={
                    step.side === "right"
                      ? {
                          ...stepOf(index),
                          left: across(step.wire.to[0] + 14),
                          top: down(step.wire.to[1]),
                        }
                      : {
                          ...stepOf(index),
                          right: across(CYCLE.width - step.wire.to[0] + 14),
                          top: down(step.wire.to[1]),
                        }
                  }
                >
                  <span className="sr-only">{step.label}</span>
                  <span aria-hidden="true">
                    {step.lines.map((line) => (
                      <span key={line}>{line}</span>
                    ))}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </div>
        <div className="lp-hero-copy" data-reveal>
          <p className="lp-kicker">Audit Workforce</p>
          <h1>
            From evidence
            <br />
            to assurance<span className="lp-dot">.</span>
          </h1>
          <p className="lp-lead">
            A coordinated team of AI agents plans, requests, tests, challenges
            and documents every control, with the auditor in command. For every
            auditor, from a one-person practice to a global firm.
          </p>
          <div className="lp-hero-actions">
            <a className="lp-btn lp-btn-primary lp-btn-lg" href="#control">
              Watch a control run
              <UiIcon name="arrow" size={16} />
            </a>
            <a className="lp-btn lp-btn-line lp-btn-lg" href="#demo">
              Book a private demo
              <UiIcon name="arrow" size={16} />
            </a>
          </div>
          {googleHref !== null ? (
            <p className="lp-hero-solo">
              Working on your own?{" "}
              <a href={googleHref}>
                <GoogleMark size={14} />
                Start with Google
              </a>{" "}
              and your workspace is ready in a minute.
            </p>
          ) : null}
        </div>
        <div className="lp-hero-app" data-reveal>
          <MissionControl />
          <p className="lp-caption">Illustration on synthetic data.</p>
        </div>
      </section>

      <section className="lp-light" id="control">
        <div className="lp-wrap">
          <div className="lp-head is-left" data-reveal>
            <p className="lp-kicker">One control. An entire team of agents.</p>
            <h2>Watch a control move from question to conclusion.</h2>
          </div>
          <ol className="lp-steps" data-reveal>
            {STEPS.map(([title, text], index) => (
              <li
                key={title}
                className={index < STEPS.length - 1 ? "is-done" : "is-now"}
              >
                <span className="lp-step-mark">
                  {index < STEPS.length - 1 ? (
                    <UiIcon name="check" size={15} />
                  ) : (
                    index + 1
                  )}
                </span>
                <span>
                  <b>{title}</b>
                  <small>{text}</small>
                </span>
              </li>
            ))}
          </ol>
          <div className="lp-control">
            <div className="lp-control-app" data-reveal>
              <ControlRun />
            </div>
            <aside className="lp-control-note" data-reveal>
              <h3>Every decision carries its evidence.</h3>
              <p>
                See which files were used, how each sample was tested, and why
                an agent reached its result, with every quote checked against
                the file. When the independent reviewer disagrees, it says so,
                and a person decides.
              </p>
            </aside>
          </div>
          <p className="lp-caption is-dark">Illustration on synthetic data.</p>
        </div>
      </section>

      <section className="lp-dark" id="assurance">
        <div className="lp-wrap">
          <div className="lp-head" data-reveal>
            <p className="lp-kicker is-rule">Built for defensible assurance</p>
            <h2>Powerful autonomy. Visible accountability.</h2>
          </div>
          <div className="lp-assure">
            <div className="lp-assure-app" data-reveal>
              <Workpaper />
            </div>
            <ul className="lp-assure-points">
              {ASSURANCE.map((item, index) => (
                <li
                  key={item.title}
                  data-reveal
                  style={{ transitionDelay: `${index * 90}ms` }}
                >
                  <span className="lp-assure-icon">
                    <UiIcon name={item.icon} size={26} />
                  </span>
                  <span>
                    <h3>{item.title}</h3>
                    <p>{item.text}</p>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="lp-rcm" data-reveal>
            <span className="lp-rcm-icon" aria-hidden="true">
              <UiIcon name="layers" size={24} />
            </span>
            <h3>Bring your RCM. Keep your methodology.</h3>
            <p>
              Upload the client's RCM in any layout and keep their terms beside
              the standard ones. The agents adapt to your methodology, so you
              standardise rather than start over.
            </p>
          </div>
        </div>
      </section>

      <section className="lp-flow" id="evidence">
        <div className="lp-flow-art" aria-hidden="true">
          {/* biome-ignore lint/performance/noImgElement: a sized WebP from /public; no image optimiser is configured. */}
          <img
            src={`${ART}/evidence-flow.webp`}
            alt=""
            width={1672}
            height={941}
            loading="lazy"
            decoding="async"
          />
        </div>
        <div className="lp-wrap">
          <div className="lp-flow-copy" data-reveal>
            <p className="lp-kicker">Evidence in. Workpaper out.</p>
            <h2>Stop chasing evidence. Start reviewing it.</h2>
            <p>
              The agents turn the plan into requests worded for the people who
              will answer them. Every file that comes back is read, classified,
              filed to its control and tested, and the workpaper fills itself
              from the records.
            </p>
            <ul className="lp-points">
              <Point>
                Requests grouped by owner and phase, sent only by you
              </Point>
              <Point>Late evidence chased without anyone keeping a list</Point>
              <Point>One workbook per control, versioned on every change</Point>
            </ul>
          </div>
        </div>
      </section>

      <section className="lp-dark is-tight" id="auditors">
        <div className="lp-wrap">
          <div className="lp-head" data-reveal>
            <p className="lp-kicker">For every auditor</p>
            <h2>Not just for the largest firms.</h2>
            <p>
              The same agents and the same safeguards for anyone who would
              rather review than chase, whatever the size of the team.
            </p>
          </div>
          <ul className="lp-auditors">
            {AUDITORS.map((item, index) => (
              <li
                key={item.title}
                data-reveal
                style={{ transitionDelay: `${index * 70}ms` }}
              >
                <span className="lp-auditors-icon">
                  <UiIcon name={item.icon} size={20} />
                </span>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </li>
            ))}
          </ul>
          {library !== null ? (
            <ul className="lp-facts" data-reveal>
              <li>
                <strong>{library.controls}</strong>
                <span>reviewed controls in the standard library</span>
              </li>
              <li>
                <strong>{library.areas}</strong>
                <span>control areas, ITGC to business cycles</span>
              </li>
              <li>
                <strong>{library.agents}</strong>
                <span>agents, each with one job</span>
              </li>
              <li>
                <strong>0</strong>
                <span>sign-offs an agent can make</span>
              </li>
            </ul>
          ) : null}
        </div>
      </section>

      <section className="lp-dark lp-faq-section" id="faq">
        <div className="lp-wrap">
          <div className="lp-faq-grid">
            <div className="lp-faq-intro" data-reveal>
              <p className="lp-kicker">Questions, answered</p>
              <h2>
                Clarity behind
                <br />
                every conclusion.
              </h2>
              <p>
                Explore how specialized agents work together—and how your team
                stays in control.
              </p>
              <ol className="lp-faq-flow" aria-label="Every control">
                {FAQ_FLOW.map(([icon, label]) => (
                  <li key={label}>
                    <span className="lp-faq-flow-icon" aria-hidden="true">
                      <UiIcon name={icon} size={17} />
                    </span>
                    {label}
                  </li>
                ))}
              </ol>
            </div>
            <div className="lp-faq" data-reveal>
              {FAQ.map((item, index) => (
                <details key={item.q} open={index === 0}>
                  <summary>
                    <span className="lp-faq-icon" aria-hidden="true">
                      <UiIcon name={item.icon} size={21} />
                    </span>
                    <span className="lp-faq-q">{item.q}</span>
                    <span className="lp-faq-toggle" aria-hidden="true" />
                  </summary>
                  <p>{item.a}</p>
                </details>
              ))}
            </div>
          </div>
          <div className="lp-faq-band" data-reveal>
            <h3>See the agents work on your controls.</h3>
            <a className="lp-btn lp-btn-primary lp-btn-lg" href="#demo">
              Book a private demo
              <UiIcon name="arrow" size={16} />
            </a>
          </div>
        </div>
      </section>

      <section className="lp-dark lp-cta" id="demo">
        <div className="lp-wrap">
          <div className="lp-cta-grid">
            <div className="lp-cta-copy" data-reveal>
              <p className="lp-kicker">A private walkthrough</p>
              <h2>
                See assurance
                <br />
                in motion.
              </h2>
              <p>
                Bring a control from your RCM. We'll show you how specialized
                agents plan the test, examine evidence, challenge findings, and
                prepare a reviewable workpaper.
              </p>
              <ul className="lp-cta-points">
                <li>
                  <span aria-hidden="true">
                    <UiIcon name="file" size={18} />
                  </span>
                  One control, end to end
                </li>
                <li>
                  <span aria-hidden="true">
                    <UiIcon name="database" size={18} />
                  </span>
                  Synthetic evidence available
                </li>
                <li>
                  <span aria-hidden="true">
                    <UiIcon name="agents" size={18} />
                  </span>
                  Auditor-led discussion
                </li>
              </ul>
              <p className="lp-cta-built">
                Built for SOX and internal audit teams
              </p>
            </div>
            <form
              className="lp-form"
              method="post"
              action="/welcome/demo"
              data-reveal
            >
              <div className="lp-form-head">
                <h3>Request your walkthrough</h3>
                <p>Tell us a little about your team.</p>
              </div>
              {notice !== null ? (
                <p
                  className={`lp-form-notice${notice === "sent" ? " is-good" : " is-warn"}`}
                  role="status"
                >
                  <UiIcon
                    name={notice === "sent" ? "check" : "info"}
                    size={14}
                  />
                  {WELCOME_NOTICES[notice]}
                </p>
              ) : null}
              <div className="lp-form-row">
                <label>
                  Full name
                  <input
                    name="name"
                    required
                    maxLength={200}
                    autoComplete="name"
                    placeholder="Your name"
                  />
                </label>
                <label>
                  Work email
                  <input
                    name="email"
                    type="email"
                    required
                    maxLength={200}
                    autoComplete="email"
                    placeholder="you@yourfirm.com"
                  />
                </label>
              </div>
              <label>
                Company or firm
                <input
                  name="firm"
                  maxLength={200}
                  autoComplete="organization"
                  placeholder="Your firm or company"
                />
              </label>
              <label>
                <span>
                  Primary focus <em>(optional)</em>
                </span>
                <span className="lp-select">
                  <select name="focus" defaultValue="">
                    <option value="">Choose one</option>
                    {DEMO_FOCUS.map((focus) => (
                      <option key={focus} value={focus}>
                        {focus}
                      </option>
                    ))}
                  </select>
                  <UiIcon name="chevron" size={16} />
                </span>
              </label>
              <div className="lp-honey" aria-hidden="true">
                <label>
                  Website
                  <input name="website" tabIndex={-1} autoComplete="off" />
                </label>
              </div>
              <button type="submit" className="lp-btn lp-btn-primary lp-btn-lg">
                Request a demo
                <UiIcon name="arrow" size={16} />
              </button>
              <p className="lp-form-fine">
                No client data required to get started.
              </p>
            </form>
          </div>
        </div>
      </section>

      <footer className="lp-footer">
        <div>
          <span className="lp-logo" aria-hidden="true">
            <UiIcon name="logo" size={15} />
          </span>
          <span>Audit Workforce</span>
        </div>
        <p>The agentic audit workspace, for every auditor.</p>
        <nav aria-label="Footer">
          <a href="#control">Product</a>
          <a href="#assurance">Assurance</a>
          <a href="#faq">FAQ</a>
          <a href="/sign-in">Sign in</a>
        </nav>
      </footer>
    </div>
  );
}
